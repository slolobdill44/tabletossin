# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Table Tossin' is a browser-based physics game: the player winds up a spatula ("whacker") and launches food off it, trying to land tosses on a diner table for points. The repo directory and main JS file are still named `hamhuckin` for historical reasons — the project was renamed but the filenames were not.

There is no build system — the game runs by opening `index.html` directly in a browser. The only npm dependency (`@neondatabase/serverless` in `package.json`) is for the Vercel serverless functions in `api/`, not the game itself.

## Running the Game

Open `index.html` in a browser. For local development with a server:

```
npx serve .
# or
python3 -m http.server
# or, to also run the api/ leaderboard functions locally:
vercel dev
```

Without the API running, the leaderboard silently falls back to localStorage — everything else is unaffected.

`CHEAT_MODE` at the top of `lib/hamhuckin.js` widens the table (and turns on wireframes) so the bonus/game-over flows can be exercised quickly. Keep it `false` in commits.

## Architecture

All game logic lives in `lib/hamhuckin.js`, wrapped in `gameStart()` (called by `<body onload="gameStart()">`).

**Physics engine**: Matter.js **0.11.1** (`lib/matter.js`, vendored) handles rendering, physics, and collision. `lib/decomp.min.js` provides concave-polygon decomposition used by `Bodies.fromVertices`. Beware of using newer Matter APIs — e.g. `Render.startViewTransform` does not exist in 0.11.1 (the game rolls its own, see zoom below).

**Canvas**: Fixed render size 1050×600 (CSS chrome assumes 602). The canvas background is transparent; the diner artwork (`.canvas-bg-diner`) and a flat freeze color (`.canvas-bg-flat`) are sibling DOM elements behind it, toggled via the `.frozen` class on `#canvas-wrapper`. `applyMobileScale()` scales `#canvas-wrapper` via CSS transform to fit the viewport (re-runs on resize / orientationchange).

**Engine speed**: `GAME_SPEED` (top of the file, next to `CHEAT_MODE`) is the master speed multiplier — 1 = real time, 2 = the classic shipped feel, fractional values fine, minimum 1. A `Runner` `afterUpdate` hook steps the engine the extra `runner.delta × (GAME_SPEED − 1)` per frame, chunked into steps no larger than `runner.delta` (keeps integration accuracy speed-independent, and refresh-rate independent — fixed 16.67ms steps would run iOS slow). Whacker-pull pacing scales with it (the game loop runs per engine step); wall-clock timers (bonus timer, settle waits, transitions) do not. The hook early-returns while `fallingHammo` is set.

### Game flow (levels)

Linear progression through `levels[]` — Level 1 Hamburger → Level 2 Fish → Level 3 Duck. Adding a level is one `levels[]` entry plus a matching `throwables` entry. Flow:

1. Title screen (`#title-screen`, artwork + Start button + `#title-goal-text` overlay copy).
2. `showLevelIntro(idx, …)` splash → `startLevel(idx)` (spawns state during the splash's `preReveal` so nothing flashes).
3. Play the level: `SHOTS_PER_LEVEL` (**7**) tosses.
4. Round end resolution (see below) → next level intro, or game-complete screen after the last level.

Cumulative `totalScore` is shown in the HUD and carried across levels. `window.sessionHighScore` tracks the best total ever, persisted to `localStorage` (`tableTossinHighScore`) via `updateHighScore()`. Level intros show the previous level's score and the running total (`showLevelIntro`'s `scoreLine`/`lastLevelScore` args).

### Key constants (top of `gameStart`)

- `SHOTS_PER_LEVEL = 7` — tosses per level
- `BONUS_THRESHOLD = 5` — scoring objects required at round end to enter bonus mode (a perfect round is NOT required)
- `BONUS_DELAY_MS = 2500` — timer between bonus shots
- `ZOOM_START_Y = 130`, `ZOOM_MAX = 2.2` — bonus camera zoom tuning

### Key game objects

