# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Table Tossin' is a browser-based physics game: the player winds up a spatula ("whacker") and launches food off it, trying to land tosses on a diner table for points. The repo directory and main JS file are still named `hamhuckin` for historical reasons — the project was renamed but the filenames were not.

There is no build system — the game runs by opening `index.html` directly in a browser. The `express` dep in `package.json` and `pnpm-lock.yaml` are vestigial from an older Heroku/Vercel deploy and are not used by the game.

## Running the Game

Open `index.html` in a browser. For local development with a server:

```
npx serve .
# or
python3 -m http.server
```

`CHEAT_MODE` at the top of `lib/hamhuckin.js` widens the table (and turns on wireframes) so the bonus/game-over flows can be exercised quickly. Keep it `false` in commits.

## Architecture

All game logic lives in `lib/hamhuckin.js`, wrapped in `gameStart()` (called by `<body onload="gameStart()">`).

**Physics engine**: Matter.js **0.11.1** (`lib/matter.js`, vendored) handles rendering, physics, and collision. `lib/decomp.min.js` provides concave-polygon decomposition used by `Bodies.fromVertices`. Beware of using newer Matter APIs — e.g. `Render.startViewTransform` does not exist in 0.11.1 (the game rolls its own, see zoom below).

**Canvas**: Fixed render size 1050×600 (CSS chrome assumes 602). The canvas background is transparent; the diner artwork (`.canvas-bg-diner`) and a flat freeze color (`.canvas-bg-flat`) are sibling DOM elements behind it, toggled via the `.frozen` class on `#canvas-wrapper`. `applyMobileScale()` scales `#canvas-wrapper` via CSS transform to fit the viewport (re-runs on resize / orientationchange).

**Engine speed**: a `Runner` `afterUpdate` hook steps the engine one extra time per frame using `runner.delta` for a true ~2x feel on all platforms (fixed 16.67ms would run iOS slow). The hook early-returns while `fallingHammo` is set.

### Game flow (levels)

Linear progression through `levels[]` — Level 1 Hamburger → Level 2 Fish → Level 3 Duck. Adding a level is one `levels[]` entry plus a matching `throwables` entry. Flow:

