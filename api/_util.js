// Shared helpers for the api/ serverless functions. The leading underscore
// keeps Vercel from exposing this file as an endpoint.
const { neon } = require('@neondatabase/serverless');

// Thrown when the function is deployed without the config it needs. Kept
// distinct from a runtime failure so the log says "fix the deploy" rather
// than looking like a transient database error.
class ConfigError extends Error {}

// Lazy so a missing DATABASE_URL fails per-request (500, and the game falls
// back to its local leaderboard) instead of crashing the function at load.
let _sql = null;
function db() {
  if (!process.env.DATABASE_URL) {
    throw new ConfigError('DATABASE_URL is not set');
  }
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

// Single exit for anything unexpected: the full error (with its stack) is
// logged alongside the request that caused it, and the client gets a generic
// message. Never swallow — every catch block in api/ ends up here.
function serverError(res, err, context) {
  const isConfig = err instanceof ConfigError;
  console.error(
    (isConfig ? 'CONFIG ERROR' : 'ERROR') + ' ' + context + ':',
    (err && err.stack) || err
  );
  return res.status(500).json({
    error: isConfig ? 'Leaderboard is not configured' : 'Server error'
  });
}

// Vercel parses JSON bodies when the content-type says so; anything else
// arrives as a raw string. Parse it here so a malformed body becomes an
// explicit 400 instead of being read as an empty object and rejected later
// with a misleading "Invalid session".
function parseJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim().length) {
    const parsed = JSON.parse(req.body);  // caller turns a throw into a 400
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('body is not a JSON object');
    }
    return parsed;
  }
  return {};
}

module.exports = { db, clientIp, serverError, parseJsonBody, ConfigError };
