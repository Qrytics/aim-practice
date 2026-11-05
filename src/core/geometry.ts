/**
 * Aim geometry shared by the simulation, drills and renderer.
 *
 * Conventions (match three.js camera rotation order YXZ used by the renderer):
 *   x right, y up, z toward the viewer. yaw = 0 looks down -z; positive yaw
 *   turns LEFT. Positive pitch looks up.
 */

/** Eye height above the floor, metres (original design choice). */
export const EYE_HEIGHT = 1.6;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface AimSource {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
}

/** Unit forward vector for a yaw/pitch (radians). */
export function aimDirection(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

export function eyePosition(p: { x: number; z: number }): Vec3 {
  return { x: p.x, y: EYE_HEIGHT, z: p.z };
}

/**
 * Distance along a UNIT-length ray to the first intersection with a sphere,
 * or null. If the origin is inside the sphere the exit distance is returned.
 */
export function raySphere(origin: Vec3, dir: Vec3, center: Vec3, radius: number): number | null {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t0 = -b - s;
  if (t0 >= 0) return t0;
  const t1 = -b + s;
  return t1 >= 0 ? t1 : null;
}

/** Does the player's aim ray hit a sphere? */
export function aimHitsSphere(p: AimSource, center: Vec3, radius: number): boolean {
  return raySphere(eyePosition(p), aimDirection(p.yaw, p.pitch), center, radius) !== null;
}

export function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z);
  return l > 0 ? { x: v.x / l, y: v.y / l, z: v.z / l } : { x: 0, y: 0, z: 0 };
}

/** Angle in degrees between two unit vectors. */
export function angleBetweenDeg(a: Vec3, b: Vec3): number {
  const d = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
  return (Math.acos(d) * 180) / Math.PI;
}

/** Angle in degrees from the player's aim to the direction of a point. */
export function aimErrorDeg(p: AimSource, point: Vec3): number {
  const to = normalize({
    x: point.x - p.x,
    y: point.y - EYE_HEIGHT,
    z: point.z - p.z,
  });
  return angleBetweenDeg(aimDirection(p.yaw, p.pitch), to);
}
