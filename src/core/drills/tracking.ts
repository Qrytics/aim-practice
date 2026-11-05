/**
 * Tracking drill ("Overwatch-inspired" practice profile; NOT a replica of any
 * game and NOT a hero/weapon profile: a faithful Overwatch profile needs
 * individual hero and weapon data this app does not have).
 *
 * One spherical target travels along a horizontal arc and changes direction and
 * speed at scheduled times. Hold the left mouse button to fire (hitscan, tested
 * every simulation step). Only time spent FIRING counts, and only Running steps
 * are simulated, so countdown, pauses and stalls are excluded by construction.
 *
 * Metrics (documented in docs/reference-notes.md):
 *   ratioActive = onTargetFiringSeconds / activeSeconds
 *   ratioFiring = onTargetFiringSeconds / firingSeconds   (null if firingSeconds == 0)
 *   firingSeconds
 * Firing on a step means the trigger was held for that whole step. On-target
 * means the aim ray hits the target sphere at the END of that step. All sizes,
 * speeds and timings are original design choices.
 */

import { Rng } from '../rng';
import { EYE_HEIGHT, aimErrorDeg, aimHitsSphere, type Vec3 } from '../geometry';
import { median, type Drill, type DrillEvent, type DrillFire, type DrillHud, type DrillStep, type DrillTarget } from '../drill';

export interface TrackingConfig {
  radius: number;
  arcRadius: number;
  thetaLimitDeg: number;
  speedMinDeg: number;
  speedMaxDeg: number;
  changeMin: number;
  changeMax: number;
  flipChance: number;
  yBase: number;
  yAmp: number;
  yRate: number;
  bucketSeconds: number;
  meterWindow: number;
  watchWindow: number;
  giveUpAfter: number;
}

export const TRACKING: TrackingConfig = {
  radius: 0.3, // m
  arcRadius: 9.2, // m from the arena centre (inside every post/wall)
  thetaLimitDeg: 55, // arc spans -55..+55 degrees about straight ahead (-z)
  speedMinDeg: 18, // deg/s of arc
  speedMaxDeg: 48,
  changeMin: 0.35, // s between scheduled direction/speed changes
  changeMax: 1.3,
  flipChance: 0.7, // chance a scheduled change reverses direction
  yBase: 1.45,
  yAmp: 0.35,
  yRate: 0.9, // rad/s
  bucketSeconds: 0.25, // results timeline resolution
  meterWindow: 1.0, // s of firing used by the live meter
  watchWindow: 0.6, // s after a change in which "held through" is judged
  giveUpAfter: 2.0, // s after losing the target following a change: counted as not recovered
};

export interface TrackingResult {
  kind: 'tracking';
  seed: number;
  activeSeconds: number;
  firingSeconds: number;
  onTargetFiringSeconds: number;
  ratioActive: number | null;
  ratioFiring: number | null;
  longestOnStreakSeconds: number;
  meanErrorDeg: number | null;
  directionChanges: number;
  heldThrough: number;
  medianReacquireSeconds: number | null;
  unrecovered: number;
  score: number;
  timeline: { bucketSeconds: number; firing: number[]; onTarget: number[] };
}

interface Watch {
  t0: number;
  lostAt: number | null;
  settled: boolean;
}

const DEG = Math.PI / 180;
const EPS = 1e-9;

export class TrackingDrill implements Drill<TrackingResult> {
  readonly kind = 'tracking' as const;
  private readonly rng: Rng;
  private t = 0;
  private theta: number; // degrees
  private omega: number; // deg/s, signed
  private phase: number;
  private nextChangeAt: number;
  private pos: Vec3;
  private onNow = false;
  private view: DrillTarget[];

  private firing = 0;
  private onTarget = 0;
  private streak = 0;
  private longestStreak = 0;
  private errSum = 0;
  private errN = 0;
  private changes = 0;
  private held = 0;
  private readonly reacquire: number[] = [];
  private unrecoveredCount = 0;
  private watches: Watch[] = [];
  private readonly bFiring: number[] = [];
  private readonly bOn: number[] = [];

  // rolling meter over the last meterWindow seconds of steps
  private win: Array<{ f: number; o: number }> = [];
  private winCap = 0;
  private winF = 0;
  private winO = 0;

  constructor(
    readonly seed: number,
    private readonly cfg: TrackingConfig = TRACKING,
  ) {
    this.rng = new Rng(seed);
    const start = Math.min(25, cfg.thetaLimitDeg * 0.45);
    this.theta = this.rng.range(-start, start);
    this.omega = (this.rng.chance(0.5) ? 1 : -1) * this.rng.range(this.cfg.speedMinDeg, this.cfg.speedMaxDeg);
    this.phase = this.rng.range(0, Math.PI * 2);
    this.nextChangeAt = this.rng.range(this.cfg.changeMin, this.cfg.changeMax);
    this.pos = this.position();
    this.view = [this.targetView(false)];
  }

  get targets(): readonly DrillTarget[] {
    return this.view;
  }

  private position(): Vec3 {
    const a = this.theta * DEG;
    return {
      x: Math.sin(a) * this.cfg.arcRadius,
      y: this.cfg.yBase + this.cfg.yAmp * Math.sin(this.phase),
      z: -Math.cos(a) * this.cfg.arcRadius,
    };
  }

