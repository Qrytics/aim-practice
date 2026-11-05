import { expect, test } from '@playwright/test';
import { debug, installFakePointerLock, moveMouse } from './helpers';

// SIMULATED pointer lock (helpers.ts). Real-frame-loop code runs; only the lock and DOM events are synthetic.

async function startToCountdown(page: import('@playwright/test').Page) {
  await installFakePointerLock(page, { unadjusted: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start' }).click();
  await expect.poll(async () => (await debug(page)).state).toBe('countdown');
}

test.describe('countdown vs running gates', () => {
  test('countdown: mouse-look works, translation and firing are frozen; running: movement works', async ({ page }) => {
    await startToCountdown(page);
    let d = await debug(page);

    await page.keyboard.down('KeyW');
    await moveMouse(page, 300, 0);
    await page.mouse.down(); // fire attempt during countdown
    await page.mouse.up();
    await page.waitForTimeout(600);
    d = await debug(page);
    expect(d.state).toBe('countdown');
    expect(d.player.yaw).not.toBe(0); // look allowed
    expect(d.player.x).toBe(0); // translation frozen
    expect(d.player.z).toBe(0);
    expect(d.player.vz).toBe(0);
    expect(d.snapshot.runElapsed).toBe(0); // no active drill time before Running

    await expect.poll(async () => (await debug(page)).state, { timeout: 8000 }).toBe('running');
    await page.waitForTimeout(500);
    d = await debug(page);
    expect(Math.hypot(d.player.x, d.player.z)).toBeGreaterThan(0.05); // W is still held: now moving
    await page.keyboard.up('KeyW');
  });

  test('fire attempts during countdown are discarded and counted, never queued for later', async ({ page }) => {
    await startToCountdown(page);
    await page.mouse.down();
    await page.mouse.up();
    await page.mouse.down();
    await page.mouse.up();
    await expect.poll(async () => (await debug(page)).firesDiscarded).toBe(2);
  });
});

test.describe('pause paths through the real frame loop', () => {
  test('visibility loss pauses (SYNTHETIC visibilitychange; real tab switching is manual)', async ({ page }) => {
    await startToCountdown(page);
    await expect.poll(async () => (await debug(page)).state, { timeout: 8000 }).toBe('running');
    await page.keyboard.down('KeyW');
    await expect.poll(async () => (await debug(page)).held).toBe(1);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(async () => (await debug(page)).state).toBe('paused');
    const d = await debug(page);
    expect(d.snapshot.pauseReason).toBe('hidden');
    expect(d.held).toBe(0);
    await page.keyboard.up('KeyW');
  });

  test('a long frame gap becomes a reported stall pause (SYNTHETIC: rAF is delayed on purpose)', async ({ page }) => {
    await startToCountdown(page);
    await expect.poll(async () => (await debug(page)).state, { timeout: 8000 }).toBe('running');
    const before = (await debug(page)).snapshot.runElapsed;
    // Block the page's main thread for ~700 ms (> maxFrameGap 0.25 s) so the next real frame sees a big gap.
    await page.evaluate(() => {
      const end = performance.now() + 700;
      while (performance.now() < end) { /* busy */ }
    });
    await expect.poll(async () => (await debug(page)).state).toBe('paused');
    const d = await debug(page);
    expect(d.snapshot.pauseReason).toBe('stall');
    expect(d.snapshot.stallCount).toBe(1);
    expect(d.snapshot.stalledSeconds).toBeGreaterThan(0.5);
    // The stalled time was not added to the run.
    expect(d.snapshot.runElapsed - before).toBeLessThan(0.5);
    await expect(page.locator('#ov-body')).toContainText('was not counted as drill time');
  });
});

test.describe('calibration application through the UI', () => {
  test('turning a known amount then applying calibration rescales sensitivity; counter resets', async ({ page }) => {
    await startToCountdown(page);
    const dpuBefore = (await debug(page)).degreesPerUnit;
    await page.evaluate(() => (document.getElementById('cal-reset') as HTMLButtonElement).click());
    // Turn the view by exactly 1000 input units, wait for the sim to consume it.
    await moveMouse(page, 1000, 0);
    await expect.poll(async () => Math.abs((await debug(page)).calibrationTurnDeg)).toBeGreaterThan(1);
    const measured = (await debug(page)).calibrationTurnDeg;
    expect(Math.abs(measured - 1000 * dpuBefore)).toBeLessThan(1e-6);

    // Pretend the user physically turned 2x what the view showed -> sensitivity should double.
    await page.evaluate(() => (window as any).__fakeUnlock());
    await expect.poll(async () => (await debug(page)).state).toBe('paused');
    await page.locator('#settings-details').evaluate((el: HTMLDetailsElement) => (el.open = true));
    await page.locator('#f-intended').fill(String(Math.abs(measured) * 2));
    await page.locator('#cal-apply').click();
    await expect(page.locator('#cal-msg')).toContainText('Calibrated to');
    const d = await debug(page);
    expect(d.degreesPerUnit).toBeCloseTo(dpuBefore * 2, 6);
    expect(d.calibrationTurnDeg).toBe(0);
    // The nominal-mode field that absorbed the change is units-per-count; it halved.
    expect(parseFloat(await page.locator('#f-upc').inputValue())).toBeCloseTo(0.5, 5);
  });

  test('applying calibration before turning anything explains why nothing happened', async ({ page }) => {
    await page.goto('/');
    await page.locator('#cal-apply').click();
    await expect(page.locator('#cal-msg')).toContainText('Nothing to calibrate');
  });

  test('calibration rejects an invalid intended turn with an error', async ({ page }) => {
    await page.goto('/');
    await page.locator('#f-intended').fill('0');
    await page.locator('#cal-apply').click();
    await expect(page.locator('#e-intended')).not.toBeEmpty();
    await expect(page.locator('#f-intended')).toHaveAttribute('aria-invalid', 'true');
  });
});

test.describe('1024x768: essentials without hunting', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('Start, state and timer are inside the first screen; settings are a collapsed disclosure', async ({ page }) => {
    await page.goto('/');
    const vh = 768;
    for (const sel of ['#r-state', '#r-time']) {
      const b = (await page.locator(sel).boundingBox())!;
      expect(b.y + b.height, sel).toBeLessThanOrEqual(vh);
    }
    const start = (await page.getByRole('button', { name: 'Start' }).boundingBox())!;
    expect(start.y + start.height).toBeLessThanOrEqual(vh);
    await expect(page.locator('#settings-details')).not.toHaveAttribute('open', '');
    // The summary itself is reachable and operable by keyboard.
    const summary = page.locator('#settings-details > summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#settings-details')).toHaveAttribute('open', '');
    await expect(page.locator('#f-dpi')).toBeVisible();
  });

  test('Review settings opens the disclosure and moves focus to it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Review settings' }).click();
    await expect(page.locator('#settings-details')).toHaveAttribute('open', '');
    await expect(page.locator('#settings-details > summary')).toBeFocused();
  });

  test('paused Resume stays on the first screen', async ({ page }) => {
    await installFakePointerLock(page, { unadjusted: true });
    await page.goto('/');
    await page.getByRole('button', { name: 'Start' }).click();
    await expect.poll(async () => (await debug(page)).state, { timeout: 8000 }).toBe('running');
    await page.keyboard.press('KeyP');
    await expect.poll(async () => (await debug(page)).state).toBe('paused');
    const b = (await page.getByRole('button', { name: 'Resume' }).boundingBox())!;
    expect(b.y + b.height).toBeLessThanOrEqual(768);
  });
});
