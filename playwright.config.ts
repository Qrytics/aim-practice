import { defineConfig, devices } from '@playwright/test';
import { selectBrowser } from './config/browserSelection';

/**
 * Browser selection (see config/browserSelection.ts and README):
 *  - default: Playwright's own installed Chromium headless shell. If it is
 *    missing, run `npx playwright install chromium`.
 *  - AIM_BROWSER_CHANNEL=<channel> or AIM_BROWSER_PATH=<absolute path>: at most
 *    one of them; both set, an unsupported channel or a bad path is an error.
 * The 'real-lock' project defaults to channel 'chromium' (new headless) because
 * the default headless shell cannot acquire pointer lock. No machine-specific
 * path is stored in this repository.
 *
 * The dev server is started and stopped by Playwright itself; the port is strict,
 * so a pre-existing process on it is an error rather than silently reused.
 */
const pick = selectBrowser(process.env);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:5199' },
  projects: [
    {
      name: 'default',
      testIgnore: /real-lock\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        ...(pick.channel ? { channel: pick.channel } : {}),
        ...(pick.executablePath ? { launchOptions: { executablePath: pick.executablePath } } : {}),
      },
    },
    {
      name: 'real-lock',
      testMatch: /real-lock\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        ...(pick.executablePath
          ? { launchOptions: { executablePath: pick.executablePath } }
          : { channel: pick.channel ?? 'chromium' }),
      },
    },
  ],
  webServer: {
    command: 'npx vite --host 127.0.0.1 --port 5199 --strictPort',
    url: 'http://127.0.0.1:5199',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
