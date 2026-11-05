import { describe, expect, it } from 'vitest';
import { aimDirection } from '../src/core/geometry';
import { PRECISION, PrecisionDrill } from '../src/core/drills/precision';
import { precisionFeedback } from '../src/core/feedback';

const DT = 1 / 120;
const stillPlayer = { x: 0, z: 0, vx: 0, vz: 0, yaw: 0, pitch: 0 };

/** Aim exactly at a point from the origin player. */
function aimAt(p: { x: number; y: number; z: number }) {
  const dx = p.x;
  const dz = p.z;
  const yaw = Math.atan2(-dx, -dz);
  const dist = Math.hypot(dx, dz);
  const pitch = Math.atan2(p.y - 1.6, dist);
  return { yaw, pitch };
}

function runUntilSpawn(d: PrecisionDrill, player = stillPlayer) {
  for (let i = 0; i < 200 && d.targets.length === 0; i++) d.step({ dt: DT, player, fireHeld: false });
  expect(d.targets.length).toBe(1);
  return d.targets[0]!;
}

const fire = (d: PrecisionDrill, aim: { yaw: number; pitch: number }, speed = 0) =>
  d.onFire({ ...aim, x: 0, z: 0, speed, dt: DT });

describe('spawning', () => {
  it('nothing appears before the first-spawn delay, then exactly one target', () => {
    const d = new PrecisionDrill(7);
    const steps = Math.floor(PRECISION.firstSpawnDelay / DT) - 3;
    for (let i = 0; i < steps; i++) d.step({ dt: DT, player: stillPlayer, fireHeld: false });
    expect(d.targets).toHaveLength(0);
    for (let i = 0; i < 10; i++) d.step({ dt: DT, player: stillPlayer, fireHeld: false });
    expect(d.targets).toHaveLength(1);
  });

  it('is reproducible from the seed (same positions) and differs across seeds', () => {
    const positions = (seed: number) => {
      const d = new PrecisionDrill(seed);
      const out: string[] = [];
      for (let k = 0; k < 6; k++) {
        const t = runUntilSpawn(d);
        out.push(`${t.x.toFixed(6)},${t.y.toFixed(6)},${t.z.toFixed(6)}`);
        fire(d, aimAt(t));
        d.step({ dt: DT, player: stillPlayer, fireHeld: false });
        for (let i = 0; i < 100; i++) d.step({ dt: DT, player: stillPlayer, fireHeld: false });
      }
      return out;
    };
    expect(positions(11)).toEqual(positions(11));
    expect(positions(11)).not.toEqual(positions(12));
  });

  it('every spawn respects distance, arena radius, height and flick limits (200 seeds)', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const d = new PrecisionDrill(seed);
      const t = runUntilSpawn(d);
      expect(Math.hypot(t.x, t.z)).toBeLessThanOrEqual(9.3 + 1e-9);
      expect(Math.hypot(t.x, t.z)).toBeGreaterThanOrEqual(PRECISION.minDistanceToPlayer - 1e-9);
      expect(t.y).toBeGreaterThanOrEqual(PRECISION.yMin - 1e-9);
      expect(t.y).toBeLessThanOrEqual(PRECISION.yMax + 1e-9);
      expect(t.r).toBe(PRECISION.targetRadius);
    }
  });
});

