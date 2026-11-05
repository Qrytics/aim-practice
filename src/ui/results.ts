/**
 * Builds the results view with DOM calls (textContent only, never innerHTML).
 * Each profile gets its own "ruler" visual of the quantity it measures:
 *   precision -> time-to-hit scale, one mark per shot
 *   tracking  -> on-target timeline across the run
 * Every graphic has a text alternative.
 */

import type { Feedback } from '../core/feedback';
import type { GridResult } from '../core/drills/grid';
import type { PrecisionResult } from '../core/drills/precision';
import type { TrackingResult } from '../core/drills/tracking';

type Child = Node | string;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of children) e.append(c);
  return e;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...children: Child[]): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  for (const c of children) e.append(c);
  return e;
}

const pct = (v: number | null) => (v === null ? 'n/a' : `${Math.round(v * 100)}%`);
const sec = (v: number | null, d = 2) => (v === null ? 'n/a' : `${v.toFixed(d)} s`);

function stat(label: string, value: string, note?: string): HTMLElement {
  const d = el('div', { class: 'stat' }, el('dt', {}, label), el('dd', { class: 'mono' }, value));
  if (note) d.append(el('dd', { class: 'stat-note' }, note));
  return d;
}

/** Headline first (so the verdict leads), the supporting detail after the numbers and graphic. */
function headline(fb: Feedback): HTMLElement {
  return el('p', { class: 'headline' }, fb.headline);
}

function feedbackDetail(fb: Feedback): HTMLElement {
  const box = el('div', { class: 'feedback' });
  if (fb.findings.length) {
    box.append(el('h3', {}, 'What the numbers show'));
    box.append(el('ul', {}, ...fb.findings.map((f) => el('li', {}, f))));
  }
  if (fb.tryNext.length) {
    box.append(el('h3', {}, 'Try next'));
    box.append(el('ul', {}, ...fb.tryNext.map((f) => el('li', {}, f))));
  }
  return box;
}

function footer(seed: number, stallCount: number, stalledSeconds: number, profileNote: string): HTMLElement {
  const notes: string[] = [profileNote, `Run seed ${seed} (the same seed gives the same target pattern).`];
  if (stallCount > 0) notes.push(`${stallCount} page stall${stallCount === 1 ? '' : 's'} (${stalledSeconds.toFixed(1)} s) paused the run and was not counted as drill time.`);
  notes.push('One session is a small sample: compare trends across several runs, not single scores.');
  return el('div', { class: 'result-notes' }, ...notes.map((n) => el('p', {}, n)));
}

// ------------------------------------------------------------------ precision

function precisionRuler(r: PrecisionResult): SVGSVGElement {
  const X0 = 28;
  const X1 = 612;
  const MAX = r.lifetime;
  const x = (t: number) => X0 + (Math.min(MAX, Math.max(0, t)) / MAX) * (X1 - X0);
  const hits = r.outcomes.filter((o) => o.kind === 'hit');
  const movingHits = hits.filter((o) => o.kind === 'hit' && o.moving).length;
  const misses = r.outcomes.filter((o) => o.kind === 'miss' && o.age !== null).length;
  const label = `Time to hit for each shot on a scale from 0 to ${MAX} seconds. ${hits.length} hits (${movingHits} while moving), ${misses} misses, ${r.expired} timed out.`;
  const s = svg('svg', { viewBox: '0 0 640 112', class: 'ruler', role: 'img', 'aria-label': label });

  s.append(svg('line', { x1: X0, x2: X1, y1: 62, y2: 62, class: 'axis' }));
  for (let t = 0; t <= MAX + 1e-9; t += 0.5) {
    s.append(svg('line', { x1: x(t), x2: x(t), y1: 58, y2: 66, class: 'axis' }));
    s.append(svg('text', { x: x(t), y: 82, class: 'tick', 'text-anchor': 'middle' }, `${t.toFixed(1)} s`));
  }
  s.append(svg('line', { x1: x(r.quickWindow), x2: x(r.quickWindow), y1: 10, y2: 62, class: 'marker' }));
  s.append(svg('text', { x: x(r.quickWindow) + 4, y: 14, class: 'tick' }, 'speed bonus ends'));

  hits.forEach((o, i) => {
    if (o.kind !== 'hit') return;
    s.append(svg('circle', { cx: x(o.timeToHit), cy: 28 + (i % 3) * 10, r: 5, class: o.moving ? 'hit moving' : 'hit' }));
  });
  r.outcomes.forEach((o) => {
    if (o.kind === 'miss' && o.age !== null) {
      const cx = x(o.age);
      s.append(svg('path', { d: `M${cx - 4} 92 L${cx + 4} 100 M${cx + 4} 92 L${cx - 4} 100`, class: 'miss' }));
    }
  });
  return s;
}

