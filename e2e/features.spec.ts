import { expect, test, type Page } from '@playwright/test';
import { dailyFor, localDateString } from '../src/core/daily';
import { debug, installFakePointerLock } from './helpers';

// SIMULATED pointer lock (helpers.ts) and a dev-only helper that aims at the first target.
// Sessions are shortened with the dev-only ?run=&countdown= override, which fixes the length.

async function begin(page: Page, url: string) {
  await installFakePointerLock(page, { unadjusted: true });
  await page.goto(url);
}
async function startAndRun(page: Page) {
  await page.getByRole('button', { name: 'Start' }).click();
  await expect.poll(async () => (await debug(page)).state, { timeout: 8000 }).toBe('running');
}
async function clickTarget(page: Page) {
  await expect.poll(async () => (await debug(page)).drillTargets.length, { timeout: 4000 }).toBeGreaterThan(0);
  await page.evaluate(() => (window as any).__aimDebug().aimAtTarget());
  await page.waitForTimeout(60);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(120);
}

test.describe('grid drill', () => {
  test('three targets stay up; each hit replaces one; results show kills per second and a timeline', async ({ page }) => {
    await begin(page, '/?run=5&countdown=0.4&seed=11');
    await page.locator('input[name="profile"][value="grid"]').check();
    await startAndRun(page);
    expect((await debug(page)).drillTargets).toHaveLength(3);
    for (let i = 0; i < 6; i++) {
      await clickTarget(page);
      expect((await debug(page)).drillTargets).toHaveLength(3);
    }
    expect((await debug(page)).drillResult.hits).toBeGreaterThanOrEqual(5);
    await expect.poll(async () => (await debug(page)).state, { timeout: 12000 }).toBe('completed');
    const r = page.locator('#ov-results');
    await expect(r).toContainText('Kills per second');
    await expect(r).toContainText('Best streak');
    await expect(r.locator('svg.ruler')).toHaveAttribute('aria-label', /Kills in each 5 second slice/);
    await expect(r).toContainText('original speed-and-accuracy drill');
  });
});