  private targetView(hot: boolean): DrillTarget {
    return { id: 1, x: this.pos.x, y: this.pos.y, z: this.pos.z, r: this.cfg.radius, hot };
  }

  onFire(_f: DrillFire): void {
    // Tracking uses the held trigger, not discrete clicks.
  }

  private change(): void {
    this.changes++;
    this.watches.push({ t0: this.t, lostAt: null, settled: false });
  }

  step(s: DrillStep): void {
    const dt = s.dt;
    this.t += dt;

    // --- target motion (scheduled changes, then arc advance with reflection)
    if (this.t >= this.nextChangeAt - EPS) {
      const flip = this.rng.chance(this.cfg.flipChance);
      const mag = this.rng.range(this.cfg.speedMinDeg, this.cfg.speedMaxDeg);
      const dir = flip ? -Math.sign(this.omega || 1) : Math.sign(this.omega || 1);
      this.omega = dir * mag;
      this.nextChangeAt = this.t + this.rng.range(this.cfg.changeMin, this.cfg.changeMax);
      this.change();
    }
    this.theta += this.omega * dt;
    const lim = this.cfg.thetaLimitDeg;
    if (Math.abs(this.theta) > lim) {
      this.theta = Math.sign(this.theta) * lim;
      this.omega = -this.omega;
      this.change();
    }
    this.phase += this.cfg.yRate * dt;
    this.pos = this.position();

    // --- aim evaluation at the end of the step
    const on = aimHitsSphere(s.player, this.pos, this.cfg.radius);
    this.onNow = on;
    const firing = s.fireHeld;

    if (firing) {
      this.firing += dt;
      if (on) {
        this.onTarget += dt;
        this.streak += dt;
        if (this.streak > this.longestStreak) this.longestStreak = this.streak;
      } else {
        this.streak = 0;
      }
      this.errSum += aimErrorDeg(s.player, this.pos);
      this.errN++;
    } else {
      this.streak = 0;
    }

    const b = Math.floor((this.t - dt * 0.5) / this.cfg.bucketSeconds);
    while (this.bFiring.length <= b) {
      this.bFiring.push(0);
      this.bOn.push(0);
    }
    if (firing) {
      this.bFiring[b]! += dt;
      if (on) this.bOn[b]! += dt;
    }

    // --- rolling meter
    if (this.winCap === 0) this.winCap = Math.max(1, Math.round(this.cfg.meterWindow / dt));
    const entry = { f: firing ? 1 : 0, o: firing && on ? 1 : 0 };
    this.win.push(entry);
    this.winF += entry.f;
    this.winO += entry.o;
    if (this.win.length > this.winCap) {
      const old = this.win.shift()!;
      this.winF -= old.f;
      this.winO -= old.o;
    }

    // --- direction-change watchers: held through, or lost then re-acquired?
    for (const w of this.watches) {
      if (w.settled) continue;
      const age = this.t - w.t0;
      if (w.lostAt === null) {
        if (!on) w.lostAt = this.t;
        else if (age >= this.cfg.watchWindow) {
          w.settled = true;
          this.held++;
        }
      } else if (on) {
        this.reacquire.push(this.t - w.lostAt);
        w.settled = true;
      } else if (this.t - w.lostAt > this.cfg.giveUpAfter) {
        this.unrecoveredCount++;
        w.settled = true;
      }
    }
    this.watches = this.watches.filter((w) => !w.settled);

    this.view = [this.targetView(on)];
  }

  drainEvents(): DrillEvent[] {
    return [];
  }

  hud(): DrillHud {
    const live = this.winF > 0 ? this.winO / this.winF : null;
    return {
      primaryLabel: 'On target (last 1 s)',
      primaryValue: live === null ? '–' : `${Math.round(live * 100)}%`,
      stats: `${this.firing.toFixed(1)} s firing`,
      meter: live,
      hot: this.onNow,
    };
  }

  result(): TrackingResult {
    // Watchers still open at the end of the run: never decided "held through".
    const open = this.watches.filter((w) => !w.settled);
    const lostOpen = this.unrecoveredCount + open.filter((w) => w.lostAt !== null).length;
    const ratioActive = this.t > 0 ? this.onTarget / this.t : null;
    return {
      kind: 'tracking',
      seed: this.seed,
      activeSeconds: this.t,
      firingSeconds: this.firing,
      onTargetFiringSeconds: this.onTarget,
      ratioActive,
      ratioFiring: this.firing > 0 ? this.onTarget / this.firing : null,
      longestOnStreakSeconds: this.longestStreak,
      meanErrorDeg: this.errN > 0 ? this.errSum / this.errN : null,
      directionChanges: this.changes,
      heldThrough: this.held,
      medianReacquireSeconds: median(this.reacquire),
      unrecovered: lostOpen,
      score: ratioActive === null ? 0 : Math.round(1000 * ratioActive),
      timeline: { bucketSeconds: this.cfg.bucketSeconds, firing: [...this.bFiring], onTarget: [...this.bOn] },
    };
  }
}

export const _eye = EYE_HEIGHT;
