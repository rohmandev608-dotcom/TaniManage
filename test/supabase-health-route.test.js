const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');

test('Supabase health endpoint is available on the local server', async (context) => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const server = createServer({ databasePath: ':memory:' });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  });

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/supabase-health`
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    connected: false,
    error: 'Supabase environment variables are not configured.',
    missingVariables: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
  });
});
