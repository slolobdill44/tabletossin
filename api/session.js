// POST /api/session → { token }
//
// Issues a one-time game-session token, requested by the client at game
// start. Its age at score-submission time drives the duration-vs-score
// bound in api/scores.js, and single-use means one submission per game
// actually played.
const { db, clientIp } = require('./_util');

const TOKENS_PER_IP_PER_MINUTE = 12;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const sql = db();
    const ip = clientIp(req);

    const recent = await sql`
      SELECT count(*)::int AS n FROM sessions
      WHERE ip = ${ip} AND created_at > now() - interval '1 minute'`;
    if (recent[0].n >= TOKENS_PER_IP_PER_MINUTE) {
      return res.status(429).json({ error: 'Too many sessions, slow down' });
    }

    const rows = await sql`INSERT INTO sessions (ip) VALUES (${ip}) RETURNING token`;
    return res.status(200).json({ token: rows[0].token });
  } catch (err) {
    console.error('session error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
