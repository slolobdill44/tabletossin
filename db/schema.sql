-- Table Tossin' leaderboard schema. Run once against the Neon database
-- (Vercel dashboard → Storage → your Neon DB → SQL editor, or:
--   psql "$DATABASE_URL" -f db/schema.sql

-- One row per game started. api/session.js inserts; api/scores.js consumes
-- (marks used) and uses the row's age for the duration-vs-score bound.
CREATE TABLE IF NOT EXISTS sessions (
  token      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  used       boolean NOT NULL DEFAULT false,
  ip         text
);

CREATE TABLE IF NOT EXISTS scores (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  score      integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ip         text
);

-- Top-10 reads and the per-IP rate-limit counts.
CREATE INDEX IF NOT EXISTS scores_top_idx        ON scores  (score DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS scores_ip_recent_idx  ON scores  (ip, created_at DESC);
CREATE INDEX IF NOT EXISTS sessions_ip_recent_idx ON sessions (ip, created_at DESC);
