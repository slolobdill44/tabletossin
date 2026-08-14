const test = require('node:test');
const assert = require('node:assert/strict');

const { createFakeSql } = require('./helpers/fake-sql');
const { createReq, createRes, loadHandlerWithUtil } = require('./helpers/http');

const TOKEN = '5d1e3f2a-1111-4222-8333-444455556666';
const TOP_ROWS = [
  { id: 1, name: 'AAA', score: 40 },
  { id: 2, name: 'BOB', score: 10 }
];

function load(sql, { ip = '203.0.113.9' } = {}) {
  return loadHandlerWithUtil('../../api/scores', { db: () => sql, clientIp: () => ip });
}

const topRule = () => ({ match: /SELECT id, name, score FROM scores/, rows: TOP_ROWS });
const rateRule = (n) => ({ match: /count\(\*\).*FROM scores/, rows: [{ n }] });
const consumeRule = (elapsed) => ({
  match: /UPDATE sessions SET used/,
  rows: elapsed === null ? [] : [{ elapsed }]
});
const insertRule = (id = 7) => ({ match: /INSERT INTO scores/, rows: [{ id }] });

// A fully happy path: token consumed after `elapsed` seconds of play.
function okRules(elapsed, insertedId) {
  return [topRule(), rateRule(0), consumeRule(elapsed), insertRule(insertedId)];
}

function post(body, rules, opts) {
  const sql = createFakeSql(rules);
  const res = createRes();
  return load(sql, opts)(createReq({ method: 'POST', body }), res).then(() => ({ res, sql }));
}

test('GET returns the top scores', async () => {
  const sql = createFakeSql([topRule()]);
  const res = createRes();
  await load(sql)(createReq({ method: 'GET' }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { entries: TOP_ROWS });
});

test('rejects other methods with 405 and an Allow header', async () => {
  const sql = createFakeSql([]);
  const res = createRes();
  await load(sql)(createReq({ method: 'PUT' }), res);
  assert.equal(res.statusCode, 405);
  assert.deepEqual(res.body, { error: 'Method not allowed' });
  assert.equal(res.headers.allow, 'GET, POST');
});

test('POST inserts a valid submission and returns the refreshed standings', async () => {
  const { res, sql } = await post(
    { token: TOKEN, name: 'zed', score: 30 },
    okRules(600, 42),
    { ip: '198.51.100.7' }
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { entries: TOP_ROWS, you: 42 });

  const insert = sql.calls.find((c) => /INSERT INTO scores/.test(c.text));
  assert.deepEqual(insert.values, ['ZED', 30, '198.51.100.7']);
});

test('POST with a missing body is treated as an invalid score', async () => {
  const { res } = await post(undefined, okRules(600));
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'Invalid score' });
});

test('score shape validation', async () => {
  for (const score of [undefined, null, '10', 10.5, NaN, -1, 201]) {
    const { res, sql } = await post({ token: TOKEN, name: 'AAA', score }, okRules(600));
    assert.equal(res.statusCode, 400, 'score ' + String(score) + ' should be rejected');
    assert.deepEqual(res.body, { error: 'Invalid score' });
    assert.equal(sql.calls.length, 0, 'rejected before any query');
  }
  // Boundaries are accepted (0 and the absolute cap).
  const zero = await post({ token: TOKEN, name: 'AAA', score: 0 }, okRules(600));
  assert.equal(zero.res.statusCode, 200);
  const cap = await post({ token: TOKEN, name: 'AAA', score: 200 }, okRules(100000));
  assert.equal(cap.res.statusCode, 200);
});

test('token must look like a uuid', async () => {
  for (const token of [undefined, '', 'not-a-uuid', TOKEN + 'a', TOKEN.replace('-', ''), 12345]) {
    const { res, sql } = await post({ token, name: 'AAA', score: 10 }, okRules(600));
    assert.equal(res.statusCode, 403, 'token ' + String(token) + ' should be rejected');
    assert.deepEqual(res.body, { error: 'Invalid session' });
    assert.equal(sql.calls.length, 0, 'rejected before the uuid cast');
  }
  const upper = await post({ token: TOKEN.toUpperCase(), name: 'AAA', score: 10 }, okRules(600));
  assert.equal(upper.res.statusCode, 200, 'uuids are matched case-insensitively');
});

test('rate limits at 4 submissions per ip per minute', async () => {
  const under = await post({ token: TOKEN, name: 'AAA', score: 10 }, [
    topRule(), rateRule(3), consumeRule(600), insertRule()
  ]);
  assert.equal(under.res.statusCode, 200);

  const { res, sql } = await post({ token: TOKEN, name: 'AAA', score: 10 }, [
    topRule(), rateRule(4), consumeRule(600), insertRule()
  ]);
  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.body, { error: 'Too many submissions, slow down' });
  assert.ok(!sql.calls.some((c) => /UPDATE sessions/.test(c.text)), 'token is not consumed');
});

test('an unknown, used, or expired token is rejected', async () => {
  const { res, sql } = await post({ token: TOKEN, name: 'AAA', score: 10 }, [
    topRule(), rateRule(0), consumeRule(null), insertRule()
  ]);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'Invalid session' });
  assert.ok(!sql.calls.some((c) => /INSERT INTO scores/.test(c.text)));
  const consume = sql.calls.find((c) => /UPDATE sessions/.test(c.text));
  assert.deepEqual(consume.values, [TOKEN]);
});

test('a game shorter than the 12s floor is implausible', async () => {
  const { res } = await post({ token: TOKEN, name: 'AAA', score: 1 }, okRules(11.9));
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'Implausible game duration' });

  const ok = await post({ token: TOKEN, name: 'AAA', score: 1 }, okRules(12));
  assert.equal(ok.res.statusCode, 200);
});

test('score is bounded by 21 base points plus one bonus point per 2s elapsed', async () => {
  // 30s elapsed → 21 + floor(30 / 2) = 36 allowed.
  const at = await post({ token: TOKEN, name: 'AAA', score: 36 }, okRules(30));
  assert.equal(at.res.statusCode, 200);

  const over = await post({ token: TOKEN, name: 'AAA', score: 37 }, okRules(30));
  assert.equal(over.res.statusCode, 403);
  assert.deepEqual(over.res.body, { error: 'Implausible score for game duration' });
});

test('name normalization', async () => {
  const cases = [
    ['zed', 'ZED'],
    ['a b!c', 'ABC'],
    ['abcdef', 'ABC'],
    ['a1', 'A1'],
    ['', 'AAA'],
    ['!!!', 'AAA'],
    [undefined, 'AAA'],
    [42, 'AAA'],
    ['ass', 'AAA'],
    ['WTF', 'AAA'],
    ['wtf!!', 'AAA']
  ];
  for (const [raw, expected] of cases) {
    const { sql } = await post({ token: TOKEN, name: raw, score: 10 }, okRules(600));
    const insert = sql.calls.find((c) => /INSERT INTO scores/.test(c.text));
    assert.equal(insert.values[0], expected, 'name ' + String(raw));
  }
});

test('returns 500 when a query fails', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { res } = await post({ token: TOKEN, name: 'AAA', score: 10 }, [
    { match: /count\(\*\).*FROM scores/, error: new Error('db down') }
  ]);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: 'Server error' });
});
