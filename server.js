const http = require('node:http');
const Router = require('./app/core/Router');
const registerWebRoutes = require('./routes/web');
const Database = require('./app/models/Database');
const Sessions = require('./app/core/Sessions');
const Security = require('./app/core/Security');
const { loadSession } = require('./app/middleware/auth');
const { parseFormBody } = require('./app/middleware/formBody');

function bootstrapAdmin(database, environment = process.env) {
  const values = [
    environment.BOOTSTRAP_ADMIN_NAME,
    environment.BOOTSTRAP_ADMIN_EMAIL,
    environment.BOOTSTRAP_ADMIN_PASSWORD
  ];
  const configuredCount = values.filter((value) => value !== undefined).length;

  if (configuredCount === 0) {
    return;
  }
  if (configuredCount !== values.length) {
    throw new Error('Konfigurasi bootstrap admin harus mengisi NAME, EMAIL, dan PASSWORD.');
  }
  if (database.getUserCount() !== 0) {
    console.info('Bootstrap admin dilewati karena database sudah berisi pengguna.');
    return;
  }

  const [name, rawEmail, password] = values;
  const email = rawEmail.trim().toLowerCase();
  if (name.trim().length < 2 || name.trim().length > 80
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || password.length < 12 || password.length > 128) {
    throw new Error('Nama, email, atau password bootstrap admin tidak valid.');
  }

  database.createUser({
    name: name.trim(),
    email,
    passwordHash: Security.hashPassword(password),
    role: 'admin'
  });
  console.info('Akun admin awal berhasil dibuat.');
}

function createServer(options = {}) {
  const database = new Database(options.databasePath);
  bootstrapAdmin(database, options.bootstrap);
  const sessions = new Sessions(database);
  const router = new Router();

  router.use(parseFormBody);
  router.use(loadSession(sessions, database));
  registerWebRoutes(router, { database, sessions });

  const server = http.createServer((request, response) => {
    router.handle(request, response).catch((error) => {
      console.error('Gagal menangani request:', error);
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      if (!response.writableEnded) {
        response.end('Terjadi kesalahan pada server.');
      }
    });
  });

  server.on('close', () => database.close());
  return server;
}

if (require.main === module) {
  const server = createServer();
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => {
    console.log(`Web Petani berjalan di http://localhost:${port}`);
  });
}

module.exports = { createServer, bootstrapAdmin };
