const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const DatabaseConnection = require('./DatabaseConnection');
const Database = require('./Database');

test('database URLs select PostgreSQL and MySQL-compatible drivers', async () => {
  const postgres = new DatabaseConnection({
    connectionString: 'postgresql://user:password@127.0.0.1:5432/app'
  });
  const mysql = new DatabaseConnection({
    connectionString: 'mysql://user:password@127.0.0.1:3306/app'
  });
  const mariadb = new DatabaseConnection({
    connectionString: 'mariadb://user:password@127.0.0.1:3306/app'
  });

  try {
    assert.equal(postgres.dialect, 'postgres');
    assert.equal(mysql.dialect, 'mysql');
    assert.equal(mariadb.dialect, 'mysql');
  } finally {
    await Promise.all([postgres.close(), mysql.close(), mariadb.close()]);
  }
});

test('sqlite DATABASE_URL remains available for explicit local configuration', async () => {
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'sqlite::memory:';
  const database = new Database();
  try {
    assert.equal(database.dialect, 'sqlite');
    assert.equal(await database.getUserCount(), 0);
  } finally {
    await database.close();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  }
});

test('database SQL adapter translates placeholders and conflict syntax per driver', () => {
  assert.equal(
    DatabaseConnection.formatSql(
      'SELECT name FROM users WHERE id = ? ORDER BY name COLLATE NOCASE',
      'postgres'
    ),
    'SELECT name FROM users WHERE id = $1 ORDER BY name'
  );
  assert.equal(
    DatabaseConnection.formatSql(
      'INSERT INTO owner_invites (owner_id, invite_code) VALUES (?, ?) ON CONFLICT(owner_id) DO NOTHING',
      'mysql'
    ),
    'INSERT IGNORE INTO owner_invites (owner_id, invite_code) VALUES (?, ?)'
  );
  assert.equal(
    DatabaseConnection.formatSql('INSERT INTO users (email) VALUES (?)', 'mysql'),
    'INSERT INTO users (email) VALUES (?)'
  );
});

test('custom TLS CA is trusted without disabling certificate verification', (context) => {
  const previousCaFile = process.env.DATABASE_SSL_CA_FILE;
  const previousCaCertificate = process.env.DATABASE_SSL_CA_CERT;
  const previousSsl = process.env.DATABASE_SSL;
  const caFile = path.join(os.tmpdir(), `db-ca-${process.pid}.pem`);
  const caCertificate = '-----BEGIN CERTIFICATE-----\ntest-ca\n-----END CERTIFICATE-----';
  fs.writeFileSync(caFile, caCertificate);
  context.after(() => {
    fs.rmSync(caFile, { force: true });
    if (previousCaFile === undefined) delete process.env.DATABASE_SSL_CA_FILE;
    else process.env.DATABASE_SSL_CA_FILE = previousCaFile;
    if (previousCaCertificate === undefined) delete process.env.DATABASE_SSL_CA_CERT;
    else process.env.DATABASE_SSL_CA_CERT = previousCaCertificate;
    if (previousSsl === undefined) delete process.env.DATABASE_SSL;
    else process.env.DATABASE_SSL = previousSsl;
  });

  process.env.DATABASE_SSL_CA_FILE = caFile;
  delete process.env.DATABASE_SSL_CA_CERT;
  delete process.env.DATABASE_SSL;
  assert.deepEqual(DatabaseConnection.getSslConfig(), {
    ca: caCertificate,
    rejectUnauthorized: true
  });
  process.env.DATABASE_SSL_CA_CERT = caCertificate.replace(/\n/g, '\\n');
  assert.deepEqual(DatabaseConnection.getSslConfig(), {
    ca: caCertificate,
    rejectUnauthorized: true
  });
  assert.equal(
    DatabaseConnection.removeConnectionStringSslOptions(
      'postgresql://user:secret@db.example.test:5432/app?sslmode=require&application_name=tani'
    ),
    'postgresql://user:secret@db.example.test:5432/app?application_name=tani'
  );
  process.env.DATABASE_SSL = 'disable';
  assert.equal(DatabaseConnection.getSslConfig(), false);
});

test('PostgreSQL inserts only request generated IDs from tables that have them', async () => {
  const queries = [];
  const connection = Object.create(DatabaseConnection.prototype);
  connection.dialect = 'postgres';
  connection.ready = Promise.resolve();
  connection.transactions = { getStore: () => null };
  connection.pool = {
    async query(sql) {
      queries.push(sql);
      return { rowCount: 1, rows: [{ id: 12 }] };
    }
  };

  await connection.query(
    'INSERT INTO sessions (token_hash, user_id) VALUES (?, ?)',
    ['hash', 1],
    'run'
  );
  await connection.query(
    'INSERT INTO users (name, email) VALUES (?, ?)',
    ['Petani', 'petani@example.test'],
    'run'
  );

  assert.doesNotMatch(queries[0], /RETURNING/);
  assert.match(queries[1], /RETURNING id/);
});

test('fresh PostgreSQL and MySQL databases receive compatible schemas', async () => {
  for (const dialect of ['postgres', 'mysql']) {
    const statements = [];
    const pool = {
      async query(sql) {
        statements.push(sql);
      },
      async execute(sql) {
        statements.push(sql);
        return [[], []];
      }
    };
    const database = Object.create(Database.prototype);
    database.dialect = dialect;
    database.connection = { pool };

    await database.initializeRemoteSchema();

    const schema = statements.join('\n');
    assert.match(schema, /CREATE TABLE IF NOT EXISTS users/);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS sessions/);
    assert.doesNotMatch(schema, /AUTOINCREMENT|PRAGMA|COLLATE NOCASE/);
    if (dialect === 'postgres') {
      assert.match(schema, /BIGSERIAL PRIMARY KEY/);
      assert.match(schema, /created_at TIMESTAMPTZ/);
      assert.match(schema, /users_email_lower_unique/);
      assert.match(schema, /crop_cycles_one_active_per_field[\s\S]*WHERE status = 'active'/);
    } else {
      assert.match(schema, /token_hash VARCHAR\(128\) PRIMARY KEY/);
      assert.match(schema, /created_at DATETIME/);
      assert.match(schema, /active_field_id BIGINT GENERATED ALWAYS/);
      assert.match(schema, /ON crop_cycles\(active_field_id\)/);
      assert.doesNotMatch(schema, /IF NOT EXISTS \w+\s+ON|WHERE status = 'active'/);
    }
  }
});
