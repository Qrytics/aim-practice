import { describe, expect, it } from 'vitest';
import { HeldInput, isEditableTarget, type InputEvent } from '../src/core/input';
import { DEFAULT_MOVEMENT } from '../src/core/movement';
import { FrameStats, percentile } from '../src/core/frameStats';
import { PITCH_LIMIT_DEG, Simulation, type FireEvent } from '../src/core/simulation';
import { SessionMachine } from '../src/core/session';
import { ALWAYS_RUNNING as ALWAYS_RUNNING_FOR_TEST, sessionStepClock } from '../src/core/stepClock';

const HZ = 120;
const DT = 1 / HZ;
const cfg = {
  stepHz: HZ,
  maxFrameGap: 0.25,
  movement: DEFAULT_MOVEMENT,
  bounds: { minX: -50, maxX: 50, minZ: -50, maxZ: 50 },
};
// Tolerances (stated, not arbitrary):
//  - positions/angles from identical step sequences differ only by float
//    summation order: 1e-9 is far above that and far below any visible effect.
const FLOAT_TOL = 1e-9;

function sim(dpu = 0.1) {
  return new Simulation(0, 0, 0, dpu, cfg);
}

/** Scripted input timeline, deliberately off the step grid. */
const SCRIPT: InputEvent[] = [
  { t: 0.0031, type: 'key', code: 'KeyW', down: true },
  { t: 0.1, type: 'look', dx: 40, dy: -10 },
  { t: 0.2517, type: 'look', dx: -15, dy: 4 },
  { t: 0.4, type: 'key', code: 'KeyD', down: true },
  { t: 0.6203, type: 'key', code: 'KeyW', down: false },
  { t: 0.75, type: 'look', dx: 22, dy: 9 },
  { t: 0.9, type: 'key', code: 'KeyD', down: false },
];

/** Run the script, delivering inputs just before the frame that reaches them. */
function run(frameTimes: number[], events: InputEvent[] = SCRIPT) {
  const s = sim();
  const pending = [...events].sort((a, b) => a.t - b.t);
  for (const now of frameTimes) {
    while (pending.length && pending[0]!.t <= now) s.push(pending.shift()!);
    s.advance(now);
  }
  return s;
}

/** Advance in 1/60 s frames (below maxFrameGap) up to `end`. */
function advanceTo(s: Simulation, end: number) {
  for (let t = 1 / 60; t <= end + 1e-9; t += 1 / 60) s.advance(t);
}

const frames = (stepSec: number, end: number) => {
  const out: number[] = [];
  for (let i = 1; i * stepSec <= end + 1e-12; i++) out.push(i * stepSec);
  return out;
};

describe('simulation reproducibility across frame rates (not real-world latency)', () => {
  it('30, 60, 144 Hz and jittery frames reach the same state at the same sim time', () => {
    // End on a multiple of DT so every run has simulated the same whole steps.
    const end = 120 * DT; // 1.0 s
    const jitter: number[] = [];
    let t = 0;
    let k = 0;
    while (t < end - 1e-9) {
      t = Math.min(end, t + [0.004, 0.019, 0.011, 0.031, 0.007][k++ % 5]!);
      jitter.push(t);
    }
    const ref = run(frames(1 / 240, end));
    for (const f of [frames(1 / 30, end), frames(1 / 60, end), frames(1 / 144, end), jitter]) {
      const s = run(f);
      expect(Math.abs(s.simTime - ref.simTime)).toBeLessThan(FLOAT_TOL);
      expect(Math.abs(s.player.x - ref.player.x)).toBeLessThan(FLOAT_TOL);
      expect(Math.abs(s.player.z - ref.player.z)).toBeLessThan(FLOAT_TOL);
      expect(Math.abs(s.player.yaw - ref.player.yaw)).toBeLessThan(FLOAT_TOL);
      expect(Math.abs(s.player.pitch - ref.player.pitch)).toBeLessThan(FLOAT_TOL);
    }
  });

  it('simulated time is a whole number of steps behind the frame time', () => {
    const s = sim();
    s.advance(0.0201); // 2.41 steps -> 2 steps
    expect(s.simTime).toBeCloseTo(2 * DT, 12);
    expect(s.simTime).toBeLessThanOrEqual(0.0201);
    s.advance(0.0204);
    expect(s.simTime).toBeCloseTo(2 * DT, 12); // 0.0003 s more is not a full step
  });

  it('a frame landing exactly on a step boundary does not lose the step', () => {
    const s = sim();
    s.advance(3 * DT);
    expect(s.simTime).toBeCloseTo(3 * DT, 12);
  });
});

