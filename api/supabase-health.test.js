const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('./supabase-health');

function createResponse() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body) {
      this.body = body;
    }
  };
}

test('Supabase health check reports missing environment variable names only', async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    const response = createResponse();
    await handler({ method: 'GET' }, response);

    assert.equal(response.statusCode, 503);
    assert.deepEqual(JSON.parse(response.body).missingVariables, [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY'
    ]);
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

test('Supabase health check validates API credentials without returning them', async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousFetch = global.fetch;
  const secret = 'test-only-supabase-service-role-key';
  process.env.SUPABASE_URL = 'https://project.example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = secret;
  global.fetch = async (url, options) => {
    assert.equal(url.href, 'https://project.example.supabase.co/rest/v1/');
    assert.equal(options.headers.apikey, secret);
    assert.equal(options.headers.Authorization, `Bearer ${secret}`);
    return { ok: true, status: 200 };
  };

  try {
    const response = createResponse();
    await handler({ method: 'GET' }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { connected: true, status: 200 });
    assert.equal(response.body.includes(secret), false);
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
    global.fetch = previousFetch;
  }
});

test('Supabase health check rejects non-GET requests', async () => {
  const response = createResponse();
  await handler({ method: 'POST' }, response);

  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.Allow, 'GET');
});
