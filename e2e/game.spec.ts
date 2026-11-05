import { expect, test, type Page } from '@playwright/test';
import { debug, installFakePointerLock } from './helpers';

// SIMULATED pointer lock throughout (helpers.ts). Sessions are shortened with the dev-only ?run=&countdown=
// override. Aiming uses a dev-only helper that points the camera at the target; mouse buttons are real
// Playwright mouse events. These tests exercise the game logic and UI, not real mouse feel.

const FAST = '/?run=6&countdown=0.4';

async function start(page: Page, url = FAST) {
  await installFakePointerLock(page, { unadjusted: true });
  await page.goto(url);
  await page.getByRole('button', { name: 'Start' }).click();
  await expect.poll(async () => (await debug(page)).state, { timeout: 8000 }).toBe('running');
}

async function hitOne(page: Page) {
  await expect.poll(async () => (await debug(page)).drillTargets.length, { timeout: 4000 }).toBe(1);
  await page.evaluate(() => (window as any).__aimDebug().aimAtTarget());
  await page.waitForTimeout(60);
  await page.mouse.down();
  await page.mouse.up();
}

test.describe('profile selection', () => {
  test('both profiles are offered with "inspired" labels and an honest disclaimer; keyboard operable', async ({ page }) => {
    await installFakePointerLock(page);
    await page.goto('/');
    const overlay = page.locator('#overlay');
    await expect(overlay).toContainText('Valorant-inspired');
    await expect(overlay).toContainText('Overwatch-inspired');
    await expect(overlay).toContainText('do not replicate any game');
    await expect(overlay).toContainText('not a hero or weapon profile');
    // Focus starts on the checked radio; arrow keys switch profile; the page follows.
    await expect(page.locator('input[name="profile"]:checked')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('input[name="profile"][value="tracking"]')).toBeChecked();
    await expect(page.locator('body')).toHaveAttribute('data-profile', 'tracking');
    await expect(page.locator('#page-title')).toHaveText('Tracking drill');
    // Tab leaves the radio group, then reaches Start after the difficulty and length selects.
    const reached: string[] = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      reached.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.textContent?.trim() || ''));
      if (reached[reached.length - 1] === 'Start') break;
    }
    expect(reached).toContain('f-difficulty');
    expect(reached).toContain('f-length');
    await expect(page.getByRole('button', { name: 'Start' })).toBeFocused();
  });

  test('the two profiles are visibly different (page and arena treatment)', async ({ page }) => {
    await installFakePointerLock(page);
    await page.goto('/');
    const a = await page.locator('canvas#arena').screenshot();
    await page.locator('input[name="profile"][value="tracking"]').check();
    await page.waitForTimeout(300);
    const b = await page.locator('canvas#arena').screenshot();
    expect(Buffer.compare(a, b)).not.toBe(0);
    await expect(page.locator('#r-primary-label')).toHaveText('On target (last 1 s)');
  });

  test('the chosen profile is remembered across reload', async ({ page }) => {
    await installFakePointerLock(page);
    await page.goto('/');
    await page.locator('input[name="profile"][value="tracking"]').check();
    await page.reload();
    await expect(page.locator('input[name="profile"][value="tracking"]')).toBeChecked();
    await expect(page.locator('body')).toHaveAttribute('data-profile', 'tracking');
  });
});