describe('ordering of look, fire and movement relative to steps', () => {
  it('a flick stamped before a click lands first; one stamped after does not', () => {
    const s = sim(0.1);
    const fired: FireEvent[] = [];
    s.onFire = (e) => fired.push(e);
    s.push({ t: 0.01, type: 'look', dx: 100, dy: 0 }); // -10 deg yaw... (dx*0.1)
    s.push({ t: 0.0105, type: 'fire' });
    s.push({ t: 0.0108, type: 'look', dx: 100, dy: 0 }); // same step, after the click
    s.advance(0.05);
    expect(fired).toHaveLength(1);
    // Both looks fall in the same 8.33 ms step, so both are applied before that
    // step's movement; but the fire reads aim between them (arrival/timestamp order).
    const oneLook = -(100 * 0.1 * Math.PI) / 180;
    expect(Math.abs(fired[0]!.yaw - oneLook)).toBeLessThan(FLOAT_TOL);
    expect(Math.abs(s.player.yaw - 2 * oneLook)).toBeLessThan(FLOAT_TOL);
  });

  it('events are applied in timestamp order even if delivered out of order', () => {
    const s = sim(0.1);
    const fired: FireEvent[] = [];
    s.onFire = (e) => fired.push(e);
    s.push({ t: 0.03, type: 'fire' });
    s.push({ t: 0.02, type: 'look', dx: 50, dy: 0 });
    s.advance(0.05);
    expect(Math.abs(fired[0]!.yaw + (50 * 0.1 * Math.PI) / 180)).toBeLessThan(FLOAT_TOL);
  });

  it('inputs stamped after the last completed step stay queued, never applied early', () => {
    const s = sim(0.1);
    s.push({ t: 0.5, type: 'look', dx: 100, dy: 0 });
    s.advance(0.2);
    expect(s.player.yaw).toBe(0);
    s.advance(0.4); // up to the step ending at 0.4: still before t=0.5
    expect(s.player.yaw).toBe(0);
    s.advance(0.5 + DT);
    expect(s.player.yaw).not.toBe(0);
  });

  it('late input (stamped before already-simulated time) is applied next step and counted', () => {
    const s = sim(0.1);
    s.advance(0.1);
    s.push({ t: 0.02, type: 'look', dx: 10, dy: 0 });
    const r = s.advance(0.1 + DT);
    expect(r.lateInputs).toBe(1);
    expect(s.player.yaw).not.toBe(0);
  });

  it('movement uses the aim at the start of the step: look and key in one step both apply before integration', () => {
    const s = sim(0.1);
    s.push({ t: 0.001, type: 'look', dx: 900, dy: 0 }); // 90 deg: yaw -> -90 (turn right)
    s.push({ t: 0.002, type: 'key', code: 'KeyW', down: true });
    s.advance(1.0 * DT);
    expect(s.player.vx).toBeGreaterThan(0); // forward is now +x
    expect(Math.abs(s.player.vz)).toBeLessThan(1e-9);
  });
});

describe('pitch and yaw', () => {
  it('pitch clamps at the limit in both directions', () => {
    const s = sim(1);
    s.push({ t: 0.001, type: 'look', dx: 0, dy: -1000 });
    s.advance(DT);
    expect(Math.abs(s.player.pitch - (PITCH_LIMIT_DEG * Math.PI) / 180)).toBeLessThan(FLOAT_TOL);
    s.push({ t: 0.01, type: 'look', dx: 0, dy: 5000 });
    s.advance(2 * DT);
    expect(Math.abs(s.player.pitch + (PITCH_LIMIT_DEG * Math.PI) / 180)).toBeLessThan(FLOAT_TOL);
  });

  it('a unit-exact full turn accumulates 360 calibration degrees', () => {
    const s = sim(0.25);
    s.push({ t: 0.001, type: 'look', dx: 1440, dy: 0 });
    s.advance(DT);
    expect(Math.abs(s.calibrationTurnDeg - 360)).toBeLessThan(FLOAT_TOL);
    s.resetCalibration();
    expect(s.calibrationTurnDeg).toBe(0);
  });
});

