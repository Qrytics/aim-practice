import { describe, expect, it } from 'vitest';
import { calibratedDegreesPerUnit } from '../src/core/calibration';
import {
  DEFAULT_SENSITIVITY,
  cm360FromDegreesPerCount,
  degreesPerCount,
  resolveSensitivity,
} from '../src/core/sensitivity';

const TOL = 1e-9;

describe('degreesPerCount', () => {
  it('a full cm/360 of travel at the given DPI sums to exactly 360 degrees', () => {
    for (const [cm, dpi] of [[30, 800], [20, 1600], [45.5, 400], [10, 3200]] as const) {
      const counts = (cm / 2.54) * dpi;
      expect(Math.abs(counts * degreesPerCount(cm, dpi) - 360)).toBeLessThan(TOL);
    }
  });

  it('hand-computed: 2.54 cm at 100 DPI = 100 counts; 360 deg / 100 = 3.6 deg per count', () => {
    expect(Math.abs(degreesPerCount(2.54, 100) - 3.6)).toBeLessThan(TOL);
  });

  it('inverse round trips', () => {
    const d = degreesPerCount(33, 1000);
    expect(Math.abs(cm360FromDegreesPerCount(d, 1000) - 33)).toBeLessThan(1e-9);
  });
});

describe('resolveSensitivity', () => {
  it('nominal mode is labelled nominal and divides by unitsPerCount', () => {
    const a = resolveSensitivity({ ...DEFAULT_SENSITIVITY, unitsPerCount: 1 });
    const b = resolveSensitivity({ ...DEFAULT_SENSITIVITY, unitsPerCount: 2 });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.basis).toBe('nominal');
      expect(Math.abs(a.value.degreesPerUnit / 2 - b.value.degreesPerUnit)).toBeLessThan(TOL);
    }
  });

  it('direct mode ignores DPI and cm/360 entirely', () => {
    const r = resolveSensitivity({ ...DEFAULT_SENSITIVITY, mode: 'direct', degreesPerUnit: 0.07, dpi: NaN });
    expect(r.ok && r.value.degreesPerUnit === 0.07 && r.value.basis === 'direct').toBe(true);
  });

  it.each([
    { dpi: 0 },
    { dpi: NaN },
    { cm360: -5 },
    { cm360: Infinity },
    { unitsPerCount: 0 },
  ])('rejects invalid nominal input %o', (patch) => {
    expect(resolveSensitivity({ ...DEFAULT_SENSITIVITY, ...patch }).ok).toBe(false);
  });

  it('rejects out-of-range direct degrees per unit', () => {
    expect(resolveSensitivity({ ...DEFAULT_SENSITIVITY, mode: 'direct', degreesPerUnit: 0 }).ok).toBe(false);
    expect(resolveSensitivity({ ...DEFAULT_SENSITIVITY, mode: 'direct', degreesPerUnit: 5 }).ok).toBe(false);
  });
});

describe('calibration', () => {
  it('scales so the measured turn matches the intended turn', () => {
    // Turned 180 deg when a full 360 was physically made: sensitivity must double.
    expect(calibratedDegreesPerUnit(0.05, 180, 360)).toBeCloseTo(0.1, 12);
    expect(calibratedDegreesPerUnit(0.05, -720, 360)).toBeCloseTo(0.025, 12);
  });
  it('returns null for unusable measurements', () => {
    expect(calibratedDegreesPerUnit(0.05, 0, 360)).toBeNull();
    expect(calibratedDegreesPerUnit(0.05, NaN, 360)).toBeNull();
    expect(calibratedDegreesPerUnit(0.05, 100, 0)).toBeNull();
    expect(calibratedDegreesPerUnit(0, 100, 360)).toBeNull();
  });
});
