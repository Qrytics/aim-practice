import { describe, expect, it } from 'vitest';
import { SessionMachine } from '../src/core/session';

const cfg = { countdownSeconds: 3, runSeconds: 10 };
const make = () => new SessionMachine(cfg);

function toRunning(m: SessionMachine) {
  expect(m.requestLock()).toBe(true);
  expect(m.lockAcquired()).toBe(true);
  m.tick(3);
  expect(m.state).toBe('running');
}

describe('starting', () => {
  it('begins in ready and only reaches countdown through a granted lock', () => {
    const m = make();
    expect(m.state).toBe('ready');
    m.tick(5); // time does nothing outside active states
    expect(m.snapshot.countdownRemaining).toBe(3);
    expect(m.lockAcquired()).toBe(false); // no request outstanding: refuse
    expect(m.state).toBe('ready');
    m.requestLock();
    expect(m.state).toBe('requestingLock');
    m.tick(5); // still no time while waiting for the lock
    expect(m.snapshot.countdownRemaining).toBe(3);
    expect(m.lockAcquired()).toBe(true);
    expect(m.state).toBe('countdown');
  });

  it('never enters countdown or running by any path other than lockAcquired', () => {
    const m = make();
    m.pause('user');
    m.lockLost();
    m.rendererRestored();
    expect(m.state).toBe('ready');
  });

  it('countdown flows into running; overshoot inside the final countdown tick is discarded, not credited', () => {
    const m = make();
    m.requestLock();
    m.lockAcquired();
    m.tick(2.5);
    expect(m.state).toBe('countdown');
    expect(m.snapshot.countdownRemaining).toBeCloseTo(0.5, 12);
    m.tick(1.5); // 0.5 finishes the countdown; the other 1.0 s is overshoot of a countdown tick
    expect(m.state).toBe('running');
    expect(m.snapshot.runElapsed).toBe(0);
    expect(m.snapshot.countdownRemaining).toBe(0);
  });

  it('summing many 1/120 s ticks neither adds nor drops a step at the boundaries', () => {
    const m = new SessionMachine({ countdownSeconds: 3, runSeconds: 60 });
    m.requestLock();
    m.lockAcquired();
    let n = 0;
    while (m.state === 'countdown') {
      m.tick(1 / 120);
      n++;
    }
    expect(n).toBe(360);
    let r = 0;
    while (m.state === 'running') {
      m.tick(1 / 120);
      r++;
    }
    expect(r).toBe(7200);
    expect(m.state).toBe('completed');
  });

  it('run completes at exactly runDuration and discards overshoot', () => {
    const m = make();
    toRunning(m);
    m.tick(9.9);
    expect(m.state).toBe('running');
    m.tick(5);
    expect(m.state).toBe('completed');
    expect(m.snapshot.runElapsed).toBe(10);
  });
});

describe('lock denial and loss', () => {
  it('denial from ready returns to ready with a notice and does not re-request', () => {
    const m = make();
    m.requestLock();
    m.lockDenied('Browser refused pointer lock.');
    expect(m.state).toBe('ready');
    expect(m.snapshot.lockNotice).toMatch(/refused/);
    // Nothing happens until the user explicitly asks again.
    m.tick(1);
    expect(m.state).toBe('ready');
    expect(m.requestLock()).toBe(true); // explicit retry works
  });

  it('denial while resuming returns to paused, preserving progress', () => {
    const m = make();
    toRunning(m);
    m.tick(4);
    m.lockLost();
    expect(m.state).toBe('paused');
    m.requestLock();
    m.lockDenied('nope');
    expect(m.state).toBe('paused');
    expect(m.snapshot.runElapsed).toBeCloseTo(4, 12);
    expect(m.requestLock()).toBe(true);
    expect(m.lockAcquired()).toBe(true);
    expect(m.state).toBe('running');
  });

  it('lock loss in countdown pauses and resumes into countdown', () => {
    const m = make();
    m.requestLock();
    m.lockAcquired();
    m.tick(1);
    m.lockLost();
    expect(m.snapshot.pauseReason).toBe('lock-lost');
    m.tick(10); // paused: no time passes
    expect(m.snapshot.countdownRemaining).toBeCloseTo(2, 12);
    m.requestLock();
    m.lockAcquired();
    expect(m.state).toBe('countdown');
  });

  it('lock lost while still requesting counts as a denial', () => {
    const m = make();
    m.requestLock();
    m.lockLost();
    expect(m.state).toBe('ready');
    expect(m.snapshot.lockNotice).not.toBeNull();
  });
});