describe('movement', () => {
  it('reaches max speed, and diagonals are not faster', () => {
    const a = sim();
    a.push({ t: 0, type: 'key', code: 'KeyW', down: true });
    advanceTo(a, 1);
    const b = sim();
    b.push({ t: 0, type: 'key', code: 'KeyW', down: true });
    b.push({ t: 0, type: 'key', code: 'KeyD', down: true });
    advanceTo(b, 1);
    expect(Math.hypot(a.player.vx, a.player.vz)).toBeCloseTo(DEFAULT_MOVEMENT.maxSpeed, 9);
    expect(Math.hypot(b.player.vx, b.player.vz)).toBeCloseTo(DEFAULT_MOVEMENT.maxSpeed, 9);
  });

  it('opposite keys cancel and decelerate to rest', () => {
    const s = sim();
    s.push({ t: 0, type: 'key', code: 'KeyW', down: true });
    advanceTo(s, 0.5);
    s.push({ t: 0.51, type: 'key', code: 'KeyW', down: false });
    advanceTo(s, 1.5);
    expect(Math.hypot(s.player.vx, s.player.vz)).toBe(0);
  });

  it('is stopped by the arena bounds', () => {
    const s = new Simulation(0, 0, 0, 0.1, { ...cfg, bounds: { minX: -2, maxX: 2, minZ: -2, maxZ: 2 } });
    s.push({ t: 0, type: 'key', code: 'KeyW', down: true });
    for (let t = 0.1; t <= 3; t += 0.1) s.advance(t);
    expect(s.player.z).toBeCloseTo(-2 + DEFAULT_MOVEMENT.radius, 9);
  });
});

// ---- phases decided inside the step loop, driven by a real SessionMachine ----------------------

function activeSession(countdown: number, run: number) {
  const m = new SessionMachine({ countdownSeconds: countdown, runSeconds: run });
  expect(m.requestLock()).toBe(true);
  expect(m.lockAcquired()).toBe(true);
  return m;
}

