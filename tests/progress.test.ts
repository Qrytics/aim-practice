import { describe, expect, it } from 'vitest';
import { GRID, GridDrill } from '../src/core/drills/grid';
import { PrecisionDrill } from '../src/core/drills/precision';
import { TrackingDrill } from '../src/core/drills/tracking';
import { DEFAULT_CROSSHAIR, contrast, crosshairSvg, luminance, parseCrosshair, visibilityWarning } from '../src/core/crosshair';
import { dailyFor, hashString, isDateString, localDateString } from '../src/core/daily';
import { HISTORY_LIMIT, addRun, compare, parseHistory, personalBest, recentScores, summarize, type RunRecord } from '../src/core/history';
import { DIFFICULTIES, SCENARIOS, categoryKey, gridConfig, precisionConfig, trackingConfig } from '../src/core/scenarios';
import { SessionMachine } from '../src/core/session';
import { challengeUrl, decodeChallenge, encodeChallenge } from '../src/core/share';
import { DEFAULT_SETTINGS, parseSettings } from '../src/core/settings';

const DT = 1 / 120;
const still = { x: 0, z: 0, vx: 0, vz: 0, yaw: 0, pitch: 0 };

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  at: '2026-11-05T10:00:00.000Z',
  scenario: 'precision',
  difficulty: 'standard',
  seconds: 60,
  score: 500,
  accuracy: 0.7,
  detail: '70% accuracy',
  seed: 1,
  daily: null,
  ...over,
});

describe('history parsing is defensive', () => {
  it('drops malformed entries, keeps valid ones, never throws', () => {
    const good = run();
    const parsed = parseHistory([good, null, 5, 'x', { ...good, score: NaN }, { ...good, difficulty: 'nightmare' }, { ...good, accuracy: 'high' }, { ...good, seed: undefined }]);
    expect(parsed).toEqual([good]);
    expect(parseHistory('nope')).toEqual([]);
    expect(parseHistory(null)).toEqual([]);
  });
  it('keeps only the most recent HISTORY_LIMIT runs', () => {
    let h: RunRecord[] = [];
    for (let i = 0; i < HISTORY_LIMIT + 25; i++) h = addRun(h, run({ score: i }));
    expect(h).toHaveLength(HISTORY_LIMIT);
    expect(h[0]!.score).toBe(25);
    expect(h[h.length - 1]!.score).toBe(HISTORY_LIMIT + 24);
  });
});

describe('personal bests and comparison (compared only within the same scenario, difficulty and length)', () => {
  const h = [run({ score: 400 }), run({ score: 600 }), run({ score: 500 }), run({ difficulty: 'hard', score: 9999 }), run({ seconds: 30, score: 8888 })];
  const key = categoryKey('precision', 'standard', 60);

  it('best ignores other difficulties and lengths', () => {
    expect(personalBest(h, key)!.score).toBe(600);
    expect(personalBest(h, categoryKey('grid', 'easy', 30))).toBeNull();
  });
  it('first run in a category has nothing to compare with', () => {
    const c = compare([], run());
    expect(c).toMatchObject({ first: true, newBest: false, previousBest: null, delta: null, earlierRuns: 0, recentAverage: null });
  });
  it('detects a new best and the exact delta', () => {
    const c = compare(h, run({ score: 650 }));
    expect(c).toMatchObject({ first: false, newBest: true, previousBest: 600, delta: 50, earlierRuns: 3 });
    expect(c.recentAverage).toBeCloseTo((400 + 600 + 500) / 3, 9);
  });
  it('a tie is not a new best; a lower score has a negative delta', () => {
    expect(compare(h, run({ score: 600 })).newBest).toBe(false);
    expect(compare(h, run({ score: 450 })).delta).toBe(-150);
  });
  it('recent average uses at most the 5 runs before', () => {
    const many = Array.from({ length: 9 }, (_, i) => run({ score: (i + 1) * 100 }));
    expect(compare(many, run({ score: 1 })).recentAverage).toBeCloseTo((500 + 600 + 700 + 800 + 900) / 5, 9);
  });
  it('summaries group by category with best/last/average', () => {
    const s = summarize(h);
    const std = s.find((x) => x.key === key)!;
    expect(std).toMatchObject({ runs: 3, best: 600, last: 500 });
    expect(std.average).toBeCloseTo(500, 9);
    expect(s).toHaveLength(3);
  });
  it('recentScores is oldest-first and capped', () => {
    expect(recentScores(h, key)).toEqual([400, 600, 500]);
    expect(recentScores(Array.from({ length: 30 }, (_, i) => run({ score: i })), key, 5)).toEqual([25, 26, 27, 28, 29]);
  });
});

