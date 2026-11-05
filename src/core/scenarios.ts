/**
 * Scenarios: a drill kind + a named configuration. Everything is original and
 * every number is a design choice. "Easier/Harder" is relative to this app's
 * own settings, not to any game or rank.
 */

import type { DrillKind, ProfileId } from './drill';
import { GRID, type GridConfig } from './drills/grid';
import { PRECISION, type PrecisionConfig } from './drills/precision';
import { TRACKING, type TrackingConfig } from './drills/tracking';

export type Difficulty = 'easy' | 'standard' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'standard', 'hard'];

export interface ScenarioDef {
  id: string;
  name: string;
  kind: DrillKind;
  profile: ProfileId;
  /** Whether the dedicated tag in the UI says Valorant-/Overwatch-inspired (never for the generic ones). */
  inspired: string | null;
  blurb: string;
  controls: string;
  /** Daily-challenge eligible. */
  daily: boolean;
}

export const SCENARIOS: readonly ScenarioDef[] = [
  {
    id: 'precision',
    name: 'Precision',
    kind: 'precision',
    profile: 'precision',
    inspired: 'Valorant-inspired',
    blurb: 'One target at a time. Flick to it, let the crosshair settle, and click once. Stopping before you shoot and spacing your shots both pay off.',
    controls: 'Left click fires a single shot.',
    daily: true,
  },
  {
    id: 'tracking',
    name: 'Tracking',
    kind: 'tracking',
    profile: 'tracking',
    inspired: 'Overwatch-inspired',
    blurb: 'One target keeps moving and changing direction. Hold the left button and keep the crosshair on it. Strafing while you track is part of the practice.',
    controls: 'Hold the left button to fire; only time spent firing is scored.',
    daily: true,
  },
  {
    id: 'grid',
    name: 'Grid',
    kind: 'grid',
    profile: 'precision',
    inspired: null,
    blurb: 'Three targets sit on the wall. Shoot one and a new one appears elsewhere. Work through them quickly without wasting shots.',
    controls: 'Left click fires. There is no timeout on targets.',
    daily: true,
  },
];

export function scenarioById(id: string): ScenarioDef | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

export function isDifficulty(v: unknown): v is Difficulty {
  return v === 'easy' || v === 'standard' || v === 'hard';
}

export const DURATIONS = [30, 60, 90] as const;
export type Duration = (typeof DURATIONS)[number];
export function isDuration(v: unknown): v is Duration {
  return typeof v === 'number' && (DURATIONS as readonly number[]).includes(v);
}

export function precisionConfig(d: Difficulty): PrecisionConfig {
  switch (d) {
    case 'easy':
      return { ...PRECISION, targetRadius: 0.3, lifetime: 3.0, distMin: 5, distMax: 9, flickMaxDeg: 90, minShotInterval: 0.18 };
    case 'hard':
      return { ...PRECISION, targetRadius: 0.15, lifetime: 1.7, distMin: 7, distMax: 12, flickMinDeg: 30, flickMaxDeg: 140, minShotInterval: 0.28, respawnDelay: 0.2 };
    default:
      return PRECISION;
  }
}

export function trackingConfig(d: Difficulty): TrackingConfig {
  switch (d) {
    case 'easy':
      return { ...TRACKING, radius: 0.42, speedMinDeg: 12, speedMaxDeg: 30, changeMin: 0.6, changeMax: 1.8, flipChance: 0.55 };
    case 'hard':
      return { ...TRACKING, radius: 0.22, speedMinDeg: 28, speedMaxDeg: 70, changeMin: 0.25, changeMax: 0.9, flipChance: 0.8 };
    default:
      return TRACKING;
  }
}

export function gridConfig(d: Difficulty): GridConfig {
  switch (d) {
    case 'easy':
      return { ...GRID, count: 3, radius: 0.36, halfWidth: 3.0 };
    case 'hard':
      return { ...GRID, count: 3, radius: 0.2, halfWidth: 4.4, minShotInterval: 0.08, quickWindow: 0.6 };
    default:
      return GRID;
  }
}

/** What a saved score is compared against: only runs of the same scenario, difficulty and length. */
export function categoryKey(scenario: string, difficulty: Difficulty, seconds: number): string {
  return `${scenario}|${difficulty}|${seconds}`;
}