describe('phases inside the fixed-step loop', () => {
  it('countdown: look applies, translation frozen (velocity zero), fire discarded and counted', () => {
    const m = activeSession(10, 10);
    const clock = sessionStepClock(m);
    const s = sim(0.1);
    const fired: FireEvent[] = [];
    s.onFire = (e) => fired.push(e);
    s.push({ t: 0.001, type: 'key', code: 'KeyW', down: true });
    s.push({ t: 0.002, type: 'look', dx: 100, dy: 0 });
    s.push({ t: 0.05, type: 'fire' });
    for (let t = 1 / 60; t <= 1 + 1e-9; t += 1 / 60) s.advance(t, clock);
    expect(m.state).toBe('countdown');
    expect(s.held.count).toBe(1); // key tracked, not acted on
    expect(s.player.x).toBe(0);
    expect(s.player.z).toBe(0);
    expect(s.player.vx).toBe(0);
    expect(s.player.vz).toBe(0);
    expect(s.player.yaw).not.toBe(0);
    expect(fired).toHaveLength(0);
    expect(s.firesDiscarded).toBe(1);
    expect(m.snapshot.runElapsed).toBe(0);
  });

  it('running: movement and fire both apply', () => {
    const m = activeSession(0.05, 10);
    const clock = sessionStepClock(m);
    const s = sim(0.1);
    const fired: FireEvent[] = [];
    s.onFire = (e) => fired.push(e);
    s.push({ t: 0.001, type: 'key', code: 'KeyW', down: true });
    s.push({ t: 0.5, type: 'fire' });
    for (let t = 1 / 60; t <= 1 + 1e-9; t += 1 / 60) s.advance(t, clock);
    expect(m.state).toBe('running');
    expect(s.player.z).toBeLessThan(-0.5);
    expect(fired).toHaveLength(1);
  });

  it('a frame containing countdown->running applies running movement only to steps after the transition', () => {
    // Countdown = 15 steps (0.125 s). One big frame of 0.2 s = 24 steps, W held from the start.
    const CD = 0.125;
    const bigFrame = sim(0.1);
    const mBig = activeSession(CD, 10);
    bigFrame.push({ t: 0.001, type: 'key', code: 'KeyW', down: true });
    const r = bigFrame.advance(0.2, sessionStepClock(mBig));
    expect(r.steps).toBe(24);
    expect(mBig.state).toBe('running');

    // Upper bound: at most (24 - 15 + 1) running steps from rest. If the whole frame had used
    // running rules, distance would be the 24-step value, far larger.
    const dt = 1 / HZ;
    const dist = (n: number) => (DEFAULT_MOVEMENT.accel * dt * dt * n * (n + 1)) / 2;
    const moved = -bigFrame.player.z;
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThanOrEqual(dist(10) + 1e-9);
    expect(moved).toBeLessThan(dist(24) / 4);

    // Equivalence: the same inputs delivered one step per frame give the same result.
    const stepped = sim(0.1);
    const mStep = activeSession(CD, 10);
    stepped.push({ t: 0.001, type: 'key', code: 'KeyW', down: true });
    for (let i = 1; i <= 24; i++) stepped.advance(i * dt, sessionStepClock(mStep));
    expect(Math.abs(stepped.player.z - bigFrame.player.z)).toBeLessThan(FLOAT_TOL);
    expect(Math.abs(stepped.player.vz - bigFrame.player.vz)).toBeLessThan(FLOAT_TOL);
    expect(Math.abs(mStep.snapshot.runElapsed - mBig.snapshot.runElapsed)).toBeLessThan(FLOAT_TOL);
  });

  it('boundary for fire: stamped well inside countdown is discarded; stamped after the transition is delivered', () => {
    const m = activeSession(0.125, 10);
    const clock = sessionStepClock(m);
    const s = sim(0.1);
    const fired: FireEvent[] = [];
    s.onFire = (e) => fired.push(e);
    s.push({ t: 0.06, type: 'fire' }); // step ~8 of 15: countdown
    s.push({ t: 0.16, type: 'fire' }); // step ~20: running
    s.advance(0.2, clock);
    expect(s.firesDiscarded).toBe(1);
    expect(fired).toHaveLength(1);
    expect(fired[0]!.t).toBe(0.16);
  });

  it('paused (inactive) time advances neither the simulation nor session time; no catch-up on resume', () => {
    const m = activeSession(0.05, 10);
    const clock = sessionStepClock(m);
    const s = sim(0.1);
    s.push({ t: 0.001, type: 'key', code: 'KeyW', down: true });
    for (let t = 1 / 60; t <= 0.5 + 1e-9; t += 1 / 60) s.advance(t, clock);
    expect(m.state).toBe('running');
    const elapsed = m.snapshot.runElapsed;
    const pos = { x: s.player.x, z: s.player.z, yaw: s.player.yaw };

    m.pause('user');
    let lastPausedFrame = 0;
    for (let t = 0.5 + 1 / 60; t <= 5; t += 0.1) {
      const r = s.advance(t, clock);
      expect(r.steps).toBe(0);
      expect(r.stalledSeconds).toBe(0); // a long pause is not a stall
      lastPausedFrame = t;
    }
    expect(m.snapshot.runElapsed).toBe(elapsed);
    expect(m.snapshot.countdownRemaining).toBe(0);
    expect(s.player.x).toBe(pos.x);
    expect(s.player.z).toBe(pos.z);
    expect(s.player.yaw).toBe(pos.yaw);

    // Resume: clock is already at 'now', so the next small gap simulates only that gap.
    m.requestLock();
    m.lockAcquired();
    const r = s.advance(lastPausedFrame + 3 / HZ + 1e-6, clock);
    expect(r.steps).toBe(3);
    expect(Math.abs(m.snapshot.runElapsed - (elapsed + 3 / HZ))).toBeLessThan(FLOAT_TOL);
  });

  it('pausing clears held keys and queued input; nothing replays after resume', () => {
    const m = activeSession(0.05, 10);
    const clock = sessionStepClock(m);
    const s = sim(0.1);
    s.push({ t: 0.001, type: 'key', code: 'KeyD', down: true });
    for (let t = 1 / 60; t <= 0.3 + 1e-9; t += 1 / 60) s.advance(t, clock);
    expect(s.held.count).toBe(1);

    s.push({ t: 0.4, type: 'look', dx: 500, dy: 0 }); // queued, not yet reached
    m.pause('focus-lost');
    s.advance(0.31, clock);
    expect(s.held.count).toBe(0);

    m.requestLock();
    m.lockAcquired();
    const yaw0 = s.player.yaw;
    const x0 = s.player.x;
    for (let t = 0.31 + 1 / 60; t <= 1; t += 1 / 60) s.advance(t, clock);
    expect(s.player.yaw).toBe(yaw0); // the queued look was dropped
    expect(s.player.x).toBe(x0); // D is no longer held, and no residual velocity carries over
    expect(s.player.vx).toBe(0);
  });

  it('losing pointer lock (session pause) clears held keys through the same path', () => {
    const m = activeSession(0.05, 10);
    const clock = sessionStepClock(m);
    const s = sim(0.1);
    s.push({ t: 0.001, type: 'key', code: 'KeyW', down: true });
    for (let t = 1 / 60; t <= 0.3 + 1e-9; t += 1 / 60) s.advance(t, clock);
    m.lockLost();
    expect(m.state).toBe('paused');
    s.advance(0.32, clock);
    expect(s.held.count).toBe(0);
  });

  it('completion mid-frame stops simulating the remaining steps and clears held input', () => {
    const m = activeSession(0.025, 0.05); // 3 + 6 steps
    const clock = sessionStepClock(m);
    const s = sim(0.1);
    s.push({ t: 0.001, type: 'key', code: 'KeyW', down: true });
    const r = s.advance(0.2, clock); // frame allows 24 steps
    expect(m.state).toBe('completed');
    expect(r.steps).toBeLessThan(24);
    expect(r.steps).toBeGreaterThanOrEqual(8);
    expect(r.steps).toBeLessThanOrEqual(10);
    expect(m.snapshot.runElapsed).toBe(0.05);
    // The loop notices 'inactive' only when it checks before the next step.
    s.advance(0.21, clock);
    expect(s.held.count).toBe(0);
  });

  it('phase is read per step, not cached per frame: 3 countdown steps then 3 running steps in ONE frame', () => {
    let advanced = 0;
    const clock = {
      phase: () => (advanced < 3 ? 'countdown' : 'running') as 'countdown' | 'running',
      advance: () => {
        advanced++;
      },
    };
    const s = sim(0.1);
    s.push({ t: 0.0001, type: 'key', code: 'KeyW', down: true });
    const r = s.advance(6 / HZ + 1e-9, clock);
    expect(r.steps).toBe(6);
    // Exactly 3 running steps from rest (semi-implicit Euler): z = -a*dt^2 * n(n+1)/2, n = 3.
    const expected = (DEFAULT_MOVEMENT.accel / (HZ * HZ)) * 6;
    expect(Math.abs(s.player.z + expected)).toBeLessThan(FLOAT_TOL);
  });
});

