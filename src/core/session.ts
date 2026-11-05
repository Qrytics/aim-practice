/**
 * Session state machine (pure, no DOM, no clock of its own).
 *
 *   ready ──requestLock──▶ requestingLock ──lockAcquired──▶ countdown ──▶ running ──▶ completed
 *     ▲                         │  ▲                           │            │
 *     │                lockDenied│  │requestLock               ▼            ▼
 *     └──────────────────────────┘  └────────────────────── paused ◀────────┘
 *   any state except error ──fail──▶ error (terminal; recovery = reload)
 *
 * Invariants (all covered by tests):
 *  - countdown and running are only entered through lockAcquired. Nothing
 *    else can reach active gameplay, so gameplay never starts without a lock.
 *  - Time only advances in countdown/running via tick(dt). Pauses, lock
 *    requests and stalls never consume countdown or drill time.
 *  - BOUNDARY POLICY (whole steps): tick(dt) is called once per fixed simulation
 *    step, AFTER that step was simulated. The step in which countdown reaches
 *    zero is a countdown step in full; time beyond zero inside it is DISCARDED,
 *    not credited to Running, because movement and firing were prohibited for
 *    that whole step. So Running time is always a whole number of Running steps.
 *    The same rule ends the run: the step that reaches the duration is the last.
 *    Comparisons use TIME_EPS so float noise in sums of 1/120 cannot add or drop
 *    a step.
 *  - A denied lock request returns to the state it came from (ready/paused)
 *    with a notice. The machine never re-requests by itself, so keyboard
 *    users are never trapped in a request loop; the UI offers an explicit retry.
 *  - Renderer loss pauses and blocks resume until restored (or fail()).
 */

/** Seconds. Absorbs float error when summing many 1/120 s steps. */
export const TIME_EPS = 1e-9;

export type SessionState =
  | 'ready'
  | 'requestingLock'
  | 'countdown'
  | 'running'
  | 'paused'
  | 'completed'
  | 'error';

export type ActivePhase = 'countdown' | 'running';

export type PauseReason =
  | 'lock-lost'
  | 'focus-lost'
  | 'hidden'
  | 'stall'
  | 'renderer-lost'
  | 'user';

export interface SessionConfig {
  /** seconds, design choice */
  countdownSeconds: number;
  /** seconds, design choice */
  runSeconds: number;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = { countdownSeconds: 3, runSeconds: 60 };

export interface SessionSnapshot {
  state: SessionState;
  pauseReason: PauseReason | null;
  /** Phase a paused session returns to (or a pending lock request leads to). */
  resumePhase: ActivePhase | null;
  /** Where a pending lock request came from, so a denial can return there. */
  requestOrigin: 'ready' | 'paused' | null;
  /** Human-readable reason the last lock request failed, if any. */
  lockNotice: string | null;
  countdownSeconds: number;
  countdownRemaining: number;
  runElapsed: number;
  runDuration: number;
  rendererLost: boolean;
  /** Total seconds of detected stalls (excluded from drill time and reported). */
  stalledSeconds: number;
  stallCount: number;
  error: { code: string; message: string } | null;
}

export class SessionMachine {
  private s: SessionSnapshot;

  constructor(private cfg: SessionConfig = DEFAULT_SESSION_CONFIG) {
    this.s = this.fresh();
  }

  private fresh(): SessionSnapshot {
    return {
      state: 'ready',
      pauseReason: null,
      resumePhase: null,
      requestOrigin: null,
      lockNotice: null,
      countdownSeconds: this.cfg.countdownSeconds,
      countdownRemaining: this.cfg.countdownSeconds,
      runElapsed: 0,
      runDuration: this.cfg.runSeconds,
      rendererLost: false,
      stalledSeconds: 0,
      stallCount: 0,
      error: null,
    };
  }

  get snapshot(): Readonly<SessionSnapshot> {
    return this.s;
  }

  get state(): SessionState {
    return this.s.state;
  }

  get isActive(): boolean {
    return this.s.state === 'countdown' || this.s.state === 'running';
  }

