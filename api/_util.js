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

module.exports = { db, clientIp };