describe('held-input reset', () => {
  it('a reset event releases held keys; clearInput drops queue and keys', () => {
    const s = sim();
    s.push({ t: 0, type: 'key', code: 'KeyW', down: true });
    s.advance(0.1);
    expect(s.held.count).toBe(1);
    s.push({ t: 0.1, type: 'reset' });
    s.advance(0.2);
    expect(s.held.count).toBe(0);

    s.push({ t: 0.25, type: 'key', code: 'KeyA', down: true });
    s.push({ t: 5, type: 'look', dx: 100, dy: 0 });
    s.clearInput();
    expect(s.held.count).toBe(0);
    s.advance(0.3);
    s.advance(5.2); // beyond maxFrameGap -> stall, nothing applied
    expect(s.player.yaw).toBe(0);
  });

  it('a key released while another is held keeps the other active', () => {
    const h = new HeldInput();
    h.set('KeyW', true);
    h.set('KeyD', true);
    h.set('KeyW', false);
    expect(h.axes()).toEqual({ forward: 0, right: 1 });
    h.reset();
    expect(h.axes()).toEqual({ forward: 0, right: 0 });
  });
});

describe('stalls are reported, never silently skipped', () => {
  it('a gap above maxFrameGap simulates nothing and reports the whole gap', () => {
    const s = sim();
    s.advance(0.1);
    const before = s.simTime;
    const r = s.advance(0.1 + 3.7);
    expect(r.steps).toBe(0);
    expect(r.stalledSeconds).toBeCloseTo(3.7, 12);
    expect(s.simTime).toBe(before);
  });

  it('resync moves the clock without simulating', () => {
    const s = sim();
    s.resync(10);
    expect(s.simTime).toBe(10);
    expect(s.advance(10).steps).toBe(0);
  });

  it('a gap equal to maxFrameGap is still simulated', () => {
    const s = sim();
    const r = s.advance(0.25);
    expect(r.stalledSeconds).toBe(0);
    expect(r.steps).toBe(30);
  });
});

