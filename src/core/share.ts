/**
 * Challenge links: a scenario, difficulty, length and seed encoded in the URL
 * so a friend can play the SAME target pattern. No score is embedded, so there
 * is nothing to forge and nothing to verify; compare scores yourselves.
 *
 *   ?c=<scenario>.<difficulty>.<seconds>.<seed>
 */

import { isDifficulty, isDuration, scenarioById, type Difficulty } from './scenarios';

export interface Challenge {
  scenario: string;
  difficulty: Difficulty;
  seconds: number;
  seed: number;
}

export function encodeChallenge(c: Challenge): string {
  return `${c.scenario}.${c.difficulty}.${c.seconds}.${c.seed >>> 0}`;
}

/** Returns null for anything malformed; never throws. Strict: unknown ids, lengths or huge seeds are rejected. */
export function decodeChallenge(raw: string | null): Challenge | null {
  if (!raw || raw.length > 64) return null;
  const parts = raw.split('.');
  if (parts.length !== 4) return null;
  const [scenario, difficulty, secs, seed] = parts as [string, string, string, string];
  if (!scenarioById(scenario)) return null;
  if (!isDifficulty(difficulty)) return null;
  if (!/^\d{1,3}$/.test(secs) || !/^\d{1,10}$/.test(seed)) return null;
  const seconds = Number(secs);
  if (!isDuration(seconds)) return null;
  const s = Number(seed);
  if (s > 4294967295) return null;
  return { scenario, difficulty, seconds, seed: s };
}

export function challengeUrl(base: string, c: Challenge): string {
  const u = new URL(base);
  u.search = '';
  u.hash = '';
  u.searchParams.set('c', encodeChallenge(c));
  return u.toString();
}
