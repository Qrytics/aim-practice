/**
 * Grid drill ("gridshot"-style speed and accuracy practice; an original drill).
 *
 * Several spherical targets stay on a wall in front of you. Shooting one
 * removes it and a new one appears elsewhere on the wall, so there is always
 * the same number to choose from. Hitscan, one click per shot, no timeout:
 * the pace is yours.
 *
 * Every size, count and scoring value below is an ORIGINAL design choice.
 */

import { Rng } from '../rng';
import { EYE_HEIGHT, aimErrorDeg, aimHitsSphere } from '../geometry';
import { median, type Drill, type DrillEvent, type DrillFire, type DrillHud, type DrillStep, type DrillTarget } from '../drill';

export interface GridConfig {
  count: number; // targets on the wall at once
  radius: number; // m
  wallZ: number; // m, wall plane (negative = in front of the start position)
  halfWidth: number; // m, targets span -halfWidth..+halfWidth in x
  yMin: number;
  yMax: number;
  minSpacing: number; // m between target centres
  minShotInterval: number; // s
  hitPoints: number;
  quickBonusMax: number;
  quickWindow: number; // s since the previous kill (or start) for the full bonus
  missPenalty: number;
}

export const GRID: GridConfig = {
  count: 3,
  radius: 0.28,
  wallZ: -9,
  halfWidth: 3.6,
  yMin: 0.8,
  yMax: 2.5,
  minSpacing: 1.1,
  minShotInterval: 0.06,
  hitPoints: 100,
  quickBonusMax: 50,
  quickWindow: 0.8,
  missPenalty: 25,
};

export interface GridResult {
  kind: 'grid';
  seed: number;
  activeSeconds: number;
  shots: number;
  hits: number;
  misses: number;
  rushedBlocked: number;
  accuracy: number | null;
  /** Kills per second over the whole run (activeSeconds > 0). */
  killsPerSecond: number | null;
  medianKillInterval: number | null;
  bestStreak: number;
  medianFlickDeg: number | null;
  score: number;
  /** Kills in each 5 s slice of the run, for the results timeline. */
  killsPerSlice: number[];
  sliceSeconds: number;
}

interface Live {
  id: number;
  x: number;
  y: number;
  z: number;
}

const SLICE = 5;
const EPS = 1e-9;

export class GridDrill implements Drill<GridResult> {
  readonly kind = 'grid' as const;
  private readonly rng: Rng;
  private t = 0;
  private live: Live[] = [];
  private nextId = 1;
  private lastShotT = -Infinity;
  private lastKillT = 0;
  private events: DrillEvent[] = [];
  private view: DrillTarget[] = [];

  private shots = 0;
  private hits = 0;
  private misses = 0;
  private rushed = 0;
  private streak = 0;
  private best = 0;
  private points = 0;
  private readonly intervals: number[] = [];
  private readonly flicks: number[] = [];
  private readonly slices: number[] = [];

  constructor(
    readonly seed: number,
    private readonly cfg: GridConfig = GRID,
  ) {
    this.rng = new Rng(seed);
    for (let i = 0; i < cfg.count; i++) this.addTarget();
    this.syncView();
  }

  get targets(): readonly DrillTarget[] {
    return this.view;
  }

  private syncView(): void {
    this.view = this.live.map((l) => ({ id: l.id, x: l.x, y: l.y, z: l.z, r: this.cfg.radius }));
  }

  private addTarget(): void {
    const c = this.cfg;
    let x = 0;
    let y = 0;
    for (let tries = 0; tries < 40; tries++) {
      x = this.rng.range(-c.halfWidth, c.halfWidth);
      y = this.rng.range(c.yMin, c.yMax);
      if (this.live.every((o) => Math.hypot(o.x - x, o.y - y) >= c.minSpacing)) break;
    }
    this.live.push({ id: this.nextId++, x, y, z: c.wallZ });
  }

  step(s: DrillStep): void {
    this.t += s.dt;
  }

  onFire(f: DrillFire): void {
    const c = this.cfg;
    const shotT = this.t + f.dt;
    if (shotT - this.lastShotT < c.minShotInterval - EPS) {
      this.rushed++;
      return;
    }
    this.lastShotT = shotT;
    this.shots++;

    // Nearest hit along the ray: the target whose centre is closest to the aim wins on overlap.
    let hit: Live | null = null;
    let bestErr = Infinity;
    for (const l of this.live) {
      if (aimHitsSphere(f, l, c.radius)) {
        const err = aimErrorDeg(f, l);
        if (err < bestErr) {
          bestErr = err;
          hit = l;
        }
      }
    }

    if (hit) {
      const since = shotT - this.lastKillT;
      this.hits++;
      this.streak++;
      if (this.streak > this.best) this.best = this.streak;
      this.intervals.push(since);
      this.flicks.push(bestErr);
      this.points += c.hitPoints + c.quickBonusMax * Math.max(0, 1 - since / c.quickWindow);
      this.lastKillT = shotT;
      const slice = Math.floor(shotT / SLICE);
      while (this.slices.length <= slice) this.slices.push(0);
      this.slices[slice]!++;
      this.events.push({ type: 'hit', id: hit.id, x: hit.x, y: hit.y, z: hit.z });
      this.live = this.live.filter((l) => l !== hit);
      this.addTarget();
      this.syncView();
    } else {
      this.misses++;
      this.streak = 0;
      this.points -= c.missPenalty;
      this.events.push({ type: 'miss' });
    }
  }

  drainEvents(): DrillEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  hud(): DrillHud {
    const acc = this.shots > 0 ? Math.round((100 * this.hits) / this.shots) : null;
    return {
      primaryLabel: 'Hits',
      primaryValue: String(this.hits),
      stats: `${acc === null ? 'no shots yet' : `${acc}% accuracy`} · streak ${this.streak}`,
      meter: null,
      hot: false,
    };
  }

  result(): GridResult {
    const slices = [...this.slices];
    const n = Math.max(slices.length, Math.ceil(this.t / SLICE));
    while (slices.length < n) slices.push(0);
    return {
      kind: 'grid',
      seed: this.seed,
      activeSeconds: this.t,
      shots: this.shots,
      hits: this.hits,
      misses: this.misses,
      rushedBlocked: this.rushed,
      accuracy: this.shots > 0 ? this.hits / this.shots : null,
      killsPerSecond: this.t > 0 ? this.hits / this.t : null,
      medianKillInterval: median(this.intervals),
      bestStreak: this.best,
      medianFlickDeg: median(this.flicks),
      score: Math.max(0, Math.round(this.points)),
      killsPerSlice: slices,
      sliceSeconds: SLICE,
    };
  }
}

export const _gridEye = EYE_HEIGHT;
