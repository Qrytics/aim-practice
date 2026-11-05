import { describe, expect, it } from 'vitest';
import { TRACKING, TrackingDrill } from '../src/core/drills/tracking';
import { trackingFeedback } from '../src/core/feedback';

const DT = 1 / 120;
const STILL = { x: 0, z: 0, vx: 0, vz: 0 };

/** Aim exactly at the drill's current target. */
function aimAtTarget(d: TrackingDrill) {
  const t = d.targets[0]!;
  const yaw = Math.atan2(-t.x, -t.z);
  const pitch = Math.atan2(t.y - 1.6, Math.hypot(t.x, t.z));
  return { ...STILL, yaw, pitch };
}

/** Advance `n` steps; the aim is computed from the target BEFORE the step (a perfect-but-lagging tracker). */
function run(d: TrackingDrill, n: number, opts: { fire: boolean | ((i: number) => boolean); lead?: boolean; offsetRad?: number }) {
  for (let i = 0; i < n; i++) {
    const a = aimAtTarget(d);
    const f = typeof opts.fire === 'function' ? opts.fire(i) : opts.fire;
    d.step({ dt: DT, player: { ...a, yaw: a.yaw + (opts.offsetRad ?? 0) }, fireHeld: f });
  }
}

describe('target motion', () => {
  it('stays on its arc inside the arena for a full 60 s across many seeds', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const d = new TrackingDrill(seed);
      for (let i = 0; i < 60 * 120; i++) {
        d.step({ dt: DT, player: { ...STILL, yaw: 0, pitch: 0 }, fireHeld: false });
        const t = d.targets[0]!;
        const r = Math.hypot(t.x, t.z);
        expect(Math.abs(r - TRACKING.arcRadius)).toBeLessThan(1e-9);
        expect(t.z).toBeLessThan(0);
        expect(t.y).toBeGreaterThan(TRACKING.yBase - TRACKING.yAmp - 1e-9);
        expect(t.y).toBeLessThan(TRACKING.yBase + TRACKING.yAmp + 1e-9);
      }
    }
  });

  it('changes direction on a schedule and at the arc ends; same seed, same path', () => {
    const path = (seed: number) => {
      const d = new TrackingDrill(seed);
      const out: number[] = [];
      for (let i = 0; i < 600; i++) {
        d.step({ dt: DT, player: { ...STILL, yaw: 0, pitch: 0 }, fireHeld: false });
        out.push(d.targets[0]!.x);
      }
      return { out, changes: d.result().directionChanges };
    };
    const a = path(5);
    const b = path(5);
    expect(a.out).toEqual(b.out);
    expect(path(6).out).not.toEqual(a.out);
    expect(a.changes).toBeGreaterThanOrEqual(3); // 5 s with 0.35-1.3 s between changes
  });

  it('target motion does not depend on where the player aims or fires', () => {
    const a = new TrackingDrill(9);
    const b = new TrackingDrill(9);
    for (let i = 0; i < 400; i++) {
      a.step({ dt: DT, player: { ...STILL, yaw: 0, pitch: 0 }, fireHeld: false });
      b.step({ dt: DT, player: { ...STILL, yaw: 1.2, pitch: 0.3 }, fireHeld: i % 2 === 0 });
    }
    expect(a.targets[0]!.x).toBe(b.targets[0]!.x);
    expect(a.targets[0]!.z).toBe(b.targets[0]!.z);
  });
});

