import { describe, expect, it } from 'vitest';
import { SUPPORTED_CHANNELS, selectBrowser, type FileProbe } from '../config/browserSelection';

const fsWith = (files: string[]): FileProbe => ({
  exists: (p) => files.includes(p) || files.includes(p + '/'),
  isFile: (p) => files.includes(p),
});

describe('selectBrowser', () => {
  it('neither variable set: no override (Playwright discovery)', () => {
    expect(selectBrowser({})).toEqual({});
  });

  it.each(SUPPORTED_CHANNELS)('accepts supported channel %s', (c) => {
    expect(selectBrowser({ AIM_BROWSER_CHANNEL: c })).toEqual({ channel: c });
  });

  it('trims surrounding whitespace in a channel', () => {
    expect(selectBrowser({ AIM_BROWSER_CHANNEL: ' chrome ' })).toEqual({ channel: 'chrome' });
  });

  it.each(['firefox', 'webkit', 'Chrome', 'chromium-beta', 'chrome;rm'])('rejects unsupported channel %s', (c) => {
    expect(() => selectBrowser({ AIM_BROWSER_CHANNEL: c })).toThrow(/not supported/);
  });

  it('rejects empty and whitespace-only values instead of treating them as unset', () => {
    expect(() => selectBrowser({ AIM_BROWSER_CHANNEL: '' })).toThrow(/empty/);
    expect(() => selectBrowser({ AIM_BROWSER_CHANNEL: '   ' })).toThrow(/empty/);
    expect(() => selectBrowser({ AIM_BROWSER_PATH: '' })).toThrow(/empty/);
  });

  it('accepts an existing absolute file path', () => {
    const r = selectBrowser({ AIM_BROWSER_PATH: '/opt/browser/chrome' }, fsWith(['/opt/browser/chrome']));
    expect(r).toEqual({ executablePath: '/opt/browser/chrome' });
  });

  it('rejects relative, missing and non-file paths', () => {
    expect(() => selectBrowser({ AIM_BROWSER_PATH: 'chrome' }, fsWith([]))).toThrow(/absolute/);
    expect(() => selectBrowser({ AIM_BROWSER_PATH: '/nope/chrome' }, fsWith([]))).toThrow(/does not exist/);
    expect(() => selectBrowser({ AIM_BROWSER_PATH: '/opt/dir' }, fsWith(['/opt/dir/']))).toThrow(/not a file/);
  });

  it('rejects both variables set, whatever their values (no silent precedence)', () => {
    expect(() =>
      selectBrowser({ AIM_BROWSER_CHANNEL: 'chrome', AIM_BROWSER_PATH: '/opt/browser/chrome' }, fsWith(['/opt/browser/chrome'])),
    ).toThrow(/both set/);
    expect(() => selectBrowser({ AIM_BROWSER_CHANNEL: '', AIM_BROWSER_PATH: '' })).toThrow(/both set/);
  });
});
