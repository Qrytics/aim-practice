/**
 * Basic ground movement. Original design values, not any game's.
 *
 * Coordinates: x right, y up, z toward the viewer. yaw = 0 looks down -z.
 * Positive yaw turns the view LEFT (counter-clockwise from above), matching
 * three.js camera rotation.y.
 */

export interface PlayerState {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** radians */
  yaw: number;
  /** radians, positive looks up */
  pitch: number;
}

export interface MovementConfig {
  /** m/s */
  maxSpeed: number;
  /** m/s^2 while a movement key is held */
  accel: number;
  /** m/s^2 when no key is held */
  decel: number;
  /** collision radius against the arena bounds, m */
  radius: number;
}

export interface ArenaBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Design choice (original). */
export const DEFAULT_MOVEMENT: MovementConfig = {
  maxSpeed: 5.4,
  accel: 48,
  decel: 60,
  radius: 0.4,
};

export function createPlayer(x: number, z: number): PlayerState {
  return { x, z, vx: 0, vz: 0, yaw: 0, pitch: 0 };
}

/** Advances one fixed step in place. Diagonals are normalised (no speed boost). */
export function stepMovement(
  p: PlayerState,
  axes: { forward: number; right: number },
  dt: number,
  cfg: MovementConfig,
  bounds: ArenaBounds,
): void {
  const sin = Math.sin(p.yaw);
  const cos = Math.cos(p.yaw);
  let wx = -sin * axes.forward + cos * axes.right;
  let wz = -cos * axes.forward - sin * axes.right;
  const len = Math.hypot(wx, wz);
  const hasWish = len > 1e-9;
  if (hasWish) {
    wx /= len;
    wz /= len;
  } else {
    wx = 0;
    wz = 0;
  }

  const tx = wx * cfg.maxSpeed;
  const tz = wz * cfg.maxSpeed;
  const rate = (hasWish ? cfg.accel : cfg.decel) * dt;
  const dvx = tx - p.vx;
  const dvz = tz - p.vz;
  const dl = Math.hypot(dvx, dvz);
  if (dl <= rate) {
    p.vx = tx;
    p.vz = tz;
  } else {
    p.vx += (dvx / dl) * rate;
    p.vz += (dvz / dl) * rate;
  }

  p.x += p.vx * dt;
  p.z += p.vz * dt;

  const r = cfg.radius;
  if (p.x < bounds.minX + r) {
    p.x = bounds.minX + r;
    p.vx = 0;
  } else if (p.x > bounds.maxX - r) {
    p.x = bounds.maxX - r;
    p.vx = 0;
  }
  if (p.z < bounds.minZ + r) {
    p.z = bounds.minZ + r;
    p.vz = 0;
  } else if (p.z > bounds.maxZ - r) {
    p.z = bounds.maxZ - r;
    p.vz = 0;
  }
}