function shotTable(r: PrecisionResult): HTMLElement {
  const rows = r.outcomes.map((o, i) => {
    const kind = o.kind === 'hit' ? 'Hit' : o.kind === 'miss' ? 'Miss' : 'Timed out';
    const when = `${o.t.toFixed(1)} s`;
    const tth = o.kind === 'hit' ? sec(o.timeToHit) : o.kind === 'miss' ? (o.age === null ? 'no target' : `${o.age.toFixed(2)} s after spawn`) : 'n/a';
    const mv = o.kind === 'expire' ? '' : o.moving ? 'moving' : 'standing';
    return el('tr', {}, el('td', {}, String(i + 1)), el('td', {}, when), el('td', {}, kind), el('td', {}, tth), el('td', {}, mv));
  });
  return el(
    'details',
    { class: 'shot-log' },
    el('summary', {}, 'Shot by shot'),
    el(
      'table',
      {},
      el('thead', {}, el('tr', {}, ...['#', 'Run time', 'Outcome', 'Time', 'Movement'].map((h) => el('th', { scope: 'col' }, h)))),
      el('tbody', {}, ...rows),
    ),
  );
}

export interface ProgressInfo {
  line: string;
  newBest: boolean;
  trend: number[];
}

function progressBlock(p: ProgressInfo | undefined): HTMLElement | null {
  if (!p) return null;
  const box = el('div', { class: p.newBest ? 'progress best' : 'progress' });
  box.append(el('p', {}, p.newBest ? el('strong', {}, 'New personal best. ') : '', p.line.replace(/^New personal best: /, '')));
  if (p.trend.length >= 2) box.append(sparkline(p.trend));
  return box;
}

function sparkline(values: number[]): SVGSVGElement {
  const W = 220;
  const H = 36;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const x = (i: number) => 4 + (i / (values.length - 1)) * (W - 8);
  const y = (v: number) => H - 5 - ((v - lo) / span) * (H - 10);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'spark', role: 'img', 'aria-label': `Your last ${values.length} scores here, oldest to newest: ${values.join(', ')}.` });
  s.append(svg('path', { d, class: 'spark-line' }));
  const last = values.length - 1;
  s.append(svg('circle', { cx: x(last), cy: y(values[last]!), r: 3.5, class: 'spark-dot' }));
  return s;
}

export function renderPrecisionResults(r: PrecisionResult, fb: Feedback, stall: { count: number; seconds: number }, progress?: ProgressInfo): HTMLElement {
  const root = el('div', { class: 'results precision' });
  root.append(headline(fb));
  const pb0 = progressBlock(progress);
  if (pb0) root.append(pb0);
  root.append(
    el(
      'dl',
      { class: 'stats' },
      stat('Score', String(r.score), 'original formula'),
      stat('Accuracy', pct(r.accuracy), `${r.hits} of ${r.shots} shots`),
      stat('Median time to hit', sec(r.medianTimeToHit), r.bestTimeToHit === null ? undefined : `best ${sec(r.bestTimeToHit)}`),
      stat('Standing accuracy', pct(r.settledAccuracy), `${r.settledShots} shots`),
      stat('Moving accuracy', pct(r.movingAccuracy), `${r.movingShots} shots`),
      stat('Timed out', String(r.expired), `${r.targetsSpawned} targets appeared`),
    ),
  );
  root.append(el('h3', {}, 'Time to hit, shot by shot'));
  root.append(precisionRuler(r));
  root.append(
    el(
      'ul',
      { class: 'legend' },
      el('li', {}, el('span', { class: 'swatch hit' }), 'hit while standing'),
      el('li', {}, el('span', { class: 'swatch hit moving' }), 'hit while moving'),
      el('li', {}, el('span', { class: 'swatch miss' }), 'miss, placed at the target’s age'),
    ),
  );
  root.append(feedbackDetail(fb));
  if (r.outcomes.length) root.append(shotTable(r));
  root.append(footer(r.seed, stall.count, stall.seconds, 'Valorant-inspired practice profile: an original drill, not a replica of any game.'));
  return root;
}

// ------------------------------------------------------------------- tracking

function trackingTimeline(r: TrackingResult): SVGSVGElement {
  const X0 = 28;
  const X1 = 612;
  const BASE = 82;
  const H = 56;
  const total = Math.max(1, r.activeSeconds);
  const n = r.timeline.firing.length;
  const bw = (X1 - X0) / Math.max(1, Math.ceil(total / r.timeline.bucketSeconds));
  const label = `Timeline of the ${Math.round(total)} second run. You fired for ${r.firingSeconds.toFixed(1)} seconds, ${r.onTargetFiringSeconds.toFixed(1)} of them on target.`;
  const s = svg('svg', { viewBox: '0 0 640 120', class: 'ruler', role: 'img', 'aria-label': label });
  s.append(svg('line', { x1: X0, x2: X1, y1: BASE, y2: BASE, class: 'axis' }));
  for (let t = 0; t <= total + 1e-9; t += 10) {
    const px = X0 + (t / total) * (X1 - X0);
    s.append(svg('line', { x1: px, x2: px, y1: BASE, y2: BASE + 6, class: 'axis' }));
    s.append(svg('text', { x: px, y: BASE + 20, class: 'tick', 'text-anchor': 'middle' }, `${t} s`));
  }
  for (let i = 0; i < n; i++) {
    const f = r.timeline.firing[i]! / r.timeline.bucketSeconds;
    const o = r.timeline.onTarget[i]! / r.timeline.bucketSeconds;
    if (f <= 0) continue;
    const px = X0 + i * bw;
    const hf = Math.min(1, f) * H;
    s.append(svg('rect', { x: px, y: BASE - hf, width: Math.max(1, bw - 0.4), height: hf, class: 'tl-firing' }));
    const ho = Math.min(1, o) * H;
    if (ho > 0) s.append(svg('rect', { x: px, y: BASE - ho, width: Math.max(1, bw - 0.4), height: ho, class: 'tl-on' }));
  }
  return s;
}