describe('hitscan outcomes and scoring (hand-computed)', () => {
  it('a perfect shot at t after spawn scores 100 + 50*(1 - t/1.0)', () => {
    const d = new PrecisionDrill(3);
    const t0 = runUntilSpawn(d);
    // advance exactly 24 steps (0.2 s) then shoot: shot time = spawn + 25 steps (applied inside next step)
    for (let i = 0; i < 24; i++) d.step({ dt: DT, player: stillPlayer, fireHeld: false });
    fire(d, aimAt(t0));
    const r = d.result();
    expect(r.hits).toBe(1);
    expect(r.misses).toBe(0);
    const tth = r.outcomes[0]!.kind === 'hit' ? (r.outcomes[0] as { timeToHit: number }).timeToHit : NaN;
    expect(tth).toBeCloseTo(25 * DT, 9);
    expect(r.score).toBe(Math.round(100 + 50 * (1 - tth / 1.0)));
    expect(r.accuracy).toBe(1);
    expect(r.medianTimeToHit).toBeCloseTo(tth, 12);
    expect(d.targets).toHaveLength(0); // target removed on hit
  });

  it('a miss costs 20 and leaves the target alive; score never goes below zero', () => {
    const d = new PrecisionDrill(3);
    const t0 = runUntilSpawn(d);
    const a = aimAt(t0);
    fire(d, { yaw: a.yaw + 1.0, pitch: a.pitch });
    expect(d.result().misses).toBe(1);
    expect(d.targets).toHaveLength(1);
    expect(d.result().score).toBe(0); // -20 clamps to 0
    expect(d.drainEvents().some((e) => e.type === 'miss')).toBe(true);
  });

  it('edge: aiming just inside the target radius hits, just outside misses', () => {
    const base = new PrecisionDrill(5);
    const t = runUntilSpawn(base);
    const a = aimAt(t);
    const dist = Math.hypot(t.x, t.y - 1.6, t.z);
    const half = Math.asin(t.r / dist);
    const hit = new PrecisionDrill(5);
    runUntilSpawn(hit);
    fire(hit, { yaw: a.yaw + half * 0.97, pitch: a.pitch });
    expect(hit.result().hits).toBe(1);
    const miss = new PrecisionDrill(5);
    runUntilSpawn(miss);
    fire(miss, { yaw: a.yaw + half * 1.03, pitch: a.pitch });
    expect(miss.result().hits).toBe(0);
  });

  it('a hit while moving is flagged and penalised by 40; settled vs moving accuracy are separate', () => {
    const d = new PrecisionDrill(9);
    const t = runUntilSpawn(d);
    for (let i = 0; i < 119; i++) d.step({ dt: DT, player: stillPlayer, fireHeld: false });
    fire(d, aimAt(t), 3.0);
    const r = d.result();
    expect(r.movingShots).toBe(1);
    expect(r.movingHits).toBe(1);
    expect(r.settledShots).toBe(0);
    expect(r.settledAccuracy).toBeNull();
    const o = r.outcomes[0] as { timeToHit: number };
    expect(r.score).toBe(Math.round(100 + 50 * Math.max(0, 1 - o.timeToHit) - 40));
  });

  it('a click with no live target is a miss', () => {
    const d = new PrecisionDrill(2);
    fire(d, { yaw: 0, pitch: 0 });
    expect(d.result().misses).toBe(1);
  });
});

describe('cadence, timeout and timing', () => {
  it('clicks faster than 0.22 s are ignored and counted, not scored', () => {
    const d = new PrecisionDrill(4);
    const t = runUntilSpawn(d);
    const a = aimAt(t);
    fire(d, { yaw: a.yaw + 1.0, pitch: a.pitch }); // miss, counts
    for (let i = 0; i < 10; i++) d.step({ dt: DT, player: stillPlayer, fireHeld: false }); // 0.083 s
    fire(d, a); // would have hit, but too soon
    const r = d.result();
    expect(r.shots).toBe(1);
    expect(r.rushedBlocked).toBe(1);
    expect(r.hits).toBe(0);
    for (let i = 0; i < 30; i++) d.step({ dt: DT, player: stillPlayer, fireHeld: false }); // total > 0.22 s
    fire(d, a);
    expect(d.result().hits).toBe(1);
  });

  it('an ignored target times out after 2.2 s: -10, expire event, next spawn after 0.3 s', () => {
    const d = new PrecisionDrill(6);
    runUntilSpawn(d);
    d.drainEvents();
    for (let i = 0; i < Math.ceil(2.25 / DT); i++) d.step({ dt: DT, player: stillPlayer, fireHeld: false });
    expect(d.targets).toHaveLength(0);
    const r = d.result();
    expect(r.expired).toBe(1);
    expect(d.drainEvents().some((e) => e.type === 'expire')).toBe(true);
    for (let i = 0; i < Math.ceil(0.35 / DT); i++) d.step({ dt: DT, player: stillPlayer, fireHeld: false });
    expect(d.targets).toHaveLength(1);
    expect(d.result().targetsSpawned).toBe(2);
  });

  it('a click after the lifetime ended counts as a miss on nothing, never a late hit', () => {
    const d = new PrecisionDrill(6);
    const t = runUntilSpawn(d);
    const a = aimAt(t);
    for (let i = 0; i < Math.ceil(2.3 / DT); i++) d.step({ dt: DT, player: stillPlayer, fireHeld: false });
    fire(d, a);
    const r = d.result();
    expect(r.hits).toBe(0);
    expect(r.expired).toBe(1);
  });

  it('only RUNNING steps advance drill time (activeSeconds counts steps stepped)', () => {
    const d = new PrecisionDrill(8);
    for (let i = 0; i < 240; i++) d.step({ dt: DT, player: stillPlayer, fireHeld: false });
    expect(d.result().activeSeconds).toBeCloseTo(2, 9);
  });
});

