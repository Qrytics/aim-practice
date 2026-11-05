/**
 * Fixed-step simulation (120 Hz by default) fed by TIMESTAMPED inputs.
 *
 * ORDERING RULE
 *   Simulation time advances in whole steps of dt = 1 / stepHz. For the step
 *   covering (stepStart, stepEnd]:
 *     1. every queued input with t <= stepEnd is applied, in timestamp order
 *        (ties keep arrival order);
 *     2. then movement is integrated once for the step.
 *   So a look delta stamped inside a step turns the view before that step
 *   moves the player (input is quantised to step boundaries: at most one step,
 *   8.33 ms at 120 Hz). A fire event reads the aim after every look delta
 *   stamped at or before it and before any stamped after it, so a flick that
 *   precedes a click always lands first. Fire reads the player position from
 *   the last completed step.
 *   Inputs stamped after the last completed step wait in the queue; they are
 *   never applied early. Inputs stamped before the already-simulated time
 *   (late delivery) are applied at the next step and counted in `lateInputs`.
 *
 * REPRODUCIBILITY
 *   Results depend only on the input timestamps and step size, not on how
 *   frames chunk the timeline, provided each input is delivered before the
 *   advance that reaches its timestamp. This is SIMULATION reproducibility.
 *   It says nothing about real input latency, OS/browser event batching or
 *   display refresh behaviour, which must be measured on real hardware.
 *
 * PHASES (decided INSIDE the step loop, per step)
 *   Before each step the StepClock reports the phase from the state at the
 *   START of that step; after the step the clock advances by exactly dt.
 *     countdown: look applies; player translation is frozen (velocity is held
 *                at zero) and fire events are discarded and counted.
 *     running:   look, movement and fire all apply.
 *     inactive:  nothing is simulated. advance() drops queued input, held
 *                keys and player velocity (resume starts from rest), moves the
 *                clock to `now` and returns 0 steps, so paused time advances
 *                neither the simulation nor the session.
 *   If the clock turns inactive after a step (e.g. the run completes), cleanup
 *   (queued input, held keys, velocity) happens immediately after THAT step,
 *   before advance() returns, even when it was the last step the frame allowed;
 *   remaining allowed steps are not simulated.
 *   Boundary (whole-step policy, see SessionMachine): the step during which
 *   countdown time reaches zero is a countdown step in full; its overshoot is
 *   discarded, NOT carried into run time. The next step is the first running
 *   step. A fire stamped in or before the last countdown step is discarded;
 *   one stamped in the first running step is delivered.
 *
 * STALLS
 *   A gap longer than maxFrameGap is never simulated or silently skipped:
 *   advance() reports it as `stalledSeconds` and does not move the clock, so
 *   the caller can record it and pause.
 */

import { HeldInput, isMoveKey, type InputEvent } from './input';
import { ALWAYS_RUNNING, type StepClock, type StepPhase } from './stepClock';
import {
  DEFAULT_MOVEMENT,
  createPlayer,
  stepMovement,
  type ArenaBounds,
  type MovementConfig,
  type PlayerState,
} from './movement';

export const DEFAULT_STEP_HZ = 120;
export const DEFAULT_MAX_FRAME_GAP = 0.25;
export const PITCH_LIMIT_DEG = 89;

const DEG = Math.PI / 180;

export interface SimConfig {
  stepHz: number;
  /** seconds; a longer frame gap is reported as a stall instead of simulated */
  maxFrameGap: number;
  movement: MovementConfig;
  bounds: ArenaBounds;
}

export interface FireEvent {
  t: number;
  yaw: number;
  pitch: number;
  x: number;
  z: number;
  /** Horizontal speed at the shot (from the last completed step), m/s. */
  speed: number;
  /** Length of one simulation step, s. */
  dt: number;
}

/** Passed to onStep after each RUNNING step has been simulated. */
export interface StepInfo {
  dt: number;
  player: PlayerState;
  fireHeld: boolean;
}

export interface AdvanceResult {
  /** Steps actually simulated (may be fewer than the frame allowed if the clock went inactive). */
  steps: number;
  /** Seconds of an over-long frame gap that were NOT simulated (0 if none). */
  stalledSeconds: number;
  lateInputs: number;
}

export class Simulation {
  readonly player: PlayerState;
  readonly held = new HeldInput();
  readonly dt: number;

  /** Last simulated time, seconds, on the input timeline. */
  simTime: number;
  /** Net horizontal turn since the last reset, degrees (calibration aid only). */
  calibrationTurnDeg = 0;
  /** Degrees of rotation per browser input unit. */
  degreesPerUnit: number;
  onFire: ((e: FireEvent) => void) | null = null;
  /** Called after every RUNNING step (never during countdown or while inactive). */
  onStep: ((s: StepInfo) => void) | null = null;
  /** Trigger is held and the last trigger-down happened in a Running step. */
  triggerHeld = false;
  /** Fire events discarded because the step's phase was not running (diagnostic). */
  firesDiscarded = 0;

