# Aim practice

An original browser-based 3D aim trainer. Pick a drill, enter a 3D arena with
pointer-lock aiming, complete a 60 second session and read plain-language
results. It is not affiliated with, and does not replicate, any commercial game.

| Drill | Inspired by | What you do | Main measure |
|---|---|---|---|
| **Precision** | Valorant-style practice | Flick to one static target at a time, settle, click once. | Accuracy, time to hit, standing vs moving accuracy |
| **Tracking** | Overwatch-style practice | Hold fire and keep the crosshair on a target that keeps changing direction. | On-target time while firing |
| **Grid** | Original | Three targets on a wall; shoot one and another appears. | Kills per second, accuracy, streak |

Each drill has **Easy / Standard / Hard** difficulty (relative to this app only, not to any game or rank) and **30 / 60 / 90 second** lengths.

Around the drills:

- **Personal bests and progress**, saved in your browser: score, accuracy, a short trend line, and a plain statement of how many earlier runs the comparison rests on. Scores are compared only within the same drill, difficulty and length.
- **Daily challenge:** one drill, difficulty, length and target pattern per local calendar day, derived from the date alone. There is no server, so nothing is ranked or submitted.
- **Challenge links** ("Copy challenge link" after a run): a friend opening it gets the same drill, difficulty, length and target pattern. The link carries no score, so there is nothing to verify; compare scores yourselves.
- **Crosshair editor:** style, size, thickness, gap, colour, opacity and outline, with previews on dark and light backgrounds and a warning for hard-to-see colours.
- **Stats view** and a **Clear history** button.

"Inspired" means original drills for the same kind of practice. No game values
are used, and the tracking drill is **not** a hero or weapon profile (a faithful
Overwatch profile would need individual hero and weapon data this app does not have).
Desktop mouse and keyboard only. Sound is short synthesized beeps (mute in Settings).

## Requirements

- Node `^22.12.0 || ^24.0.0 || >=26.0.0` (set in `package.json` `engines`; Vitest 5 sets the floor).
  Developed on Node 24.
- npm (a single `package-lock.json`; do not add another lockfile).

```sh
npm install
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server. Includes dev-only extras used by tests: the debug hook, and `?run=<s>&countdown=<s>` to shorten a session. Both are removed from production builds. `?seed=<n>` (works everywhere) makes the target pattern reproducible. |
| `npm run build` | Cleans `dist/`, typechecks, builds. No source maps. |
| `npm run verify:build` | Fails if `dist/` has source maps or contains the debug-hook markers. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm test` | Unit tests (Vitest). |
| `npm run test:e2e` | Browser tests (Playwright). Starts and stops its own dev server on port 5199. |
| `npm run check` | All of the above, in order. |

## Browser tests: installing and choosing a browser

Playwright finds its own browsers. If the default is missing:

```sh
npx playwright install chromium
```

Optional overrides, set in **your** shell (never committed):

| Variable | Meaning |
|---|---|
| `AIM_BROWSER_CHANNEL` | One of `chromium`, `chrome`, `msedge`, `chrome-beta`, `msedge-beta`, `chrome-dev`, `msedge-dev`, `chrome-canary`, `msedge-canary`. Playwright locates it. |
| `AIM_BROWSER_PATH` | Absolute path to a browser executable. |

Precedence and validation (`config/browserSelection.ts`, unit tested):

- There is **no precedence**: setting **both** is an error, so a mistake is not hidden.
- An unsupported channel, an empty or whitespace-only value, a relative path, or a path that does not exist or is not a file is an error with the reason.
- Neither set: the `default` project uses Playwright's Chromium headless shell. The `real-lock` project uses channel `chromium` (new headless), because the headless shell cannot acquire pointer lock (it fails with `WrongDocumentError`).

No machine-specific absolute path is stored in any configuration file.

## What the automated checks do and do not prove

- **Unit tests** check the math and state logic: FOV, sensitivity, calibration, session states, the fixed-step simulation, phase boundaries and browser-selection rules. "Reproducible" here means reproducible in simulation (same timestamped inputs, same result across frame rates). It says nothing about real input latency or display behaviour.
- **Browser tests (default project)** use a **simulated** pointer lock and **synthetic** events (mouse movement, `visibilitychange`, a deliberately blocked main thread for the stall test). They show that this app reacts correctly to those events. They do not show that a real browser or OS delivers them that way.
- **`real-lock` project** calls the real `requestPointerLock` in automated Chromium and requires `document.pointerLockElement` to be the canvas. It proves the request path works in that automated browser only. It uses no physical mouse.
- **Rendering** in automated runs is usually software (SwiftShader). Frame times from it say nothing about real GPUs. The "Rendering & timing" panel in the app reports the renderer, whether a software renderer was detected, pixel ratio and measured frame times for the machine in front of you.

