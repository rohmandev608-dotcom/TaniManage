const { createServer } = require('../server');

let server;
let startupError;
const usesPersistentDatabase = /^(?:postgres(?:ql)?|mysql|mariadb):\/\//i
  .test(process.env.DATABASE_URL || '');
if (usesPersistentDatabase) {
  try {
    server = createServer();
  } catch (error) {
    startupError = error;
  }
}

module.exports = async function handler(request, response) {
  if (!usesPersistentDatabase || !server) {
    response.statusCode = 503;
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    if (startupError) console.error('Gagal menginisialisasi database:', startupError.message);
    response.end('Konfigurasikan DATABASE_URL ke PostgreSQL, MySQL, atau MariaDB untuk deployment.');
    return;
  }

  try {
    await server.ready;
    await server.handleRequest(request, response);
  } catch (error) {
    console.error('Gagal menginisialisasi database deployment:', error);
    response.statusCode = 503;
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.end('Database belum siap.');
  }
};