  /** Change the run length. Only allowed while Ready; a running or paused session keeps its length. */
  setRunSeconds(seconds: number): boolean {
    if (this.s.state !== 'ready') return false;
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3600) return false;
    this.cfg = { ...this.cfg, runSeconds: seconds };
    this.s.runDuration = seconds;
    return true;
  }

  /** User asked to start/resume. Returns false if not allowed (UI should not call lock then). */
  requestLock(): boolean {
    const s = this.s;
    if (s.rendererLost) return false;
    if (s.state === 'ready') {
      s.state = 'requestingLock';
      s.requestOrigin = 'ready';
      s.resumePhase = 'countdown';
      s.lockNotice = null;
      return true;
    }
    if (s.state === 'paused' && s.resumePhase) {
      s.state = 'requestingLock';
      s.requestOrigin = 'paused';
      s.lockNotice = null;
      return true;
    }
    return false;
  }

  /** Pointer lock is held. Returns false if the lock is unexpected and should be released. */
  lockAcquired(): boolean {
    const s = this.s;
    if (s.state !== 'requestingLock' || !s.resumePhase) return false;
    s.state = s.resumePhase;
    s.pauseReason = null;
    s.requestOrigin = null;
    return true;
  }

  /** The lock request failed or was refused. Goes back; never retries on its own. */
  lockDenied(notice: string): void {
    const s = this.s;
    if (s.state !== 'requestingLock') return;
    s.lockNotice = notice;
    if (s.requestOrigin === 'paused') {
      s.state = 'paused';
    } else {
      s.state = 'ready';
      s.resumePhase = null;
    }
    s.requestOrigin = null;
  }

  /** Pointer lock was released (Esc, alt-tab, browser policy). */
  lockLost(): void {
    const s = this.s;
    if (s.state === 'requestingLock') {
      this.lockDenied('Pointer lock was released before the session could start.');
      return;
    }
    this.pause('lock-lost');
  }

  /** Pauses active gameplay. No effect elsewhere. */
  pause(reason: PauseReason): void {
    const s = this.s;
    if (s.state !== 'countdown' && s.state !== 'running') return;
    s.resumePhase = s.state;
    s.state = 'paused';
    s.pauseReason = reason;
  }

  /** A frame gap too long to simulate: record it as excluded time and pause. */
  reportStall(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    this.s.stalledSeconds += seconds;
    this.s.stallCount += 1;
    this.pause('stall');
  }

  rendererLost(): void {
    this.s.rendererLost = true;
    this.pause('renderer-lost');
  }

  rendererRestored(): void {
    this.s.rendererLost = false;
  }

  /** Back to ready with timers reset. Allowed from every state except error. */
  restart(): boolean {
    const s = this.s;
    if (s.state === 'error') return false;
    const keep = { rendererLost: s.rendererLost };
    this.s = { ...this.fresh(), ...keep };
    return true;
  }

  /** Unrecoverable failure. Terminal; the UI offers a reload. */
  fail(code: string, message: string): void {
    this.s.state = 'error';
    this.s.error = { code, message };
    this.s.pauseReason = null;
    this.s.requestOrigin = null;
  }

  /**
   * Advance by ONE simulated step of `dt` seconds (called after that step ran).
   * Only countdown/running consume time. See BOUNDARY POLICY in the file header:
   * overshoot past the end of the countdown is discarded, never carried into Running.
   */
  tick(dt: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    const s = this.s;
    if (s.state === 'countdown') {
      s.countdownRemaining -= dt;
      if (s.countdownRemaining <= TIME_EPS) {
        s.countdownRemaining = 0;
        s.state = 'running';
        s.resumePhase = null;
      }
      return;
    }
    if (s.state === 'running') {
      s.runElapsed += dt;
      if (s.runElapsed >= s.runDuration - TIME_EPS) {
        s.runElapsed = s.runDuration;
        s.state = 'completed';
        s.resumePhase = null;
      }
    }
  }
}