describe('pausing never consumes drill time', () => {
  it.each(['user', 'focus-lost', 'hidden'] as const)('pause(%s) freezes the clocks', (reason) => {
    const m = make();
    toRunning(m);
    m.tick(2);
    m.pause(reason);
    m.tick(100);
    expect(m.snapshot.runElapsed).toBeCloseTo(2, 12);
    expect(m.snapshot.pauseReason).toBe(reason);
  });

  it('stalls are recorded, reported and pause the session', () => {
    const m = make();
    toRunning(m);
    m.tick(1);
    m.reportStall(4.2);
    expect(m.state).toBe('paused');
    expect(m.snapshot.pauseReason).toBe('stall');
    expect(m.snapshot.stalledSeconds).toBeCloseTo(4.2, 12);
    expect(m.snapshot.stallCount).toBe(1);
    expect(m.snapshot.runElapsed).toBeCloseTo(1, 12);
  });

  it('ignores nonsense stall values', () => {
    const m = make();
    toRunning(m);
    m.reportStall(NaN);
    m.reportStall(-1);
    m.reportStall(0);
    expect(m.state).toBe('running');
    expect(m.snapshot.stallCount).toBe(0);
  });

  it('pause outside active play is a no-op', () => {
    const m = make();
    m.pause('user');
    expect(m.state).toBe('ready');
  });
});

describe('renderer loss', () => {
  it('pauses, blocks resume, then allows it once restored', () => {
    const m = make();
    toRunning(m);
    m.tick(2);
    m.rendererLost();
    expect(m.state).toBe('paused');
    expect(m.snapshot.pauseReason).toBe('renderer-lost');
    expect(m.requestLock()).toBe(false);
    m.rendererRestored();
    expect(m.requestLock()).toBe(true);
    m.lockAcquired();
    expect(m.state).toBe('running');
    expect(m.snapshot.runElapsed).toBeCloseTo(2, 12);
  });

  it('blocks starting from ready while the renderer is lost', () => {
    const m = make();
    m.rendererLost();
    expect(m.requestLock()).toBe(false);
  });
});

describe('restart, completion, error', () => {
  it('restart resets timers from running, paused and completed', () => {
    const m = make();
    toRunning(m);
    m.tick(5);
    m.pause('user');
    expect(m.restart()).toBe(true);
    expect(m.state).toBe('ready');
    expect(m.snapshot.runElapsed).toBe(0);
    expect(m.snapshot.countdownRemaining).toBe(3);

    toRunning(m);
    m.tick(20);
    expect(m.state).toBe('completed');
    expect(m.restart()).toBe(true);
    expect(m.state).toBe('ready');
  });

  it('restart keeps the renderer-lost flag', () => {
    const m = make();
    m.rendererLost();
    m.restart();
    expect(m.snapshot.rendererLost).toBe(true);
    expect(m.requestLock()).toBe(false);
  });

  it('error is terminal: nothing leaves it', () => {
    const m = make();
    m.fail('webgl', 'no context');
    expect(m.state).toBe('error');
    expect(m.requestLock()).toBe(false);
    expect(m.restart()).toBe(false);
    m.tick(10);
    m.lockLost();
    expect(m.state).toBe('error');
    expect(m.snapshot.error?.code).toBe('webgl');
  });

  it('completed ignores lock loss and ticks', () => {
    const m = make();
    toRunning(m);
    m.tick(11);
    m.lockLost();
    expect(m.state).toBe('completed');
  });

  it('ignores invalid tick values', () => {
    const m = make();
    toRunning(m);
    m.tick(NaN);
    m.tick(-1);
    m.tick(0);
    m.tick(Infinity);
    expect(m.snapshot.runElapsed).toBe(0);
  });
});