test.describe('precision drill, end to end', () => {
  test('targets appear one at a time; hits count; completion shows real results', async ({ page }) => {
    await start(page);
    for (let i = 0; i < 3; i++) {
      await expect.poll(async () => (await debug(page)).drillTargets.length).toBeLessThanOrEqual(1);
      await hitOne(page);
      await page.waitForTimeout(450);
    }
    const mid = await debug(page);
    expect(mid.drillResult.hits).toBeGreaterThanOrEqual(2);
    expect(mid.drillResult.shots).toBeGreaterThanOrEqual(2);
    await expect(page.locator('#r-primary')).toHaveText(String(mid.drillResult.hits));

    await expect.poll(async () => (await debug(page)).state, { timeout: 12000 }).toBe('completed');
    const results = page.locator('#ov-results');
    await expect(results).toHaveAttribute('tabindex', '0'); // scrollable region must be keyboard-focusable
    await expect(results).toContainText('Accuracy');
    await expect(results).toContainText('Median time to hit');
    await expect(results.locator('svg.ruler')).toBeVisible();
    await expect(results.locator('svg.ruler')).toHaveAttribute('role', 'img');
    await expect(results.locator('svg.ruler')).toHaveAttribute('aria-label', /Time to hit/);
    await expect(results).toContainText('Run seed');
    await expect(results).toContainText('small sample');
    // Shot-by-shot table is keyboard reachable and carries the same data as the graphic.
    const summary = results.locator('summary', { hasText: 'Shot by shot' });
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(results.locator('table tbody tr').first()).toBeVisible();
    // Run again returns to the picker with a fresh state.
    await page.getByRole('button', { name: 'Run again' }).click();
    await expect.poll(async () => (await debug(page)).state).toBe('ready');
    await expect(page.locator('#r-primary')).toHaveText('0');
    expect((await debug(page)).drillResult).toBeNull();
  });

  test('a miss is recorded, the target stays, and accuracy reflects it', async ({ page }) => {
    await start(page, '/?run=20&countdown=0.4');
    await expect.poll(async () => (await debug(page)).drillTargets.length).toBe(1);
    await page.evaluate(() => {
      const d = (window as any).__aimDebug();
      d.aimAtTarget();
    });
    await moveAway(page);
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(async () => (await debug(page)).drillResult.misses).toBe(1);
    expect((await debug(page)).drillTargets).toHaveLength(1);
  });

  test('pausing keeps score and drill; restart discards them', async ({ page }) => {
    await start(page, '/?run=30&countdown=0.4');
    await hitOne(page);
    await expect.poll(async () => (await debug(page)).drillResult.hits).toBe(1);
    await page.keyboard.press('KeyP');
    await expect.poll(async () => (await debug(page)).state).toBe('paused');
    const paused = await debug(page);
    await page.waitForTimeout(600);
    const later = await debug(page);
    expect(later.drillResult.activeSeconds).toBe(paused.drillResult.activeSeconds); // no drill time while paused
    expect(later.drillResult.hits).toBe(1);
    await page.getByRole('button', { name: 'Restart' }).click();
    await expect.poll(async () => (await debug(page)).state).toBe('ready');
    expect((await debug(page)).drillResult).toBeNull();
  });

  test('no drill time, targets or shots during the countdown', async ({ page }) => {
    await installFakePointerLock(page);
    await page.goto('/?run=10&countdown=2');
    await page.getByRole('button', { name: 'Start' }).click();
    await expect.poll(async () => (await debug(page)).state).toBe('countdown');
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(700);
    const d = await debug(page);
    expect(d.state).toBe('countdown');
    expect(d.drillResult.activeSeconds).toBe(0);
    expect(d.drillResult.shots).toBe(0);
    expect(d.drillTargets).toHaveLength(0);
  });
});

async function moveAway(page: Page) {
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove', { movementX: 4000, movementY: 0, bubbles: true })));
  await page.waitForTimeout(80);
}

