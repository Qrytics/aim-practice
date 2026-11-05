/**
 * Wiring only: connects the DOM input adapter, the pure core (session state
 * machine + fixed-step simulation), the three.js renderer and the DOM UI.
 * Game rules live in src/core and are unit tested there.
 */

import '@fontsource-variable/schibsted-grotesk/index.css';
import '@fontsource-variable/martian-mono/wdth.css';
import './ui/styles.css';

import { FrameStats } from './core/frameStats';
import { verticalFovFromSetting, actualHorizontalFov } from './core/fov';
import { createPlayer } from './core/movement';
import { SessionMachine, type SessionSnapshot } from './core/session';
import { DEFAULT_SETTINGS, parseSettings, type Settings } from './core/settings';
import { Simulation } from './core/simulation';
import { sessionStepClock } from './core/stepClock';
import { DEFAULT_MOVEMENT } from './core/movement';
import { BrowserInput } from './input/browserInput';
import { ArenaRenderer, PLAY_HALF_EXTENT, webgl2Available } from './render/arena';
import { SettingsPanel, type ArenaShape } from './ui/settingsPanel';
import { Sfx } from './audio/sfx';
import type { Drill, ProfileId } from './core/drill';
import { GridDrill } from './core/drills/grid';
import { PrecisionDrill } from './core/drills/precision';
import { TrackingDrill } from './core/drills/tracking';
import { gridFeedback, precisionFeedback, progressLine, trackingFeedback } from './core/feedback';
import { randomSeed } from './core/rng';
import { PROFILE_DISCLAIMER } from './ui/profiles';
import { renderGridResults, renderPrecisionResults, renderTrackingResults, type ProgressInfo } from './ui/results';
import type { DrillResult } from './core/drill';
import { dailyFor, localDateString } from './core/daily';
import { addRun, categoryOf, compare, parseHistory, recentScores, type RunRecord } from './core/history';
import { recordFromResult } from './core/records';
import { gridConfig, isDifficulty, isDuration, precisionConfig, scenarioById, trackingConfig, type Difficulty } from './core/scenarios';
import { challengeUrl, decodeChallenge } from './core/share';
import { CrosshairPanel, drawCrosshair } from './ui/crosshairPanel';
import { renderStats } from './ui/stats';

const STORAGE_KEY = 'aim-practice.settings.v1';
const PROFILE_KEY = 'aim-practice.profile.v1';
const PREFS_KEY = 'aim-practice.prefs.v1';
const HISTORY_KEY = 'aim-practice.history.v1';
const SOUND_KEY = 'aim-practice.sound.v1';

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: kept for this page view only */
  }
}

/** Optional ?seed=<integer> makes the target pattern reproducible (practice and bug reports). */
function seedFromUrl(): number | null {
  const v = new URLSearchParams(location.search).get('seed');
  if (v === null || !/^\d{1,10}$/.test(v)) return null;
  const n = Number(v);
  return n <= 4294967295 ? n : null;
}

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parseSettings(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS; // storage blocked or corrupt: defaults, page still works
  }
}

function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); // settings only, never mouse input
  } catch {
    /* storage unavailable: settings last for this page view only */
  }
}

// ---------------------------------------------------------------- fallback

function capabilityProblem(): { reason: string; need: string } | null {
  const probe = document.createElement('canvas');
  if (!('requestPointerLock' in probe) || !('exitPointerLock' in document)) {
    return {
      reason: 'This browser does not support the Pointer Lock API, which mouse-look aiming requires.',
      need: 'Use a current desktop version of Chrome, Edge, Firefox or Safari with a mouse and keyboard.',
    };
  }
  if (!webgl2Available()) {
    return {
      reason: 'WebGL 2 could not be started in this browser, so the 3D arena cannot be drawn.',
      need: 'Turn on hardware acceleration in the browser settings, update your graphics driver or browser, or try another desktop browser. Software rendering also works but may be slow.',
    };
  }
  return null;
}

function showFallback(reason: string, need: string): void {
  document.body.dataset.state = 'error';
  // Settings and diagnostics are bound to the arena; without it they would be blank, dead controls.
  document.body.dataset.unavailable = 'true';
  $('settings').hidden = true;
  $('r-state').textContent = 'Unavailable';
  $('fb-reason').textContent = reason;
  $('fb-need').textContent = need;
  $('fallback').hidden = false;
  $('arena').hidden = true;
  $('crosshair').hidden = true;
  $('fb-retry').addEventListener('click', () => location.reload());
  $<HTMLButtonElement>('fb-retry').focus({ preventScroll: true });
}

