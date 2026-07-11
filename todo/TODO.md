# Ham Huckin' — To-Do


## Next stuff

- Intro screen should say 5 in a row gets you bonus shots
- Bonus game over screen tells you an object fell off
- Do levels of 1, 2, 3. one for each object
- Make bonus mode zoom out if stack gets big enough
- Leaderboard that can't be hacked


## 1. Next.js Migration + Vercel Leaderboard

Port the game to a Next.js app and add a persistent leaderboard backed by Vercel Postgres.

**What needs to happen:**
- Scaffold a new Next.js app (App Router) and move the game into it — `index.html` becomes `app/page.js`, the game canvas renders inside a client component, static assets go in `/public`
- Move `lib/hamhuckin.js` logic into a React `useEffect` that initializes the Matter.js engine on mount; keep all game logic intact
- Add a `/api/scores` route (Next.js Route Handler) that accepts POST (submit score + name) and GET (return top 10 scores), backed by Vercel Postgres
- Add a leaderboard panel to the game-over screen showing the top 10 scores fetched from the API
- Add a name input to the game-over screen so users can submit their score
- Deploy to Vercel; configure Vercel Postgres in the dashboard and add the connection string env var

**Prompt to use:**
> "Port Ham Huckin' to Next.js (App Router). The entire game currently lives in `lib/hamhuckin.js` as a single `gameStart()` function that uses Matter.js imperatively. Create a `components/Game.jsx` client component (`'use client'`) that runs `gameStart()` inside a `useEffect(() => { gameStart(); return () => { /* cleanup */ } }, [])`. The component renders a single `<div id='game-screen'>` with the existing HUD markup from `index.html`. Move all static assets to `/public`. Create `app/api/scores/route.js` with GET (SELECT top 10 from a `scores` table ordered by score DESC) and POST (INSERT name + score). Use `@vercel/postgres` for the DB client. On the game-over screen, add a name text input and a submit button; on submit, POST to `/api/scores`, then fetch GET and render the top 10 below the final score. Provide the SQL to create the scores table."

---

## 2. Vercel Edge Config for Game Tuning

Store game balance parameters in Vercel Edge Config so they can be changed without redeploying.

**What needs to happen:**
- Move tuneable values out of `hamhuckin.js` into Vercel Edge Config: `shotCount`, gravity (`engine.gravity.y`), `whackerSpring.stiffness`, landing pad position/size
- Fetch these at page load time from a Next.js server component or `getServerSideProps` and pass them as props into the game component
- Fall back to hardcoded defaults if Edge Config is unavailable

**Prompt to use:**
> "In the Ham Huckin' Next.js app, fetch game config from Vercel Edge Config using `@vercel/edge-config`. The values to read are: `shotCount` (default 5), `gravityY` (default 1), `springStiffness` (default 0.2), `landingPadX` (default 750), `landingPadWidth` (default 315). Fetch these in the root `app/page.js` server component using `get()` from `@vercel/edge-config`, fall back to defaults if any are missing, and pass them as props to the `<Game>` client component. In `Game.jsx`, accept these as props and pass them into `gameStart(config)`. Refactor `gameStart` to accept a config parameter object instead of using hardcoded values."

---

## 3. AI-Generated Throwable Objects

Let users type a prompt, generate a pixel art sprite via an image generation API, and throw it.

**What needs to happen:**
- Add a "Generate your own" option to the throwable picker screen (from item 2)
- Clicking it shows a text input and a generate button
- The request goes through a Next.js API route `/api/generate` — never call the image API from the browser
- The API route rate-limits by IP using Vercel KV: max 3 generations per IP per 24 hours; return 429 with a friendly message if exceeded
- Run the user prompt through OpenAI's moderation endpoint before passing to the image generator
- Call DALL-E 3 (or Replicate) with a prefix like `"simple pixel art, single object, white background, 64x64, no text:"` + user prompt
- Show a loading state, then preview the generated image; user confirms or re-generates
- On confirm, use the image URL as the sprite texture and assign medium default physics values
- Store the generated image in Vercel Blob so the URL is stable and doesn't expire

**Prompt to use:**
> "Add AI-generated throwables to the Ham Huckin' Next.js app. Create `app/api/generate/route.js` (POST). It should: 1) extract the real IP from `x-forwarded-for`; 2) check `@vercel/kv` for key `gen:{ip}` — if value >= 3, return 429 JSON `{ error: 'Daily generation limit reached' }`; 3) call OpenAI moderation API on the user prompt and return 400 if flagged; 4) call DALL-E 3 with prompt `'simple pixel art, single object, white background, 64x64, no text: ' + userPrompt`, size `256x256`; 5) download the image buffer and upload to Vercel Blob with `@vercel/blob`; 6) increment the KV counter with a 86400 second TTL; 7) return the stable Vercel Blob URL. In the frontend picker screen, add a text input + generate button, show a spinner during generation, show the resulting image as a preview with Confirm/Regenerate buttons. On confirm, create a throwable config with the blob URL as sprite and default physics `{ density: 0.001, friction: 0.2, restitution: 0.3, width: 60, height: 60 }`. Handle 429 by showing the limit message to the user."
