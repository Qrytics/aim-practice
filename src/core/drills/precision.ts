/**
 * Precision drill ("Valorant-inspired" practice profile; NOT a replica of any game).
 *
 * One static spherical target at a time appears away from where you are aiming.
 * Flick to it, settle, and click once. Hitscan: the shot is a ray from the eye
 * along the aim, tested against the target sphere at the END of the simulation
 * step the click is applied in. Scenery never blocks a shot (spawn rules keep
 * targets in front of every wall and post).
 *
 * Everything below is an ORIGINAL design choice, not a measured or sourced game
 * value: sizes, timings, the settled-speed threshold, the minimum shot interval
 * and the scoring formula.
 */

import { Rng } from '../rng';
import {
  EYE_HEIGHT,
  aimDirection,
  aimErrorDeg,
  aimHitsSphere,
  type Vec3,
} from '../geometry';
import { median, type Drill, type DrillEvent, type DrillFire, type DrillHud, type DrillStep, type DrillTarget } from '../drill';

export interface PrecisionConfig {
  targetRadius: number;
  firstSpawnDelay: number;
  respawnDelay: number;
  lifetime: number;
  minShotInterval: number;
  settledSpeed: number;
  distMin: number;
  distMax: number;
  flickMinDeg: number;
  flickMaxDeg: number;
  elevMinDeg: number;
  elevMaxDeg: number;
  maxRadiusFromOrigin: number;
  yMin: number;
  yMax: number;
  minDistanceToPlayer: number;
  hitPoints: number;
  quickBonusMax: number;
  quickWindow: number;
  movingPenalty: number;
  missPenalty: number;
  expirePenalty: number;
}

export const PRECISION: PrecisionConfig = {
  targetRadius: 0.21, // m
  firstSpawnDelay: 0.5, // s after Running starts
  respawnDelay: 0.3, // s after a hit/timeout
  lifetime: 2.2, // s a target stays before timing out
  minShotInterval: 0.22, // s; faster clicks are ignored (deliberate cadence)
  settledSpeed: 1.0, // m/s; faster than this at the shot = "moving shot"
  distMin: 6, // m from the player
  distMax: 11,
  flickMinDeg: 20, // azimuth offset from where you are looking
  flickMaxDeg: 110,
  elevMinDeg: -4,
  elevMaxDeg: 10,
  maxRadiusFromOrigin: 9.3, // keeps targets inside every post/wall (see arena.ts)
  yMin: 0.9,
  yMax: 2.4,
  minDistanceToPlayer: 4,
  // scoring (original)
  hitPoints: 100,
  quickBonusMax: 50,
  quickWindow: 1.0, // s; full bonus at 0, none at/after this
  movingPenalty: 40,
  missPenalty: 20,
  expirePenalty: 10,
};

export type ShotOutcome =
  | { kind: 'hit'; t: number; timeToHit: number; moving: boolean; flickDeg: number }
  | { kind: 'miss'; t: number; moving: boolean; /** age of the live target, or null if none */ age: number | null }
  | { kind: 'expire'; t: number };

export interface PrecisionResult {
  kind: 'precision';
  seed: number;
  /** Running time simulated, seconds (countdown and pauses excluded). */
  activeSeconds: number;
  targetsSpawned: number;
  shots: number;
  hits: number;
  misses: number;
  expired: number;
  /** Clicks ignored because they came faster than minShotInterval. */
  rushedBlocked: number;
  /** hits / shots, or null when no shots were fired. */
  accuracy: number | null;
  medianTimeToHit: number | null;
  bestTimeToHit: number | null;
  movingShots: number;
  movingHits: number;
  settledShots: number;
  settledHits: number;
  movingAccuracy: number | null;
  settledAccuracy: number | null;
  medianFlickDeg: number | null;
  /** Target lifetime and speed-bonus window of this run's configuration, seconds (for the results graphic). */
  lifetime: number;
  quickWindow: number;
  score: number;
  outcomes: ShotOutcome[];
}

interface Live {
  id: number;
  pos: Vec3;
  spawnT: number;
  flickDeg: number;
}

const EPS = 1e-9;
const DEG = Math.PI / 180;

export class PrecisionDrill implements Drill<PrecisionResult> {
  readonly kind = 'precision' as const;
  private readonly rng: Rng;
  private t = 0;
  private nextSpawnAt = 0;
  private live: Live | null = null;
  private nextId = 1;
  private lastShotT = -Infinity;
  private events: DrillEvent[] = [];
  private view: DrillTarget[] = [];

  private spawned = 0;
  private shots = 0;
  private hits = 0;
  private misses = 0;
  private expired = 0;
  private rushed = 0;
  private movingShots = 0;
  private movingHits = 0;
  private settledShots = 0;
  private settledHits = 0;
  private points = 0;
  private readonly tths: number[] = [];
  private readonly flicks: number[] = [];
  private readonly outcomes: ShotOutcome[] = [];

  constructor(
    readonly seed: number,
    private readonly cfg: PrecisionConfig = PRECISION,
  ) {
    this.rng = new Rng(seed);
    this.nextSpawnAt = cfg.firstSpawnDelay;
  }

  get targets(): readonly DrillTarget[] {
    return this.view;
  }

  private syncView(): void {
    const l = this.live;
    this.view = l ? [{ id: l.id, x: l.pos.x, y: l.pos.y, z: l.pos.z, r: this.cfg.targetRadius }] : [];
  }