## Manual checks (real mouse, real GPU)

Note first: browser name and version, OS version, mouse model and DPI, OS pointer
speed/acceleration settings, display refresh rate and scaling, and the values in
the app's "Rendering & timing" panel.

1. **Click to lock.** Click Start. The cursor disappears, state reads Countdown, and the "Pointer-lock mode" line says ACCEPTED or REJECTED.
2. **Countdown vs running.** During the 3 s countdown, look around while holding W: the view turns, you do not move. After Running begins, W moves you.
3. **Esc and resume.** Press Esc: Paused, time frozen. Click Resume. If the browser refuses straight after Esc, wait a second and use "Try again". The app never retries by itself.
4. **Focus loss.** Hold W, alt-tab away and back: Paused, and you do not keep moving after resuming. Repeat by switching tabs.
5. **Calibration.** Lock the pointer, turn the mouse a measured distance (for example your own 360° distance), press Esc, read "Turned since reset" (nominal until calibrated), enter the turn you really made, press Apply, then repeat the same motion: it should read about the same angle.
6. **Window shape.** Resize the window and try 21:9: horizontal FOV rises while vertical FOV is unchanged. At 1024×768 Start and the status are visible without scrolling.

## Scoring, in one place

All formulas and thresholds are **original design choices**, not measured or sourced game values.

- **Grid score:** each kill 100, plus up to 50 for a quick kill (full bonus for a kill right after the previous one, none after 0.8 s), minus 25 per miss; never below 0.
- **Precision score:** each hit 100, plus up to 50 for speed (full at 0 s, none at 1 s), minus 40 for a hit while moving faster than 1 m/s; each miss −20; each timed-out target −10; never below 0. Clicks closer than 0.22 s to the previous shot are ignored and reported.
- **Difficulty** changes only target size, speed, time limits and spacing (see `src/core/scenarios.ts`); the scoring formulas are the same, so the same score at different difficulties is not equivalent.
- **Tracking score:** `round(1000 × on-target firing time ÷ run time)`. The results also show on-target ÷ firing time (blank, not 0%, if you never fired) and total firing time. Countdown, pauses and stalls are never counted.
- Feedback sentences come from fixed rules in `src/core/feedback.ts`, say how many shots or seconds they rest on, and decline to coach on tiny samples.

## Current limitations

- **Sensitivity is nominal.** cm/360 and DPI results assume one browser input unit per mouse count. Browsers differ (physical, logical or CSS pixels), so calibrate. The "Pointer-lock mode" line reports whether the browser *accepted* an unadjusted-movement request or *rejected* it and fell back; the app cannot verify physical counts or that acceleration is really off.
- **No game values.** No game's FOV, sensitivity constant or conversion is used: they could not be verified (see `docs/reference-notes.md`).
- **Accessibility.** Real-time mouse aiming is not universally accessible and no alternative input exists in this build. Settings and dialogs are keyboard-operable with visible focus; that is not a full accessibility audit.
- Desktop mouse and keyboard only. No audio, mobile controls, multiplayer or backend.
- The production JS bundle is about 627 kB uncompressed (about 163 kB gzipped). Not optimised yet.
- Hitscan only: no projectiles, recoil, spread, hero abilities or per-weapon behaviour.
- Targets are not blocked by scenery: spawns stay inside every post and wall, and shots are plain ray-sphere tests.
- Saved data is local only: settings, crosshair, drill/difficulty/length choice, sound preferences and run summaries (score, accuracy, seed). Raw mouse movement and per-shot data are never stored. Clearing browser data erases it, and it does not sync between devices.
- No accounts, leaderboards, cloud sync or replays: there is no backend, so scores cannot be verified or ranked. Challenge links and the daily challenge give shared target patterns, not shared scoreboards.
- Performance has been measured only in software-rendered headless Chromium. The in-app "Rendering & timing" panel reports your real numbers; no frame rate is promised.
- Source maps are off in the production build. That is not a security boundary: the shipped JavaScript is public, and `verify:build` separately checks that the dev-only debug hook is absent from it.
