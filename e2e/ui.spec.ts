import { expect, test } from '@playwright/test';
import { debug } from './helpers';

test.describe('settings, layout and fallback (no pointer lock involved)', () => {
  test('loads with no console errors and shows renderer diagnostics', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto('/');
    await expect(page.locator('#arena')).toBeVisible();
    await expect(page.locator('#d-renderer')).not.toHaveText('–');
    expect(errors).toEqual([]);
  });

  test('FOV display: reference aspect identity, Hor+ at a wider window', async ({ page }) => {
    await page.goto('/');
    await page.locator('#f-shape').selectOption('16:9');
    await page.locator('#f-fov').fill('100');
    await expect(page.locator('#r-fov')).toHaveText('100.0°');
    await page.locator('#f-shape').selectOption('21:9');
    await expect.poll(async () => parseFloat((await page.locator('#r-fov').textContent())!)).toBeGreaterThan(100);
    await page.locator('#f-shape').selectOption('4:3');
    await expect.poll(async () => parseFloat((await page.locator('#r-fov').textContent())!)).toBeLessThan(100);
    await expect(page.locator('#fov-derived')).toContainText('Vertical FOV (derived, fixed)');
  });

  test('invalid values show an error, keep last valid settings, and are not saved', async ({ page }) => {
    await page.goto('/');
    const before = (await debug(page)).degreesPerUnit;
    await page.locator('#f-dpi').fill('0');
    await expect(page.locator('#e-dpi')).toContainText('Use a value');
    await expect(page.locator('#f-dpi')).toHaveAttribute('aria-invalid', 'true');
    expect((await debug(page)).degreesPerUnit).toBe(before);
    await page.locator('#f-dpi').fill('1600');
    await expect(page.locator('#e-dpi')).toBeEmpty();
    expect((await debug(page)).degreesPerUnit).toBeCloseTo(before / 2, 9);
  });

  test('sensitivity is labelled nominal and direct mode switches the editable fields', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#sens-derived')).toContainText('NOMINAL');
    await page.getByLabel('Degrees per input unit').check();
    await expect(page.locator('#f-dpu')).toBeEnabled();
    await expect(page.locator('#f-dpi')).toBeDisabled();
    await expect(page.locator('#sens-derived')).toContainText('Direct setting');
    await page.locator('#f-dpu').fill('0.1');
    expect((await debug(page)).degreesPerUnit).toBeCloseTo(0.1, 12);
  });

  test('settings are keyboard reachable: Tab visits the form fields with a visible focus ring', async ({ page }) => {
    await page.goto('/');
    await page.locator('body').click({ position: { x: 2, y: 2 } });
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(() => document.activeElement?.id ?? '');
      if (id) seen.add(id);
    }
    for (const id of ['f-dpi', 'f-cm', 'f-upc', 'x-style', 'x-color', 'f-mute', 'f-vol']) expect(seen).toContain(id);
    await page.locator('#f-fov').focus();
    const outline = await page.locator('#f-fov').evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
  });

  test('pressing Enter in a field does not reload the page', async ({ page }) => {
    await page.goto('/');
    await page.locator('#f-cm').fill('40');
    await page.locator('#f-cm').press('Enter');
    await expect(page.locator('#f-cm')).toHaveValue('40');
  });

  test('settings persist across reload (settings only)', async ({ page }) => {
    await page.goto('/');
    await page.locator('#f-fov').fill('95');
    await page.reload();
    await expect(page.locator('#f-fov')).toHaveValue('95');
    const stored = await page.evaluate(() => localStorage.getItem('aim-practice.settings.v1'));
    expect(stored).toBeTruthy();
    // Settings only: sensitivity, FOV, crosshair. Never raw mouse input or run data.
    expect(Object.keys(JSON.parse(stored!)).sort()).toEqual(['crosshair', 'fovAt16x9', 'sensitivity']);
  });

  test('canvas backing store is sharp at device pixel ratio 2', async ({ browser }) => {
    const ctx = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto('http://127.0.0.1:5199/');
    await expect(page.locator('#d-buffer')).not.toHaveText('–');
    const r = await page.evaluate(() => {
      const c = document.getElementById('arena') as HTMLCanvasElement;
      const rect = c.getBoundingClientRect();
      return { bw: c.width, cw: rect.width };
    });
    expect(Math.abs(r.bw / r.cw - 2)).toBeLessThan(0.02);
    await ctx.close();
  });

  test('resize keeps the aspect correct and the canvas matched to its box', async ({ page }) => {
    await page.goto('/');
    await page.locator('#f-shape').selectOption('fill');
    await page.setViewportSize({ width: 1100, height: 700 });
    // Resize is applied asynchronously (ResizeObserver), so wait until the camera aspect,
    // the CSS box and the drawing buffer all agree rather than reading once.
    const measure = async () => {
      const r = await page.evaluate(() => {
        const c = document.getElementById('arena') as HTMLCanvasElement;
        const rect = c.getBoundingClientRect();
        return { boxAspect: rect.width / rect.height, bufAspect: c.width / c.height };
      });
      const d = await debug(page);
      return {
        camVsBox: Math.abs(d.aspect - r.boxAspect),
        bufVsBox: Math.abs(r.bufAspect - r.boxAspect),
      };
    };
    await expect.poll(async () => (await measure()).camVsBox, { timeout: 5000 }).toBeLessThan(0.02);
    await expect.poll(async () => (await measure()).bufVsBox, { timeout: 5000 }).toBeLessThan(0.02);
  });
});

test.describe('fallback', () => {
  test('WebGL unavailable shows an honest message and no arena', async ({ page }) => {
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
        return (orig as any).call(this, type, ...rest);
      } as typeof orig;
    });
    await page.goto('/');
    await expect(page.locator('#fallback')).toBeVisible();
    await expect(page.locator('#fb-reason')).toContainText('WebGL 2');
    await expect(page.locator('#fb-need')).not.toBeEmpty();
    await expect(page.locator('#arena')).toBeHidden();
    await expect(page.locator('#settings')).toBeHidden(); // no blank, dead controls
    await expect(page.getByRole('button', { name: 'Check again' })).toBeFocused();
  });

  test('missing Pointer Lock API shows an honest message', async ({ page }) => {
    await page.addInitScript(() => {
      // requestPointerLock is defined on Element.prototype, not on the canvas subclass.
      delete (Element.prototype as any).requestPointerLock;
    });
    await page.goto('/');
    await expect(page.locator('#fallback')).toBeVisible();
    await expect(page.locator('#fb-reason')).toContainText('Pointer Lock');
  });
});
