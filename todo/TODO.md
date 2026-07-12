## 1. Hosted Leaderboard (Vercel serverless functions — no Next.js port)

Make the leaderboard global by backing it with a database behind two Vercel
serverless functions. **Do NOT port the game to Next.js for this.** The game is
a zero-build static site that already deploys to Vercel, and Vercel runs any
`api/*.js` file in the repo as a serverless function with no framework and no
build step. The Next.js port was where all the risk in the old plan lived
(wrapping the imperative `gameStart()` world in a React `useEffect`, moving
assets, adding a build) and it buys the leaderboard nothing. Revisit Next.js
only if the site someday needs real pages/SSR (e.g. item 3 at scale).

**Architecture:**

```
browser (static index.html, unchanged game code)
  │  leaderboardLoad()  ──────────  GET  /api/scores        → top 10
  │  game start        ──────────  POST /api/session       → one-time token
  │  leaderboardSubmit(entry) ───  POST /api/scores        → insert if valid
  ▼
api/scores.js + api/session.js   (Vercel serverless, Node)
  ▼
Postgres  ("Vercel Postgres" is now Neon via the Vercel Marketplace;
           it injects DATABASE_URL automatically)
```

**Client side is already done.** The local leaderboard (fable-work branch)
isolates storage behind two Promise-returning functions in `lib/hamhuckin.js` —
`leaderboardLoad()` and `leaderboardSubmit(entry)`. Phase 2 replaces only their
bodies with `fetch()` calls; no UI code changes. Keep localStorage as the
fallback when fetch fails, so offline play and `open index.html` local dev
keep working (`vercel dev` runs the functions locally when you want them).

**What needs to happen:**
- `api/session.js` — POST issues a one-time session token (random UUID) and
  records its creation time in a `sessions` table. Called by the client at
  game start.
- `api/scores.js` — GET returns the top 10 (`name`, `score`). POST accepts
  `{ token, name, score }` and inserts only if ALL of:
  - token exists, is unused, and is younger than ~2 hours; mark it used
    (one submission per game played)
  - **duration bound**: elapsed time since the token was issued must be at
    least the minimum a real game takes, and — because bonus shots arrive on
    a fixed 2.5 s timer — the score itself is bounded by a function of
    elapsed time. A score of 40 arriving 90 seconds after game start is
    physically impossible; reject it. This is the highest-value anti-cheat
    per line of code this game can have.
  - name ≤ 12 chars after trimming; score is an integer within a sane cap
  - per-IP rate limit (a few submissions/minute is plenty)
- SQL: `scores (id serial, name text, score int, created_at timestamptz)` and
  `sessions (token uuid pk, created_at timestamptz, used boolean)`
- Swap the two client functions to fetch; wire the session POST into
  `startGameFromTitle`/`restartFromGameComplete`
- `package.json`: add the Postgres client (`@neondatabase/serverless` or
  `@vercel/postgres`), delete the vestigial `express` dep
- Dashboard (manual): create the Neon database via the Vercel Marketplace,
  confirm `DATABASE_URL` is set, deploy

**Anti-cheat: decided scope.** Scores are computed client-side, so a public
leaderboard is forgeable by anyone willing to read the JS — the ladder of
defenses, in ascending effort, is: (1) validation caps + rate limits,
(2) session tokens + duration/score bounds (chosen — see above), (3) in-flight
per-shot event pings sanity-checked server-side (nice later upgrade if junk
appears), (4) HMAC-signing the payload with a client-embedded secret (mostly
theater; the secret ships in readable JS), (5) server-verified input replays.
Replay verification is the only cryptographically honest option and is what
leaderboard-centric games (Trackmania, osu!, lockstep RTSes) do — but it
requires making the whole sim deterministic (fixed-timestep refactor of the
wall-clock-driven game loop, tick-indexed inputs, deterministic trig shims
because `Math.sin/cos` differ across JS engines and stacked-body physics is
chaotic), extracting the sim from the DOM so Node can run it headless, and
version-stamping replays — 5–10× the cost of the entire leaderboard, and it
still only proves "these inputs produce this score", not "a human played"
(TAS-style input search remains). Not worth it here; tier 2 + the ability to
manually delete rows is the right call for a hobby game. The old "leaderboard
that can't be hacked" goal should be read as "leaderboard that can't be hacked
with one curl command".

