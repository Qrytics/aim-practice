/** Stats dialog content: built with DOM calls (textContent only). */

import { dailyFor, localDateString } from '../core/daily';
import { summarize, type RunRecord } from '../core/history';
import { scenarioById } from '../core/scenarios';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of children) e.append(c);
  return e;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function renderStats(history: readonly RunRecord[], today: Date): HTMLElement {
  const root = el('div', { class: 'stats-view' });
  if (history.length === 0) {
    root.append(el('p', {}, 'No runs saved yet. Finish a session and your score, accuracy and personal best appear here.'));
    root.append(el('p', { class: 'hint' }, 'Only run summaries are stored, in this browser. Nothing is uploaded.'));
    return root;
  }

  const dailies = new Set(history.filter((r) => r.daily).map((r) => r.daily));
  const todayStr = localDateString(today);
  const daily = dailyFor(todayStr);
  const dailyName = scenarioById(daily.scenario)?.name ?? daily.scenario;
  root.append(
    el(
      'p',
      {},
      `${history.length} runs saved. Daily challenges played: ${dailies.size}. `,
      dailies.has(todayStr) ? `Today's (${dailyName}, ${daily.difficulty}, ${daily.seconds} s) is done.` : `Today's is ${dailyName}, ${daily.difficulty}, ${daily.seconds} s.`,
    ),
  );

  root.append(el('h3', {}, 'By mode'));
  const rows = summarize(history).map((c) =>
    el(
      'tr',
      {},
      el('th', { scope: 'row' }, scenarioById(c.scenario)?.name ?? c.scenario),
      el('td', {}, cap(c.difficulty)),
      el('td', {}, `${c.seconds} s`),
      el('td', { class: 'num' }, String(c.runs)),
      el('td', { class: 'num' }, String(c.best)),
      el('td', { class: 'num' }, String(c.last)),
      el('td', { class: 'num' }, String(Math.round(c.average))),
    ),
  );
  root.append(
    el(
      'table',
      { class: 'stat-table' },
      el('caption', { class: 'sr-only' }, 'Scores by mode, difficulty and length'),
      el('thead', {}, el('tr', {}, ...['Mode', 'Difficulty', 'Length', 'Runs', 'Best', 'Last', 'Average'].map((h) => el('th', { scope: 'col' }, h)))),
      el('tbody', {}, ...rows),
    ),
  );
  root.append(el('p', { class: 'hint' }, 'Scores are only comparable within the same mode, difficulty and length. They are not rankings.'));

  root.append(el('h3', {}, 'Recent runs'));
  const recent = [...history].slice(-10).reverse().map((r) =>
    el(
      'tr',
      {},
      el('td', {}, new Date(r.at).toLocaleString()),
      el('td', {}, `${scenarioById(r.scenario)?.name ?? r.scenario} · ${cap(r.difficulty)} · ${r.seconds} s${r.daily ? ' · daily' : ''}`),
      el('td', { class: 'num' }, String(r.score)),
      el('td', {}, r.detail),
    ),
  );
  root.append(
    el(
      'table',
      { class: 'stat-table' },
      el('caption', { class: 'sr-only' }, 'Your ten most recent runs'),
      el('thead', {}, el('tr', {}, ...['When', 'Run', 'Score', 'Detail'].map((h) => el('th', { scope: 'col' }, h)))),
      el('tbody', {}, ...recent),
    ),
  );
  return root;
}
