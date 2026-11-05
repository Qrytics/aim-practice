/**
 * Calibration helper. The user turns the view by a known amount (for example
 * one full 360 degree turn measured against the mouse pad), reads the turned
 * degrees from the HUD counter, and we scale degrees-per-unit so the two agree.
 *
 * This corrects for whatever the browser's movement units are on this
 * machine; it does not make anything "match" a game.
 */
export function calibratedDegreesPerUnit(
  currentDegPerUnit: number,
  measuredTurnDeg: number,
  intendedTurnDeg: number,
): number | null {
  if (!(currentDegPerUnit > 0) || !Number.isFinite(currentDegPerUnit)) return null;
  const measured = Math.abs(measuredTurnDeg);
  if (!(measured > 1e-6) || !Number.isFinite(measured)) return null;
  if (!(intendedTurnDeg > 0) || !Number.isFinite(intendedTurnDeg)) return null;
  return currentDegPerUnit * (intendedTurnDeg / measured);
}
