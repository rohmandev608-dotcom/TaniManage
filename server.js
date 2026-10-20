const http = require('node:http');
const Router = require('./app/core/Router');
const registerWebRoutes = require('./routes/web');
const Database = require('./app/models/Database');
const Sessions = require('./app/core/Sessions');
const Security = require('./app/core/Security');
const { loadSession } = require('./app/middleware/auth');
const { parseFormBody } = require('./app/middleware/formBody');

async function bootstrapAdmin(database, environment = process.env) {
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
  if (await database.getUserCount() !== 0) {
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

  await database.createUser({
    name: name.trim(),
    email,
    passwordHash: Security.hashPassword(password),
    role: 'admin'
  });
  console.info('Akun admin awal berhasil dibuat.');
}

function createServer(options = {}) {
  const database = new Database(options.databasePath);
  const ready = database.ready.then(() => bootstrapAdmin(database, options.bootstrap));
  const sessions = new Sessions(database);
  const router = new Router();

  router.use(parseFormBody);
  router.use(loadSession(sessions, database));
  registerWebRoutes(router, { database, sessions });

  const handleRequest = async (request, response) => {
    try {
      await ready;
      await router.handle(request, response);
    } catch (error) {
      console.error('Gagal menangani request:', error);
      if (!response.headersSent) {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      if (!response.writableEnded) {
        response.end('Terjadi kesalahan pada server.');
      }
    }
  };
  const server = http.createServer(handleRequest);

  server.on('close', () => {
    database.close().catch((error) => console.error('Gagal menutup database:', error));
  });
  server.ready = ready;
  server.database = database;
  server.handleRequest = handleRequest;
  return server;
}

let deploymentServer;
let deploymentStartupError;

async function deploymentHandler(request, response) {
  const usesPersistentDatabase = /^(?:postgres(?:ql)?|mysql|mariadb):\/\//i
    .test(process.env.DATABASE_URL || '');
  if (!usesPersistentDatabase) {
    response.statusCode = 503;
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.end('Konfigurasikan DATABASE_URL ke PostgreSQL, MySQL, atau MariaDB untuk deployment.');
    return;
  }

  if (!deploymentServer && !deploymentStartupError) {
    try {
      deploymentServer = createServer();
    } catch (error) {
      deploymentStartupError = error;
    }
  }
  if (!deploymentServer) {
    console.error('Gagal menginisialisasi database:', deploymentStartupError.message);
    response.statusCode = 503;
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.end('Database belum siap.');
    return;
  }

  try {
    await deploymentServer.ready;
    await deploymentServer.handleRequest(request, response);
  } catch (error) {
    console.error('Gagal menginisialisasi database deployment:', error);
    response.statusCode = 503;
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.end('Database belum siap.');
  }
}

if (require.main === module) {
  const server = createServer();
  const port = Number(process.env.PORT) || 3000;
  server.ready.then(() => {
    server.listen(port, () => {
      console.log(`Web Petani berjalan di http://localhost:${port}`);
    });
  }).catch(async (error) => {
    console.error('Gagal menyiapkan koneksi database:', error.message);
    if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
      console.error(
        'Periksa host pada DATABASE_URL di Supabase Dashboard > Project Settings > Database. '
        + 'Salin ulang connection string, atau coba connection pooler jika DNS/network tidak mendukung direct connection.'
      );
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      console.error(
        'Periksa status proyek Supabase, port database, firewall, dan connection string.'
      );
    } else if (error.code === 'SELF_SIGNED_CERT_IN_CHAIN'
      || error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
      console.error(
        'TLS certificate tidak dipercaya. Jika jaringan memakai proxy inspeksi TLS, minta CA certificate resmi dari administrator jaringan, simpan sebagai file PEM, lalu set DATABASE_SSL_CA_FILE ke path file tersebut. Jangan menonaktifkan verifikasi sertifikat.'
      );
    }
    try {
      await server.database.close();
    } catch (closeError) {
      console.error('Gagal menutup koneksi database:', closeError.message);
    }
    process.exitCode = 1;
  });
}

module.exports = Object.assign(deploymentHandler, { createServer, bootstrapAdmin });