  /** Time out the live target if `now` is past its lifetime. */
  private expireIfDue(now: number): void {
    const l = this.live;
    if (l && now > l.spawnT + this.cfg.lifetime + EPS) {
      this.expired++;
      this.points -= this.cfg.expirePenalty;
      this.outcomes.push({ kind: 'expire', t: l.spawnT + this.cfg.lifetime });
      this.events.push({ type: 'expire', id: l.id });
      this.live = null;
      this.nextSpawnAt = l.spawnT + this.cfg.lifetime + this.cfg.respawnDelay;
      this.syncView();
    }
  }

  onFire(f: DrillFire): void {
    const shotT = this.t + f.dt; // quantised to the end of the step the click was applied in
    this.expireIfDue(shotT);
    if (shotT - this.lastShotT < this.cfg.minShotInterval - EPS) {
      this.rushed++;
      return;
    }
    this.lastShotT = shotT;
    this.shots++;
    const moving = f.speed > this.cfg.settledSpeed;
    if (moving) this.movingShots++;
    else this.settledShots++;

    const l = this.live;
    if (l && aimHitsSphere(f, l.pos, this.cfg.targetRadius)) {
      const tth = shotT - l.spawnT;
      this.hits++;
      if (moving) this.movingHits++;
      else this.settledHits++;
      this.tths.push(tth);
      this.flicks.push(l.flickDeg);
      const bonus = this.cfg.quickBonusMax * Math.max(0, 1 - tth / this.cfg.quickWindow);
      this.points += this.cfg.hitPoints + bonus - (moving ? this.cfg.movingPenalty : 0);
      this.outcomes.push({ kind: 'hit', t: shotT, timeToHit: tth, moving, flickDeg: l.flickDeg });
      this.events.push({ type: 'hit', id: l.id, x: l.pos.x, y: l.pos.y, z: l.pos.z });
      this.live = null;
      this.nextSpawnAt = shotT + this.cfg.respawnDelay;
      this.syncView();
    } else {
      this.misses++;
      this.points -= this.cfg.missPenalty;
      this.outcomes.push({ kind: 'miss', t: shotT, moving, age: l ? shotT - l.spawnT : null });
      this.events.push({ type: 'miss' });
    }
  }

  step(s: DrillStep): void {
    this.t += s.dt;
    this.expireIfDue(this.t);
    if (!this.live && this.t >= this.nextSpawnAt - EPS) this.spawn(s.player);
  }

  private spawn(p: { x: number; z: number; yaw: number; pitch: number }): void {
    const C = this.cfg;
    let pos: Vec3 | null = null;
    for (let i = 0; i < 24 && !pos; i++) {
      const sign = this.rng.chance(0.5) ? 1 : -1;
      const az = p.yaw + sign * this.rng.range(C.flickMinDeg, C.flickMaxDeg) * DEG;
      const dist = this.rng.range(C.distMin, C.distMax);
      const elev = this.rng.range(C.elevMinDeg, C.elevMaxDeg) * DEG;
      const x = p.x - Math.sin(az) * dist;
      const z = p.z - Math.cos(az) * dist;
      const y = Math.min(C.yMax, Math.max(C.yMin, EYE_HEIGHT + Math.tan(elev) * dist));
      if (Math.hypot(x, z) > C.maxRadiusFromOrigin) continue;
      if (Math.hypot(x - p.x, z - p.z) < C.minDistanceToPlayer) continue;
      pos = { x, y, z };
    }
    if (!pos) {
      // Deterministic fallback: a point on a ring around the arena centre, away from the player.
      const az = this.rng.range(0, Math.PI * 2);
      pos = { x: Math.sin(az) * 8, y: this.rng.range(1.2, 2.0), z: -Math.cos(az) * 8 };
    }
    const id = this.nextId++;
    this.spawned++;
    const flickDeg = aimErrorDeg({ x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch }, pos);
    this.live = { id, pos, spawnT: this.t, flickDeg };
    this.events.push({ type: 'spawn', id });
    this.syncView();
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
      stats: `${acc === null ? 'no shots yet' : `${acc}% accuracy`} · ${this.shots} shots`,
      meter: null,
      hot: false,
    };
  }

  result(): PrecisionResult {
    const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
    return {
      kind: 'precision',
      seed: this.seed,
      activeSeconds: this.t,
      targetsSpawned: this.spawned,
      shots: this.shots,
      hits: this.hits,
      misses: this.misses,
      expired: this.expired,
      rushedBlocked: this.rushed,
      accuracy: ratio(this.hits, this.shots),
      medianTimeToHit: median(this.tths),
      bestTimeToHit: this.tths.length ? Math.min(...this.tths) : null,
      movingShots: this.movingShots,
      movingHits: this.movingHits,
      settledShots: this.settledShots,
      settledHits: this.settledHits,
      movingAccuracy: ratio(this.movingHits, this.movingShots),
      settledAccuracy: ratio(this.settledHits, this.settledShots),
      medianFlickDeg: median(this.flicks),
      lifetime: this.cfg.lifetime,
      quickWindow: this.cfg.quickWindow,
      score: Math.max(0, Math.round(this.points)),
      outcomes: [...this.outcomes],
    };
  }
}

/** Exposed for tests: where the aim ray points (unit vector). */
export const _aimDirection = aimDirection;
