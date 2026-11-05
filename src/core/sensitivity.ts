/**
 * Mouse sensitivity model.
 *
 * Two ways to define how far the view turns per BROWSER input unit
 * (one unit of MouseEvent.movementX/Y while pointer-locked):
 *
 *  - 'nominal': derived from DPI and cm/360 under the ASSUMPTION that one
 *    physical sensor count produces `unitsPerCount` browser units.
 *      degreesPerCount = 360 / (cm360 / 2.54 * dpi)
 *      degreesPerUnit  = degreesPerCount / unitsPerCount
 *    This is only as true as that assumption. MDN states that browsers use
 *    different units for movementX (physical, logical or CSS pixels depending
 *    on browser and OS), so these results are NOMINAL until physically
 *    calibrated (turn the mouse a measured distance and compare the turned
 *    degrees shown in the HUD).
 *
 *  - 'direct': the user enters degrees per browser input unit; no DPI or
 *    count assumption is involved.
 *
 * Nothing here claims to match any game's sensitivity scale.
 */

import type { Validation } from './fov';

export const CM_PER_INCH = 2.54;

export type SensitivityMode = 'nominal' | 'direct';

export interface SensitivitySettings {
  mode: SensitivityMode;
  /** Mouse sensor DPI (counts per inch). */
  dpi: number;
  /** Physical mouse travel in cm for a 360 degree turn (nominal mode). */
  cm360: number;
  /** Browser input units reported per physical count (calibration, nominal mode). */
  unitsPerCount: number;
  /** Degrees of view rotation per browser input unit (direct mode). */
  degreesPerUnit: number;
}

/** Design-choice placeholders. Not taken from any game. */
export const DEFAULT_SENSITIVITY: SensitivitySettings = {
  mode: 'nominal',
  dpi: 800,
  cm360: 30,
  unitsPerCount: 1,
  degreesPerUnit: 0.04,
};

export const SENSITIVITY_LIMITS = {
  dpi: { min: 50, max: 32000 },
  cm360: { min: 1, max: 500 },
  unitsPerCount: { min: 0.1, max: 10 },
  degreesPerUnit: { min: 0.0005, max: 1 },
} as const;

/** Degrees turned per physical sensor count. */
export function degreesPerCount(cm360: number, dpi: number): number {
  return 360 / ((cm360 / CM_PER_INCH) * dpi);
}

/** Inverse of degreesPerCount. */
export function cm360FromDegreesPerCount(degPerCount: number, dpi: number): number {
  return (360 / (degPerCount * dpi)) * CM_PER_INCH;
}

export interface ResolvedSensitivity {
  degreesPerUnit: number;
  /** 'nominal' values rest on unverified count assumptions. */
  basis: 'nominal' | 'direct';
  /** Implied cm/360 under the stated assumptions (nominal mode only). */
  cm360?: number;
}

function inRange(v: number, r: { min: number; max: number }): boolean {
  return Number.isFinite(v) && v >= r.min && v <= r.max;
}

export function validateField(
  field: keyof typeof SENSITIVITY_LIMITS,
  raw: number,
): Validation<number> {
  const r = SENSITIVITY_LIMITS[field];
  if (!Number.isFinite(raw)) return { ok: false, error: 'Enter a number.' };
  if (!inRange(raw, r)) return { ok: false, error: `Use a value from ${r.min} to ${r.max}.` };
  return { ok: true, value: raw };
}

export function resolveSensitivity(s: SensitivitySettings): Validation<ResolvedSensitivity> {
  if (s.mode === 'direct') {
    const v = validateField('degreesPerUnit', s.degreesPerUnit);
    if (!v.ok) return v;
    return { ok: true, value: { degreesPerUnit: v.value, basis: 'direct' } };
  }
  for (const f of ['dpi', 'cm360', 'unitsPerCount'] as const) {
    const v = validateField(f, s[f]);
    if (!v.ok) return { ok: false, error: `${f}: ${v.error}` };
  }
  const perCount = degreesPerCount(s.cm360, s.dpi);
  return {
    ok: true,
    value: { degreesPerUnit: perCount / s.unitsPerCount, basis: 'nominal', cm360: s.cm360 },
  };
}
