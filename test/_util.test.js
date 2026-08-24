const test = require('node:test');
const assert = require('node:assert/strict');

const { createReq } = require('./helpers/http');

const NEON_PATH = require.resolve('@neondatabase/serverless');
const UTIL_PATH = require.resolve('../api/_util');

// Loads api/_util.js fresh with a stubbed neon() so no connection is made.
function loadUtil() {
  const neonCalls = [];
  const savedNeon = require.cache[NEON_PATH];

  require.cache[NEON_PATH] = {
    id: NEON_PATH,
    filename: NEON_PATH,
    loaded: true,
    exports: {
      neon(url) {
        neonCalls.push(url);
        return function fakeSql() {};
      }
    }
  };
  delete require.cache[UTIL_PATH];
  try {
    return { util: require(UTIL_PATH), neonCalls };
  } finally {
    delete require.cache[UTIL_PATH];
    if (savedNeon) require.cache[NEON_PATH] = savedNeon;
    else delete require.cache[NEON_PATH];
  }
}

test('db() does not connect until it is called', () => {
  const { neonCalls } = loadUtil();
  assert.deepEqual(neonCalls, []);
});

test('db() connects with DATABASE_URL and memoizes the client', () => {
  const saved = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://user:pw@example.test/db';
  try {
    const { util, neonCalls } = loadUtil();
    const first = util.db();
    const second = util.db();
    assert.equal(first, second);
    assert.deepEqual(neonCalls, ['postgres://user:pw@example.test/db']);
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  }
});

test('clientIp uses the first hop of x-forwarded-for', () => {
  const { util } = loadUtil();
  const req = createReq({
    headers: { 'x-forwarded-for': ' 203.0.113.9 , 70.41.3.18, 150.172.238.178' },
    socket: { remoteAddress: '10.0.0.1' }
  });
  assert.equal(util.clientIp(req), '203.0.113.9');
});

test('clientIp falls back to the socket address when the header is absent or empty', () => {
  const { util } = loadUtil();
  assert.equal(
    util.clientIp(createReq({ socket: { remoteAddress: '10.0.0.1' } })),
    '10.0.0.1'
  );
  assert.equal(
    util.clientIp(createReq({ headers: { 'x-forwarded-for': '' }, socket: { remoteAddress: '10.0.0.1' } })),
    '10.0.0.1'
  );
  // A proxy that sends the header as an array is not trusted either.
  assert.equal(
    util.clientIp(createReq({ headers: { 'x-forwarded-for': ['1.2.3.4'] }, socket: { remoteAddress: '10.0.0.1' } })),
    '10.0.0.1'
  );
});

test('clientIp returns "unknown" with no header and no socket', () => {
  const { util } = loadUtil();
  assert.equal(util.clientIp(createReq({})), 'unknown');
  assert.equal(util.clientIp(createReq({ socket: {} })), 'unknown');
});
