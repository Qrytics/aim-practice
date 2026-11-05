/**
 * Local run history and personal bests. Pure: storage is passed in, so this is
 * unit tested without a browser. Nothing leaves the device.
 *
 * Only DERIVED run summaries are stored (score, accuracy, durations, seed).
 * Raw mouse movement, per-shot data and timestamps of individual inputs are
 * never stored.
 */

import { categoryKey, isDifficulty, type Difficulty } from './scenarios';

export interface RunRecord {
  /** ISO date-time the run finished. */
  at: string;
  scenario: string;
  difficulty: Difficulty;
  seconds: number;
  score: number;
  /** 0..1, or null when the scenario has no accuracy (e.g. no shots). */
  accuracy: number | null;
  /** Headline secondary stat, scenario-specific, already formatted for display. */
  detail: string;
  seed: number;
  /** YYYY-MM-DD when this was the daily challenge, else null. */
  daily: string | null;
}

export const HISTORY_LIMIT = 200;

export function emptyHistory(): RunRecord[] {
  return [];
}

function isRecord(v: unknown): v is RunRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.at === 'string' &&
    typeof r.scenario === 'string' &&
    isDifficulty(r.difficulty) &&
    typeof r.seconds === 'number' &&
    Number.isFinite(r.seconds) &&
    typeof r.score === 'number' &&
    Number.isFinite(r.score) &&
    (r.accuracy === null || (typeof r.accuracy === 'number' && Number.isFinite(r.accuracy))) &&
    typeof r.detail === 'string' &&
    typeof r.seed === 'number' &&
    (r.daily === null || typeof r.daily === 'string')
  );
}

/** Defensive parse: anything malformed is dropped, never thrown. */
export function parseHistory(raw: unknown): RunRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).slice(-HISTORY_LIMIT);
}

export function addRun(history: readonly RunRecord[], run: RunRecord): RunRecord[] {
  return [...history, run].slice(-HISTORY_LIMIT);
}

export function categoryOf(r: RunRecord): string {
  return categoryKey(r.scenario, r.difficulty, r.seconds);
}

export function runsIn(history: readonly RunRecord[], key: string): RunRecord[] {
  return history.filter((r) => categoryOf(r) === key);
}

/** Highest score among runs in the category, or null. */
export function personalBest(history: readonly RunRecord[], key: string): RunRecord | null {
  let best: RunRecord | null = null;
  for (const r of runsIn(history, key)) if (!best || r.score > best.score) best = r;
  return best;
}

export interface RunComparison {
  /** First run in this category: nothing to compare with. */
  first: boolean;
  newBest: boolean;
  /** Previous best score (before this run), or null. */
  previousBest: number | null;
  /** score - previousBest, or null. */
  delta: number | null;
  /** How many earlier runs in this category (for honest sample-size wording). */
  earlierRuns: number;
  /** Average of the up-to-5 runs before this one, or null if none. */
  recentAverage: number | null;
}

/** Compare a just-finished run with the history BEFORE it was added. */
export function compare(before: readonly RunRecord[], run: RunRecord): RunComparison {
  const key = categoryOf(run);
  const earlier = runsIn(before, key);
  if (earlier.length === 0) {
    return { first: true, newBest: false, previousBest: null, delta: null, earlierRuns: 0, recentAverage: null };
  }
  const prev = Math.max(...earlier.map((r) => r.score));
  const recent = earlier.slice(-5);
  return {
    first: false,
    newBest: run.score > prev,
    previousBest: prev,
    delta: run.score - prev,
    earlierRuns: earlier.length,
    recentAverage: recent.reduce((s, r) => s + r.score, 0) / recent.length,
  };
}

export interface CategorySummary {
  key: string;
  scenario: string;
  difficulty: Difficulty;
  seconds: number;
  runs: number;
  best: number;
  last: number;
  average: number;
}

export function summarize(history: readonly RunRecord[]): CategorySummary[] {
  const map = new Map<string, RunRecord[]>();
  for (const r of history) {
    const k = categoryOf(r);
    const a = map.get(k);
    if (a) a.push(r);
    else map.set(k, [r]);
  }
  return [...map.entries()]
    .map(([key, runs]) => ({
      key,
      scenario: runs[0]!.scenario,
      difficulty: runs[0]!.difficulty,
      seconds: runs[0]!.seconds,
      runs: runs.length,
      best: Math.max(...runs.map((r) => r.score)),
      last: runs[runs.length - 1]!.score,
      average: runs.reduce((s, r) => s + r.score, 0) / runs.length,
    }))
    .sort((a, b) => b.runs - a.runs || a.key.localeCompare(b.key));
}

/** Last n scores of a category, oldest first (for a trend line). */
export function recentScores(history: readonly RunRecord[], key: string, n = 12): number[] {
  return runsIn(history, key)
    .slice(-n)
    .map((r) => r.score);
}
