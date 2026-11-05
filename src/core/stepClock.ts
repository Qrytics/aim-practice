/**
 * The fixed-step loop asks a StepClock two things, once per 1/120 s step:
 *
 *   phase()    - what the step that is ABOUT to be simulated is allowed to do.
 *                Decided from the state at the START of the step.
 *   advance(dt) - called AFTER the step, to advance countdown/session time by
 *                exactly that step.
 *
 * Because both happen inside the step loop, a frame that contains the
 * countdown -> running transition applies countdown rules to the steps before
 * the transition and running rules to the steps after it, never one phase to
 * the whole frame.
 *
 * Boundary policy (see SessionMachine): the step that ends the countdown is a
 * countdown step in full and its overshoot is discarded, so Running time is a
 * whole number of Running steps and no interval is both "prohibited" and
 * "counted".
 */

import type { SessionMachine } from './session';

export type StepPhase = 'inactive' | 'countdown' | 'running';

export interface StepClock {
  phase(): StepPhase;
  advance(dt: number): void;
}

/** Test/simple use: always Running, nothing to advance. */
export const ALWAYS_RUNNING: StepClock = {
  phase: () => 'running',
  advance: () => {},
};

/** Adapts the session state machine: only countdown/running are active. */
export function sessionStepClock(session: SessionMachine): StepClock {
  return {
    phase: () => {
      const s = session.state;
      return s === 'countdown' || s === 'running' ? s : 'inactive';
    },
    advance: (dt) => session.tick(dt),
  };
}
