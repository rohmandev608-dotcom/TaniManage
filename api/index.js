const app = require('../index');

function restoreRewrittenPath(request) {
  const requestUrl = new URL(request.url || '/', 'http://localhost');
  const appPath = requestUrl.searchParams.get('__app_path');
  if (appPath === null) return;
  if (!appPath.startsWith('/') || appPath.startsWith('//')
    || /[?#\\]/.test(appPath)) {
    throw new Error('Path hasil rewrite Vercel tidak valid.');
  }

  requestUrl.searchParams.delete('__app_path');
  request.url = `${appPath}${requestUrl.search}`;
}

function handler(request, response) {
  try {
    restoreRewrittenPath(request);
  } catch {
    response.statusCode = 400;
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.end('Request tidak valid.');
    return;
  }

  const usesPersistentDatabase = /^(?:postgres(?:ql)?|mysql|mariadb):\/\//i
    .test(process.env.DATABASE_URL || '');
  if (!usesPersistentDatabase) {
    response.statusCode = 503;
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.end('Konfigurasikan DATABASE_URL ke PostgreSQL, MySQL, atau MariaDB untuk deployment.');
    return;
  }

  return app(request, response);
}

module.exports = handler;
module.exports.restoreRewrittenPath = restoreRewrittenPath;
