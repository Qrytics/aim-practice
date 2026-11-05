/**
 * Turns a finished drill result into the compact record that is stored in
 * local history. Pure and unit tested.
 *
 * Runs with no activity (no shots fired / no firing time) are NOT recorded:
 * a score of 0 from an untouched run would drag averages down and mean nothing.
 */

import type { DrillResult } from './drill';
import type { RunRecord } from './history';
import type { Difficulty } from './scenarios';

export interface RunInfo {
  scenario: string;
  difficulty: Difficulty;
  seconds: number;
  seed: number;
  /** YYYY-MM-DD when played as the daily challenge. */
  daily: string | null;
}

const pct = (v: number | null) => (v === null ? 'n/a' : `${Math.round(v * 100)}%`);

export function recordFromResult(result: DrillResult, info: RunInfo, nowIso: string): RunRecord | null {
  let accuracy: number | null;
  let detail: string;
  switch (result.kind) {
    case 'precision':
      if (result.shots === 0) return null;
      accuracy = result.accuracy;
      detail = `${pct(accuracy)} accuracy` + (result.medianTimeToHit === null ? '' : ` · median ${result.medianTimeToHit.toFixed(2)} s`);
      break;
    case 'tracking':
      if (result.firingSeconds <= 0) return null;
      accuracy = result.ratioFiring;
      detail = `${pct(result.ratioFiring)} on target while firing · ${result.firingSeconds.toFixed(1)} s firing`;
      break;
    case 'grid':
      if (result.shots === 0) return null;
      accuracy = result.accuracy;
      detail = `${pct(accuracy)} accuracy · ${(result.killsPerSecond ?? 0).toFixed(2)} kills/s`;
      break;
  }
  return {
    at: nowIso,
    scenario: info.scenario,
    difficulty: info.difficulty,
    seconds: info.seconds,
    score: result.score,
    accuracy,
    detail,
    seed: info.seed >>> 0,
    daily: info.daily,
  };
}
