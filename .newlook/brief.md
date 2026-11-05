# Design brief: Instrument Range (M0–M2 foundation)

## 1. Scope
- **Mode:** Build.
- **Outcome:** a rendered original arena with mouse-look and movement, pointer-lock
  lifecycle, sensitivity/FOV settings, honest fallback. No drills, scoring or results yet.
- **Out of scope:** drills, scoring, results screen, audio, mobile, game-specific mechanics.
- **Acceptance (observable):** states ready/requestingLock/countdown/running/paused/completed/error
  are reachable and visually distinct; settings are keyboard-operable with visible focus;
  the fallback is honest; the arena fills the first screen.

## 2. Audience and task
Players who want to set up and sanity-check their sensitivity and FOV before drilling.
Most important to notice: the arena, then the session state and time. Secondary: settings and
diagnostics. The 50px figure is the session timer because the strip is the only metrics
surface; the arena is the largest element and the focal point.

## 3. Direction
**Adapted catalog direction: `bench` (recorded in `.newlook/history.json`).**
Fits live readouts and measurement. Adaptation: the catalog says "page is light"; kept, with the
arena as a dark well (the catalog's own "dark wells for live screens"). The 12-post turn ring is
the signature (a ruler for what the tool measures: degrees turned).
Alternatives considered: `blueprint` (grid clutter competes with targets later), custom bright
"gym" (glare during sustained play). Not selected for those reasons.

## 4. Tokens (in `src/ui/styles.css`)
- Colour: bone `#e4e1d9`, paper `#f2efe8`, ink `#17181a`, ink-muted `#484a4d`, teal `#0b6e6a`
  (active/focus), vermilion `#b83f12` (error/nominal tag), signal `#e8c600` (paused/warning only),
  well `#0b1a1b`, arena line `#7fd6cf`.
- Type: Schibsted Grotesk (UI), Martian Mono (numbers, tabular). Scale 12/14/17/20/24/50 px.
- Shape: square, hairlines, no shadows. Density: medium.

## 5. Hierarchy and first screen
Left: arena (16:9, sized to fit viewport height). Above: one readout strip (state, 50px timer,
turn counter, actual horizontal FOV). Right: 23rem settings column. HUD inside the arena is a
small crosshair and a top-centre timer only; nothing covers the centre.

## 6. States
Ready / waiting for lock / countdown / running / paused (reasoned) / completed / error, plus the
no-WebGL and no-Pointer-Lock fallback. Each state has distinct copy and a state chip colour.
Profiles ARE differentiated (built after M2): precision is the cool, still teal arena with a
single orange target and no motion cue; tracking is a warm brown arena with a faint floor arc showing
the target's path, a cyan target that turns white while the aim is on it, and a live on-target bar
along the bottom edge. Results differ too: a time-to-hit ruler for precision, an on-target timeline
for tracking.

## 7. Verification criteria
Unit tests for FOV, sensitivity, timing, states; Playwright with simulated lock (labelled as such);
real-lock probe; screenshots actually viewed; renderer reported (software vs not).
