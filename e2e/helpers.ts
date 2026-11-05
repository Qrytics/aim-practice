import type { Page } from '@playwright/test';

/**
 * SIMULATED pointer lock. Replaces requestPointerLock/exitPointerLock/
 * pointerLockElement on the page so our lifecycle handling can be exercised in
 * headless Chromium. This proves OUR logic reacts correctly to lock events and
 * promises; it does NOT prove the real browser grants or releases the lock.
 *
 * Behaviour is read at CALL time from window.__fakeLock, so a test can change it
 * between requests (page.evaluate):
 *   deny        reject/fail every request (SecurityError)
 *   unadjusted  accept {unadjustedMovement:true}; false = reject it with NotSupportedError
 *   legacy      return undefined (no promise); outcome is signalled by events only
 *   hang        never answer
 *   errorEvents also dispatch `pointerlockerror` on failures (real browsers do; default true).
 *               Legacy failures always dispatch it: it is their only signal.
 */
export interface FakeLockOptions {
  deny?: boolean;
  unadjusted?: boolean;
  legacy?: boolean;
  hang?: boolean;
  errorEvents?: boolean;
}

export async function installFakePointerLock(page: Page, opts: FakeLockOptions = {}) {
  await page.addInitScript((o) => {
    let locked: Element | null = null;
    const w = window as unknown as Record<string, any>;
    w.__lockCalls = [];
    w.__fakeLock = { deny: false, unadjusted: false, legacy: false, hang: false, errorEvents: true, ...o };
    Object.defineProperty(Document.prototype, 'pointerLockElement', { get: () => locked, configurable: true });
    const later = (name: string) => setTimeout(() => document.dispatchEvent(new Event(name)), 0);

    HTMLCanvasElement.prototype.requestPointerLock = function (this: HTMLCanvasElement, options?: unknown) {
      const b = w.__fakeLock;
      w.__lockCalls.push(options ?? null);
      const unadj = !!(options && (options as { unadjustedMovement?: boolean }).unadjustedMovement);
      const fail = (name: string) => {
        if (b.legacy || b.errorEvents) later('pointerlockerror');
        return b.legacy ? undefined : Promise.reject(new DOMException('rejected by test', name));
      };
      if (b.hang) return b.legacy ? undefined : new Promise<void>(() => {});
      if (b.deny) return fail('SecurityError');
      if (unadj && !b.unadjusted && !b.legacy) return fail('NotSupportedError');
      locked = this;
      later('pointerlockchange');
      return b.legacy ? undefined : Promise.resolve();
    } as typeof HTMLCanvasElement.prototype.requestPointerLock;

    Document.prototype.exitPointerLock = function () {
      if (locked) {
        locked = null;
        later('pointerlockchange');
      }
    };
    w.__fakeUnlock = () => {
      locked = null;
      document.dispatchEvent(new Event('pointerlockchange'));
    };
  }, opts);
}

export const setFakeLock = (page: Page, patch: FakeLockOptions) =>
  page.evaluate((p) => Object.assign((window as any).__fakeLock, p), patch);

export const debug = (page: Page) =>
  page.evaluate(() => (window as unknown as { __aimDebug: () => any }).__aimDebug());

export async function moveMouse(page: Page, dx: number, dy: number) {
  await page.evaluate(
    ([x, y]) => document.dispatchEvent(new MouseEvent('mousemove', { movementX: x, movementY: y, bubbles: true })),
    [dx, dy] as const,
  );
}
