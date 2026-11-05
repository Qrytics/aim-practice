import { describe, expect, it } from 'vitest';
import { LockCoordinator, type LockPort, type MovementMode } from '../src/input/lockCoordinator';

/** Deterministic fake: the test decides when ownership changes, when events fire and when promises settle. */
class FakePort implements LockPort {
  owned = false;
  calls: Array<{ unadjustedMovement: boolean } | undefined> = [];
  legacy = false;
  throwOn: Array<unknown | null> = []; // per call index: error to throw synchronously, or null
  private settlers: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];

  request(options?: { unadjustedMovement: boolean }): Promise<void> | void {
    const i = this.calls.length;
    this.calls.push(options);
    const t = this.throwOn[i];
    if (t) throw t;
    if (this.legacy) return undefined;
    return new Promise<void>((resolve, reject) => this.settlers.push({ resolve, reject }));
  }
  owns(): boolean {
    return this.owned;
  }
  resolveCall(i: number) {
    this.settlers[i]!.resolve();
  }
  rejectCall(i: number, name: string) {
    this.settlers[i]!.reject(Object.assign(new Error(name + ' (test)'), { name }));
  }
}

function rig(configure?: (p: FakePort) => void) {
  const port = new FakePort();
  configure?.(port);
  const log: string[] = [];
  const modes: MovementMode[] = [];
  const c = new LockCoordinator(port, {
    onAcquired: () => log.push('acquired'),
    onDenied: (m) => log.push('denied:' + m.split(':')[0]),
    onLost: () => log.push('lost'),
    onUnexpectedLock: () => log.push('unexpected'),
    onMode: (m) => modes.push(m),
  });
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  /** Browser grants the lock: ownership first, then the event. */
  const grantWithEvent = () => {
    port.owned = true;
    c.handleChange();
  };
  const loseWithEvent = () => {
    port.owned = false;
    c.handleChange();
  };
  return { port, c, log, modes, flush, grantWithEvent, loseWithEvent };
}

describe('fallback success (unadjusted rejected, default mode acquires)', () => {
  it('pointerlockerror BEFORE the rejection: not a failure; fallback issued once; ends acquired', async () => {
    const r = rig();
    expect(r.c.request()).toBe('started');
    r.c.handleError(); // intermediate error event while the promise is outstanding
    r.port.rejectCall(0, 'NotSupportedError');
    await r.flush();
    expect(r.port.calls).toEqual([{ unadjustedMovement: true }, undefined]);
    r.grantWithEvent();
    r.port.resolveCall(1);
    await r.flush();
    expect(r.log).toEqual(['acquired']); // never denied
    expect(r.c.mode).toBe('default-os-adjusted');
  });

  it('pointerlockerror AFTER the rejection (while the fallback is in flight) is also ignored', async () => {
    const r = rig();
    r.c.request();
    r.port.rejectCall(0, 'NotSupportedError');
    await r.flush();
    r.c.handleError(); // arrives after the rejection, fallback still pending
    r.grantWithEvent();
    r.port.resolveCall(1);
    await r.flush();
    expect(r.log).toEqual(['acquired']);
    expect(r.c.mode).toBe('default-os-adjusted');
  });

  it('promise resolves BEFORE the pointerlockchange event (ownership already true): acquired exactly once', async () => {
    const r = rig();
    r.c.request();
    r.port.rejectCall(0, 'NotSupportedError');
    await r.flush();
    r.port.owned = true; // ownership flips, event not delivered yet
    r.port.resolveCall(1);
    await r.flush();
    r.c.handleChange(); // late event
    expect(r.log).toEqual(['acquired']);
    expect(r.c.mode).toBe('default-os-adjusted');
  });

  it('pointerlockchange BEFORE the promise: acquired once, label set when the promise settles', async () => {
    const r = rig((p) => (p.calls = []));
    r.c.request();
    r.grantWithEvent();
    expect(r.log).toEqual(['acquired']);
    expect(r.c.mode).toBe('none'); // not labelled until the promise says what happened
    r.port.resolveCall(0);
    await r.flush();
    expect(r.log).toEqual(['acquired']);
    expect(r.c.mode).toBe('unadjusted');
  });

  it('synchronous NotSupportedError throw also falls back once', async () => {
    const r = rig((p) => (p.throwOn = [Object.assign(new Error('x'), { name: 'NotSupportedError' })]));
    r.c.request();
    await r.flush();
    expect(r.port.calls).toEqual([{ unadjustedMovement: true }, undefined]);
    r.grantWithEvent();
    r.port.resolveCall(0); // the fallback is the first call that returned a promise
    await r.flush();
    expect(r.log).toEqual(['acquired']);
    expect(r.c.mode).toBe('default-os-adjusted');
  });
});

