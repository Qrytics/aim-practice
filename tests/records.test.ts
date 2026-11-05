import { describe, expect, it } from 'vitest';
import { GridDrill } from '../src/core/drills/grid';
import { PrecisionDrill } from '../src/core/drills/precision';
import { TrackingDrill } from '../src/core/drills/tracking';
import { recordFromResult } from '../src/core/records';
import { parseHistory } from '../src/core/history';
import { progressLine, gridFeedback } from '../src/core/feedback';

const info = { scenario: 'precision', difficulty: 'standard' as const, seconds: 60, seed: 7, daily: null };
const NOW = '2026-11-05T12:00:00.000Z';

describe('recordFromResult', () => {
  it('an untouched run is not recorded (all three drills)', () => {
    expect(recordFromResult(new PrecisionDrill(1).result(), info, NOW)).toBeNull();
    expect(recordFromResult(new TrackingDrill(1).result(), { ...info, scenario: 'tracking' }, NOW)).toBeNull();
    expect(recordFromResult(new GridDrill(1).result(), { ...info, scenario: 'grid' }, NOW)).toBeNull();
  });
  it('a grid run with shots becomes a valid record that survives parseHistory', () => {
    const g = new GridDrill(2);
    for (let i = 0; i < 30; i++) g.step({ dt: 1 / 120, player: { x: 0, z: 0, vx: 0, vz: 0, yaw: 0, pitch: 0 }, fireHeld: false });
    g.onFire({ yaw: 2, pitch: 0, x: 0, z: 0, speed: 0, dt: 1 / 120 });
    const rec = recordFromResult(g.result(), { ...info, scenario: 'grid', daily: '2026-11-05' }, NOW)!;
    expect(rec).toMatchObject({ scenario: 'grid', score: 0, accuracy: 0, daily: '2026-11-05', seed: 7 });
    expect(parseHistory([rec])).toEqual([rec]);
    expect(rec.detail).toMatch(/0% accuracy/);
  });
  it('tracking uses on-target-per-firing as its accuracy', () => {
    const d = new TrackingDrill(3);
    const t = () => d.targets[0]!;
    for (let i = 0; i < 240; i++) {
      d.step({ dt: 1 / 120, player: { x: 0, z: 0, vx: 0, vz: 0, yaw: Math.atan2(-t().x, -t().z), pitch: Math.atan2(t().y - 1.6, Math.hypot(t().x, t().z)) }, fireHeld: true });
    }
    const rec = recordFromResult(d.result(), { ...info, scenario: 'tracking' }, NOW)!;
    expect(rec.accuracy).toBeCloseTo(1, 6);
    expect(rec.detail).toMatch(/100% on target/);
  });
  it('seed is stored as an unsigned 32-bit integer', () => {
    const rec = recordFromResult({ ...new PrecisionDrill(1).result(), shots: 3, hits: 1, accuracy: 1 / 3 }, { ...info, seed: 4294967295 }, NOW)!;
    expect(rec.seed).toBe(4294967295);
  });
});

describe('progressLine never overclaims', () => {
  const base = { first: false, newBest: false, previousBest: 500, delta: -50, earlierRuns: 2, recentAverage: 480 };
  it('first run', () => expect(progressLine({ first: true, newBest: false, previousBest: null, delta: null, earlierRuns: 0, recentAverage: null }, 400)).toMatch(/nothing to compare/));
  it('declines to call a trend from fewer than 3 earlier runs', () => {
    expect(progressLine(base, 450)).toMatch(/too few to call a trend/);
    expect(progressLine({ ...base, earlierRuns: 1 }, 450)).toMatch(/Only 1 earlier run:/);
  });
  it('compares to the recent average once there are 3+ earlier runs', () => {
    expect(progressLine({ ...base, earlierRuns: 6, recentAverage: 400 }, 450)).toMatch(/averaged 400.*50 above/);
    expect(progressLine({ ...base, earlierRuns: 6, recentAverage: 500 }, 450)).toMatch(/50 below/);
  });
  it('new best and tie wording', () => {
    expect(progressLine({ ...base, newBest: true, delta: 20 }, 520)).toMatch(/^New personal best: 520 \(previous 500\)/);
    expect(progressLine({ ...base, delta: 0 }, 500)).toMatch(/Matched your personal best/);
  });
});

describe('gridFeedback sample-size honesty', () => {
  it('no shots and few shots give no coaching', () => {
    expect(gridFeedback(new GridDrill(1).result()).headline).toMatch(/No shots/);
    const g = new GridDrill(1);
    g.onFire({ yaw: 2, pitch: 0, x: 0, z: 0, speed: 0, dt: 1 / 120 });
    expect(gridFeedback(g.result()).headline).toMatch(/too few/);
  });
});