export function renderTrackingResults(r: TrackingResult, fb: Feedback, stall: { count: number; seconds: number }, progress?: ProgressInfo): HTMLElement {
  const root = el('div', { class: 'results tracking' });
  root.append(headline(fb));
  const pb1 = progressBlock(progress);
  if (pb1) root.append(pb1);
  root.append(
    el(
      'dl',
      { class: 'stats' },
      stat('On target / firing', pct(r.ratioFiring), r.ratioFiring === null ? 'you did not fire' : `${sec(r.onTargetFiringSeconds, 1)} of ${sec(r.firingSeconds, 1)}`),
      stat('On target / whole run', pct(r.ratioActive), `of ${Math.round(r.activeSeconds)} s`),
      stat('Time firing', sec(r.firingSeconds, 1)),
      stat('Longest stretch on target', sec(r.longestOnStreakSeconds, 1)),
      stat('Held through changes', `${r.heldThrough} of ${r.directionChanges}`),
      stat('Median re-acquire', sec(r.medianReacquireSeconds), r.unrecovered ? `${r.unrecovered} not recovered` : undefined),
      stat('Score', String(r.score), 'original formula'),
    ),
  );
  root.append(el('h3', {}, 'On target over the run'));
  root.append(trackingTimeline(r));
  root.append(
    el(
      'ul',
      { class: 'legend' },
      el('li', {}, el('span', { class: 'swatch tl-firing' }), 'time spent firing'),
      el('li', {}, el('span', { class: 'swatch tl-on' }), 'of that, on target'),
    ),
  );
  root.append(feedbackDetail(fb));
  root.append(footer(r.seed, stall.count, stall.seconds, 'Overwatch-inspired practice profile: an original drill, not a replica of any game and not a hero or weapon profile.'));
  return root;
}

// ----------------------------------------------------------------------- grid

function gridTimeline(r: GridResult): SVGSVGElement {
  const X0 = 28;
  const X1 = 612;
  const BASE = 82;
  const H = 54;
  const n = r.killsPerSlice.length;
  const max = Math.max(1, ...r.killsPerSlice);
  const bw = (X1 - X0) / Math.max(1, n);
  const label = `Kills in each ${r.sliceSeconds} second slice of the run: ${r.killsPerSlice.join(', ')}.`;
  const s = svg('svg', { viewBox: '0 0 640 120', class: 'ruler', role: 'img', 'aria-label': label });
  s.append(svg('line', { x1: X0, x2: X1, y1: BASE, y2: BASE, class: 'axis' }));
  r.killsPerSlice.forEach((k, i) => {
    const h = (k / max) * H;
    const px = X0 + i * bw;
    s.append(svg('rect', { x: px + 2, y: BASE - h, width: Math.max(2, bw - 4), height: h, class: 'tl-on' }));
    s.append(svg('text', { x: px + bw / 2, y: BASE + 16, class: 'tick', 'text-anchor': 'middle' }, `${i * r.sliceSeconds}s`));
    if (k > 0) s.append(svg('text', { x: px + bw / 2, y: BASE - h - 4, class: 'tick', 'text-anchor': 'middle' }, String(k)));
  });
  return s;
}

export function renderGridResults(r: GridResult, fb: Feedback, stall: { count: number; seconds: number }, progress?: ProgressInfo): HTMLElement {
  const root = el('div', { class: 'results grid' });
  root.append(headline(fb));
  const pb = progressBlock(progress);
  if (pb) root.append(pb);
  root.append(
    el(
      'dl',
      { class: 'stats' },
      stat('Score', String(r.score), 'original formula'),
      stat('Accuracy', pct(r.accuracy), `${r.hits} of ${r.shots} shots`),
      stat('Kills per second', r.killsPerSecond === null ? 'n/a' : r.killsPerSecond.toFixed(2)),
      stat('Median between kills', sec(r.medianKillInterval)),
      stat('Best streak', String(r.bestStreak), 'hits without a miss'),
    ),
  );
  root.append(el('h3', {}, 'Kills over the run'));
  root.append(gridTimeline(r));
  root.append(feedbackDetail(fb));
  root.append(footer(r.seed, stall.count, stall.seconds, 'Grid is an original speed-and-accuracy drill, not a replica of any game.'));
  return root;
}
