// Minimal stand-ins for the Vercel (Node-style) req/res objects the api/
// handlers are written against.
function createReq({ method = 'GET', headers = {}, body, socket } = {}) {
  return { method, headers, body, socket };
}

function createRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) {
      res.headers[name.toLowerCase()] = value;
      return res;
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    }
  };
  return res;
}

// Loads an api/ handler with './_util' replaced by the given exports, so the
// handler never touches a real database. Returns a fresh handler instance.
function loadHandlerWithUtil(handlerRelPath, utilExports) {
  const utilPath = require.resolve('../../api/_util');
  const handlerPath = require.resolve(handlerRelPath);
  const savedUtil = require.cache[utilPath];

  require.cache[utilPath] = {
    id: utilPath,
    filename: utilPath,
    loaded: true,
    exports: utilExports
  };
  delete require.cache[handlerPath];
  try {
    return require(handlerPath);
  } finally {
    delete require.cache[handlerPath];
    if (savedUtil) require.cache[utilPath] = savedUtil;
    else delete require.cache[utilPath];
  }
}

module.exports = { createReq, createRes, loadHandlerWithUtil };
