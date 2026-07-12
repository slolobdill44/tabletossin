# Table Tossin' — Improvement Backlog

Ordered by player-facing impact (broken-mechanic fixes first, then impact/effort).
Same content as `backlog.json`; keep the two in sync when statuses change.

| # | Title | Category | Priority | Effort | Depends on | What / why |
|---|-------|----------|----------|--------|------------|------------|
| 1 | Fix bonus ending instantly from floor debris | bug | high | small | — | Bonus entry tags every on-screen hammo, including floor-resting misses whose y (~545–565) sits inside the 530–602 falling band with jittery velocity — the bonus can end the moment it starts. Regression from the 5-of-7 threshold. Tag only pieces in the table column and require real downward velocity. |
| 2 | Define missed bonus shot behavior explicitly | gameplay | high | small | #1 | A missed bonus toss ends the run only by accident today. Decide: miss = bonus over (high stakes) or misses forgiven; implement deliberately. |
| 3 | Shrink multi-megabyte artwork and delete unused | performance | high | small | — | dinerandscore.png is 5.5MB and ~8MB of assets are referenced by nothing (scoreboard.png, diner1/2/5). Recompress + delete = biggest time-to-first-toss win. |
| 4 | Filter offensive leaderboard names server-side | polish | high | small | — | Public top-10 accepts any 12-char name. Denylist/normalize in the POST before launch. |
| 5 | Prevent duplicate leaderboard submissions | bug | medium | small | — | Double-click Save / held Enter duplicates local entries (server is token-safe). Close the form synchronously; ignore key repeats. |
| 6 | Add sound effects with mute toggle | gameplay | high | medium | — | Silent game. Thwack/thud/fanfare/fall-sting plus a mute button; most game-feel per effort of anything here. |
| 7 | Extend the floor beneath the table | polish | medium | small | — | Ground spans x −5..805, so right-side falls sink through the visible floor and vanish — reads as a glitch. |
| 8 | Show scores on level intro screens | polish | medium | small | — | showLevelIntro's score params and the intro score divs exist but are never wired — zero feedback between levels. |
| 9 | Persist total high score across visits | polish | medium | small | — | "Your High Score" resets on reload while per-object bests persist. Store it in localStorage too. |
| 10 | Label leaderboard as offline when local | polish | medium | small | — | API failure silently swaps in the private local list; players can't tell. Add a small "local scores" tag. |
| 11 | Add a whacker power indicator | gameplay | medium | medium | — | Pull strength is nearly invisible; a meter makes the core mechanic learnable in one toss. |
| 12 | Celebrate landings with score pops | gameplay | medium | medium | — | Floating +1 / squash when a piece settles in the score column; makes scoring legible and rewarding. |
| 13 | Add restart and quit-to-title controls | gameplay | medium | medium | — | No way to bail a bad run without finishing all three levels. R key + small HUD button, overlay-guarded. |
| 14 | Baseline accessibility pass on UI chrome | accessibility | medium | small | — | Restore focus outlines, label the name input, aria-live the score, honor prefers-reduced-motion — DOM only. |
| 15 | Improve ending screen on small phones | polish | medium | medium | — | Two-column ending layout scales to ~0.35× on phones; stack columns / enlarge type under (pointer: coarse). |
| 16 | Show leaderboard from the title screen | polish | low | small | — | The board is the long-term hook but only visible after a full run; add a title-screen button reusing the GET. |
| 17 | Display best score per player name | gameplay | low | small | — | One player can fill all ten slots; switch the top-10 query to best-per-name. |
| 18 | Preload game art during title screen | performance | low | small | — | Sprites/backdrop load lazily → first-toss pop-in on slow networks; preload during the title screen. |
| 19 | Auto-prune expired session rows | code-quality | low | small | — | sessions grows forever; delete day-old rows opportunistically inside the session POST. |
| 20 | Document server-mirrored gameplay constants | code-quality | low | small | — | api/scores.js hand-mirrors game constants and one has already drifted (2.0s vs 2500ms — intentional but undocumented). State the source of truth in both files. |
| 21 | Remove dead code and accidental global | code-quality | low | small | — | isHammoDone (never called), shotsTaken (write-only, stale comment), allDone (undeclared global), .stack-height div, old commented blocks. |
| 22 | Rewrite outdated README | code-quality | low | small | — | Still documents the removed picker, 5 shots, and old constraint stack, with a placeholder screenshot. |