describe('the three tracking metrics (hand-computed)', () => {
  it('perfect tracking for 10 s while firing the whole time', () => {
    const d = new TrackingDrill(3);
    run(d, 1200, { fire: true });
    const r = d.result();
    // Aim is set from the pre-step target, so the aim lags one step; sphere radius 0.3 m at 9.2 m
    // is about 1.9 degrees; target speed <= 48 deg/s * 1/120 s = 0.4 deg lag. Every step is on target.
    expect(r.activeSeconds).toBeCloseTo(10, 9);
    expect(r.firingSeconds).toBeCloseTo(10, 9);
    expect(r.onTargetFiringSeconds).toBeCloseTo(10, 9);
    expect(r.ratioActive).toBeCloseTo(1, 9);
    expect(r.ratioFiring).toBeCloseTo(1, 9);
    expect(r.longestOnStreakSeconds).toBeCloseTo(10, 9);
    expect(r.score).toBe(1000);
  });

  it('firing only half the time while perfectly on target: ratioFiring 1, ratioActive 0.5, firing 5 s', () => {
    const d = new TrackingDrill(3);
    run(d, 1200, { fire: (i) => i < 600 });
    const r = d.result();
    expect(r.firingSeconds).toBeCloseTo(5, 9);
    expect(r.onTargetFiringSeconds).toBeCloseTo(5, 9);
    expect(r.ratioFiring).toBeCloseTo(1, 9);
    expect(r.ratioActive).toBeCloseTo(0.5, 9);
  });

  it('firing the whole time but 5 degrees off for 4 of 10 s: 0.6 / 0.6', () => {
    const d = new TrackingDrill(3);
    for (let i = 0; i < 1200; i++) {
      const a = aimAtTarget(d);
      const off = i >= 240 && i < 720 ? (5 * Math.PI) / 180 : 0; // steps 240..719 = 4 s off
      d.step({ dt: DT, player: { ...a, yaw: a.yaw + off }, fireHeld: true });
    }
    const r = d.result();
    expect(r.firingSeconds).toBeCloseTo(10, 9);
    expect(r.onTargetFiringSeconds).toBeCloseTo(6, 9);
    expect(r.ratioFiring).toBeCloseTo(0.6, 9);
    expect(r.ratioActive).toBeCloseTo(0.6, 9);
    // on 0-2 s, off 2-6 s, on 6-10 s: the longest unbroken on-target stretch is the last 4 s
    expect(r.longestOnStreakSeconds).toBeCloseTo(4, 9);
  });

  it('on target but NOT firing counts nothing', () => {
    const d = new TrackingDrill(3);
    run(d, 600, { fire: false });
    const r = d.result();
    expect(r.firingSeconds).toBe(0);
    expect(r.onTargetFiringSeconds).toBe(0);
    expect(r.ratioActive).toBe(0);
  });

  it('zero firing time: ratioFiring is null (never 0, never NaN) and feedback says so', () => {
    const d = new TrackingDrill(3);
    run(d, 600, { fire: false });
    const r = d.result();
    expect(r.ratioFiring).toBeNull();
    expect(Number.isNaN(r.ratioActive ?? 0)).toBe(false);
    expect(trackingFeedback(r).headline).toMatch(/did not fire/);
  });

  it('zero active time: ratioActive is null', () => {
    expect(new TrackingDrill(3).result().ratioActive).toBeNull();
    expect(new TrackingDrill(3).result().score).toBe(0);
  });

  it('timeline buckets add up to the totals', () => {
    const d = new TrackingDrill(4);
    run(d, 1200, { fire: (i) => i % 3 !== 0 });
    const r = d.result();
    const f = r.timeline.firing.reduce((s, v) => s + v, 0);
    const o = r.timeline.onTarget.reduce((s, v) => s + v, 0);
    expect(f).toBeCloseTo(r.firingSeconds, 9);
    expect(o).toBeCloseTo(r.onTargetFiringSeconds, 9);
    expect(r.timeline.firing.length).toBe(Math.ceil(10 / TRACKING.bucketSeconds));
  });
});

describe('only simulated Running steps count (countdown and pauses excluded by construction)', () => {
  it('activeSeconds equals the number of step() calls, regardless of how they were chunked', () => {
    const d = new TrackingDrill(2);
    run(d, 100, { fire: true });
    // A pause is simply "no step() calls": nothing to subtract.
    run(d, 140, { fire: true });
    expect(d.result().activeSeconds).toBeCloseTo(240 * DT, 12);
  });
});

describe('direction-change handling', () => {
  it('a tracker who holds on is credited; one who loses and regains is measured', () => {
    const steady = new TrackingDrill(11);
    run(steady, 120 * 20, { fire: true });
    const s = steady.result();
    expect(s.directionChanges).toBeGreaterThan(5);
    expect(s.heldThrough).toBeGreaterThanOrEqual(s.directionChanges - 2); // last watchers may still be open
    expect(s.unrecovered).toBe(0);

    // Look away for 0.5 s after the first change window, then come back.
    const d = new TrackingDrill(11);
    for (let i = 0; i < 120 * 20; i++) {
      const a = aimAtTarget(d);
      const away = i >= 120 * 3 && i < 120 * 3.5 ? 0.3 : 0;
      d.step({ dt: DT, player: { ...a, yaw: a.yaw + away }, fireHeld: true });
    }
    const r = d.result();
    expect(r.medianReacquireSeconds).not.toBeNull();
    expect(r.medianReacquireSeconds!).toBeGreaterThan(0);
    expect(r.medianReacquireSeconds!).toBeLessThanOrEqual(0.55);
  });

  it('never getting back on target after losing it counts as unrecovered', () => {
    const d = new TrackingDrill(11);
    run(d, 120 * 15, { fire: true, offsetRad: 0.5 }); // permanently ~29 degrees off
    const r = d.result();
    expect(r.onTargetFiringSeconds).toBe(0);
    expect(r.unrecovered).toBeGreaterThan(0);
    expect(r.heldThrough).toBe(0);
  });
});

describe('live HUD meter', () => {
  it('reads null before any firing, then tracks the last second', () => {
    const d = new TrackingDrill(3);
    run(d, 60, { fire: false });
    expect(d.hud().meter).toBeNull();
    run(d, 240, { fire: true });
    expect(d.hud().meter).toBeCloseTo(1, 9);
    run(d, 120, { fire: true, offsetRad: 0.5 });
    expect(d.hud().meter).toBeCloseTo(0, 9);
    expect(d.hud().hot).toBe(false);
  });
});

describe('feedback honesty', () => {
  it('small samples give no coaching', () => {
    const d = new TrackingDrill(3);
    run(d, 120, { fire: true });
    expect(trackingFeedback(d.result()).headline).toMatch(/too little/);
  });
  it('good tracking with little firing suggests firing longer, not aiming', () => {
    const d = new TrackingDrill(3);
    run(d, 120 * 20, { fire: (i) => i < 120 * 5 });
    const f = trackingFeedback(d.result());
    expect(f.tryNext.join(' ')).toMatch(/Fire for longer/);
  });
});
