/**
 * Daily challenge: one scenario, difficulty and seed per calendar day, the same
 * for everyone who opens the app that (local) day, derived only from the date.
 * There is no server: nothing is submitted or ranked.
 */

import { Rng } from './rng';
import { SCENARIOS, type Difficulty } from './scenarios';

export interface DailyChallenge {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  scenario: string;
  difficulty: Difficulty;
  seconds: 30 | 60;
  seed: number;
}

/** Local calendar date as YYYY-MM-DD. */
export function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** FNV-1a 32-bit hash of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function dailyFor(date: string): DailyChallenge {
  const rng = new Rng(hashString(`aim-practice-daily|${date}`));
  const eligible = SCENARIOS.filter((s) => s.daily);
  const scenario = eligible[Math.floor(rng.next() * eligible.length)]!.id;
  const roll = rng.next();
  const difficulty: Difficulty = roll < 0.25 ? 'easy' : roll < 0.8 ? 'standard' : 'hard';
  const seconds: 30 | 60 = rng.chance(0.5) ? 30 : 60;
  const seed = Math.floor(rng.next() * 4294967296) >>> 0;
  return { date, scenario, difficulty, seconds, seed };
}

export function isDateString(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T12:00:00`);
  return !Number.isNaN(d.getTime()) && localDateString(d) === v;
}
