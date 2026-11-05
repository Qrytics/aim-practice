/**
 * Pointer-lock request lifecycle, free of DOM so event/promise ordering can be
 * unit tested with a fake port.
 *
 * AUTHORITY
 *   `port.owns()` (document.pointerLockElement === canvas) is the only truth
 *   about whether we hold the lock. Events and promises are only prompts to
 *   re-check it (`sync()`), never proof by themselves.
 *
 * ONE ATTEMPT AT A TIME
 *   request() while an attempt is in flight is coalesced (no second browser
 *   request). cancel() only marks the attempt unwanted; if the user asks again
 *   while the browser has not answered, that same attempt is adopted instead of
 *   issuing an overlapping request. A lock that arrives for an unwanted attempt
 *   is reported as `onUnexpectedLock` (the caller releases it), never as success.
 *
 * ORDERING (promise API)
 *   - Success may be seen first through `pointerlockchange` or through the
 *     promise; either path reaches the same `sync()`, and `onAcquired` fires at
 *     most once per attempt. The promise decides the mode label.
 *   - A `pointerlockerror` event is IGNORED while a promise is outstanding: the
 *     promise settles the outcome. This is what stops an intermediate
 *     unadjusted-movement rejection from being reported as a failure when the
 *     default-mode fallback then succeeds.
 *   - Rejection with NotSupportedError during the unadjusted phase starts ONE
 *     fallback request without options. Any other rejection, or a fallback
 *     rejection, is terminal: `onDenied` once, no retry.
 *   - A promise that settles after the attempt was superseded (lock lost,
 *     cancelled-and-released, replaced) is ignored: it cannot re-acquire,
 *     deny, or change the label.
 * LEGACY (request returns undefined)
 *   Outcome comes from events only. `pointerlockerror` is then the failure
 *   signal. The label can never be 'unadjusted': a void-returning API gives no
 *   confirmation that the option applied, so a successful lock is 'unconfirmed'.
 * MODE LABEL
 *   Cleared to 'none' when a NEW attempt starts, so a failed request cannot
 *   keep an older success label. Plain lock loss keeps the last label (it
 *   describes the lock that just ended). The label is only ever set while
 *   `owns()` is true.
 * NO RETRY LOOPS
 *   The only automatic second request is the single NotSupportedError fallback.
 *   After any denial nothing is requested until request() is called again by
 *   the user.
 */

export type MovementMode = 'none' | 'unadjusted' | 'default-os-adjusted' | 'unconfirmed';

export interface LockPort {
  /** May return a promise (Pointer Lock 2.0), undefined (legacy), or throw. */
  request(options?: { unadjustedMovement: boolean }): Promise<void> | void;
  owns(): boolean;
}

export interface LockHandlers {
  /** We hold the lock for the attempt the user asked for. At most once per attempt. */
  onAcquired(): void;
  /** The wanted attempt failed. Terminal for that attempt. */
  onDenied(message: string): void;
  /** A lock we held was lost. */
  onLost(): void;
  /** A lock appeared that nobody is waiting for (cancelled/superseded). Caller should release it. */
  onUnexpectedLock(): void;
  onMode(mode: MovementMode): void;
}

type Phase = 'unadjusted' | 'default';

interface Attempt {
  id: number;
  phase: Phase;
  hasPromise: boolean;
  wanted: boolean;
  acquired: boolean;
}

export type RequestResult = 'started' | 'reused' | 'ignored';

function isThenable(v: unknown): v is Promise<void> {
  return typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function';
}

export function describeLockError(err: unknown): string {
  const name = typeof err === 'object' && err !== null ? String((err as { name?: unknown }).name ?? '') : '';
  const message = typeof err === 'object' && err !== null ? String((err as { message?: unknown }).message ?? '') : '';
  if (name || message) return `${name || 'Error'}: ${message || 'pointer lock request failed'}`;
  return 'Pointer lock request failed.';
}

function errorName(err: unknown): string {
  return typeof err === 'object' && err !== null ? String((err as { name?: unknown }).name ?? '') : '';
}

export class LockCoordinator {
  private attempt: Attempt | null = null;
  private nextId = 1;
  private held = false;
  /** The lock we currently hold was never wanted; its loss is not reported as onLost. */
  private heldUnexpected = false;
  private _mode: MovementMode = 'none';