test.describe('tracking drill, end to end', () => {
  test('holding fire on target accumulates firing time; completion shows the three metrics and a timeline', async ({ page }) => {
    await installFakePointerLock(page, { unadjusted: true });
    await page.goto('/?run=6&countdown=0.4');
    await page.locator('input[name="profile"][value="tracking"]').check();
    await page.getByRole('button', { name: 'Start' }).click();
    await expect.poll(async () => (await debug(page)).state, { timeout: 8000 }).toBe('running');
    await page.mouse.down();
    await expect.poll(async () => (await debug(page)).triggerHeld).toBe(true);
    for (let i = 0; i < 40; i++) {
      await page.evaluate(() => (window as any).__aimDebug().aimAtTarget());
      await page.waitForTimeout(100);
      if ((await debug(page)).state === 'completed') break;
    }
    await page.mouse.up();
    await expect.poll(async () => (await debug(page)).state, { timeout: 12000 }).toBe('completed');
    const results = page.locator('#ov-results');
    await expect(results).toContainText('On target / firing');
    await expect(results).toContainText('On target / whole run');
    await expect(results).toContainText('Time firing');
    await expect(results.locator('svg.ruler')).toHaveAttribute('aria-label', /Timeline of the/);
    await expect(results).toContainText('not a hero or weapon profile');
    const d = await debug(page);
    expect(d.drillResult.firingSeconds).toBeGreaterThan(1);
    expect(d.drillResult.onTargetFiringSeconds).toBeGreaterThan(0);
  });

  test('never firing is reported honestly, not as 0% accuracy', async ({ page }) => {
    await installFakePointerLock(page, { unadjusted: true });
    await page.goto('/?run=3&countdown=0.4');
    await page.locator('input[name="profile"][value="tracking"]').check();
    await page.getByRole('button', { name: 'Start' }).click();
    await expect.poll(async () => (await debug(page)).state, { timeout: 12000 }).toBe('completed');
    const results = page.locator('#ov-results');
    await expect(results).toContainText('You did not fire this run');
    await expect(results).toContainText('n/a');
    expect((await debug(page)).drillResult.ratioFiring).toBeNull();
  });

  test('releasing focus mid-hold clears the trigger (no stuck fire after resume)', async ({ page }) => {
    await installFakePointerLock(page, { unadjusted: true });
    await page.goto('/?run=30&countdown=0.4');
    await page.locator('input[name="profile"][value="tracking"]').check();
    await page.getByRole('button', { name: 'Start' }).click();
    await expect.poll(async () => (await debug(page)).state, { timeout: 8000 }).toBe('running');
    await page.mouse.down();
    await expect.poll(async () => (await debug(page)).triggerHeld).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect.poll(async () => (await debug(page)).state).toBe('paused');
    expect((await debug(page)).triggerHeld).toBe(false);
    const f0 = (await debug(page)).drillResult.firingSeconds;
    await page.mouse.up();
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect.poll(async () => (await debug(page)).state).toBe('running');
    await page.waitForTimeout(500);
    expect((await debug(page)).drillResult.firingSeconds).toBe(f0); // still not firing
  });

  test('holding the button from the countdown does not start firing', async ({ page }) => {
    await installFakePointerLock(page, { unadjusted: true });
    await page.goto('/?run=10&countdown=1');
    await page.locator('input[name="profile"][value="tracking"]').check();
    await page.getByRole('button', { name: 'Start' }).click();
    await expect.poll(async () => (await debug(page)).state).toBe('countdown');
    await page.mouse.down();
    await expect.poll(async () => (await debug(page)).state, { timeout: 4000 }).toBe('running');
    await page.waitForTimeout(500);
    expect((await debug(page)).drillResult.firingSeconds).toBe(0);
    await page.mouse.up();
  });
});

test.describe('sound controls', () => {
  test('mute and volume persist and never break the page when audio is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).AudioContext = undefined;
      (window as any).webkitAudioContext = undefined;
    });
    await installFakePointerLock(page);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(FAST);
    await page.locator('#settings-details').evaluate((el: HTMLDetailsElement) => (el.open = true));
    await page.locator('#f-mute').check();
    await page.locator('#f-vol').fill('30');
    await page.reload();
    await page.locator('#settings-details').evaluate((el: HTMLDetailsElement) => (el.open = true));
    await expect(page.locator('#f-mute')).toBeChecked();
    await expect(page.locator('#f-vol')).toHaveValue('30');
    await page.getByRole('button', { name: 'Start' }).click();
    await expect.poll(async () => (await debug(page)).state, { timeout: 8000 }).toBe('running');
    await hitOne(page);
    expect(errors).toEqual([]);
  });
});
