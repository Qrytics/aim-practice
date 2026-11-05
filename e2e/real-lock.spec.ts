import { expect, test } from '@playwright/test';
import { debug } from './helpers';

/**
 * REAL pointer lock. Nothing is stubbed. This spec:
 *  - FAILS unless document.pointerLockElement === the #arena canvas after Start
 *    (a pass can never mean "the lock was refused and we shrugged");
 *  - records the browser build and the lock mode the app reported.
 * It proves the real request path works in this automated Chromium. It does
 * NOT prove it for a person with a physical mouse and OS: that is the manual
 * checklist. If the lock cannot be acquired in your environment the test fails
 * loudly and the annotation says why.
 */
test('real pointer lock is acquired on the canvas and the app enters countdown', async ({ page, browser }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start' }).click();
  await page.waitForTimeout(1200);
  const probe = await page.evaluate(() => ({
    lockIsCanvas: document.pointerLockElement === document.getElementById('arena'),
    notice: (window as any).__aimDebug().snapshot.lockNotice as string | null,
  }));
  const d = await debug(page);
  test.info().annotations.push({
    type: 'real-pointer-lock',
    description: `lockIsCanvas=${probe.lockIsCanvas} state=${d.state} movementMode=${d.movementMode} browser=${browser.version()} notice=${probe.notice ?? 'none'}`,
  });
  expect(probe.lockIsCanvas, `lock not acquired; notice: ${probe.notice}`).toBe(true);
  expect(['countdown', 'running']).toContain(d.state);
  expect(['unadjusted', 'default-os-adjusted', 'unconfirmed']).toContain(d.movementMode);

  // Real exit path: releasing the lock must pause with reason lock-lost.
  await page.evaluate(() => document.exitPointerLock());
  await expect.poll(async () => (await debug(page)).state).toBe('paused');
  expect((await debug(page)).snapshot.pauseReason).toBe('lock-lost');
});
