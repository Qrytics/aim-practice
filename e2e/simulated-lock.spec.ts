import { expect, test } from '@playwright/test';
import { debug, installFakePointerLock, moveMouse } from './helpers';

// Everything in this file uses a SIMULATED pointer lock (see helpers.ts).

test.describe('simulated pointer lock: session flow', () => {
  test('start -> countdown -> running; look and movement respond', async ({ page }) => {
    await installFakePointerLock(page, { unadjusted: true });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.locator('#overlay')).toBeVisible();
    expect((await debug(page)).state).toBe('ready');

    await page.getByRole('button', { name: 'Start' }).click();
    await expect.poll(async () => (await debug(page)).state).toBe('countdown');
    await expect(page.locator('#overlay')).toBeHidden();
    await expect.poll(async () => (await debug(page)).state, { timeout: 8000 }).toBe('running');

    const before = (await debug(page)).player;
    await moveMouse(page, 200, -60);
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(500);
    const mid = await debug(page);
    expect(mid.held).toBe(1);
    expect(mid.player.vz).toBeLessThan(0); // accelerating forward
    expect(mid.player.yaw).not.toBe(before.yaw);
    expect(mid.player.z).toBeLessThan(before.z); // forward at yaw~0 is -z (small yaw)
    await page.keyboard.up('KeyW');
    expect(errors).toEqual([]);
  });

  test('gameplay never starts before the lock is granted', async ({ page }) => {
    await page.addInitScript(() => {
      // A lock request that never answers.
      HTMLCanvasElement.prototype.requestPointerLock = function () {
        return new Promise<void>(() => {});
      } as typeof HTMLCanvasElement.prototype.requestPointerLock;
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Start' }).click();
    await page.waitForTimeout(1500);
    const d = await debug(page);
    expect(d.state).toBe('requestingLock');
    expect(d.snapshot.countdownRemaining).toBe(3);
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect((await debug(page)).state).toBe('ready');
  });

  test('denied lock: actionable notice, explicit retry only, no automatic re-request', async ({ page }) => {
    await installFakePointerLock(page, { deny: true });
    await page.goto('/');
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.locator('#ov-notice')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    const calls1 = await page.evaluate(() => (window as any).__lockCalls.length);
    await page.waitForTimeout(1500);
    const calls2 = await page.evaluate(() => (window as any).__lockCalls.length);
    expect(calls2).toBe(calls1); // nothing retried by itself
    expect((await debug(page)).state).toBe('ready');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__lockCalls.length)).toBeGreaterThan(calls2);
  });

  test('lock loss pauses with progress intact; resume re-locks', async ({ page }) => {
    await installFakePointerLock(page, { unadjusted: true });
    await page.goto('/');
    await page.getByRole('button', { name: 'Start' }).click();
    await expect.poll(async () => (await debug(page)).state, { timeout: 8000 }).toBe('running');
    await page.waitForTimeout(600);
    await page.keyboard.down('KeyD');
    await page.evaluate(() => (window as any).__fakeUnlock());
    await expect.poll(async () => (await debug(page)).state).toBe('paused');
    let d = await debug(page);
    expect(d.snapshot.pauseReason).toBe('lock-lost');
    expect(d.held).toBe(0); // held key reset on lock loss
    const elapsed = d.snapshot.runElapsed;
    await page.waitForTimeout(700);
    d = await debug(page);
    expect(d.snapshot.runElapsed).toBe(elapsed); // paused time is not drill time
    await page.keyboard.up('KeyD');

    await page.getByRole('button', { name: 'Resume' }).click();
    await expect.poll(async () => (await debug(page)).state).toBe('running');
  });

  test('window blur releases held keys and pauses', async ({ page }) => {
    await installFakePointerLock(page, { unadjusted: true });
    await page.goto('/');
    await page.getByRole('button', { name: 'Start' }).click();
    await expect.poll(async () => (await debug(page)).state, { timeout: 8000 }).toBe('running');
    await page.keyboard.down('KeyW');
    // Held state is applied on the next simulation step, so poll rather than read at once.
    await expect.poll(async () => (await debug(page)).held).toBe(1);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect.poll(async () => (await debug(page)).state).toBe('paused');
    const d = await debug(page);
    expect(d.held).toBe(0);
    expect(d.snapshot.pauseReason).toBe('focus-lost');
  });

  test('P pauses, R restarts, but R does not restart while editing a field', async ({ page }) => {
    await installFakePointerLock(page, { unadjusted: true });
    await page.goto('/');
    await page.getByRole('button', { name: 'Start' }).click();
    await expect.poll(async () => (await debug(page)).state, { timeout: 8000 }).toBe('running');
    await page.keyboard.press('KeyP');
    await expect.poll(async () => (await debug(page)).state).toBe('paused');
    expect((await debug(page)).snapshot.pauseReason).toBe('user');

    // Editing a settings field: typing "r" must not restart.
    await page.locator('#f-dpi').focus();
    await page.keyboard.press('KeyR');
    expect((await debug(page)).state).toBe('paused');

    // Focus elsewhere: R restarts.
    await page.locator('#f-dpi').blur();
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('KeyR');
    await expect.poll(async () => (await debug(page)).state).toBe('ready');
  });

  test('movement mode is reported honestly: unsupported unadjusted movement is disclosed', async ({ page }) => {
    await installFakePointerLock(page, { unadjusted: false });
    await page.goto('/');
    await page.getByRole('button', { name: 'Start' }).click();
    await expect.poll(async () => (await debug(page)).state).toBe('countdown');
    await expect(page.locator('#sens-mode-report')).toContainText('REJECTED');
    expect((await debug(page)).movementMode).toBe('default-os-adjusted');
  });

  test('WebGL context loss pauses, blocks resume until restored, and offers reload', async ({ page }) => {
    await installFakePointerLock(page, { unadjusted: true });
    await page.goto('/');
    await page.getByRole('button', { name: 'Start' }).click();
    await expect.poll(async () => (await debug(page)).state, { timeout: 8000 }).toBe('running');
    await page.evaluate(() => {
      const gl = (document.getElementById('arena') as HTMLCanvasElement).getContext('webgl2')!;
      (window as any).__loseExt = gl.getExtension('WEBGL_lose_context');
      (window as any).__loseExt.loseContext();
    });
    await expect.poll(async () => (await debug(page)).state).toBe('paused');
    const d = await debug(page);
    expect(d.snapshot.pauseReason).toBe('renderer-lost');
    await expect(page.getByRole('button', { name: 'Resume' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Reload page' })).toBeVisible();

    await page.evaluate(() => (window as any).__loseExt.restoreContext());
    await expect.poll(async () => (await debug(page)).contextLost).toBe(false);
    await expect(page.getByRole('button', { name: 'Resume' })).toBeEnabled();
  });
});
