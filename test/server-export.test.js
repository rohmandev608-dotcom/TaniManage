const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const server = require('../server');
const handler = require('../api/index');
const app = require('../index');

test('Vercel API module exports the Express app handler and server keeps local helpers', () => {
  assert.equal(typeof handler, 'function');
  assert.equal(typeof server, 'object');
  assert.equal(typeof server.createServer, 'function');
  assert.equal(typeof server.bootstrapAdmin, 'function');
});

test('Express entry point serves existing application routes', async () => {
  const application = app.createApp({ databasePath: ':memory:' });
  const deploymentServer = http.createServer(application);
  await new Promise((resolve) => deploymentServer.listen(0, resolve));

  try {
    const address = deploymentServer.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/login`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Masuk ke akun TaniManage Anda/);
  } finally {
    await new Promise((resolve, reject) => {
      deploymentServer.close((error) => error ? reject(error) : resolve());
    });
  }
});

test('Vercel handler requires a persistent database configuration', async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const response = {
    setHeader(name, value) {
      this.headers = { ...this.headers, [name]: value };
    },
    end(body) {
      this.body = body;
    }
  };

  try {
    await handler({ url: '/login' }, response);
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

test('Vercel handler rejects invalid rewritten paths', async () => {
  const deploymentServer = http.createServer(handler);
  await new Promise((resolve) => deploymentServer.listen(0, resolve));

  try {
    const address = deploymentServer.address();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/index?__app_path=%2F%2Fexample.com`
    );
    assert.equal(response.status, 400);
    assert.equal(await response.text(), 'Request tidak valid.');
  } finally {
    await new Promise((resolve, reject) => {
      deploymentServer.close((error) => error ? reject(error) : resolve());
    });
  }
});