describe('daily challenge', () => {
  it('is a pure function of the date: same date, same challenge; different dates differ somewhere', () => {
    expect(dailyFor('2026-11-05')).toEqual(dailyFor('2026-11-05'));
    const days = Array.from({ length: 30 }, (_, i) => dailyFor(`2026-11-${String(i + 1).padStart(2, '0')}`));
    expect(new Set(days.map((d) => d.seed)).size).toBeGreaterThan(25);
    expect(new Set(days.map((d) => d.scenario)).size).toBeGreaterThan(1);
  });
  it('always yields a known scenario, a valid difficulty and an allowed length', () => {
    for (let i = 1; i <= 28; i++) {
      const d = dailyFor(`2027-02-${String(i).padStart(2, '0')}`);
      expect(SCENARIOS.some((s) => s.id === d.scenario && s.daily)).toBe(true);
      expect(DIFFICULTIES).toContain(d.difficulty);
      expect([30, 60]).toContain(d.seconds);
      expect(d.seed).toBeGreaterThanOrEqual(0);
      expect(d.seed).toBeLessThanOrEqual(4294967295);
    }
  });
  it('uses the LOCAL calendar date and validates date strings', () => {
    expect(localDateString(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localDateString(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
    expect(isDateString('2026-02-30')).toBe(false);
    expect(isDateString('2026-2-3')).toBe(false);
    expect(isDateString('2026-11-05')).toBe(true);
    expect(hashString('a')).not.toBe(hashString('b'));
  });
});

describe('challenge links', () => {
  const c = { scenario: 'grid', difficulty: 'hard' as const, seconds: 30, seed: 123456789 };
  it('round-trips', () => {
    expect(decodeChallenge(encodeChallenge(c))).toEqual(c);
    expect(decodeChallenge(encodeChallenge({ ...c, seed: 4294967295 }))!.seed).toBe(4294967295);
    expect(decodeChallenge(encodeChallenge({ ...c, seed: 0 }))!.seed).toBe(0);
  });
  it.each([
    null, '', 'x', 'grid.hard.30', 'grid.hard.30.1.2', 'nope.hard.30.5', 'grid.brutal.30.5', 'grid.hard.45.5', 'grid.hard.30.4294967296',
    'grid.hard.30.-1', 'grid.hard.30.1e3', 'grid.hard.030x.5', '<script>.hard.30.5', 'grid.hard.30.' + '9'.repeat(40),
  ])('rejects malformed %s', (raw) => {
    expect(decodeChallenge(raw as string | null)).toBeNull();
  });
  it('builds a URL that carries only the challenge (no score, no other params)', () => {
    const u = new URL(challengeUrl('https://example.test/play/?x=1#h', c));
    expect([...u.searchParams.keys()]).toEqual(['c']);
    expect(u.hash).toBe('');
    expect(decodeChallenge(u.searchParams.get('c'))).toEqual(c);
  });
});

describe('scenario difficulty is monotonic (harder is genuinely smaller/faster)', () => {
  it('precision', () => {
    const [e, s, h] = DIFFICULTIES.map(precisionConfig) as [ReturnType<typeof precisionConfig>, ReturnType<typeof precisionConfig>, ReturnType<typeof precisionConfig>];
    expect(e.targetRadius).toBeGreaterThan(s.targetRadius);
    expect(s.targetRadius).toBeGreaterThan(h.targetRadius);
    expect(e.lifetime).toBeGreaterThan(s.lifetime);
    expect(s.lifetime).toBeGreaterThan(h.lifetime);
  });
  it('tracking', () => {
    const [e, s, h] = DIFFICULTIES.map(trackingConfig) as [ReturnType<typeof trackingConfig>, ReturnType<typeof trackingConfig>, ReturnType<typeof trackingConfig>];
    expect(e.radius).toBeGreaterThan(s.radius);
    expect(s.radius).toBeGreaterThan(h.radius);
    expect(e.speedMaxDeg).toBeLessThan(s.speedMaxDeg);
    expect(s.speedMaxDeg).toBeLessThan(h.speedMaxDeg);
  });
  it('grid', () => {
    const [e, s, h] = DIFFICULTIES.map(gridConfig) as [ReturnType<typeof gridConfig>, ReturnType<typeof gridConfig>, ReturnType<typeof gridConfig>];
    expect(e.radius).toBeGreaterThan(s.radius);
    expect(s.radius).toBeGreaterThan(h.radius);
  });
  it('every precision spawn at every difficulty stays inside the arena (200 seeds each)', () => {
    for (const d of DIFFICULTIES) {
      const cfg = precisionConfig(d);
      for (let seed = 1; seed <= 200; seed++) {
        const dr = new PrecisionDrill(seed, cfg);
        for (let i = 0; i < 300 && dr.targets.length === 0; i++) dr.step({ dt: DT, player: still, fireHeld: false });
        const t = dr.targets[0]!;
        expect(Math.hypot(t.x, t.z)).toBeLessThanOrEqual(cfg.maxRadiusFromOrigin + 1e-9);
        expect(t.r).toBe(cfg.targetRadius);
      }
    }
  });
  it('tracking stays on its arc at every difficulty', () => {
    for (const d of DIFFICULTIES) {
      const cfg = trackingConfig(d);
      const dr = new TrackingDrill(4, cfg);
      for (let i = 0; i < 120 * 30; i++) {
        dr.step({ dt: DT, player: still, fireHeld: false });
        const t = dr.targets[0]!;
        expect(Math.abs(Math.hypot(t.x, t.z) - cfg.arcRadius)).toBeLessThan(1e-9);
      }
    }
  });
});

describe('grid drill', () => {
  const aim = (t: { x: number; y: number; z: number }) => ({
    yaw: Math.atan2(-t.x, -t.z),
    pitch: Math.atan2(t.y - 1.6, Math.hypot(t.x, t.z)),
  });
  const fire = (d: GridDrill, a: { yaw: number; pitch: number }) => d.onFire({ ...a, x: 0, z: 0, speed: 0, dt: DT });
  const wait = (d: GridDrill, n: number) => {
    for (let i = 0; i < n; i++) d.step({ dt: DT, player: still, fireHeld: false });
  };

  it('always keeps exactly `count` targets, all on the wall, spaced apart', () => {
    const d = new GridDrill(5);
    for (let k = 0; k < 40; k++) {
      expect(d.targets).toHaveLength(GRID.count);
      for (const t of d.targets) {
        expect(t.z).toBe(GRID.wallZ);
        expect(Math.abs(t.x)).toBeLessThanOrEqual(GRID.halfWidth + 1e-9);
        expect(t.y).toBeGreaterThanOrEqual(GRID.yMin - 1e-9);
        expect(t.y).toBeLessThanOrEqual(GRID.yMax + 1e-9);
      }
      wait(d, 10);
      fire(d, aim(d.targets[0]!));
    }
    expect(d.result().hits).toBe(40);
  });

  it('a hit replaces the target (new id, count unchanged); a miss changes nothing but accuracy and score', () => {
    const d = new GridDrill(2);
    const ids = d.targets.map((t) => t.id);
    wait(d, 12);
    fire(d, { yaw: 1.5, pitch: 0 });
    expect(d.targets.map((t) => t.id)).toEqual(ids);
    expect(d.result()).toMatchObject({ shots: 1, hits: 0, misses: 1, score: 0 });
    wait(d, 12);
    const first = d.targets[0]!;
    fire(d, aim(first));
    expect(d.targets).toHaveLength(GRID.count);
    expect(d.targets.some((t) => t.id === first.id)).toBe(false);
    expect(d.result().hits).toBe(1);
  });

  it('scoring is hand-computable: 100 + 50*(1 - interval/0.8) per kill, -25 per miss', () => {
    const d = new GridDrill(3);
    wait(d, 23); // shot time = 24 steps = 0.2 s after start
    fire(d, aim(d.targets[0]!));
    const r = d.result();
    expect(r.score).toBe(Math.round(100 + 50 * (1 - 0.2 / 0.8)));
    expect(r.bestStreak).toBe(1);
    expect(r.medianKillInterval).toBeCloseTo(24 * DT, 9);
  });

  it('streak resets on a miss; best streak is remembered; rushed clicks are ignored and counted', () => {
    const d = new GridDrill(4);
    for (let k = 0; k < 3; k++) {
      wait(d, 10);
      fire(d, aim(d.targets[0]!));
    }
    wait(d, 10);
    fire(d, { yaw: 2, pitch: 0 });
    wait(d, 10);
    fire(d, aim(d.targets[0]!));
    d.onFire({ ...aim(d.targets[0]!), x: 0, z: 0, speed: 0, dt: DT }); // same instant: too soon
    const r = d.result();
    expect(r.bestStreak).toBe(3);
    expect(r.rushedBlocked).toBe(1);
    expect(r.hits).toBe(4);
  });

  it('no shots: accuracy null, nothing NaN', () => {
    const r = new GridDrill(1).result();
    expect(r.accuracy).toBeNull();
    expect(r.killsPerSecond).toBeNull();
    expect(r.medianKillInterval).toBeNull();
    wait(new GridDrill(1), 5);
  });

  it('is reproducible from the seed', () => {
    const pos = (s: number) => new GridDrill(s).targets.map((t) => `${t.x.toFixed(5)},${t.y.toFixed(5)}`).join('|');
    expect(pos(9)).toBe(pos(9));
    expect(pos(9)).not.toBe(pos(10));
  });

  it('kills-per-slice adds up to hits', () => {
    const d = new GridDrill(6);
    for (let k = 0; k < 30; k++) {
      wait(d, 60);
      fire(d, aim(d.targets[0]!));
    }
    const r = d.result();
    expect(r.killsPerSlice.reduce((a, b) => a + b, 0)).toBe(r.hits);
  });
});

describe('session length', () => {
  it('can be changed only while Ready and takes effect', () => {
    const m = new SessionMachine({ countdownSeconds: 3, runSeconds: 60 });
    expect(m.setRunSeconds(30)).toBe(true);
    expect(m.snapshot.runDuration).toBe(30);
    m.requestLock();
    m.lockAcquired();
    expect(m.setRunSeconds(90)).toBe(false);
    expect(m.snapshot.runDuration).toBe(30);
    for (let i = 0; i < 360; i++) m.tick(1 / 120);
    for (let i = 0; i < 3600; i++) m.tick(1 / 120);
    expect(m.state).toBe('completed');
    m.restart();
    expect(m.snapshot.runDuration).toBe(30); // the chosen length survives restart
  });
  it('rejects nonsense lengths', () => {
    const m = new SessionMachine();
    for (const bad of [0, -5, NaN, Infinity, 99999]) expect(m.setRunSeconds(bad)).toBe(false);
    expect(m.snapshot.runDuration).toBe(60);
  });
});

describe('crosshair', () => {
  it('parses defensively and keeps defaults for bad fields', () => {
    expect(parseCrosshair(null)).toEqual(DEFAULT_CROSSHAIR);
    const c = parseCrosshair({ style: 'laser', size: 500, thickness: -1, gap: 'x', color: 'red', outline: 'yes', opacity: 0 });
    expect(c).toEqual(DEFAULT_CROSSHAIR);
    expect(parseCrosshair({ color: '#FF00AA', style: 'dot', opacity: 0.5 })).toMatchObject({ color: '#ff00aa', style: 'dot', opacity: 0.5 });
  });
  it('rejects colours that could carry markup', () => {
    for (const bad of ['#fff', '#gggggg', '"><script>', 'url(x)', '#ffffff"onload=1']) {
      expect(parseCrosshair({ color: bad }).color).toBe(DEFAULT_CROSSHAIR.color);
    }
  });
  it('produces well-formed SVG for every style, with no unexpected tags', () => {
    for (const style of ['cross', 'dot', 'circle', 'cross-dot'] as const) {
      const svg = crosshairSvg({ ...DEFAULT_CROSSHAIR, style });
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
      const tags = [...svg.matchAll(/<([a-z]+)/g)].map((m) => m[1]);
      expect(tags.every((t) => ['svg', 'g', 'rect', 'circle'].includes(t!))).toBe(true);
      expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    }
    expect(crosshairSvg({ ...DEFAULT_CROSSHAIR, outline: false })).not.toContain('#07110f');
    expect(crosshairSvg(DEFAULT_CROSSHAIR)).toContain('#07110f');
  });
  it('contrast maths: black on white is 21:1, same colour is 1:1', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#336699', '#336699')).toBeCloseTo(1, 9);
    expect(luminance('#ffffff')).toBeCloseTo(1, 9);
  });
  it('warns about a low-contrast, outline-less crosshair but not about the default', () => {
    expect(visibilityWarning(DEFAULT_CROSSHAIR)).toBeNull();
    expect(visibilityWarning({ ...DEFAULT_CROSSHAIR, color: '#10403e', outline: false })).toMatch(/close to the arena/);
    expect(visibilityWarning({ ...DEFAULT_CROSSHAIR, outline: false, opacity: 0.3 })).toMatch(/opacity/);
  });
  it('settings round-trip keeps the crosshair', () => {
    const s = parseSettings({ crosshair: { style: 'circle', color: '#00ff88' } });
    expect(s.crosshair.style).toBe('circle');
    expect(parseSettings({}).crosshair).toEqual(DEFAULT_SETTINGS.crosshair);
  });
});
