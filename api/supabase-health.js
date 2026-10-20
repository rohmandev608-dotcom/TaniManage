const REQUIRED_ENVIRONMENT_VARIABLES = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY'
];

module.exports = async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.statusCode = 405;
    response.end('Method not allowed.');
    return;
  }

  const missingVariables = REQUIRED_ENVIRONMENT_VARIABLES
    .filter((name) => !process.env[name]);
  if (missingVariables.length > 0) {
    response.statusCode = 503;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({
      connected: false,
      error: 'Supabase environment variables are not configured.',
      missingVariables
    }));
    return;
  }

  let projectUrl;
  try {
    projectUrl = new URL(process.env.SUPABASE_URL);
  } catch {
    response.statusCode = 503;
    response.end('SUPABASE_URL must be a valid URL.');
    return;
  }

  if (projectUrl.protocol !== 'https:' && projectUrl.hostname !== 'localhost') {
    response.statusCode = 503;
    response.end('SUPABASE_URL must use HTTPS.');
    return;
  }

  projectUrl.pathname = '/rest/v1/';
  projectUrl.search = '';

  let supabaseResponse;
  try {
    supabaseResponse = await fetch(projectUrl, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      signal: AbortSignal.timeout(5000)
    });
  } catch {
    response.statusCode = 502;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({
      connected: false,
      error: 'Could not reach the Supabase REST API.'
    }));
    return;
  }

  response.statusCode = supabaseResponse.ok ? 200 : 502;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify({
    connected: supabaseResponse.ok,
    status: supabaseResponse.status
  }));
};
