// GET  /api/scores → { entries: [{ id, name, score }] }   (top 10)
// POST /api/scores   body { token, name, score }
//                  → { entries: [...], you: <inserted id> }
//
// A POST is accepted only if ALL of:
//  - the token exists, is unused, and is younger than 2 hours; it's marked
//    used atomically, so each game session can submit exactly once
//  - the duration-vs-score bound holds: the game must have run at least
//    MIN_GAME_SECONDS, and the score can't exceed the 21 base points
//    (3 levels × 7 tosses) plus one bonus point per BONUS_SECONDS_PER_POINT
//    of elapsed play — bonus shots arrive on a fixed 2.5 s timer in the
//    game, so a big score arriving quickly is physically impossible
//  - name/score pass shape validation and the per-IP rate limit
const { db, clientIp } = require('./_util');

const TOP_N = 10;
const MAX_SCORE = 200;                 // absolute sanity cap
const MIN_GAME_SECONDS = 12;           // floor for a physically possible 3-level run
const BASE_MAX_SCORE = 21;             // 3 levels × SHOTS_PER_LEVEL (7) base tosses
const BONUS_SECONDS_PER_POINT = 2.0;   // BONUS_DELAY_MS in lib/hamhuckin.js
const SUBMITS_PER_IP_PER_MINUTE = 4;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Arcade-style initials: letters/digits only, uppercased, exactly 1-3 chars.
// Offensive combos are replaced (not rejected) so a submission never fails
// over its name. Mirror any normalization change in submitLeaderboardName
// in lib/hamhuckin.js.
const NAME_DENYLIST = [
  'ASS', 'FUK', 'FUC', 'FCK', 'FUX', 'FAG', 'FGT', 'NIG', 'NGR', 'NGA',
  'KKK', 'CUM', 'JIZ', 'TIT', 'DIK', 'DIC', 'DCK', 'COK', 'CNT', 'TWT',
  'VAG', 'PIS', 'SHT', 'WTF', 'RAP', 'HOR', 'WHR', 'SLT'
];
function cleanName(raw) {
  const name = (typeof raw === 'string' ? raw : '')
    .replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 3);
  if (!name || NAME_DENYLIST.indexOf(name) !== -1) return 'AAA';
  return name;
}

function topScores(sql) {
  return sql`
    SELECT id, name, score FROM scores
    ORDER BY score DESC, created_at ASC
    LIMIT ${TOP_N}`;
}

module.exports = async function handler(req, res) {
  try {
    const sql = db();

    if (req.method === 'GET') {
      return res.status(200).json({ entries: await topScores(sql) });
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const body = req.body || {};
    const token = typeof body.token === 'string' ? body.token : '';
    const name = cleanName(body.name);
    const score = body.score;

    if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
      return res.status(400).json({ error: 'Invalid score' });
    }
    // Also guards the ::uuid cast below from throwing on garbage input.
    if (!UUID_RE.test(token)) {
      return res.status(403).json({ error: 'Invalid session' });
    }

    const ip = clientIp(req);
    const recent = await sql`
      SELECT count(*)::int AS n FROM scores
      WHERE ip = ${ip} AND created_at > now() - interval '1 minute'`;
    if (recent[0].n >= SUBMITS_PER_IP_PER_MINUTE) {
      return res.status(429).json({ error: 'Too many submissions, slow down' });
    }

    // Consume the token atomically and learn how long ago the game started.
    const consumed = await sql`
      UPDATE sessions SET used = true
      WHERE token = ${token}::uuid
        AND used = false
        AND created_at > now() - interval '2 hours'
      RETURNING extract(epoch FROM now() - created_at) AS elapsed`;
    if (consumed.length === 0) {
      return res.status(403).json({ error: 'Invalid session' });
    }
    const elapsed = Number(consumed[0].elapsed);

    if (elapsed < MIN_GAME_SECONDS) {
      return res.status(403).json({ error: 'Implausible game duration' });
    }
    const maxPlausible = BASE_MAX_SCORE + Math.floor(elapsed / BONUS_SECONDS_PER_POINT);
    if (score > maxPlausible) {
      return res.status(403).json({ error: 'Implausible score for game duration' });
    }

    const inserted = await sql`
      INSERT INTO scores (name, score, ip) VALUES (${name}, ${score}, ${ip})
      RETURNING id`;
    return res.status(200).json({
      entries: await topScores(sql),
      you: inserted[0].id
    });
  } catch (err) {
    console.error('scores error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