- `whacker` — spatula-sprited paddle, pivoted at its left end
- `hammo` — the currently active projectile; `hammos[]` tracks every spawned shot for scoring/settling checks
- `landingPad` — compound static body (`tableTop` + `leftLeg` + `rightLeg`) via `Matter.Body.create({ parts: [...] })`; geometry derives from `TABLE_CENTER_X` / `TABLETOP_WIDTH`. Its parts have `friction: 1` on purpose — Matter resolves contact friction as min(A, B), so the object's own friction always governs landings.
- `throwables` — registry of objects (`burger`, `fish`, `rubberDuck`) with physics params, sprite, concave `vertices`, and per-throwable whacker tuning (`restAnchorY`, applied by `applyThrowableTuning`). Commented-out `ham` / `bowlingBall` entries are intentional dormant configs.
- **Two-phase friction**: each throwable has `friction` (launch feel — object vs. whacker) and `stackFriction` (grip on the table and on other pieces). `applyStackFriction` swaps a shot to `stackFriction` (all parts, plus a `frictionStatic` bump) the moment it leaves the launch area — nothing can reach the table without crossing that line, so the two are independently tunable.

### Whacker (single damped spring — NOT a constraint stack)

Two constraints only: `whackerPivot` (fixed left-end pivot) and `whackerReturn` (damped spring to `whackerReturnAnchor`). While input is held (`pullHeld`), the game loop lerps `whackerReturnAnchor` toward `whackerPulledAnchor`; on release the anchor snaps back to `whackerRestAnchor` and the spring fires the whacker. No constraints are added/removed at runtime. The loop also clamps upward rotation (soft brake near `-0.21` rad, hard stop at it) so a strong fire can't strand the whacker angled up.

### Custom sprite rendering (concave bodies)

For throwables with concave `vertices`, `spawnHammo()` uses `Bodies.fromVertices`, which splits the body into parts. Matter would draw the sprite once per part, so per-part rendering is suppressed and the parent is tagged with `customSprite`; an `Events.on(render, 'afterRender')` listener draws each tagged hammo once at the parent centroid using `spriteCache`. All gameplay art is preloaded through the same cache at boot (`preloadArt`) so nothing pops in on the first toss. **Sprite art must assume the body's natural width/height** — no scaling at draw time. Both custom-draw listeners (sprites, red circle) wrap their drawing in the local `startViewTransform`/`endViewTransform` helpers so they track the bonus zoom (Matter 0.11.1 resets the canvas transform before firing `afterRender`).

### Round-end resolution (in the `afterUpdate` game loop)

Each toss is counted the moment its hammo leaves the launch area (`x > 400 || y > 500`); all but the last shot immediately spawn the next hammo. After the last shot, once 2.5s have passed and `areAllHammosDone()`:

- `calcScore() >= BONUS_THRESHOLD` → enter **bonus mode**
- otherwise → `endLevel(score)`:
  - non-final level: `startRoundEndSequence` shows the `#round-end-screen` overlay ("press any key"), which advances to the next level intro
  - **final level: skips the round summary and goes straight to the game-complete screen**

Score = bodies inside `scoreBounds` (the table column, extended to y = −1200 so over-canvas stacks count) filtered to `position.y <= 700 && speed < 2`. `areAllHammosDone()` deliberately uses the same `speed < 2` threshold so the two agree (stacked bodies micro-jitter; tighter thresholds never settle).

### Bonus mode

Entered when `BONUS_THRESHOLD`+ objects are scoring at round end. `lockBonusBaseline()` tags `_countedInBonus` on pieces that are actually ON the table — inside the score column AND above the tabletop (`y < 500`). Floor debris from missed shots and the fresh hammo on the whacker stay untagged, so **misses never end the bonus** — only a previously-on-table piece falling off does (floor-resting pieces sit at y ≈ 545–565, inside the falling band, with jittering velocity; tagging them ended the bonus instantly). Bonus shots are awarded on a `BONUS_DELAY_MS` timer (HUD countdown) — shoot fast, forever, until a tagged piece crosses the 530–602 band with `velocity.y > 1` (not `> 0`; resting bodies jitter). That triggers `startBonusEndSequence`:

1. `Runner.stop`, `.frozen` class (flat backdrop), red circle drawn around the falling object, HUD hidden.
2. After 500ms the `#bonus-end-screen` overlay appears ("An object fell off!"), waiting for click/tap/any key.
3. `advanceFromBonusEnd` clears the world, resets the zoom, banks the score, and routes to the next level intro or game complete.

**Camera zoom**: while in bonus mode the loop eases the render toward a zoom that keeps the settled stack top in frame (`getStackTopY`, ignoring bodies with `speed >= 2.5`). `applyZoom(z)` expands `render.bounds` (floor-anchored, horizontally centered, `hasBounds` toggled on only when z > 1) and applies a matching CSS transform to `.canvas-bg-diner` so the artwork stays in register. `#canvas-wrapper`'s background color shows at the exposed edges. Zoom resets in `startLevel` and `advanceFromBonusEnd`.

