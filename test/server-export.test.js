const test = require('node:test');
const assert = require('node:assert/strict');
const server = require('../server');
const handler = require('../api/index');

test('Vercel API module exports a handler and server keeps local helpers', () => {
  assert.equal(typeof handler, 'function');
  assert.equal(typeof server, 'object');
  assert.equal(typeof server.createServer, 'function');
  assert.equal(typeof server.bootstrapAdmin, 'function');
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
    await handler({}, response);
    assert.equal(response.statusCode, 503);
    assert.match(response.body, /DATABASE_URL/);
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test('Vercel rewrite path is restored while preserving query parameters', () => {
  const request = { url: '/api/index?__app_path=%2Flogin&next=%2Fdashboard' };
  handler.restoreRewrittenPath(request);
  assert.equal(request.url, '/login?next=%2Fdashboard');
});

test('deployment handler identifies a missing CA file without exposing secrets', async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousCaFile = process.env.DATABASE_SSL_CA_FILE;
  process.env.DATABASE_URL = 'postgres://localhost/test';
  process.env.DATABASE_SSL_CA_FILE = './missing-ca-for-test.crt';
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
    await handler({}, response);
    assert.equal(response.statusCode, 503);
    assert.match(response.body, /CA certificate file tidak ditemukan/);
    assert.doesNotMatch(response.body, /postgres:\/\//);
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousCaFile === undefined) delete process.env.DATABASE_SSL_CA_FILE;
    else process.env.DATABASE_SSL_CA_FILE = previousCaFile;
  }
});
