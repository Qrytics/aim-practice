/**
 * Common drill contract. A drill is pure simulation state: it never touches
 * the DOM or the renderer. The Simulation feeds it fire events and one
 * `step()` per RUNNING fixed step (never during countdown or pause).
 */

/** Visual/theme profile of the arena and page. */
export type ProfileId = 'precision' | 'tracking';

/** Which drill implementation (and result shape) a scenario uses. */
export type DrillKind = 'precision' | 'tracking' | 'grid';

export type DrillResult =
  | import('./drills/precision').PrecisionResult
  | import('./drills/tracking').TrackingResult
  | import('./drills/grid').GridResult;

export interface DrillTarget {
  id: number;
  x: number;
  y: number;
  z: number;
  r: number;
  /** Aim is on the target while firing (tracking feedback). */
  hot?: boolean;
}

export type DrillEvent =
  | { type: 'spawn'; id: number }
  | { type: 'hit'; id: number; x: number; y: number; z: number }
  | { type: 'miss' }
  | { type: 'expire'; id: number };

export interface DrillFire {
  yaw: number;
  pitch: number;
  x: number;
  z: number;
  /** Horizontal speed of the player at the shot, m/s. */
  speed: number;
  /** Length of one simulation step, s (shot time is quantised to the step end). */
  dt: number;
}

export interface DrillStep {
  dt: number;
  player: { x: number; z: number; vx: number; vz: number; yaw: number; pitch: number };
  fireHeld: boolean;
}

export interface DrillHud {
  primaryLabel: string;
  primaryValue: string;
  stats: string;
  /** 0..1 live quality meter, or null when the drill has none. */
  meter: number | null;
  hot: boolean;
}

export interface Drill<R = DrillResult> {
  readonly kind: DrillKind;
  readonly seed: number;
  readonly targets: readonly DrillTarget[];
  onFire(f: DrillFire): void;
  step(s: DrillStep): void;
  drainEvents(): DrillEvent[];
  hud(): DrillHud;
  result(): R;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