describe('failures are terminal and never retried', () => {
  it('fallback rejection: denied exactly once, mode none, exactly two browser calls, no third', async () => {
    const r = rig();
    r.c.request();
    r.port.rejectCall(0, 'NotSupportedError');
    await r.flush();
    r.port.rejectCall(1, 'SecurityError');
    await r.flush();
    r.c.handleError(); // a trailing error event must not produce a second denial
    await r.flush();
    expect(r.log).toEqual(['denied:SecurityError']);
    expect(r.c.mode).toBe('none');
    expect(r.port.calls).toHaveLength(2);
    expect(r.c.inFlight).toBe(false);
  });

  it('a non-NotSupportedError rejection of the unadjusted request does not fall back', async () => {
    const r = rig();
    r.c.request();
    r.port.rejectCall(0, 'SecurityError');
    await r.flush();
    expect(r.log).toEqual(['denied:SecurityError']);
    expect(r.port.calls).toHaveLength(1);
  });

  it('explicit user retry after a denial starts a fresh attempt', async () => {
    const r = rig();
    r.c.request();
    r.port.rejectCall(0, 'SecurityError');
    await r.flush();
    expect(r.c.request()).toBe('started');
    expect(r.port.calls).toHaveLength(2);
    r.grantWithEvent();
    r.port.resolveCall(1);
    await r.flush();
    expect(r.log).toEqual(['denied:SecurityError', 'acquired']);
    expect(r.c.mode).toBe('unadjusted');
  });
});

describe('mode label lifecycle', () => {
  it('a failed NEW request does not keep the previous success label', async () => {
    const r = rig();
    r.c.request();
    r.grantWithEvent();
    r.port.resolveCall(0);
    await r.flush();
    expect(r.c.mode).toBe('unadjusted');
    r.loseWithEvent();
    expect(r.c.mode).toBe('unadjusted'); // plain loss keeps describing the lock that just ended
    r.c.request();
    expect(r.c.mode).toBe('none'); // cleared as soon as a new attempt starts
    r.port.rejectCall(1, 'SecurityError');
    await r.flush();
    expect(r.c.mode).toBe('none');
    expect(r.modes).toEqual(['unadjusted', 'none']);
  });
});

describe('lock loss versus late completion', () => {
  it('a promise resolving after the lock was lost cannot re-acquire or set a label', async () => {
    const r = rig();
    r.c.request();
    r.grantWithEvent(); // acquired via event
    r.loseWithEvent(); // lost before the promise settled
    expect(r.log).toEqual(['acquired', 'lost']);
    r.port.resolveCall(0); // late
    await r.flush();
    expect(r.log).toEqual(['acquired', 'lost']);
    expect(r.c.mode).toBe('none'); // owns() is false: no label for a lock we do not hold
  });

  it('a late resolution of an OLD attempt cannot affect a newer attempt', async () => {
    const r = rig();
    r.c.request(); // attempt 1
    r.grantWithEvent();
    r.loseWithEvent();
    r.c.request(); // attempt 2 (user retry)
    r.port.resolveCall(0); // stale promise from attempt 1
    await r.flush();
    expect(r.c.mode).toBe('none');
    expect(r.c.inFlight).toBe(true);
    r.grantWithEvent();
    r.port.resolveCall(1);
    await r.flush();
    expect(r.log).toEqual(['acquired', 'lost', 'acquired']);
    expect(r.c.mode).toBe('unadjusted');
  });

  it('resolve while NOT owning (released before we saw it) is a denial, not a success', async () => {
    const r = rig();
    r.c.request();
    r.port.resolveCall(0); // owns() is false
    await r.flush();
    expect(r.log).toEqual(['denied:The pointer lock was released before the session could start.']);
    expect(r.c.mode).toBe('none');
  });

  it('a rejection that contradicts actual ownership defers to ownership, labelled unconfirmed', async () => {
    const r = rig();
    r.c.request();
    r.port.owned = true;
    r.port.rejectCall(0, 'SecurityError');
    await r.flush();
    expect(r.log).toEqual(['acquired']);
    expect(r.c.mode).toBe('unconfirmed');
  });
});

