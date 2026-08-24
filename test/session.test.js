const test = require('node:test');
const assert = require('node:assert/strict');

const { createFakeSql } = require('./helpers/fake-sql');
const { createReq, createRes, loadHandlerWithUtil } = require('./helpers/http');

const TOKEN = '5d1e3f2a-1111-4222-8333-444455556666';

function load(sql, { ip = '203.0.113.9' } = {}) {
  return loadHandlerWithUtil('../../api/session', { db: () => sql, clientIp: () => ip });
}

function countRule(n) {
  return { match: /count\(\*\).*FROM sessions/, rows: [{ n }] };
}

function insertRule(token = TOKEN) {
  return { match: /INSERT INTO sessions/, rows: [{ token }] };
}

test('rejects non-POST methods with 405 and an Allow header', async () => {
  const sql = createFakeSql([]);
  const handler = load(sql);
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const res = createRes();
    await handler(createReq({ method }), res);
    assert.equal(res.statusCode, 405);
    assert.deepEqual(res.body, { error: 'Method not allowed' });
    assert.equal(res.headers.allow, 'POST');
  }
  assert.equal(sql.calls.length, 0);
});

test('issues a token and records the client ip', async () => {
  const sql = createFakeSql([countRule(0), insertRule()]);
  const handler = load(sql, { ip: '198.51.100.7' });
  const res = createRes();

  await handler(createReq({ method: 'POST' }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { token: TOKEN });
  assert.deepEqual(sql.calls[0].values, ['198.51.100.7']);
  assert.deepEqual(sql.calls[1].values, ['198.51.100.7']);
});

test('allows the last token under the per-ip minute limit', async () => {
  const sql = createFakeSql([countRule(11), insertRule()]);
  const res = createRes();
  await load(sql)(createReq({ method: 'POST' }), res);
  assert.equal(res.statusCode, 200);
});

test('rate limits at 12 tokens per ip per minute', async () => {
  const sql = createFakeSql([countRule(12), insertRule()]);
  const res = createRes();
  await load(sql)(createReq({ method: 'POST' }), res);
  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.body, { error: 'Too many sessions, slow down' });
  assert.equal(sql.calls.length, 1, 'no insert after a rate-limit rejection');
});

test('returns 500 when a query fails', async (t) => {
  t.mock.method(console, 'error', () => {});
  const sql = createFakeSql([{ match: /FROM sessions/, error: new Error('db down') }]);
  const res = createRes();
  await load(sql)(createReq({ method: 'POST' }), res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: 'Server error' });
});
