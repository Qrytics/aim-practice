/**
 * Field of view model.
 *
 * The user-facing setting is a HORIZONTAL FOV defined at a 16:9 REFERENCE
 * ASPECT. From it we derive one VERTICAL FOV, and that vertical FOV is what
 * stays fixed when the window aspect changes (Hor+ behaviour: wider windows
 * reveal more horizontally, vertical coverage is unchanged).
 *
 *   vertical FOV           = 2 * atan( tan(settingH / 2) / (16/9) )
 *   actual horizontal FOV  = 2 * atan( tan(vertical / 2) * currentAspect )
 *
 * At exactly 16:9 the actual horizontal FOV equals the setting.
 * three.js PerspectiveCamera.fov is a VERTICAL FOV in degrees (verified in
 * node_modules/three/src/cameras/PerspectiveCamera.js, "The vertical field
 * of view").
 */

export const REFERENCE_ASPECT = 16 / 9;

/** Design choice (original): accepted range for the setting, degrees at 16:9. */
export const FOV_LIMITS = { min: 60, max: 130 } as const;
export const DEFAULT_FOV_SETTING = 100;

const DEG = Math.PI / 180;

export function hfovToVfov(hfovDeg: number, aspect: number): number {
  return (2 * Math.atan(Math.tan((hfovDeg * DEG) / 2) / aspect)) / DEG;
}

export function vfovToHfov(vfovDeg: number, aspect: number): number {
  return (2 * Math.atan(Math.tan((vfovDeg * DEG) / 2) * aspect)) / DEG;
}

/** Vertical FOV (degrees) implied by a setting made at the 16:9 reference. */
export function verticalFovFromSetting(settingHfovAt16x9: number): number {
  return hfovToVfov(settingHfovAt16x9, REFERENCE_ASPECT);
}

/** Horizontal FOV (degrees) actually shown at the given current aspect. */
export function actualHorizontalFov(settingHfovAt16x9: number, aspect: number): number {
  return vfovToHfov(verticalFovFromSetting(settingHfovAt16x9), aspect);
}

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateFovSetting(raw: number): Validation<number> {
  if (!Number.isFinite(raw)) return { ok: false, error: 'Enter a number.' };
  if (raw < FOV_LIMITS.min || raw > FOV_LIMITS.max) {
    return { ok: false, error: `Use a value from ${FOV_LIMITS.min} to ${FOV_LIMITS.max} degrees.` };
  }
  return { ok: true, value: raw };
}
