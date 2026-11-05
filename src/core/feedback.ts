/**
 * Plain-language feedback from a drill result. Pure and deterministic.
 *
 * Every threshold here is an ORIGINAL heuristic chosen for this app, not a
 * benchmark from any game or study. Wording avoids claiming more than the
 * numbers show, and a small sample says so instead of giving advice.
 */

import type { PrecisionResult } from './drills/precision';
import type { GridResult } from './drills/grid';
import type { TrackingResult } from './drills/tracking';
import type { RunComparison } from './history';

export interface Feedback {
  headline: string;
  /** Observations that follow directly from the numbers. */
  findings: string[];
  /** One or two things to try next, only when the data supports them. */
  tryNext: string[];
}

export const FEEDBACK = {
  minShots: 5,
  minMovingShots: 4,
  movingGapPoints: 0.15,
  slowMedianTth: 1.1,
  earlyMissAge: 0.45,
  minTrackFiring: 3,
  goodRatioFiring: 0.6,
  lowRatioActive: 0.3,
  slowReacquire: 0.5,
} as const;

const pct = (v: number) => `${Math.round(v * 100)}%`;
const sec = (v: number) => `${v.toFixed(2)} s`;

export function precisionFeedback(r: PrecisionResult): Feedback {
  const F = FEEDBACK;
  const findings: string[] = [];
  const tryNext: string[] = [];

  if (r.shots === 0) {
    return {
      headline: 'No shots were fired this run.',
      findings: [`${r.targetsSpawned} targets appeared and ${r.expired} timed out.`],
      tryNext: ['Flick to the target and click once. Each target stays for a couple of seconds.'],
    };
  }
  if (r.shots < F.minShots) {
    return {
      headline: `Only ${r.shots} shots: too few to judge your aim.`,
      findings: [`${r.hits} hit, ${r.misses} missed, ${r.expired} timed out.`],
      tryNext: ['Run it again and keep clicking on targets to get a meaningful sample.'],
    };
  }

  const acc = r.accuracy ?? 0;
  findings.push(`You hit ${r.hits} of ${r.shots} shots (${pct(acc)}).`);
  if (r.medianTimeToHit !== null) {
    findings.push(`Median time from a target appearing to your hit: ${sec(r.medianTimeToHit)} (best ${sec(r.bestTimeToHit ?? r.medianTimeToHit)}).`);
  }
  if (r.medianFlickDeg !== null) findings.push(`Typical flick distance: about ${Math.round(r.medianFlickDeg)}°.`);
  if (r.expired > 0) findings.push(`${r.expired} target${r.expired === 1 ? '' : 's'} timed out without a shot.`);
  if (r.rushedBlocked > 0) {
    findings.push(`${r.rushedBlocked} click${r.rushedBlocked === 1 ? ' was' : 's were'} ignored for coming too soon after the previous shot.`);
    tryNext.push('Space your shots: one deliberate click per target.');
  }

  const early = r.outcomes.filter((o) => o.kind === 'miss' && o.age !== null && o.age < F.earlyMissAge).length;
  if (early >= 2 && early >= r.misses / 2) {
    findings.push(`${early} of your ${r.misses} misses came within ${F.earlyMissAge} s of a target appearing.`);
    tryNext.push('Let the crosshair settle on the target before clicking, even if it costs a fraction of a second.');
  }

  if (
    r.movingShots >= F.minMovingShots &&
    r.settledShots >= F.minMovingShots &&
    r.movingAccuracy !== null &&
    r.settledAccuracy !== null
  ) {
    findings.push(`Accuracy while moving: ${pct(r.movingAccuracy)} (${r.movingShots} shots). Standing still: ${pct(r.settledAccuracy)} (${r.settledShots} shots).`);
    if (r.settledAccuracy - r.movingAccuracy >= F.movingGapPoints) {
      tryNext.push('Release the movement keys and let your speed drop before you click.');
    }
  } else if (r.movingShots > 0) {
    findings.push(`${r.movingShots} shot${r.movingShots === 1 ? '' : 's'} fired while moving: too few to compare with standing shots.`);
  }

  if (r.medianTimeToHit !== null && r.medianTimeToHit > F.slowMedianTth) {
    tryNext.push('Your flicks are taking over a second on average: practise moving the crosshair toward where targets appear before they do.');
  }
  if (tryNext.length === 0 && acc >= 0.8) tryNext.push('Accuracy is solid. Try a lower time-to-hit by committing to the flick earlier.');
  if (tryNext.length === 0) tryNext.push('Run it again; one session is a small sample, and trends across several runs say more.');

  const headline =
    acc >= 0.8 ? `Accurate run: ${pct(acc)} of shots hit.` : acc >= 0.5 ? `Mixed run: ${pct(acc)} of shots hit.` : `Low accuracy this run: ${pct(acc)} of shots hit.`;
  return { headline, findings, tryNext: tryNext.slice(0, 2) };
}