  constructor(
    private readonly port: LockPort,
    private readonly h: LockHandlers,
  ) {}

  get mode(): MovementMode {
    return this._mode;
  }

  /** True while a browser request is outstanding (wanted or not). */
  get inFlight(): boolean {
    return this.attempt !== null;
  }

  request(): RequestResult {
    if (this.port.owns()) return 'ignored';
    const existing = this.attempt;
    if (existing) {
      if (existing.wanted) return 'ignored';
      existing.wanted = true; // adopt: no overlapping browser request
      return 'reused';
    }
    this.setMode('none');
    const a: Attempt = { id: this.nextId++, phase: 'unadjusted', hasPromise: false, wanted: true, acquired: false };
    this.attempt = a;
    this.issue(a, { unadjustedMovement: true });
    return 'started';
  }

  /** The user gave up waiting. The browser request itself cannot be withdrawn. */
  cancel(): void {
    if (this.attempt && !this.attempt.acquired) this.attempt.wanted = false;
  }

  /** `pointerlockchange` fired. */
  handleChange(): void {
    this.sync();
  }

  /** `pointerlockerror` fired. */
  handleError(): void {
    const a = this.attempt;
    if (!a || a.hasPromise || a.acquired) return; // promise API: the promise decides
    this.fail(a, 'The browser refused pointer lock.');
  }

  private setMode(m: MovementMode): void {
    if (this._mode !== m) {
      this._mode = m;
      this.h.onMode(m);
    }
  }

  private issue(a: Attempt, options?: { unadjustedMovement: boolean }): void {
    let ret: Promise<void> | void;
    try {
      ret = this.port.request(options);
    } catch (err) {
      a.hasPromise = true; // treat a synchronous throw like a rejection
      this.onReject(a.id, err);
      return;
    }
    if (isThenable(ret)) {
      a.hasPromise = true;
      ret.then(
        () => this.onResolve(a.id),
        (err: unknown) => this.onReject(a.id, err),
      );
    } else {
      a.hasPromise = false;
    }
  }

  /** Reconcile with the authoritative ownership. */
  private sync(): void {
    const owns = this.port.owns();
    if (owns && !this.held) {
      this.held = true;
      const a = this.attempt;
      if (a && a.wanted && !a.acquired) {
        a.acquired = true;
        if (!a.hasPromise) {
          this.setMode('unconfirmed'); // legacy: acquired, but nothing confirms the option applied
          this.attempt = null;
        }
        this.h.onAcquired();
      } else {
        this.attempt = null; // stale/unwanted attempt: its late outcome is now irrelevant
        this.heldUnexpected = true;
        this.h.onUnexpectedLock();
      }
    } else if (!owns && this.held) {
      this.held = false;
      if (this.attempt?.acquired) this.attempt = null; // supersede: a late promise must not act
      const unexpected = this.heldUnexpected;
      this.heldUnexpected = false;
      if (!unexpected) this.h.onLost();
    }
  }

  private onResolve(id: number): void {
    const a = this.attempt;
    if (!a || a.id !== id) return; // superseded: ignore
    this.sync();
    if (this.attempt !== a) return; // sync() retired it (unexpected lock)
    if (a.acquired && this.port.owns()) {
      this.setMode(a.phase === 'unadjusted' ? 'unadjusted' : 'default-os-adjusted');
      this.attempt = null;
      return;
    }
    // Resolved without us owning the lock and without ever observing it.
    this.fail(a, 'The pointer lock was released before the session could start.');
  }

  private onReject(id: number, err: unknown): void {
    const a = this.attempt;
    if (!a || a.id !== id) return;
    if (this.port.owns()) {
      // Ownership wins over a contradictory rejection; nothing confirms the option applied.
      this.sync();
      if (this.attempt === a && a.acquired) {
        this.setMode('unconfirmed');
        this.attempt = null;
      }
      return;
    }
    if (a.phase === 'unadjusted' && !a.acquired && errorName(err) === 'NotSupportedError') {
      a.phase = 'default';
      this.issue(a, undefined); // the one permitted fallback
      return;
    }
    this.fail(a, describeLockError(err));
  }

  private fail(a: Attempt, message: string): void {
    if (this.attempt === a) this.attempt = null;
    this.setMode('none');
    if (a.wanted) this.h.onDenied(message);
  }
}
