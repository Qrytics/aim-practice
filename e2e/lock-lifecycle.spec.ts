import { expect, test } from '@playwright/test';
import { debug, installFakePointerLock, setFakeLock } from './helpers';

// All tests here use the SIMULATED pointer lock from helpers.ts, including its
// promise/event combinations. The ordering of events versus promises is covered
// deterministically in tests/lockCoordinator.test.ts; these confirm the integration.

test.describe('pointer-lock request lifecycle (simulated lock)', () => {
  test('unadjusted rejected + pointerlockerror event, then default-mode fallback acquires: countdown, no failure', async ({ page }) => {
    await installFakePointerLock(page, { unadjusted: false, errorEvents: true });
    await page.goto('/');
    await page.getByRole('button', { name: 'Start' }).click();
    await expect.poll(async () => (await debug(page)).state).toBe('countdown');
    await page.waitForTimeout(400); // let any stray late events arrive
    const d = await debug(page);
    expect(d.state).toBe('countdown');
    expect(d.snapshot.lockNotice).toBeNull();
    expect(d.movementMode).toBe('default-os-adjusted');
    expect(await page.evaluate(() => (window as any).__lockCalls)).toEqual([{ unadjustedMovement: true }, null]);
    await expect(page.locator('#sens-mode-report')).toContainText('REJECTED');
  });

  test('a failed new request does not keep the previous successful mode label', async ({ page }) => {
    await installFakePointerLock(page, { unadjusted: true });
    await page.goto('/');
    await page.getByRole('button', { name: 'Start' }).click();
    await expect.poll(async () => (await debug(page)).state).toBe('countdown');
    await expect.poll(async () => (await debug(page)).movementMode).toBe('unadjusted');

    await page.evaluate(() => (window as any).__fakeUnlock());
    await expect.poll(async () => (await debug(page)).state).toBe('paused');
    // Plain lock loss keeps the label of the most recent lock (so it can be read in settings).
    expect((await debug(page)).movementMode).toBe('unadjusted');

    await setFakeLock(page, { deny: true });
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.locator('#ov-notice')).toBeVisible();
    const d = await debug(page);
    expect(d.state).toBe('paused');
    expect(d.movementMode).toBe('none'); // not the stale 'unadjusted'
    await expect(page.locator('#sens-mode-report')).not.toContainText('ACCEPTED');
  });

  test('legacy void-returning API: never claims unadjusted; label only after a real lock', async ({ page }) => {
    await installFakePointerLock(page, { legacy: true });
    await page.goto('/');
    await page.getByRole('button', { name: 'Start' }).click();
    await expect.poll(async () => (await debug(page)).state).toBe('countdown');
    await expect.poll(async () => (await debug(page)).movementMode).toBe('unconfirmed');
    await expect(page.locator('#sens-mode-report')).not.toContainText('ACCEPTED');
  });

  test('legacy API failure: error shown once, label stays none', async ({ page }) => {
    await installFakePointerLock(page, { legacy: true, deny: true });
    await page.goto('/');
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.locator('#ov-notice')).toBeVisible();
    const d = await debug(page);
    expect(d.state).toBe('ready');
    expect(d.movementMode).toBe('none');
  });

  test('pressing Enter twice on Start does not cancel the pending request', async ({ page }) => {
    await installFakePointerLock(page, { hang: true });
    await page.goto('/');
    await page.getByRole('button', { name: 'Start' }).focus();
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await debug(page)).state).toBe('requestingLock');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    const d = await debug(page);
    expect(d.state).toBe('requestingLock'); // not cancelled by a repeated key
    expect(await page.evaluate(() => (window as any).__lockCalls.length)).toBe(1); // one browser request
    // Cancel is still reachable by keyboard.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await debug(page)).state).toBe('ready');
  });

  test('cancel then retry while the first request is still pending reuses one browser request', async ({ page }) => {
    await installFakePointerLock(page, { hang: true });
    await page.goto('/');
    await page.getByRole('button', { name: 'Start' }).click();
    await expect.poll(async () => (await debug(page)).state).toBe('requestingLock');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect.poll(async () => (await debug(page)).state).toBe('ready');
    await page.getByRole('button', { name: /Start|Try again/ }).click();
    await expect.poll(async () => (await debug(page)).state).toBe('requestingLock');
    expect(await page.evaluate(() => (window as any).__lockCalls.length)).toBe(1);
  });
});