test.describe('difficulty and length', () => {
  test('difficulty changes the target size; the choice is remembered', async ({ page }) => {
    await begin(page, '/?run=20&countdown=0.4');
    await page.locator('#f-difficulty').selectOption('easy');
    await startAndRun(page);
    await expect.poll(async () => (await debug(page)).drillTargets.length).toBe(1);
    const easy = (await debug(page)).drillTargets[0].r;
    await page.keyboard.press('KeyR');
    await expect.poll(async () => (await debug(page)).state).toBe('ready');
    await page.locator('#f-difficulty').selectOption('hard');
    await startAndRun(page);
    await expect.poll(async () => (await debug(page)).drillTargets.length).toBe(1);
    const hard = (await debug(page)).drillTargets[0].r;
    expect(easy).toBeGreaterThan(hard);
    await page.reload();
    await expect(page.locator('#f-difficulty')).toHaveValue('hard');
  });

  test('chosen length sets the session length (production path, no dev override)', async ({ page }) => {
    await installFakePointerLock(page);
    await page.goto('/');
    await page.locator('#f-length').selectOption('30');
    await expect(page.locator('#r-time')).toHaveText('30.0');
    await page.locator('#f-length').selectOption('90');
    await expect(page.locator('#r-time')).toHaveText('90.0');
    expect((await debug(page)).snapshot.runDuration).toBe(90);
  });

  test('Start, difficulty and length are reachable with the keyboard in a sensible order', async ({ page }) => {
    await installFakePointerLock(page);
    await page.goto('/');
    await page.locator('#f-length').focus();
    await page.keyboard.type('9'); // type-ahead works on a focused <select> in every browser
    await expect(page.locator('#f-length')).toHaveValue('90');
    await expect(page.locator('#r-time')).toHaveText('90.0');
    // Changing the length rebuilds the Ready screen; focus must not be thrown away, and Tab must reach Start.
    await expect(page.locator('#f-length')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Start' })).toBeFocused();
  });
});

test.describe('history, personal bests and stats', () => {
  test('a finished run is saved once; the second is compared with the first; stats show both', async ({ page }) => {
    await begin(page, '/?run=3&countdown=0.4&seed=21');
    await startAndRun(page);
    await clickTarget(page);
    await expect.poll(async () => (await debug(page)).state, { timeout: 10000 }).toBe('completed');
    await expect(page.locator('.progress')).toContainText('First run in this mode');
    expect((await debug(page)).history).toHaveLength(1);

    await page.getByRole('button', { name: 'Run again' }).click();
    await startAndRun(page);
    await clickTarget(page);
    await expect.poll(async () => (await debug(page)).state, { timeout: 10000 }).toBe('completed');
    expect((await debug(page)).history).toHaveLength(2);
    await expect(page.locator('.progress')).toContainText(/personal best|Matched/);
    await expect(page.locator('.progress')).toContainText(/too few to call a trend/);

    await page.locator('#ov-actions').getByRole('button', { name: 'View stats' }).click();
    const dlg = page.locator('#stats-dialog');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('table').first()).toContainText('Precision');
    await expect(dlg).toContainText('not rankings');
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();

    // Persisted: survives reload, contains summaries only.
    await page.reload();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('aim-practice.history.v1') ?? '[]'));
    expect(stored).toHaveLength(2);
    for (const rec of stored) {
      expect(Object.keys(rec).sort()).toEqual(['accuracy', 'at', 'daily', 'detail', 'difficulty', 'scenario', 'score', 'seconds', 'seed']);
    }
  });

  test('an untouched run is not saved and says so', async ({ page }) => {
    await begin(page, '/?run=2&countdown=0.4');
    await startAndRun(page);
    await expect.poll(async () => (await debug(page)).state, { timeout: 8000 }).toBe('completed');
    expect((await debug(page)).history).toHaveLength(0);
    await expect(page.locator('#ov-results')).toContainText('not saved');
  });

  test('clearing history asks for confirmation and empties the store', async ({ page }) => {
    await begin(page, '/?run=2&countdown=0.4');
    await page.evaluate(() => localStorage.setItem('aim-practice.history.v1', JSON.stringify([{ at: '2026-01-01T00:00:00.000Z', scenario: 'grid', difficulty: 'easy', seconds: 30, score: 100, accuracy: 0.5, detail: 'x', seed: 1, daily: null }])));
    await page.reload();
    expect((await debug(page)).history).toHaveLength(1);
    await page.locator('#settings-details').evaluate((el: HTMLDetailsElement) => (el.open = true));
    page.once('dialog', (d) => d.dismiss());
    await page.locator('#data-clear').click();
    expect((await debug(page)).history).toHaveLength(1); // declined
    page.once('dialog', (d) => d.accept());
    await page.locator('#data-clear').click();
    await expect(page.locator('#data-msg')).toHaveText('History cleared.');
    expect(await page.evaluate(() => localStorage.getItem('aim-practice.history.v1'))).toBe('[]');
  });

  test('corrupt stored history is ignored, never crashes the page', async ({ page }) => {
    await installFakePointerLock(page);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('aim-practice.history.v1', '{not json'));
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
    expect((await debug(page)).history).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe('daily challenge', () => {
  test("the card shows today's challenge and starting it uses its mode, difficulty, length and seed", async ({ page }) => {
    await installFakePointerLock(page, { unadjusted: true });
    await page.goto('/');
    const today = dailyFor(localDateString(new Date()));
    await expect(page.locator('#daily-text')).toContainText(`${today.difficulty}, ${today.seconds} s`);
    await page.locator('#daily-btn').click();
    await expect.poll(async () => (await debug(page)).state).toMatch(/countdown|running/);
    const d = await debug(page);
    expect(d.scenarioId).toBe(today.scenario);
    expect(d.difficulty).toBe(today.difficulty);
    expect(d.runInfo).toMatchObject({ seed: today.seed, seconds: today.seconds, daily: today.date });
  });
});

test.describe('challenge links', () => {
  test('?c= selects the shared mode, difficulty, length and seed, with a visible notice', async ({ page }) => {
    await installFakePointerLock(page, { unadjusted: true });
    await page.goto('/?c=grid.hard.30.123456');
    await expect(page.locator('input[name="profile"][value="grid"]')).toBeChecked();
    await expect(page.locator('#f-difficulty')).toHaveValue('hard');
    await expect(page.locator('#f-length')).toHaveValue('30');
    await expect(page.locator('#ov-extra')).toContainText('shared challenge');
    await expect(page.locator('#ov-extra')).toContainText('not verified');
    await page.getByRole('button', { name: 'Start' }).click();
    await expect.poll(async () => (await debug(page)).state).toMatch(/countdown|running/);
    expect((await debug(page)).runInfo).toMatchObject({ scenario: 'grid', difficulty: 'hard', seconds: 30, seed: 123456 });
  });

  test('malformed links fall back to defaults without errors', async ({ page }) => {
    await installFakePointerLock(page);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const q of ['?c=nope.hard.30.5', '?c=grid.hard.45.5', '?c=grid.hard.30.99999999999', '?c=%3Cscript%3Ealert(1)%3C%2Fscript%3E', '?c=']) {
      await page.goto('/' + q);
      await expect(page.locator('#ov-extra')).not.toContainText('shared challenge');
      await expect(page.getByRole('button', { name: 'Start' })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('completed run offers a copyable link carrying the pattern but not the score', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await begin(page, '/?run=2&countdown=0.4&seed=77');
    await startAndRun(page);
    await clickTarget(page);
    await expect.poll(async () => (await debug(page)).state, { timeout: 8000 }).toBe('completed');
    await page.getByRole('button', { name: 'Copy challenge link' }).click();
    await expect(page.locator('#share-msg')).toContainText('not your score');
    const text = await page.evaluate(() => navigator.clipboard.readText());
    const u = new URL(text);
    expect([...u.searchParams.keys()]).toEqual(['c']);
    expect(u.searchParams.get('c')).toMatch(/^precision\.standard\.\d+\.77$/);
  });
});

test.describe('crosshair customization', () => {
  test('edits update the in-arena crosshair and the previews, and persist', async ({ page }) => {
    await installFakePointerLock(page);
    await page.goto('/');
    await page.locator('#settings-details').evaluate((el: HTMLDetailsElement) => (el.open = true));
    const before = await page.locator('#crosshair').innerHTML();
    await page.locator('#x-style').selectOption('circle');
    await page.locator('#x-color').fill('#ff00aa');
    const after = await page.locator('#crosshair').innerHTML();
    expect(after).not.toBe(before);
    expect(after).toContain('#ff00aa');
    expect(await page.locator('#xh-preview svg').count()).toBe(1);
    expect(await page.locator('#xh-preview-light svg').count()).toBe(1);
    await page.reload();
    await expect(page.locator('#x-style')).toHaveValue('circle');
    await expect(page.locator('#crosshair')).toContainText('', { useInnerText: true });
    expect(await page.locator('#crosshair').innerHTML()).toContain('#ff00aa');
  });

  test('a low-contrast outline-free crosshair gets a warning; reset restores the default', async ({ page }) => {
    await installFakePointerLock(page);
    await page.goto('/');
    await page.locator('#settings-details').evaluate((el: HTMLDetailsElement) => (el.open = true));
    await page.locator('#x-outline').uncheck();
    await page.locator('#x-color').fill('#10403e');
    await expect(page.locator('#x-warn')).toContainText('close to the arena');
    await page.locator('#x-reset').click();
    await expect(page.locator('#x-warn')).toHaveText('');
    await expect(page.locator('#x-outline')).toBeChecked();
    await expect(page.locator('#x-style')).toHaveValue('cross');
  });

  test('the crosshair stays centred in the arena after a resize', async ({ page }) => {
    await installFakePointerLock(page);
    await page.goto('/');
    const centred = async () => {
      const a = (await page.locator('#stage').boundingBox())!;
      const c = (await page.locator('#crosshair svg').boundingBox())!;
      return { dx: Math.abs(c.x + c.width / 2 - (a.x + a.width / 2)), dy: Math.abs(c.y + c.height / 2 - (a.y + a.height / 2)) };
    };
    let o = await centred();
    expect(o.dx).toBeLessThan(1.5);
    expect(o.dy).toBeLessThan(1.5);
    await page.setViewportSize({ width: 1100, height: 700 });
    await page.waitForTimeout(300);
    o = await centred();
    expect(o.dx).toBeLessThan(1.5);
    expect(o.dy).toBeLessThan(1.5);
  });
});