  private queue: InputEvent[] = [];
  private seq = 0;
  private order = new WeakMap<InputEvent, number>();

  constructor(
    startTime: number,
    startX: number,
    startZ: number,
    degreesPerUnit: number,
    readonly config: SimConfig = {
      stepHz: DEFAULT_STEP_HZ,
      maxFrameGap: DEFAULT_MAX_FRAME_GAP,
      movement: DEFAULT_MOVEMENT,
      bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
    },
  ) {
    this.dt = 1 / config.stepHz;
    this.simTime = startTime;
    this.player = createPlayer(startX, startZ);
    this.degreesPerUnit = degreesPerUnit;
  }

  push(ev: InputEvent): void {
    this.order.set(ev, this.seq++);
    this.queue.push(ev);
  }

  /** Drop pending input, held keys and the held trigger (blur, lock loss, pause). */
  clearInput(): void {
    this.queue.length = 0;
    this.held.reset();
    this.triggerHeld = false;
  }

  /** Entering any inactive state: drop input and stop the player, so resume starts from rest. */
  private goInactive(): void {
    this.triggerHeld = false;
    this.clearInput();
    this.player.vx = 0;
    this.player.vz = 0;
  }

  /** Move the clock to `now` without simulating (after a pause or stall). */
  resync(now: number): void {
    this.simTime = now;
  }

  resetCalibration(): void {
    this.calibrationTurnDeg = 0;
  }

  advance(now: number, clock: StepClock = ALWAYS_RUNNING): AdvanceResult {
    if (clock.phase() === 'inactive') {
      // Paused/ready/completed: simulate nothing, keep no stale input or motion.
      this.goInactive();
      this.simTime = now;
      return { steps: 0, stalledSeconds: 0, lateInputs: 0 };
    }
    const gap = now - this.simTime;
    if (gap > this.config.maxFrameGap) {
      return { steps: 0, stalledSeconds: gap, lateInputs: 0 };
    }
    // Small epsilon so a frame landing exactly on a boundary is not lost to rounding.
    const allowed = gap > 0 ? Math.floor(gap / this.dt + 1e-9) : 0;
    let late = 0;
    let done = 0;
    if (allowed > 0 && this.queue.length > 1) {
      this.queue.sort((a, b) => a.t - b.t || (this.order.get(a) ?? 0) - (this.order.get(b) ?? 0));
    }
    for (let i = 0; i < allowed; i++) {
      const phase = clock.phase();
      if (phase === 'inactive') {
        this.goInactive(); // defensive: the clock can also go inactive between calls
        break;
      }
      const stepStart = this.simTime;
      const stepEnd = stepStart + this.dt;
      let n = 0;
      while (n < this.queue.length && this.queue[n]!.t <= stepEnd + 1e-12) {
        const ev = this.queue[n]!;
        if (ev.t < stepStart - 1e-12) late++;
        this.apply(ev, phase);
        n++;
      }
      if (n > 0) this.queue.splice(0, n);
      if (phase === 'running') {
        stepMovement(this.player, this.held.axes(), this.dt, this.config.movement, this.config.bounds);
        this.onStep?.({ dt: this.dt, player: this.player, fireHeld: this.triggerHeld });
      } else {
        this.player.vx = 0;
        this.player.vz = 0;
      }
      this.simTime = stepEnd;
      done++;
      clock.advance(this.dt);
      // The step just simulated may have been the last one (run completed). Clean up now,
      // even if it was also the last step this frame allowed, so no later frame is needed.
      if (clock.phase() === 'inactive') {
        this.goInactive();
        break;
      }
    }
    return { steps: done, stalledSeconds: 0, lateInputs: late };
  }

  private apply(ev: InputEvent, phase: StepPhase): void {
    const p = this.player;
    switch (ev.type) {
      case 'look': {
        const dpu = this.degreesPerUnit;
        p.yaw -= ev.dx * dpu * DEG;
        const limit = PITCH_LIMIT_DEG * DEG;
        p.pitch = Math.max(-limit, Math.min(limit, p.pitch - ev.dy * dpu * DEG));
        this.calibrationTurnDeg += ev.dx * dpu;
        break;
      }
      case 'key':
        if (isMoveKey(ev.code)) this.held.set(ev.code, ev.down);
        break;
      case 'fire':
        if (phase === 'running') {
          this.onFire?.({
            t: ev.t,
            yaw: p.yaw,
            pitch: p.pitch,
            x: p.x,
            z: p.z,
            speed: Math.hypot(p.vx, p.vz),
            dt: this.dt,
          });
        } else this.firesDiscarded++;
        break;
      case 'trigger':
        // Holding the trigger from the countdown does not start firing: press again in Running.
        this.triggerHeld = ev.down && phase === 'running';
        break;
      case 'reset':
        this.held.reset();
        this.triggerHeld = false;
        break;
    }
  }
}
