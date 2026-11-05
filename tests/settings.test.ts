import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from '../src/core/settings';

describe('parseSettings', () => {
  it('returns defaults for non-objects and empty input', () => {
    for (const bad of [null, undefined, 5, 'x', [], {}]) {
      expect(parseSettings(bad)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('keeps valid fields and replaces invalid ones individually', () => {
    const r = parseSettings({
      sensitivity: { mode: 'direct', dpi: 1600, cm360: -3, unitsPerCount: 'x', degreesPerUnit: 0.05 },
      fovAt16x9: 500,
    });
    expect(r.sensitivity.mode).toBe('direct');
    expect(r.sensitivity.dpi).toBe(1600);
    expect(r.sensitivity.cm360).toBe(DEFAULT_SETTINGS.sensitivity.cm360);
    expect(r.sensitivity.unitsPerCount).toBe(DEFAULT_SETTINGS.sensitivity.unitsPerCount);
    expect(r.sensitivity.degreesPerUnit).toBe(0.05);
    expect(r.fovAt16x9).toBe(DEFAULT_SETTINGS.fovAt16x9);
  });

  it('rejects NaN/Infinity and unknown modes', () => {
    const r = parseSettings({ sensitivity: { mode: 'weird', dpi: NaN, cm360: Infinity }, fovAt16x9: NaN });
    expect(r).toEqual(DEFAULT_SETTINGS);
  });
});
