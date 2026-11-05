/**
 * Browser selection for Playwright, from optional environment variables.
 *
 *   AIM_BROWSER_CHANNEL  one of SUPPORTED_CHANNELS (Playwright channel discovery)
 *   AIM_BROWSER_PATH     path to a browser executable on YOUR machine (never committed)
 *
 * Rules (no silent precedence):
 *   - neither set  -> Playwright's own installed browser (real-lock project: channel 'chromium')
 *   - exactly one  -> that one is used
 *   - both set     -> ERROR. They are different ways to pick a browser; choosing one for you
 *                     would hide a mistake.
 *   - unsupported channel, empty value, relative path or missing file -> ERROR with the reason.
 * Whitespace-only values count as empty (an error), not as "unset".
 */

import { existsSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export const SUPPORTED_CHANNELS = [
  'chromium',
  'chrome',
  'msedge',
  'chrome-beta',
  'msedge-beta',
  'chrome-dev',
  'msedge-dev',
  'chrome-canary',
  'msedge-canary',
] as const;

export type BrowserChannel = (typeof SUPPORTED_CHANNELS)[number];

export interface BrowserSelection {
  channel?: BrowserChannel;
  executablePath?: string;
}

export interface Env {
  [key: string]: string | undefined;
}

export interface FileProbe {
  exists(path: string): boolean;
  isFile(path: string): boolean;
}

const realFs: FileProbe = {
  exists: (p) => existsSync(p),
  isFile: (p) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  },
};

export function selectBrowser(env: Env, fs: FileProbe = realFs): BrowserSelection {
  const rawChannel = env.AIM_BROWSER_CHANNEL;
  const rawPath = env.AIM_BROWSER_PATH;
  const channelSet = rawChannel !== undefined;
  const pathSet = rawPath !== undefined;

  if (channelSet && pathSet) {
    throw new Error(
      'AIM_BROWSER_CHANNEL and AIM_BROWSER_PATH are both set. Set only one: ' +
        'a channel (Playwright finds the browser) or a path (you point at the executable).',
    );
  }

  if (channelSet) {
    const c = rawChannel.trim();
    if (c === '') throw new Error('AIM_BROWSER_CHANNEL is set but empty. Unset it or use one of: ' + SUPPORTED_CHANNELS.join(', ') + '.');
    if (!(SUPPORTED_CHANNELS as readonly string[]).includes(c)) {
      throw new Error(`AIM_BROWSER_CHANNEL="${c}" is not supported. Use one of: ${SUPPORTED_CHANNELS.join(', ')}.`);
    }
    return { channel: c as BrowserChannel };
  }

  if (pathSet) {
    const p = rawPath.trim();
    if (p === '') throw new Error('AIM_BROWSER_PATH is set but empty. Unset it or give the absolute path of a browser executable.');
    if (!isAbsolute(p)) throw new Error(`AIM_BROWSER_PATH must be an absolute path (got "${p}").`);
    if (!fs.exists(p)) throw new Error(`AIM_BROWSER_PATH does not exist: ${p}`);
    if (!fs.isFile(p)) throw new Error(`AIM_BROWSER_PATH is not a file: ${p}`);
    return { executablePath: p };
  }

  return {};
}
