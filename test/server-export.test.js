const test = require('node:test');
const assert = require('node:assert/strict');
const server = require('../server');

test('server module exports a callable deployment handler and local helpers', () => {
  assert.equal(typeof server, 'function');
  assert.equal(typeof server.createServer, 'function');
  assert.equal(typeof server.bootstrapAdmin, 'function');
  assert.equal(require('../api/index'), server);
});

test('deployment handler requires a persistent database configuration', async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const response = {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body) {
      this.body = body;
    }
  };
  try {
    await server({}, response);
    assert.equal(response.statusCode, 503);
    assert.match(response.body, /DATABASE_URL/);
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});