export function trackingFeedback(r: TrackingResult): Feedback {
  const F = FEEDBACK;
  const findings: string[] = [];
  const tryNext: string[] = [];

  if (r.firingSeconds === 0) {
    return {
      headline: 'You did not fire this run.',
      findings: ['Tracking is scored only while you hold the left mouse button.'],
      tryNext: ['Hold the left mouse button and keep the crosshair on the moving target.'],
    };
  }
  if (r.firingSeconds < F.minTrackFiring) {
    return {
      headline: `Only ${sec(r.firingSeconds)} of firing: too little to judge your tracking.`,
      findings: [`${sec(r.onTargetFiringSeconds)} of that was on target.`],
      tryNext: ['Hold fire for longer stretches so there is enough to measure.'],
    };
  }

  const rf = r.ratioFiring ?? 0;
  const ra = r.ratioActive ?? 0;
  findings.push(`You were on target for ${sec(r.onTargetFiringSeconds)} of ${sec(r.firingSeconds)} spent firing (${pct(rf)}).`);
  findings.push(`That is ${pct(ra)} of the ${Math.round(r.activeSeconds)} s run.`);
  findings.push(`Longest unbroken stretch on target while firing: ${sec(r.longestOnStreakSeconds)}.`);
  if (r.meanErrorDeg !== null) findings.push(`Average distance from the target centre while firing: ${r.meanErrorDeg.toFixed(1)}°.`);
  if (r.directionChanges > 0) {
    findings.push(`The target changed direction or speed ${r.directionChanges} times. You held on through ${r.heldThrough} of them.`);
  }
  if (r.medianReacquireSeconds !== null) findings.push(`When you lost it after a change, you got back on in ${sec(r.medianReacquireSeconds)} (median).`);
  if (r.unrecovered > 0) findings.push(`${r.unrecovered} time${r.unrecovered === 1 ? '' : 's'} you did not get back on target after a change.`);

  if (rf >= F.goodRatioFiring && ra < F.lowRatioActive) {
    tryNext.push('You track well while firing but spent little of the run firing. Fire for longer stretches.');
  } else if (rf < F.goodRatioFiring && r.meanErrorDeg !== null) {
    tryNext.push('Fire only while the crosshair is on the target, and ease off the button when you drift.');
  }
  if (r.medianReacquireSeconds !== null && r.medianReacquireSeconds > F.slowReacquire) {
    tryNext.push('After a direction change, correct with a small smooth move instead of a big jump.');
  }
  if (tryNext.length === 0) tryNext.push('Run it again; one session is a small sample.');

  const headline = rf >= 0.7 ? `Strong tracking: on target for ${pct(rf)} of your firing.` : rf >= 0.4 ? `Decent tracking: on target for ${pct(rf)} of your firing.` : `Tracking needs work: on target for ${pct(rf)} of your firing.`;
  return { headline, findings, tryNext: tryNext.slice(0, 2) };
}

export function gridFeedback(r: GridResult): Feedback {
  const F = FEEDBACK;
  const findings: string[] = [];
  const tryNext: string[] = [];
  if (r.shots === 0) {
    return { headline: 'No shots were fired this run.', findings: [], tryNext: ['Click a target to start. A new one appears after every kill.'] };
  }
  if (r.shots < F.minShots) {
    return { headline: `Only ${r.shots} shots: too few to judge your aim.`, findings: [`${r.hits} hit, ${r.misses} missed.`], tryNext: ['Run it again and keep clearing targets.'] };
  }
  const acc = r.accuracy ?? 0;
  findings.push(`You hit ${r.hits} of ${r.shots} shots (${pct(acc)}), about ${(r.killsPerSecond ?? 0).toFixed(2)} kills per second.`);
  if (r.medianKillInterval !== null) findings.push(`Median time between kills: ${sec(r.medianKillInterval)}.`);
  findings.push(`Longest streak without a miss: ${r.bestStreak}.`);
  if (r.rushedBlocked > 0) findings.push(`${r.rushedBlocked} click${r.rushedBlocked === 1 ? ' was' : 's were'} ignored for coming too soon after the previous one.`);
  if (acc < 0.6) tryNext.push('Slow down a little: misses cost more than they gain. Aim, then click.');
  else if (acc >= 0.85 && (r.medianKillInterval ?? 0) > 0.9) tryNext.push('Your accuracy is high; try moving to the next target sooner.');
  if (tryNext.length === 0) tryNext.push('Run it again; one session is a small sample.');
  const headline = acc >= 0.85 ? `Clean run: ${pct(acc)} of shots hit.` : acc >= 0.6 ? `Solid run: ${pct(acc)} of shots hit.` : `Rushed run: ${pct(acc)} of shots hit.`;
  return { headline, findings, tryNext: tryNext.slice(0, 2) };
}

/** One honest sentence about progress. Never claims a trend from a single earlier run. */
export function progressLine(c: RunComparison, score: number): string {
  if (c.first) return 'First run in this mode, difficulty and length: nothing to compare with yet.';
  const parts: string[] = [];
  if (c.newBest) parts.push(`New personal best: ${score} (previous ${c.previousBest}).`);
  else if (c.delta === 0) parts.push(`Matched your personal best of ${c.previousBest}.`);
  else parts.push(`${Math.abs(c.delta ?? 0)} below your personal best of ${c.previousBest}.`);
  if (c.recentAverage !== null && c.earlierRuns >= 3) {
    const diff = score - c.recentAverage;
    parts.push(`Your last ${Math.min(5, c.earlierRuns)} runs here averaged ${Math.round(c.recentAverage)}; this one was ${diff >= 0 ? '' : '-'}${Math.abs(Math.round(diff))} ${diff >= 0 ? 'above' : 'below'} that.`);
  } else {
    parts.push(`Only ${c.earlierRuns} earlier run${c.earlierRuns === 1 ? '' : 's'}: too few to call a trend.`);
  }
  return parts.join(' ');
}
