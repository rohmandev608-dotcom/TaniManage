const { createServer } = require('../server');

let server;

function getStartupErrorMessage(error) {
  if (error.code === 'ENOENT' && process.env.DATABASE_SSL_CA_FILE) {
    return 'CA certificate file tidak ditemukan di deployment. Set DATABASE_SSL_CA_CERT di Vercel atau sertakan file CA dalam deployment.';
  }
  const code = typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
    ? ` (${error.code})`
    : '';
  return `Database belum siap${code}. Periksa Runtime Logs pada deployment Vercel.`;
}


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

module.exports = async function handler(request, response) {
  try {
    restoreRewrittenPath(request);
  } catch (error) {
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

  if (!server) {
    try {
      server = createServer();
    } catch (error) {
      console.error('Gagal menginisialisasi database:', error);
      response.statusCode = 503;
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.end(getStartupErrorMessage(error));
      return;
    }
  }

  try {
    await server.ready;
    await server.handleRequest(request, response);
  } catch (error) {
    console.error('Gagal menginisialisasi database deployment:', error);
    response.statusCode = 503;
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.end(getStartupErrorMessage(error));
  }
};

module.exports.restoreRewrittenPath = restoreRewrittenPath;
