// POST /api/session → { token }
//
// Issues a one-time game-session token, requested by the client at game
// start. Its age at score-submission time drives the duration-vs-score
// bound in api/scores.js, and single-use means one submission per game
// actually played.
const { db, clientIp, recentCountForIp, methodNotAllowed, serverError } = require('./_util');

const TOKENS_PER_IP_PER_MINUTE = 12;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
  try {
    const sql = db();
    const ip = clientIp(req);

    if (await recentCountForIp(sql, 'sessions', ip) >= TOKENS_PER_IP_PER_MINUTE) {
      return res.status(429).json({ error: 'Too many sessions, slow down' });
    }

    const rows = await sql`INSERT INTO sessions (ip) VALUES (${ip}) RETURNING token`;
    return res.status(200).json({ token: rows[0].token });
  } catch (err) {
    return serverError(res, 'session', err);
  }
};