1. Title screen (`#title-screen`, artwork + Start button + `#title-goal-text` overlay copy).
2. `showLevelIntro(idx, …)` splash → `startLevel(idx)` (spawns state during the splash's `preReveal` so nothing flashes).
3. Play the level: `SHOTS_PER_LEVEL` (**7**) tosses.
4. Round end resolution (see below) → next level intro, or game-complete screen after the last level.

Cumulative `totalScore` is shown in the HUD and carried across levels. `window.sessionHighScore` tracks the best total this browser session.

### Key constants (top of `gameStart`)

- `SHOTS_PER_LEVEL = 7` — tosses per level
- `BONUS_THRESHOLD = 5` — scoring objects required at round end to enter bonus mode (a perfect round is NOT required)
- `BONUS_DELAY_MS = 2500` — timer between bonus shots
- `ZOOM_START_Y = 130`, `ZOOM_MAX = 2.2` — bonus camera zoom tuning

### Key game objects

- `whacker` — spatula-sprited paddle, pivoted at its left end
- `hammo` — the currently active projectile; `hammos[]` tracks every spawned shot for scoring/settling checks
- `landingPad` — compound static body (`tableTop` + `leftLeg` + `rightLeg`) via `Matter.Body.create({ parts: [...] })`; geometry derives from `TABLE_CENTER_X` / `TABLETOP_WIDTH`
- `throwables` — registry of objects (`burger`, `fish`, `rubberDuck`) with physics params, sprite, concave `vertices`, and per-throwable whacker tuning (`restAnchorY`, applied by `applyThrowableTuning`). Commented-out `ham` / `bowlingBall` entries are intentional dormant configs.

### Whacker (single damped spring — NOT a constraint stack)

Two constraints only: `whackerPivot` (fixed left-end pivot) and `whackerReturn` (damped spring to `whackerReturnAnchor`). While input is held (`pullHeld`), the game loop lerps `whackerReturnAnchor` toward `whackerPulledAnchor`; on release the anchor snaps back to `whackerRestAnchor` and the spring fires the whacker. No constraints are added/removed at runtime. The loop also clamps upward rotation (soft brake near `-0.21` rad, hard stop at it) so a strong fire can't strand the whacker angled up.

### Custom sprite rendering (concave bodies)

For throwables with concave `vertices`, `spawnHammo()` uses `Bodies.fromVertices`, which splits the body into parts. Matter would draw the sprite once per part, so per-part rendering is suppressed and the parent is tagged with `customSprite`; an `Events.on(render, 'afterRender')` listener draws each tagged hammo once at the parent centroid using `spriteCache`. **Sprite art must assume the body's natural width/height** — no scaling at draw time. Both custom-draw listeners (sprites, red circle) wrap their drawing in the local `startViewTransform`/`endViewTransform` helpers so they track the bonus zoom (Matter 0.11.1 resets the canvas transform before firing `afterRender`).

### Round-end resolution (in the `afterUpdate` game loop)

Each toss is counted the moment its hammo leaves the launch area (`x > 400 || y > 500`); all but the last shot immediately spawn the next hammo. After the last shot, once 2.5s have passed and `areAllHammosDone()`:

- `calcScore() >= BONUS_THRESHOLD` → enter **bonus mode**
- otherwise → `endLevel(score)`:
  - non-final level: `startRoundEndSequence` shows the `#round-end-screen` overlay ("press any key"), which advances to the next level intro
  - **final level: skips the round summary and goes straight to the game-complete screen**

Score = bodies inside `scoreBounds` (the table column, extended to y = −1200 so over-canvas stacks count) filtered to `position.y <= 700 && speed < 2`. `areAllHammosDone()` deliberately uses the same `speed < 2` threshold so the two agree (stacked bodies micro-jitter; tighter thresholds never settle).

### Bonus mode

Entered when `BONUS_THRESHOLD`+ objects are scoring at round end. `bonusPeakOnScreen` records how many on-screen objects there are, and each is tagged `_countedInBonus`. Bonus shots are awarded on a `BONUS_DELAY_MS` timer (HUD countdown) — shoot fast, forever, until any tagged object crosses below the table top (`y` in 530–602 while moving down). That triggers `startBonusEndSequence`:

1. `Runner.stop`, `.frozen` class (flat backdrop), red circle drawn around the falling object, HUD hidden.
2. After 500ms the `#bonus-end-screen` overlay appears ("An object fell off!"), waiting for click/tap/any key.
3. `advanceFromBonusEnd` clears the world, resets the zoom, banks the score, and routes to the next level intro or game complete.

**Camera zoom**: while in bonus mode the loop eases the render toward a zoom that keeps the settled stack top in frame (`getStackTopY`, ignoring bodies with `speed >= 2.5`). `applyZoom(z)` expands `render.bounds` (floor-anchored, horizontally centered, `hasBounds` toggled on only when z > 1) and applies a matching CSS transform to `.canvas-bg-diner` so the artwork stays in register. `#canvas-wrapper`'s background color shows at the exposed edges. Zoom resets in `startLevel` and `advanceFromBonusEnd`.

### Per-object score tracking

`runScores` (per run) and `bestScores` (all-time, persisted to `localStorage` under `tableTossinBestScores`, with in-memory fallback) are keyed by `throwableKey` and written via `recordLevelScore()` — called from `endLevel` and `startBonusEndSequence`. `showGameComplete()` renders them as one `.breakdown-card` per level on the ending screen.

### Controls & input routing

- **Spacebar** (desktop) / **touch-hold** on `#canvas-wrapper` (mobile, `(pointer: coarse)`): sets `pullHeld`; release fires. The spacebar handler ignores input while `gameOver`/`pickingNew`/overlay-continue flags are set, so a key that dismisses an overlay doesn't also wind the whacker.
- A single document `keydown` listener handles "press any key": it advances the round-end/bonus-end overlays, or restarts from the game-complete screen (checked via `gameOverScreen.style.display === 'flex'`). It skips repeats and cmd/ctrl/alt combos. Click/touchend equivalents are attached to each overlay element; the game-over screen's touch copy is swapped to "Tap…" by the inline `(pointer: coarse)` script in `index.html`.
- `restartFromGameComplete` resets `totalScore`, `currentLevel`, `runScores` and routes to the level-1 intro. `sessionHighScore` and `bestScores` survive.

### Coordinate magic numbers

- `400` / `500` — x/y cutoffs: hammo has left the launch area (counts the shot)
- `1050` / `700` — x/y cutoffs: hammo is truly off-screen
- `TABLE_CENTER_X = 750`, `TABLETOP_WIDTH = 532` — table geometry; `scoreBounds` is the column above the tabletop, y from −1200 to 480
- `530`–`602` (moving down) — "falling off the table" band for the bonus-end trigger
- `120/490` — `whackerPulledAnchor` (max pullback); `325/32x` — rest anchor (y is per-throwable `restAnchorY`)
- `2500` — ms settle wait after the last shot before scoring the round

## Files

| File | Purpose |
|------|---------|
| `index.html` | Entry point; HUD, title screen, level-intro, bonus-end, round-end, ending screens |
| `lib/hamhuckin.js` | All game logic |
| `lib/matter.js` | Matter.js 0.11.1 physics/rendering (vendored) |
| `lib/decomp.min.js` | Polygon decomposition for `Bodies.fromVertices` (vendored) |
| `css/style.css` | All styling; Dosis + Bungee Inline fonts; `(pointer: coarse)` media query for mobile |
| `assets/hamburger.png`, `fish.png`, `rubber-duck.png` | Throwable sprites (one per level) |
| `assets/spatula.png` | Whacker sprite |
| `assets/tabletop.png`, `tableleg.png` | Landing pad parts |
| `assets/dinerandscore.png` | In-game diner backdrop (DOM element behind the canvas) |
| `assets/intro2.png` | Title-screen artwork (instructions baked in; goal copy is an HTML overlay) |
| `assets/ham.png`, `bowling-ball.png` | Dormant — referenced only by commented-out `throwables` entries |
| `package.json`, `pnpm-lock.yaml` | Vestigial deploy config; not used by the game |
| `todo/`, `docs/` | Author notes |