// -------------------------------------------------------------------- boot

function boot(): void {
  const problem = capabilityProblem();
  if (problem) {
    showFallback(problem.reason, problem.need);
    return;
  }

  const canvas = $<HTMLCanvasElement>('arena');
  const stage = $('stage');
  const settings = loadSettings();

  let renderer: ArenaRenderer;
  try {
    renderer = new ArenaRenderer(canvas, stage, verticalFovFromSetting(settings.fovAt16x9));
  } catch (err) {
    showFallback(
      `The 3D renderer failed to start: ${err instanceof Error ? err.message : String(err)}`,
      'Turn on hardware acceleration, update your graphics driver or browser, or try another desktop browser.',
    );
    return;
  }

  // Dev server only: ?run=<s>&countdown=<s> shorten a session for testing. In production builds this
  // block is removed, so the public game is always the full-length session.
  let sessionCfg: { countdownSeconds: number; runSeconds: number } | undefined;
  if (import.meta.env.DEV) {
    const q = new URLSearchParams(location.search);
    const num = (k: string, lo: number, hi: number) => {
      const v = Number(q.get(k));
      return q.has(k) && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
    };
    const run = num('run', 1, 600);
    const cd = num('countdown', 0.05, 30);
    if (run !== null || cd !== null) sessionCfg = { countdownSeconds: cd ?? 3, runSeconds: run ?? 60 };
  }
  const session = new SessionMachine(sessionCfg);
  const frameStats = new FrameStats(240);
  const nowSec = () => performance.now() / 1000;

  const sim = new Simulation(nowSec(), 0, 0, 0.05, {
    stepHz: 120,
    maxFrameGap: 0.25,
    movement: DEFAULT_MOVEMENT,
    bounds: { minX: -PLAY_HALF_EXTENT, maxX: PLAY_HALF_EXTENT, minZ: -PLAY_HALF_EXTENT, maxZ: PLAY_HALF_EXTENT },
  });
  // The step loop asks this clock for each step's phase and advances the session itself.
  const stepClock = sessionStepClock(session);
  let lateInputs = 0;
  let lastStallSeconds = 0;

  // ---- profile, drill, sound
  const sfx = new Sfx();
  const soundPrefs = readJson(SOUND_KEY) as { muted?: unknown; volume?: unknown } | null;
  sfx.setMuted(soundPrefs?.muted === true);
  if (typeof soundPrefs?.volume === 'number') sfx.setVolume(soundPrefs.volume);

  // ---- scenario selection, drill, history
  const prefs = (readJson(PREFS_KEY) ?? {}) as { scenario?: unknown; difficulty?: unknown; seconds?: unknown };
  const storedScenario = typeof prefs.scenario === 'string' && scenarioById(prefs.scenario) ? prefs.scenario : (readJson(PROFILE_KEY) as string | null);
  let scenarioId: string = typeof storedScenario === 'string' && scenarioById(storedScenario) ? storedScenario : 'precision';
  let difficulty: Difficulty = isDifficulty(prefs.difficulty) ? prefs.difficulty : 'standard';
  let seconds: number = isDuration(prefs.seconds) ? prefs.seconds : 60;
  const hasSessionOverride = sessionCfg !== undefined; // dev-only ?run= override keeps its own length

  let profile: ProfileId = scenarioById(scenarioId)?.profile ?? 'precision';
  let drill: Drill | null = null;
  let finalResult: DrillResult | null = null;
  let history: RunRecord[] = parseHistory(readJson(HISTORY_KEY));
  let runInfo: { scenario: string; difficulty: Difficulty; seconds: number; seed: number; daily: string | null } | null = null;
  let pendingSeed: number | null = seedFromUrl();
  let pendingDaily: string | null = null;
  let saved: { record: RunRecord | null; progress: ProgressInfo | null } | null = null;

  const challenge = decodeChallenge(new URLSearchParams(location.search).get('c'));
  if (challenge) {
    scenarioId = challenge.scenario;
    difficulty = challenge.difficulty;
    seconds = challenge.seconds;
    pendingSeed = challenge.seed;
  }

  function persistPrefs(): void {
    writeJson(PREFS_KEY, { scenario: scenarioId, difficulty, seconds });
  }

  function applyScenario(id: string): void {
    const sc = scenarioById(id);
    if (!sc) return;
    scenarioId = id;
    profile = sc.profile;
    document.body.dataset.profile = profile;
    document.body.dataset.scenario = id;
    renderer.setProfile(profile);
    $('page-title').textContent = `${sc.name} drill`;
    $('r-primary-label').textContent = sc.kind === 'tracking' ? 'On target (last 1 s)' : 'Hits';
    $('r-primary').textContent = sc.kind === 'tracking' ? '–' : '0';
    for (const r of document.querySelectorAll<HTMLInputElement>('input[name="profile"]')) r.checked = r.value === id;
    persistPrefs();
  }

  function applyRunLength(): void {
    if (!hasSessionOverride) session.setRunSeconds(seconds);
  }

  /** A fresh drill for a new run. Called when leaving Ready. */
  function newDrill(): void {
    const seed = pendingSeed ?? randomSeed();
    const sc = scenarioById(scenarioId)!;
    runInfo = { scenario: scenarioId, difficulty, seconds: session.snapshot.runDuration, seed, daily: pendingDaily };
    switch (sc.kind) {
      case 'precision':
        drill = new PrecisionDrill(seed, precisionConfig(difficulty));
        break;
      case 'tracking':
        drill = new TrackingDrill(seed, trackingConfig(difficulty));
        break;
      case 'grid':
        drill = new GridDrill(seed, gridConfig(difficulty));
        break;
    }
    finalResult = null;
    saved = null;
    renderer.clearTargets();
  }

  function dropDrill(): void {
    drill = null;
    finalResult = null;
    saved = null;
    runInfo = null;
    pendingSeed = null; // a shared seed is used once; "Run again" gets a fresh pattern
    pendingDaily = null;
    renderer.clearTargets();
    applyHudDefaults();
  }

  sim.onFire = (e) => drill?.onFire(e);
  sim.onStep = (s) => {
    drill?.step({ dt: s.dt, player: s.player, fireHeld: s.fireHeld });
  };

  function applyHudDefaults(): void {
    $('r-primary').textContent = scenarioById(scenarioId)?.kind === 'tracking' ? '–' : '0';
    $('hud-score').textContent = '';
    $<HTMLElement>('hud-meter').hidden = true;
  }

  // ---- settings panel
  const panel = new SettingsPanel(settings, {
    onCommit: (s, resolved) => {
      sim.degreesPerUnit = resolved.degreesPerUnit;
      renderer.setVerticalFov(verticalFovFromSetting(s.fovAt16x9));
      saveSettings(s);
      lastHud.fov = ''; // force HUD refresh
    },
    onResetCounter: () => sim.resetCalibration(),
    onShape: (shape: ArenaShape) => {
      stage.dataset.shape = shape;
      renderer.resize();
    },
    getMeasuredTurnDeg: () => sim.calibrationTurnDeg,
  });
  sim.degreesPerUnit = panel.resolvedSensitivity.degreesPerUnit;

  const xhHost = $('crosshair');
  drawCrosshair(xhHost, settings.crosshair);
  new CrosshairPanel(settings.crosshair, (c) => {
    drawCrosshair(xhHost, c);
    saveSettings(panel.setCrosshair(c));
  });

  const muteBox = $<HTMLInputElement>('f-mute');
  const volBox = $<HTMLInputElement>('f-vol');
  muteBox.checked = sfx.muted;
  volBox.value = String(Math.round(sfx.volume * 100));
  const saveSound = () => writeJson(SOUND_KEY, { muted: sfx.muted, volume: sfx.volume });
  muteBox.addEventListener('change', () => {
    sfx.setMuted(muteBox.checked);
    saveSound();
  });
  volBox.addEventListener('input', () => {
    sfx.setVolume(Number(volBox.value) / 100);
    saveSound();
  });

  // ---- input
  const input = new BrowserInput(canvas, {
    onLook: (t, dx, dy) => {
      if (session.isActive) sim.push({ t, type: 'look', dx, dy });
    },
    onKey: (t, code, down) => {
      if (session.isActive || !down) sim.push({ t, type: 'key', code, down });
    },
    onFire: (t) => {
      if (session.isActive) sim.push({ t, type: 'fire' });
    },
    onTrigger: (t, down) => {
      // Releases are always forwarded so a held trigger can never stick.
      if (session.isActive || !down) sim.push({ t, type: 'trigger', down });
    },
    onLockAcquired: () => acquired(),
    onLockLost: () => {
      sim.clearInput();
      session.lockLost();
      syncUi();
    },
    onUnexpectedLock: () => {
      input.releaseLock(); // a lock nobody is waiting for must not linger
    },
    onLockDenied: (message) => {
      session.lockDenied(
        `${message} If you just pressed Esc, wait a second before trying again; browsers refuse an immediate re-lock.`,
      );
      syncUi();
    },
    onModeChange: (mode) => panel.setMovementMode(mode),
    onBlur: (reason) => {
      sim.clearInput(); // held keys must never survive losing focus
      if (session.isActive) {
        session.pause(reason);
        input.releaseLock();
        syncUi();
      }
    },
    onPauseKey: () => {
      if (session.isActive) {
        session.pause('user');
        sim.clearInput();
        input.releaseLock();
        syncUi();
      }
    },
    onRestartKey: () => restart(),
    onCanvasClick: () => {
      if (session.state === 'ready' || session.state === 'paused') startOrResume();
    },
  });

  /** The lock the user asked for is held (document.pointerLockElement is the canvas). */
  function acquired(): void {
    if (session.lockAcquired()) {
      sim.clearInput();
      sim.resync(nowSec());
      const a = document.activeElement;
      if (a instanceof HTMLElement && a !== document.body) a.blur();
    } else {
      input.releaseLock(); // the session is not waiting for a lock
    }
    syncUi();
  }

  function startOrResume(): void {
    const fromReady = session.state === 'ready';
    if (!session.requestLock()) {
      syncUi();
      return;
    }
    sfx.unlock(); // inside the user gesture, so the browser allows audio
    if (fromReady) {
      readPicker();
      newDrill();
    }
    sim.clearInput();
    syncUi();
    // Must run inside the user gesture: synchronous, nothing awaited before the browser call.
    const r = input.requestLock();
    if (r === 'ignored' && input.locked) acquired(); // already owned: no event will follow
  }

  /** Read the picker controls into state (only valid while Ready). */
  function readPicker(): void {
    const picked = document.querySelector<HTMLInputElement>('input[name="profile"]:checked')?.value;
    if (picked && scenarioById(picked) && picked !== scenarioId) applyScenario(picked);
    const d = $<HTMLSelectElement>('f-difficulty').value;
    if (isDifficulty(d)) difficulty = d;
    const n = Number($<HTMLSelectElement>('f-length').value);
    if (isDuration(n)) seconds = n;
    applyRunLength();
    persistPrefs();
  }

  /** Configure the picker for today's daily challenge and start it. */
  function startDaily(): void {
    if (session.state !== 'ready') return;
    const dc = dailyFor(localDateString(new Date()));
    applyScenario(dc.scenario);
    difficulty = dc.difficulty;
    seconds = dc.seconds;
    $<HTMLSelectElement>('f-difficulty').value = dc.difficulty;
    $<HTMLSelectElement>('f-length').value = String(dc.seconds);
    pendingSeed = dc.seed;
    pendingDaily = dc.date;
    applyRunLength();
    startOrResume();
  }

  function cancelLockRequest(): void {
    input.cancelLock();
    session.lockDenied('Cancelled before the browser answered.');
    syncUi();
  }

  function restart(): void {
    if (!session.restart()) return;
    input.cancelLock();
    sim.clearInput();
    dropDrill();
    Object.assign(sim.player, createPlayer(0, 0));
    input.releaseLock();
    syncUi();
  }

  renderer.onContextLost = () => {
    session.rendererLost();
    sim.clearInput();
    input.releaseLock();
    syncUi();
  };
  renderer.onContextRestored = () => {
    session.rendererRestored();
    syncUi();
  };

  // ---- overlay
  interface Action {
    label: string;
    primary?: boolean;
    disabled?: boolean;
    run: () => void;
  }

  const overlay = $('overlay');
  const ovTitle = $('ov-title');
  const ovBody = $('ov-body');
  const ovNotice = $('ov-notice');
  const ovActions = $('ov-actions');
  const ovResults = $('ov-results');
  const ovExtra = $('ov-extra');
  const ovCard = $('ov-card');
  const profilePick = $('profile-pick');
  const live = $('live');
  let overlayKey = '';

  function paragraphs(lines: string[]): void {
    ovBody.replaceChildren(
      ...lines.map((l) => {
        const p = document.createElement('p');
        p.textContent = l;
        return p;
      }),
    );
  }

  function setOverlay(
    title: string,
    lines: string[],
    notice: string | null,
    actions: Action[],
    focus: 'first-button' | 'heading' | 'profile' = 'first-button',
  ): void {
    const key = JSON.stringify([title, lines, notice, actions.map((a) => [a.label, a.disabled]), focus]);
    if (key === overlayKey) return;
    overlayKey = key;
    ovTitle.textContent = title;
    paragraphs(lines);
    ovResults.replaceChildren();
    ovCard.classList.remove('wide');
    profilePick.hidden = focus !== 'profile'; // visible before focus is attempted below
    $('pick-row').hidden = focus !== 'profile';
    $('daily-card').hidden = focus !== 'profile';
    if (focus !== 'profile') ovExtra.replaceChildren();
    ovNotice.hidden = !notice;
    ovNotice.textContent = notice ?? '';
    ovActions.replaceChildren(
      ...actions.map((a) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = a.primary ? 'btn' : 'btn ghost';
        b.textContent = a.label;
        b.disabled = !!a.disabled;
        b.addEventListener('click', a.run);
        return b;
      }),
    );
    // Never take focus from a control the user is already working in (settings, or the picker's own
    // selects when a change re-renders the Ready screen). Only move it when focus is elsewhere or was lost.
    const active = document.activeElement;
    const inSettings = active instanceof Node && $('settings').contains(active);
    const inStableControl = active instanceof HTMLElement && (active.id === 'f-length' || active.id === 'f-difficulty' || active.closest('#profile-pick') !== null);
    if (!inSettings && !(inStableControl && focus === 'profile')) {
      if (focus === 'profile') {
        ovTitle.removeAttribute('tabindex');
        const checked = document.querySelector<HTMLInputElement>('input[name="profile"]:checked');
        (checked ?? ovActions.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus({ preventScroll: true });
      } else if (focus === 'heading') {
        // Focus a non-interactive target so a repeated Enter/Space on the button that
        // started the request cannot activate Cancel. Cancel is the next Tab stop.
        ovTitle.tabIndex = -1;
        ovTitle.focus({ preventScroll: true });
      } else {
        ovTitle.removeAttribute('tabindex');
        ovActions.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
      }
    }
  }

  const PAUSE_TEXT: Record<NonNullable<SessionSnapshot['pauseReason']>, string> = {
    'lock-lost': 'The mouse was released (Esc, or the browser took it back).',
    'focus-lost': 'The window lost focus.',
    hidden: 'The tab was hidden.',
    stall: 'The page stalled.',
    'renderer-lost': 'The graphics context was lost.',
    user: 'You paused.',
  };

  const reload = () => location.reload();

  // Settings disclosure: open by default on wide screens, collapsed on narrow ones so the
  // arena, status and Start/Resume stay on the first screen. The user's own toggle is respected
  // after load; only a viewport-class change resets it.
  const disclosure = $<HTMLDetailsElement>('settings-details');
  const wide = window.matchMedia('(min-width: 1041px)');
  disclosure.open = wide.matches;
  wide.addEventListener('change', () => {
    disclosure.open = wide.matches;
  });
  function openSettings(): void {
    disclosure.open = true;
    disclosure.querySelector('summary')?.focus({ preventScroll: false });
    $('settings').scrollIntoView({ block: 'nearest' });
  }

  // ---- picker sync, daily card, stats, share
  function syncPicker(): void {
    for (const r of document.querySelectorAll<HTMLInputElement>('input[name="profile"]')) r.checked = r.value === scenarioId;
    $<HTMLSelectElement>('f-difficulty').value = difficulty;
    const len = $<HTMLSelectElement>('f-length');
    len.value = String(seconds);
    len.disabled = hasSessionOverride; // dev-only override fixes the length
    const dc = dailyFor(localDateString(new Date()));
    const dcs = scenarioById(dc.scenario)!;
    const done = history.some((r) => r.daily === dc.date);
    $('daily-text').textContent = `Today's challenge: ${dcs.name}, ${dc.difficulty}, ${dc.seconds} s${done ? ' (done)' : ''}. Same pattern for everyone today.`;
    $<HTMLButtonElement>('daily-btn').textContent = done ? 'Play it again' : "Play today's challenge";
    if (challenge && pendingSeed === challenge.seed) {
      ovExtra.replaceChildren(Object.assign(document.createElement('p'), { className: 'notice', textContent: 'You opened a shared challenge: same mode, difficulty, length and target pattern as the link. Scores are not verified; compare them yourselves.' }));
    }
  }

  function openStats(): void {
    $('stats-body').replaceChildren(renderStats(history, new Date()));
    const dlg = $<HTMLDialogElement>('stats-dialog');
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }

  async function copyChallengeLink(): Promise<void> {
    if (!runInfo) return;
    const url = challengeUrl(location.href, { scenario: runInfo.scenario, difficulty: runInfo.difficulty, seconds: runInfo.seconds, seed: runInfo.seed });
    const msg = document.getElementById('share-msg');
    try {
      await navigator.clipboard.writeText(url);
      if (msg) msg.textContent = 'Challenge link copied. It carries the mode, difficulty, length and target pattern, not your score.';
    } catch {
      if (!msg) return;
      msg.textContent = 'Copy this link:';
      const box = document.createElement('div');
      box.className = 'link-box';
      const inp = document.createElement('input');
      inp.readOnly = true;
      inp.value = url;
      inp.setAttribute('aria-label', 'Challenge link');
      box.append(inp);
      msg.after(box);
      inp.focus();
      inp.select();
    }
  }

  /** Save a finished run to local history and compute the comparison. Idempotent per run. */
  function saveFinishedRun(result: DrillResult): void {
    if (saved || !runInfo) return;
    const rec = recordFromResult(result, runInfo, new Date().toISOString());
    if (!rec) {
      saved = { record: null, progress: null };
      return;
    }
    const cmp = compare(history, rec);
    history = addRun(history, rec);
    writeJson(HISTORY_KEY, history);
    saved = {
      record: rec,
      progress: { line: progressLine(cmp, rec.score), newBest: cmp.newBest, trend: recentScores(history, categoryOf(rec)) },
    };
  }

  function syncUi(): void {
    const s = session.snapshot;
    document.body.dataset.state = s.state;
    const stateLabel: Record<string, string> = {
      ready: 'Ready',
      requestingLock: 'Waiting for mouse lock',
      countdown: 'Countdown',
      running: 'Running',
      paused: 'Paused',
      completed: 'Completed',
      error: 'Error',
    };
    $('r-state').textContent = stateLabel[s.state] ?? s.state;
    live.textContent = `State: ${stateLabel[s.state] ?? s.state}`;

    const showOverlay = s.state !== 'countdown' && s.state !== 'running';
    overlay.hidden = !showOverlay;
    $('countdown').hidden = s.state !== 'countdown';
    if (!showOverlay) {
      overlayKey = '';
      return;
    }

    const fine = window.matchMedia('(pointer: fine)').matches;
    switch (s.state) {
      case 'ready': {
        const sc = scenarioById(scenarioId)!;
        const sec = hasSessionOverride ? s.runDuration : seconds;
        setOverlay(
          'Choose a drill',
          [
            `${sc.blurb} ${sc.controls}`,
            `Starting locks your mouse to the arena, then a ${s.countdownSeconds} second countdown runs before the ${sec} second session. You can look around during the countdown but not move or fire.`,
            PROFILE_DISCLAIMER,
            ...(fine ? [] : ['No precise pointing device was detected. This game needs a desktop mouse and keyboard.']),
          ],
          s.lockNotice,
          [
            { label: s.lockNotice ? 'Try again' : 'Start', primary: true, run: startOrResume },
            { label: 'Review settings', run: openSettings },
          ],
          'profile',
        );
        syncPicker();
        break;
      }
      case 'requestingLock':
        setOverlay(
          'Waiting for the browser…',
          ['Your browser is deciding whether to lock the mouse to the arena. Press Tab to reach Cancel.'],
          null,
          [{ label: 'Cancel', primary: true, run: cancelLockRequest }],
          'heading',
        );
        break;
      case 'paused': {
        const r = s.pauseReason;
        const lines = [r ? PAUSE_TEXT[r] : 'Paused.', 'Your session time, score, position and view are exactly where you left them.'];
        if (r === 'stall') lines.push(`That ${lastStallSeconds.toFixed(1)} s gap was not counted as drill time.`);
        if (r === 'renderer-lost') {
          lines.push(
            s.rendererLost
              ? 'Waiting for the browser to restore the graphics context. If it does not recover, reload the page.'
              : 'The graphics context came back. You can resume, or reload to be safe.',
          );
        }
        setOverlay('Paused', lines, s.lockNotice, [
          { label: s.lockNotice ? 'Try again' : 'Resume', primary: true, disabled: s.rendererLost, run: startOrResume },
          { label: 'Restart', run: restart },
          ...(r === 'renderer-lost' ? [{ label: 'Reload page', run: reload }] : []),
          { label: 'Review settings', run: openSettings },
        ]);
        break;
      }
      case 'completed': {
        const stall = { count: s.stallCount, seconds: s.stalledSeconds };
        setOverlay('Session complete', [], null, [
          { label: 'Run again', primary: true, run: restart },
          { label: 'Copy challenge link', run: copyChallengeLink },
          { label: 'View stats', run: openStats },
        ]);
        ovCard.classList.add('wide');
        const result = finalResult ?? drill?.result() ?? null;
        if (!result) {
          paragraphs(['The session ended but no drill result was recorded.']);
          break;
        }
        const progress = saved?.progress ?? undefined;
        let node: HTMLElement;
        if (result.kind === 'precision') node = renderPrecisionResults(result, precisionFeedback(result), stall, progress);
        else if (result.kind === 'tracking') node = renderTrackingResults(result, trackingFeedback(result), stall, progress);
        else node = renderGridResults(result, gridFeedback(result), stall, progress);
        ovResults.replaceChildren(node);
        if (!saved?.record) {
          ovResults.append(Object.assign(document.createElement('p'), { className: 'hint', textContent: 'This run had no shots or firing, so it was not saved.' }));
        }
        const shareMsg = Object.assign(document.createElement('p'), { className: 'msg', id: 'share-msg' });
        shareMsg.setAttribute('role', 'status');
        ovResults.append(shareMsg);
        break;
      }
      case 'error':
        setOverlay('Something went wrong', [s.error?.message ?? 'Unknown error.'], null, [
          { label: 'Reload page', primary: true, run: reload },
        ]);
        break;
    }
  }

  // ---- HUD (touch the DOM only when a value changes)
  const lastHud = { time: '', count: '', turn: '', fov: '', primary: '' };
  const rTime = $('r-time');
  const hudTime = $('hud-time');
  const countdown = $('countdown');
  const rTurn = $('r-turn');
  const rFov = $('r-fov');
  const rPrimary = $('r-primary');
  const hudScore = $('hud-score');
  const meterEl = $('hud-meter');
  const meterFill = $('hud-meter-fill');
  const dRenderer = $('d-renderer');
  const dSoft = $('d-soft');
  const dDpr = $('d-dpr');
  const dBuffer = $('d-buffer');
  const dFrames = $('d-frames');
  let lastAspect = 0;
  let lastDiag = -1e9;

  function setText(el: HTMLElement, key: keyof typeof lastHud, value: string): void {
    if (lastHud[key] !== value) {
      lastHud[key] = value;
      el.textContent = value;
    }
  }

  function updateHud(): void {
    const s = session.snapshot;
    const left = Math.max(0, s.runDuration - s.runElapsed).toFixed(1);
    setText(rTime, 'time', left);
    if (hudTime.textContent !== left) hudTime.textContent = left;
    if (s.state === 'countdown') setText(countdown, 'count', String(Math.max(1, Math.ceil(s.countdownRemaining))));
    const turn = sim.calibrationTurnDeg;
    setText(rTurn, 'turn', `${turn >= 0 ? '+' : '\u2212'}${Math.abs(turn).toFixed(1)}\u00b0`);
    const aspect = renderer.aspect;
    if (aspect !== lastAspect) {
      lastAspect = aspect;
      panel.setAspect(aspect);
    }
    setText(rFov, 'fov', `${actualHorizontalFov(panel.current.fovAt16x9, aspect).toFixed(1)}\u00b0`);

    if (drill) {
      const h = drill.hud();
      setText(rPrimary, 'primary', h.primaryValue);
      if (hudScore.textContent !== h.stats) hudScore.textContent = h.stats;
      if (h.meter === null) {
        meterEl.hidden = true;
      } else {
        meterEl.hidden = false;
        meterFill.style.width = `${Math.round(h.meter * 100)}%`;
        meterFill.style.background = h.hot ? '#ffffff' : '#7fe9ff';
      }
    }
  }

  function updateDiagnostics(ts: number): void {
    if (ts - lastDiag < 500) return;
    lastDiag = ts;
    const i = renderer.info();
    dRenderer.textContent = i.rendererName;
    dSoft.textContent = !i.rendererKnown
      ? 'Unknown (browser hides renderer details)'
      : i.softwareDetected
        ? 'Yes: software renderer detected'
        : 'No software renderer detected';
    dDpr.textContent = `${i.devicePixelRatio} (using ${i.pixelRatioUsed})`;
    dBuffer.textContent = `${i.drawingBufferWidth}×${i.drawingBufferHeight} px for ${Math.round(i.cssWidth)}×${Math.round(i.cssHeight)} CSS px`;
    const f = frameStats.summary();
    dFrames.textContent = f ? `${f.p50.toFixed(1)} / ${f.p95.toFixed(1)} / ${f.p99.toFixed(1)} ms (n=${f.count})` : '–';
  }

  // ---- frame loop
  let lastTs: number | null = null;
  let lastState = session.state;
  let rafId = 0;

  function frame(ts: number): void {
    rafId = requestAnimationFrame(frame);
    try {
      if (lastTs !== null) {
        const gap = ts - lastTs;
        if (gap < 1000) frameStats.push(gap); // ignore hidden-tab gaps
      }
      lastTs = ts;

      if (session.isActive) {
        // Phase per step and session time both advance inside the step loop (see stepClock.ts).
        const before: string = session.state;
        const r = sim.advance(ts / 1000, stepClock);
        if (before === 'countdown' && (session.state as string) === 'running') sfx.play('start');
        if (r.stalledSeconds > 0) {
          lastStallSeconds = r.stalledSeconds;
          session.reportStall(r.stalledSeconds);
          sim.clearInput();
          input.releaseLock();
        } else {
          lateInputs += r.lateInputs;
        }
        if (drill) {
          for (const e of drill.drainEvents()) {
            if (e.type === 'hit') {
              renderer.burst(e.x, e.y, e.z);
              sfx.play('hit');
            } else if (e.type === 'miss') sfx.play('miss');
            else if (e.type === 'expire') sfx.play('expire');
          }
        }
        if (session.state === 'completed') {
          finalResult = drill ? drill.result() : null;
          if (finalResult) saveFinishedRun(finalResult);
          sfx.play('end');
          input.releaseLock();
        }
      }
      if (session.state !== lastState) {
        lastState = session.state;
        syncUi();
      }

      if (drill) renderer.setTargets(drill.targets);
      renderer.render(sim.player);
      updateHud();
      updateDiagnostics(ts);
    } catch (err) {
      cancelAnimationFrame(rafId);
      session.fail('runtime', `Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
      sim.clearInput();
      input.releaseLock();
      syncUi();
    }
  }

  window.addEventListener('resize', () => renderer.resize());
  applyScenario(scenarioId);
  applyRunLength();
  document.querySelectorAll<HTMLInputElement>('input[name="profile"]').forEach((r) => {
    r.addEventListener('change', () => {
      if (session.state === 'ready' && scenarioById(r.value)) applyScenario(r.value);
    });
  });
  $<HTMLSelectElement>('f-difficulty').addEventListener('change', () => {
    const d = $<HTMLSelectElement>('f-difficulty').value;
    if (session.state === 'ready' && isDifficulty(d)) {
      difficulty = d;
      persistPrefs();
    }
  });
  $<HTMLSelectElement>('f-length').addEventListener('change', () => {
    const n = Number($<HTMLSelectElement>('f-length').value);
    if (session.state === 'ready' && isDuration(n)) {
      seconds = n;
      applyRunLength();
      persistPrefs();
      syncUi();
    }
  });
  $('daily-btn').addEventListener('click', startDaily);
  $('stats-open').addEventListener('click', openStats);
  $('data-clear').addEventListener('click', () => {
    if (!confirm('Delete all saved run history from this browser? This cannot be undone.')) return;
    history = [];
    writeJson(HISTORY_KEY, history);
    $('data-msg').textContent = 'History cleared.';
    if (session.state === 'ready') syncUi();
  });
  syncUi();
  rafId = requestAnimationFrame(frame);

  // Test/diagnostic hook, development server only (stripped from production builds).
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__aimDebug = () => ({
      hookMarker: 'aim-debug-hook-v1', // unique string so scripts/verify-build.mjs can detect this hook
      state: session.state,
      snapshot: { ...session.snapshot },
      player: { ...sim.player },
      held: sim.held.count,
      calibrationTurnDeg: sim.calibrationTurnDeg,
      degreesPerUnit: sim.degreesPerUnit,
      lateInputs,
      firesDiscarded: sim.firesDiscarded,
      profile,
      scenarioId,
      difficulty,
      history,
      runInfo,
      saved,
      triggerHeld: sim.triggerHeld,
      drillResult: drill ? drill.result() : null,
      drillTargets: drill ? drill.targets.map((t) => ({ ...t })) : [],
      drillHud: drill ? drill.hud() : null,
      contextLost: renderer.contextLost,
      movementMode: input.movementMode,
      aspect: renderer.aspect,
      /** Test helper: aim straight at the first target (simulated-lock tests only). */
      aimAtTarget: () => {
        const t = drill?.targets[0];
        if (!t) return false;
        sim.player.yaw = Math.atan2(-(t.x - sim.player.x), -(t.z - sim.player.z));
        sim.player.pitch = Math.atan2(t.y - 1.6, Math.hypot(t.x - sim.player.x, t.z - sim.player.z));
        return true;
      },
    });
  }
}

boot();