describe('zero-shot and sample-size honesty', () => {
  it('no shots: accuracy and medians are null, never 0 or NaN', () => {
    const d = new PrecisionDrill(1);
    const r = d.result();
    expect(r.accuracy).toBeNull();
    expect(r.medianTimeToHit).toBeNull();
    expect(r.bestTimeToHit).toBeNull();
    expect(r.movingAccuracy).toBeNull();
    expect(precisionFeedback(r).headline).toMatch(/No shots/);
  });

  it('too few shots gives no advice', () => {
    const d = new PrecisionDrill(1);
    const t = runUntilSpawn(d);
    fire(d, aimAt(t));
    const f = precisionFeedback(d.result());
    expect(f.headline).toMatch(/too few/);
  });
});

describe('feedback rules', () => {
  const base = () => new PrecisionDrill(21);
  it('flags rushed early misses and suggests settling', () => {
    const d = base();
    for (let k = 0; k < 8; k++) {
      const t = runUntilSpawn(d);
      const a = aimAt(t);
      for (let i = 0; i < 6; i++) d.step({ dt: DT, player: stillPlayer, fireHeld: false });
      fire(d, { yaw: a.yaw + 1.2, pitch: a.pitch }); // early miss
      for (let i = 0; i < 40; i++) d.step({ dt: DT, player: stillPlayer, fireHeld: false });
      fire(d, a); // then hit
      for (let i = 0; i < 60; i++) d.step({ dt: DT, player: stillPlayer, fireHeld: false });
    }
    const f = precisionFeedback(d.result());
    expect(f.findings.join(' ')).toMatch(/misses came within/);
    expect(f.tryNext.join(' ')).toMatch(/settle/);
  });

  it('recommends releasing movement only when moving accuracy is clearly worse with enough shots', () => {
    const d = base();
    for (let k = 0; k < 10; k++) {
      const t = runUntilSpawn(d);
      const a = aimAt(t);
      for (let i = 0; i < 40; i++) d.step({ dt: DT, player: stillPlayer, fireHeld: false });
      if (k < 5) fire(d, a, 0); // settled hits
      else fire(d, { yaw: a.yaw + 1.0, pitch: a.pitch }, 4); // moving misses
      for (let i = 0; i < 40; i++) d.step({ dt: DT, player: stillPlayer, fireHeld: false });
      if (k >= 5) fire(d, a, 0);
      for (let i = 0; i < 80; i++) d.step({ dt: DT, player: stillPlayer, fireHeld: false });
    }
    const r = d.result();
    expect(r.movingShots).toBeGreaterThanOrEqual(4);
    const f = precisionFeedback(r);
    expect(f.tryNext.join(' ')).toMatch(/movement keys/);
  });

  it('is deterministic: identical results give identical feedback', () => {
    const run = () => {
      const d = new PrecisionDrill(33);
      const t = runUntilSpawn(d);
      for (let i = 0; i < 30; i++) d.step({ dt: DT, player: stillPlayer, fireHeld: false });
      fire(d, aimAt(t));
      return precisionFeedback(d.result());
    };
    expect(run()).toEqual(run());
  });
});

describe('sanity: aim helper matches the geometry module', () => {
  it('aimAt() points the ray at the target', () => {
    const t = { x: 3, y: 2, z: -5 };
    const a = aimAt(t);
    const d = aimDirection(a.yaw, a.pitch);
    const to = { x: t.x, y: t.y - 1.6, z: t.z };
    const l = Math.hypot(to.x, to.y, to.z);
    expect(Math.abs(d.x - to.x / l) + Math.abs(d.y - to.y / l) + Math.abs(d.z - to.z / l)).toBeLessThan(1e-9);
  });
});
