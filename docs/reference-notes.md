# Reference notes

Status of every number and rule in the M0–M2 build. Nothing here claims to
replicate Valorant or Overwatch.

## 1. Sourced facts (fetched 2026-11-04)

| Fact | Source | Used for |
|---|---|---|
| `requestPointerLock({ unadjustedMovement: true })` disables OS-level mouse acceleration and returns a Promise. Marked "Limited availability" (not Baseline). | https://developer.mozilla.org/en-US/docs/Web/API/Element/requestPointerLock | Lock request; accurate reporting of acceleration state |
| Success/failure is also reported by `pointerlockchange` / `pointerlockerror` on `document`. | same | Event-driven state handling |
| Requires transient user activation. Calling it right after the default unlock gesture (Esc) fails even with activation. | same | Retry notice ("wait a second after Esc"); no automatic re-request |
| `movementX` units are not defined by one standard: "physical pixel, a logical pixel, or a CSS pixel" depending on browser and OS. | https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent/movementX | Why cm/360 results are **nominal**; calibration; direct degrees-per-unit mode |
| three.js `PerspectiveCamera` `fov` is the **vertical** field of view. | `node_modules/three/src/cameras/PerspectiveCamera.js` (`@param {number} [fov=50] - The vertical field of view.`), three 0.187.0 | FOV model |
| `webglcontextlost` fires when the drawing buffer is lost. | https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextlost_event | Context-loss pause |

Not found on that page (so not stated as sourced): that `preventDefault()` on
`webglcontextlost` is needed for restoration. The code calls it because the
WebGL specification requires it, but I did not verify that from the spec text in
this session. Treat as **unverified**.

## 2. Standard math (derived, unit tested)

- `vfov = 2·atan(tan(hfov/2) / aspect)`, and its inverse.
- `degrees per count = 360 / (cm360 / 2.54 · dpi)`.

## 3. Reference values that could NOT be verified

Web search was unavailable in this environment (the search tool returned a
provider error). Direct fetches of official pages did not yield the values:

- Riot support hub page for VALORANT: no FOV or sensitivity statement found.
- Blizzard support article 300398: redirected to a login page; not read.
- Overwatch patch notes page (checked 2026-11-04 notes): no FOV or sensitivity statement.

Therefore **no game's default FOV, FOV range, FOV axis, or yaw-per-count
constant is used anywhere**, and no cross-game sensitivity conversion exists.
Uncertainty is recorded here instead of guessed. If you want game-matching
values later, supply a primary source or approve a dedicated research pass.

Overwatch note (design limitation, not a sourced fact): tracking behaviour
depends on each hero's weapon, so a faithful Overwatch profile needs per-hero
profiles. The generic tracking drill planned for M4 will say so.

## 4. Approximations

- DPI/cm-360 turn rate assumes one browser input unit per sensor count
  (`unitsPerCount = 1`). Labelled **nominal** in the UI until the user
  calibrates by physically turning the mouse a measured distance.
- "Unadjusted movement" status reflects what the browser reports about the
  request, not a measurement of the OS pipeline. The UI says "unconfirmed" when
  the browser gives no answer.

## 5. Original design choices (not authentic to any game)

Arena geometry and turn-check posts; FOV limits 60–130° and default 100°;
default 800 DPI / 30 cm per 360°; movement (max 5.4 m/s, accel 48, decel 60,
radius 0.4 m); 3 s countdown and 60 s session; 120 Hz fixed step; 0.25 s
max frame gap before a stall is reported; 89° pitch limit; eye height 1.6 m;
all colours, type and layout.

## 6. Tracking metrics (implemented in `src/core/drills/tracking.ts`)

All times are simulation seconds, excluding countdown and pauses.

1. `onTargetFiringTime / totalActiveDrillTime`
2. `onTargetFiringTime / totalFiringTime` (undefined when `totalFiringTime == 0`:
   display "no firing", never 0% or NaN)
3. `totalFiringTime`

`totalActiveDrillTime` is the running phase only. Stall time is excluded and
reported separately. "Firing" on a step means the trigger was held for that
whole step; "on target" means the aim ray hits the target sphere at the end of
that step. Holding the button down from the countdown does not start firing:
press again after Running begins.

## 9. Progress, daily challenge and sharing (all original)

- History keeps the latest 200 run summaries. An untouched run (no shots, or no firing) is not saved.
- "Personal best" and "trend" compare only runs with the same scenario, difficulty and length. A trend sentence needs at least 3 earlier runs; with fewer, the app says so.
- The daily challenge is `hash(date)` into a seeded generator, so every device with the same local date gets the same drill, difficulty (25% easy, 55% standard, 20% hard), length (30 or 60 s) and seed.
- Challenge links are `?c=<scenario>.<difficulty>.<seconds>.<seed>`, parsed strictly (known scenario, known difficulty, 30/60/90 s, seed up to 2^32-1). They contain no score.

## 8. Drill design (all original, none sourced)

- Precision: sphere radius 0.21 m, 6–11 m away, 2.2 s lifetime, 0.3 s between targets,
  minimum 0.22 s between shots, "moving" above 1 m/s, scoring as in the README.
- Tracking: sphere radius 0.3 m on a 9.2 m arc spanning ±55°, 18–48°/s, scheduled
  direction or speed change every 0.35–1.3 s plus a reversal at each arc end.
  "Held through" a change = still on target 0.6 s after it; a loss not recovered
  within 2 s counts as unrecovered.
- Target patterns come from a seeded generator (mulberry32); the seed is shown in the results.
- Sound: oscillator beeps only; no samples, no game audio.

## 7. Timing model

See the header comment of `src/core/simulation.ts` for the exact ordering rule
(inputs with timestamp ≤ step end apply in timestamp order, then movement
integrates). Tests establish **simulation reproducibility** (same inputs, same
result across frame rates, within 1e-9). They say nothing about real input
latency, OS/browser event batching or display refresh behaviour.
