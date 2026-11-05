import { DEFAULT_CROSSHAIR, parseCrosshair, type CrosshairSettings } from './crosshair';
import { DEFAULT_FOV_SETTING, FOV_LIMITS } from './fov';
import {
  DEFAULT_SENSITIVITY,
  SENSITIVITY_LIMITS,
  type SensitivitySettings,
} from './sensitivity';

export interface Settings {
  sensitivity: SensitivitySettings;
  /** Horizontal FOV in degrees, defined at the 16:9 reference aspect. */
  fovAt16x9: number;
  crosshair: CrosshairSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: DEFAULT_SENSITIVITY,
  fovAt16x9: DEFAULT_FOV_SETTING,
  crosshair: DEFAULT_CROSSHAIR,
};

function num(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
}

/** Defensive parse of stored settings: anything invalid falls back per field. */
export function parseSettings(raw: unknown): Settings {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const s = (typeof o.sensitivity === 'object' && o.sensitivity !== null ? o.sensitivity : {}) as Record<
    string,
    unknown
  >;
  const d = DEFAULT_SENSITIVITY;
  const L = SENSITIVITY_LIMITS;
  return {
    sensitivity: {
      mode: s.mode === 'direct' ? 'direct' : 'nominal',
      dpi: num(s.dpi, L.dpi.min, L.dpi.max, d.dpi),
      cm360: num(s.cm360, L.cm360.min, L.cm360.max, d.cm360),
      unitsPerCount: num(s.unitsPerCount, L.unitsPerCount.min, L.unitsPerCount.max, d.unitsPerCount),
      degreesPerUnit: num(s.degreesPerUnit, L.degreesPerUnit.min, L.degreesPerUnit.max, d.degreesPerUnit),
    },
    fovAt16x9: num(o.fovAt16x9, FOV_LIMITS.min, FOV_LIMITS.max, DEFAULT_FOV_SETTING),
    crosshair: parseCrosshair(o.crosshair),
  };
}