describe('overlapping user requests', () => {
  it('a second request while one is pending is ignored: one browser call, one outcome', async () => {
    const r = rig();
    expect(r.c.request()).toBe('started');
    expect(r.c.request()).toBe('ignored');
    expect(r.c.request()).toBe('ignored');
    expect(r.port.calls).toHaveLength(1);
    r.grantWithEvent();
    r.port.resolveCall(0);
    await r.flush();
    expect(r.log).toEqual(['acquired']);
  });

  it('request while already owning is ignored', () => {
    const r = rig();
    r.port.owned = true;
    expect(r.c.request()).toBe('ignored');
    expect(r.port.calls).toHaveLength(0);
  });

  it('cancel then request while the browser has not answered adopts the same attempt', async () => {
    const r = rig();
    r.c.request();
    r.c.cancel();
    expect(r.c.request()).toBe('reused');
    expect(r.port.calls).toHaveLength(1);
    r.grantWithEvent();
    r.port.resolveCall(0);
    await r.flush();
    expect(r.log).toEqual(['acquired']);
  });

  it('a lock that arrives for a cancelled attempt is unexpected, and its loss is not reported as a session loss', async () => {
    const r = rig();
    r.c.request();
    r.c.cancel();
    r.grantWithEvent();
    expect(r.log).toEqual(['unexpected']);
    r.port.resolveCall(0);
    await r.flush();
    expect(r.c.mode).toBe('none'); // cancelled: no label claimed
    r.loseWithEvent();
    expect(r.log).toEqual(['unexpected']); // no 'lost'
  });

  it('a failure of a cancelled attempt is not reported as a denial', async () => {
    const r = rig();
    r.c.request();
    r.c.cancel();
    r.port.rejectCall(0, 'SecurityError');
    await r.flush();
    expect(r.log).toEqual([]);
    expect(r.c.inFlight).toBe(false);
  });
});

describe('legacy void-returning API', () => {
  it('success is labelled unconfirmed, never unadjusted', async () => {
    const r = rig((p) => (p.legacy = true));
    r.c.request();
    expect(r.port.calls).toEqual([{ unadjustedMovement: true }]);
    r.grantWithEvent();
    await r.flush();
    expect(r.log).toEqual(['acquired']);
    expect(r.c.mode).toBe('unconfirmed');
    expect(r.modes).not.toContain('unadjusted');
  });

  it('failure comes from pointerlockerror, once; no fallback, mode none', async () => {
    const r = rig((p) => (p.legacy = true));
    r.c.request();
    r.c.handleError();
    r.c.handleError();
    expect(r.log).toEqual(['denied:The browser refused pointer lock.']);
    expect(r.c.mode).toBe('none');
    expect(r.port.calls).toHaveLength(1);
  });
});

describe('events alone never grant or deny a promise-API attempt', () => {
  it('pointerlockerror while a promise is outstanding changes nothing', async () => {
    const r = rig();
    r.c.request();
    r.c.handleError();
    r.c.handleError();
    expect(r.log).toEqual([]);
    expect(r.c.inFlight).toBe(true);
  });

  it('pointerlockchange without ownership changes nothing', async () => {
    const r = rig();
    r.c.request();
    r.c.handleChange();
    expect(r.log).toEqual([]);
  });
});
