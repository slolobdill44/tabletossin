// Shared helpers for the api/ serverless functions. The leading underscore
// keeps Vercel from exposing this file as an endpoint.
const { neon } = require('@neondatabase/serverless');

// Lazy so a missing DATABASE_URL fails per-request (500, and the game falls
// back to its local leaderboard) instead of crashing the function at load.
let _sql = null;
function db() {
  if (!_sql) _sql = neon(process.env.DATABASE_URL);
  return _sql;
}

// First hop of x-forwarded-for is the real client on Vercel (it normalizes
// the header at the edge).
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Per-IP rate limit shared by both endpoints: how many rows this IP has
// written to `table` in the last minute. The table name is interpolated, so
// it must never come from request data (both callers pass a literal).
async function recentCountForIp(sql, table, ip) {
  const rows = await sql.query(
    `SELECT count(*)::int AS n FROM ${table}
     WHERE ip = $1 AND created_at > now() - interval '1 minute'`,
    [ip]
  );
  return rows[0].n;
}

function methodNotAllowed(res, allow) {
  res.setHeader('Allow', allow);
  return res.status(405).json({ error: 'Method not allowed' });
}

function serverError(res, label, err) {
  console.error(label + ' error:', err);
  return res.status(500).json({ error: 'Server error' });
}

module.exports = { db, clientIp, recentCountForIp, methodNotAllowed, serverError };