**Prompt to use:**
> "The game is a static site on Vercel with a local leaderboard whose storage
> layer is isolated behind `leaderboardLoad()` / `leaderboardSubmit(entry)`
> (Promise-returning) in `lib/hamhuckin.js`. Add bare Vercel serverless
> functions (no framework): `api/session.js` — POST inserts and returns a
> one-time UUID token in a `sessions` table. `api/scores.js` — GET returns the
> top 10 from `scores` ordered by score DESC; POST takes `{ token, name,
> score }` and inserts only if the token exists, is unused (mark used), and is
> 20 s–2 h old; the score must satisfy a duration bound (max plausible score
> given elapsed seconds since token creation, knowing 7 base shots plus one
> bonus shot per 2.5 s); name trimmed to ≤ 12 chars; score an integer 0–200;
> plus a simple per-IP rate limit. Use `@neondatabase/serverless` reading
> `DATABASE_URL`. Provide the CREATE TABLE SQL. In `lib/hamhuckin.js`, replace
> the bodies of `leaderboardLoad`/`leaderboardSubmit` with fetches to
> `/api/scores` (keeping the current localStorage logic as a fallback when
> fetch fails), and request a session token at game start. Remove the unused
> `express` dependency."

---

## 2. Vercel Edge Config for Game Tuning

Store game balance parameters in Vercel Edge Config so they can be changed
without redeploying. Same no-framework rule as item 1: the game stays a static
site, and the config is exposed through a bare serverless function.

**What needs to happen:**
- Add `api/config.js` — GET reads the tunables from Edge Config via
  `@vercel/edge-config` and returns them as JSON (Edge Config can't be read
  from the browser directly)
- Tuneable values, with the current hardcoded values as defaults:
  `SHOTS_PER_LEVEL` (7), `BONUS_THRESHOLD` (5), `BONUS_DELAY_MS` (2500),
  gravity (`engine.gravity.y`), whacker spring stiffness
  (`whackerReturn.stiffness`, 0.15), `TABLE_CENTER_X` (750),
  `TABLETOP_WIDTH` (532)
- In `gameStart()`, fetch `/api/config` at load with a short timeout and merge
  over the hardcoded defaults; if the fetch fails (offline, `file://` dev),
  the defaults are already correct

**Prompt to use:**
> "The game is a static site on Vercel with bare serverless functions in
> `api/`. Add `api/config.js`: GET returns JSON game tunables read from Vercel
> Edge Config using `@vercel/edge-config`, falling back to defaults for any
> missing key: SHOTS_PER_LEVEL 7, BONUS_THRESHOLD 5, BONUS_DELAY_MS 2500,
> gravityY 1, springStiffness 0.15, tableCenterX 750, tabletopWidth 532. In
> `lib/hamhuckin.js`, fetch `/api/config` at the top of `gameStart()` (with a
> catch that keeps the hardcoded defaults) and use the merged values where
> those constants are defined today."

---

## 3. AI-Generated Throwable Objects

Let users type a prompt, generate a pixel art sprite via an image generation API, and throw it.

**What needs to happen:**
- Add a "Generate your own" option to the title screen (the old throwable
  picker is gone — the game is a fixed level progression now). See
  `todo/ai_plan.md` for the fuller plan, including deriving collision
  vertices from the generated image's alpha channel
- Clicking it shows a text input and a generate button
- The request goes through a bare Vercel serverless function
  `api/generate.js` — never call the image API from the browser
- The API route rate-limits by IP using Vercel KV: max 3 generations per IP per 24 hours; return 429 with a friendly message if exceeded
- Run the user prompt through OpenAI's moderation endpoint before passing to the image generator
- Call DALL-E 3 (or Replicate) with a prefix like `"simple pixel art, single object, white background, 64x64, no text:"` + user prompt
- Show a loading state, then preview the generated image; user confirms or re-generates
- On confirm, use the image URL as the sprite texture and assign medium default physics values
- Store the generated image in Vercel Blob so the URL is stable and doesn't expire

**Prompt to use:**
> "Add AI-generated throwables to the static-site game (bare Vercel serverless functions, no framework). Create `api/generate.js` (POST). It should: 1) extract the real IP from `x-forwarded-for`; 2) check `@vercel/kv` for key `gen:{ip}` — if value >= 3, return 429 JSON `{ error: 'Daily generation limit reached' }`; 3) call OpenAI moderation API on the user prompt and return 400 if flagged; 4) call DALL-E 3 with prompt `'simple pixel art, single object, white background, 64x64, no text: ' + userPrompt`, size `256x256`; 5) download the image buffer and upload to Vercel Blob with `@vercel/blob`; 6) increment the KV counter with a 86400 second TTL; 7) return the stable Vercel Blob URL. On the title screen, add a text input + generate button, show a spinner during generation, show the resulting image as a preview with Confirm/Regenerate buttons. On confirm, create a throwable config with the blob URL as sprite and default physics `{ density: 0.001, friction: 0.2, restitution: 0.3, width: 60, height: 60 }`. Handle 429 by showing the limit message to the user."