describe('isEditableTarget (R must not restart while typing)', () => {
  const el = (tagName: string, attrs: Record<string, string> = {}, ce = false) => ({
    tagName,
    isContentEditable: ce,
    getAttribute: (n: string) => attrs[n] ?? null,
  });
  it('treats text-like fields as editable', () => {
    expect(isEditableTarget(el('INPUT', { type: 'number' }))).toBe(true);
    expect(isEditableTarget(el('INPUT'))).toBe(true);
    expect(isEditableTarget(el('TEXTAREA'))).toBe(true);
    expect(isEditableTarget(el('SELECT'))).toBe(true);
    expect(isEditableTarget(el('DIV', {}, true))).toBe(true);
    expect(isEditableTarget(el('DIV', { role: 'spinbutton' }))).toBe(true);
  });
  it('does not block on buttons, checkboxes, radios or plain elements', () => {
    expect(isEditableTarget(el('BUTTON'))).toBe(false);
    expect(isEditableTarget(el('INPUT', { type: 'radio' }))).toBe(false);
    expect(isEditableTarget(el('INPUT', { type: 'checkbox' }))).toBe(false);
    expect(isEditableTarget(el('BODY'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('frame statistics', () => {
  it('percentiles interpolate and handle edges', () => {
    expect(percentile([], 50)).toBeNaN();
    expect(percentile([5], 99)).toBe(5);
    expect(percentile([0, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5], 100)).toBe(5);
  });
  it('is a ring buffer and ignores invalid samples', () => {
    const f = new FrameStats(3);
    for (const v of [1, 2, 3, 4, 100, NaN, -5]) f.push(v);
    const s = f.summary()!;
    expect(s.count).toBe(3);
    expect(s.max).toBe(100);
    expect(new FrameStats().summary()).toBeNull();
  });
});

// ---- completion cleanup and whole-step countdown/run accounting --------------------------------

describe('cleanup when the clock goes inactive on the last allowed step', () => {
  it('clears queued input, held keys and velocity before advance() returns', () => {
    // Countdown 3 steps + run 6 steps: the run completes on step 9. One frame allows EXACTLY 9 steps.
    const m = activeSession(3 / HZ, 6 / HZ);
    const clock = sessionStepClock(m);
    const s = sim(0.1);
    s.push({ t: 0.0001, type: 'key', code: 'KeyW', down: true });
    s.push({ t: 0.0751, type: 'look', dx: 900, dy: 0 }); // stamped just AFTER step 9 (ends 0.075): still queued
    const r = s.advance(9 / HZ + 1e-9, clock);
    expect(r.steps).toBe(9); // the completing step was also the last allowed step
    expect(m.state).toBe('completed');
    // Asserted immediately: no later frame has run.
    expect(s.held.count).toBe(0);
    expect(s.player.vx).toBe(0);
    expect(s.player.vz).toBe(0);
    expect(s.player.z).toBeLessThan(0); // position from the run steps is kept

    // The still-queued look must have been dropped: simulating further must not replay it.
    s.advance(9 / HZ + 0.1, ALWAYS_RUNNING_FOR_TEST);
    expect(s.player.yaw).toBe(0);
    expect(s.player.vz).toBe(0); // the cleared W does not resume
  });

  it('control: without the cleanup the same queued look WOULD apply (the test can fail)', () => {
    const s = sim(0.1);
    s.push({ t: 0.0751, type: 'look', dx: 900, dy: 0 });
    s.advance(9 / HZ + 1e-9, ALWAYS_RUNNING_FOR_TEST);
    expect(s.player.yaw).toBe(0); // not reached yet
    s.advance(9 / HZ + 0.1, ALWAYS_RUNNING_FOR_TEST);
    expect(s.player.yaw).not.toBe(0);
  });
});

describe('whole-step countdown/run accounting', () => {
  const CD = 0.1234; // 14.808 steps: deliberately NOT step-aligned -> 15 countdown steps

  function stepOnce(s: Simulation, m: SessionMachine, k: number) {
    s.advance(k / HZ + 1e-9, sessionStepClock(m));
  }

  it('policy: the step that ends the countdown is a countdown step; overshoot is not credited to Running', () => {
    const m = activeSession(CD, 10);
    const s = sim(0.1);
    const fired: FireEvent[] = [];
    s.onFire = (e) => fired.push(e);
    s.push({ t: 0.0001, type: 'key', code: 'KeyW', down: true });
    s.push({ t: 14.5 / HZ, type: 'fire' }); // inside step 15 (countdown rules apply)
    s.push({ t: 15.5 / HZ, type: 'fire' }); // inside step 16 (first running step)

    for (let k = 1; k <= 14; k++) stepOnce(s, m, k);
    expect(m.state).toBe('countdown');
    expect(m.snapshot.countdownRemaining).toBeCloseTo(CD - 14 / HZ, 12);
    expect(s.player.z).toBe(0);

    stepOnce(s, m, 15); // countdown reaches zero DURING this step
    expect(m.state).toBe('running');
    expect(m.snapshot.runElapsed).toBe(0); // the 0.0016 s overshoot is NOT active drill time
    expect(s.player.z).toBe(0); // movement stayed prohibited for that whole step
    expect(fired).toHaveLength(0);
    expect(s.firesDiscarded).toBe(1);

    stepOnce(s, m, 16); // first running step
    expect(m.snapshot.runElapsed).toBeCloseTo(1 / HZ, 12);
    expect(fired).toHaveLength(1);
    // Exactly one step of acceleration from rest (semi-implicit Euler): z = -a*dt^2.
    expect(Math.abs(s.player.z + DEFAULT_MOVEMENT.accel / (HZ * HZ))).toBeLessThan(FLOAT_TOL);
  });

  it('active run time is a whole number of running steps, never fractions of countdown', () => {
    const m = activeSession(CD, 10);
    const s = sim(0.1);
    s.push({ t: 0.0001, type: 'key', code: 'KeyW', down: true });
    for (let k = 1; k <= 15 + 37; k++) stepOnce(s, m, k);
    expect(m.snapshot.runElapsed).toBeCloseTo(37 / HZ, 10);
  });

  it('aligned durations take exactly the nominal number of steps (no float-noise extra step)', () => {
    const m = activeSession(3, 60);
    let steps = 0;
    let countdownSteps = 0;
    const s = sim(0.1);
    let prev: string = m.state;
    const clock = sessionStepClock(m);
    for (let k = 1; k <= 8000 && m.state !== 'completed'; k++) {
      s.advance(k / HZ + 1e-9, clock);
      steps++;
      if (prev === 'countdown' && m.state === 'running') countdownSteps = steps;
      prev = m.state;
    }
    expect(countdownSteps).toBe(360); // 3 s * 120
    expect(steps).toBe(360 + 7200); // 60 s * 120
    expect(m.state).toBe('completed');
  });

  it('frame chunking does not change the result (30/60/144 Hz, jitter, one big frame)', () => {
    const end = 28 / HZ; // 28 steps (< maxFrameGap 30 steps): 15 countdown + 13 running
    const jitter: number[] = [];
    let t = 0;
    let k = 0;
    while (t < end - 1e-9) {
      t = Math.min(end, t + [0.004, 0.019, 0.011, 0.031, 0.007][k++ % 5]!);
      jitter.push(t);
    }
    const run = (times: number[]) => {
      const m = activeSession(CD, 10);
      const s = sim(0.1);
      s.push({ t: 0.0001, type: 'key', code: 'KeyW', down: true });
      s.push({ t: 0.2, type: 'look', dx: 50, dy: 5 });
      const clock = sessionStepClock(m);
      for (const now of times) s.advance(now, clock);
      return { s, m };
    };
    const ref = run([end]);
    // Each chunking must finish exactly at `end` (1/144 s frames do not land on it by themselves).
    const finishAt = (t: number[]) => (t[t.length - 1] === end ? t : [...t, end]);
    for (const times of [frames(1 / 30, end), frames(1 / 60, end), frames(1 / 144, end), jitter].map(finishAt)) {
      const { s, m } = run(times);
      expect(m.state).toBe(ref.m.state);
      expect(Math.abs(m.snapshot.runElapsed - ref.m.snapshot.runElapsed)).toBeLessThan(FLOAT_TOL);
      expect(Math.abs(m.snapshot.countdownRemaining - ref.m.snapshot.countdownRemaining)).toBeLessThan(FLOAT_TOL);
      expect(Math.abs(s.player.z - ref.s.player.z)).toBeLessThan(FLOAT_TOL);
      expect(Math.abs(s.player.vz - ref.s.player.vz)).toBeLessThan(FLOAT_TOL);
      expect(Math.abs(s.player.yaw - ref.s.player.yaw)).toBeLessThan(FLOAT_TOL);
    }
    expect(ref.m.state).toBe('running');
    expect(ref.m.snapshot.runElapsed).toBeCloseTo(13 / HZ, 10);
  });
});