### Per-object score tracking

`runScores` (per run) and `bestScores` (all-time, persisted to `localStorage` under `tableTossinBestScores`, with in-memory fallback) are keyed by `throwableKey` and written via `recordLevelScore()` — called from `endLevel` and `startBonusEndSequence`. `showGameComplete()` renders them as one `.breakdown-card` per level on the ending screen.

### Leaderboard (server-backed, localStorage fallback)

Top-10 leaderboard on the game-complete screen (`.leaderboard-panel`, right column of `.ending-columns`), also viewable from the title screen (`#title-leaderboard-btn` opens an overlay reusing the same `renderLeaderboard` with its own list element). Names are arcade-style initials: letters/digits, uppercased, max 3 — normalized on submit client-side and again in `api/scores.js`, which additionally replaces denylisted combos with `AAA` (keep the two normalizations in sync). `submitLeaderboardName` closes the form synchronously before the async submit so double-clicks/held Enter can't create duplicate local rows. The UI only ever talks to two Promise-returning functions — `leaderboardLoad()` and `leaderboardSubmit(entry)`:

- **Online**: `leaderboardLoad` GETs `/api/scores`; `leaderboardSubmit` POSTs `{ token, name, score }` and swaps the caller's entry object into the returned rows (matched by the `you` id) so the UI's reference-equality highlight works unchanged.
- **Fallback** (fetch missing/failed — offline, `file://` dev, backend down): the original localStorage list (`tableTossinLeaderboard`), which is also always written on submit so the fallback view stays current.

**Anti-cheat (session tokens + duration bound)**: `requestSessionToken()` POSTs `/api/session` at each game start (`startGameFromTitle` / `restartFromGameComplete`) and stores a one-time token. `api/scores.js` consumes the token atomically (one submission per game played, ≤ 2 h old) and rejects scores that are impossible for the elapsed time: minimum 40 s per run, max score = 21 base points + one point per 2.5 s (the bonus-shot timer). Also per-IP rate limits and shape validation on both endpoints. If gameplay constants change (`SHOTS_PER_LEVEL`, `BONUS_DELAY_MS`, level count), **the mirrored constants at the top of `api/scores.js` must change too.** Schema lives in `db/schema.sql`; the functions read `DATABASE_URL` (injected by the Neon integration on Vercel).

If the finished run's `totalScore` beats the cut (`scoreQualifies`), a name-entry form appears in the panel and the Play Again / Main Menu buttons are visibility-hidden until the player saves or skips (`awaitingNameEntry`); submitting shows the updated standings in place — no navigation. The panel stops click/touchend propagation (touchend does **not** preventDefault — the browser must still synthesize clicks for input focus and the Save/Skip buttons). The last-used name is prefilled from `tableTossinPlayerName`; the input auto-focuses on desktop only.

### Controls & input routing

- **Spacebar** (desktop) / **touch-hold** on `#canvas-wrapper` (mobile, `(pointer: coarse)`): sets `pullHeld`; release fires. The spacebar handler ignores input while `gameOver`/`pickingNew`/overlay-continue flags are set, so a key that dismisses an overlay doesn't also wind the whacker.
- A single document `keydown` listener handles "press any key" for the round-end/bonus-end overlays only, skipping repeats, cmd/ctrl/alt combos, and INPUT targets. Click/touchend equivalents are attached to each overlay element; their touch copy is swapped to "Tap…" by the inline `(pointer: coarse)` script in `index.html`.
- The game-complete screen is button-driven — no click-anywhere/any-key restart. **Play Again** (`restartFromGameComplete`) resets `totalScore`/`currentLevel`/`runScores`, requests a fresh session token, and routes to the level-1 intro; **Main Menu** (`returnToMainMenu`) does the same reset but re-shows the title screen. `sessionHighScore` and `bestScores` survive both. After a leaderboard submission the player stays on the screen viewing the updated standings.

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
| `api/session.js`, `api/scores.js` | Vercel serverless leaderboard endpoints (`api/_util.js` is shared, not exposed) |
| `db/schema.sql` | Postgres schema for the leaderboard (run once against the Neon DB) |
| `package.json`, `pnpm-lock.yaml` | Deps for the `api/` functions only (`@neondatabase/serverless`) |
| `todo/`, `docs/` | Author notes |
