import { describe, expect, it } from 'vitest';
import {
  REFERENCE_ASPECT,
  actualHorizontalFov,
  hfovToVfov,
  validateFovSetting,
  verticalFovFromSetting,
  vfovToHfov,
} from '../src/core/fov';

// Angles are degrees; 1e-9 is far above double rounding error for these ops.
const TOL = 1e-9;

describe('reference-aspect identity', () => {
  it.each([60, 90, 100, 103, 130])('actual horizontal FOV equals the setting at 16:9 (%d)', (h) => {
    expect(Math.abs(actualHorizontalFov(h, REFERENCE_ASPECT) - h)).toBeLessThan(TOL);
  });
});

describe('conversion round trips', () => {
  it.each([4 / 3, 16 / 10, 16 / 9, 21 / 9, 32 / 9])('h -> v -> h at aspect %f', (aspect) => {
    for (const h of [60, 85, 100, 120]) {
      expect(Math.abs(vfovToHfov(hfovToVfov(h, aspect), aspect) - h)).toBeLessThan(TOL);
    }
  });

  it('matches a hand-computed value: 90 deg at 16:9 -> vertical 58.7155 deg', () => {
    // 2*atan(tan(45deg) / (16/9)) = 2*atan(0.5625) = 58.71550...
    expect(Math.abs(verticalFovFromSetting(90) - 58.7155)).toBeLessThan(1e-3);
  });
});

describe('Hor+ across aspect ratios (vertical FOV is the constant)', () => {
  it('wider aspect gives wider horizontal coverage, narrower gives less', () => {
    const h = 100;
    const at43 = actualHorizontalFov(h, 4 / 3);
    const at169 = actualHorizontalFov(h, 16 / 9);
    const at219 = actualHorizontalFov(h, 21 / 9);
    const at329 = actualHorizontalFov(h, 32 / 9);
    expect(at43).toBeLessThan(at169);
    expect(at169).toBeLessThan(at219);
    expect(at219).toBeLessThan(at329);
    expect(at329).toBeLessThan(180);
  });

  it('derived vertical FOV does not depend on the window aspect', () => {
    // The camera is always given verticalFovFromSetting(setting); only aspect varies.
    const v = verticalFovFromSetting(100);
    for (const aspect of [4 / 3, 16 / 9, 21 / 9]) {
      expect(Math.abs(hfovToVfov(actualHorizontalFov(100, aspect), aspect) - v)).toBeLessThan(TOL);
    }
  });
});

describe('validation', () => {
  it('accepts in-range values and rejects NaN, Infinity and out-of-range', () => {
    expect(validateFovSetting(100).ok).toBe(true);
    expect(validateFovSetting(NaN).ok).toBe(false);
    expect(validateFovSetting(Infinity).ok).toBe(false);
    expect(validateFovSetting(59.9).ok).toBe(false);
    expect(validateFovSetting(130.1).ok).toBe(false);
  });
});
