const { AsyncLocalStorage } = require('node:async_hooks');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const TABLES_WITH_GENERATED_IDS = new Set([
  'users',
  'worker_activities',
  'lands',
  'crop_cycles',
  'financial_transactions',
  'inventory_items',
  'field_activities',
  'owner_worker_assignments',
  'inventory_movements'
]);

function getPoolMax() {
  const value = process.env.DATABASE_POOL_MAX;
  if (value === undefined || value === '') return 5;
  const poolMax = Number(value);
  if (!Number.isSafeInteger(poolMax) || poolMax < 1) {
    throw new Error('DATABASE_POOL_MAX harus berupa bilangan bulat positif.');
  }
  return poolMax;
}

function getSslConfig() {
  if (process.env.DATABASE_SSL === 'disable') return false;
  const caCertificate = process.env.DATABASE_SSL_CA_CERT;
  if (caCertificate) {
    return {
      ca: caCertificate.replace(/\\n/g, '\n'),
      rejectUnauthorized: true
    };
  }
  const caFile = process.env.DATABASE_SSL_CA_FILE;
  if (!caFile) return true;
  return {
    ca: fs.readFileSync(caFile, 'utf8'),
    rejectUnauthorized: true
  };
}

function removeConnectionStringSslOptions(connectionString) {
  const url = new URL(connectionString);
  for (const parameter of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'sslpassword']) {
    url.searchParams.delete(parameter);
  }
  return url.toString();
}

function formatSql(sql, dialect) {
  let formatted = sql.replace(/\s+COLLATE NOCASE\b/gi, '');
  if (dialect === 'postgres') {
    let index = 0;
    formatted = formatted.replace(/\?/g, () => `$${++index}`);
  } else if (dialect === 'mysql' && /\bON CONFLICT\b/i.test(formatted)) {
    formatted = formatted
      .replace(/^(\s*)INSERT INTO\b/i, '$1INSERT IGNORE INTO')
      .replace(/\s+ON CONFLICT\s*\([^)]*\)\s+DO NOTHING\s*$/i, '');
  }
  return formatted;
}

class DatabaseConnection {
  constructor({ filename, connectionString }) {
    this.transactions = new AsyncLocalStorage();
    this.databaseSync = null;
    this.pool = null;
    this.ready = Promise.resolve();
    this.asyncMode = false;
    this.sqliteQueue = Promise.resolve();
    this.sqliteTransactionToken = {};
    this.dialect = 'sqlite';

    if (connectionString) {
      if (process.env.NODE_ENV === 'production' && process.env.DATABASE_SSL === 'disable') {
        throw new Error('DATABASE_SSL=disable tidak diizinkan di production.');
      }
      const protocol = new URL(connectionString).protocol;
      if (protocol === 'postgres:' || protocol === 'postgresql:') {
        this.dialect = 'postgres';
        const pg = require('pg');
        pg.types.setTypeParser(20, Number);
        const { Pool } = pg;
        this.pool = new Pool({
          connectionString: removeConnectionStringSslOptions(connectionString),
          ssl: getSslConfig(),
          max: getPoolMax()
        });
      } else if (protocol === 'mysql:' || protocol === 'mariadb:') {
        this.dialect = 'mysql';
        const mysql = require('mysql2/promise');
        const mysqlUrl = connectionString.replace(/^mariadb:/i, 'mysql:');
        const mysqlOptions = {
          uri: mysqlUrl,
          connectionLimit: getPoolMax(),
          supportBigNumbers: true,
          bigNumberStrings: false
        };
        if (process.env.DATABASE_SSL === 'disable') mysqlOptions.ssl = undefined;
        else if (process.env.DATABASE_SSL_CA_FILE) mysqlOptions.ssl = getSslConfig();
        else if (process.env.NODE_ENV === 'production' || process.env.DATABASE_SSL === 'enable') {
          mysqlOptions.ssl = true;
        }
        this.pool = mysql.createPool(mysqlOptions);
      } else {
        throw new Error(`Jenis database tidak didukung: ${protocol}`);
      }
    } else {
      this.databaseSync = new DatabaseSync(filename);
    }
  }

  prepare(sql) {
    if (this.databaseSync && !this.asyncMode) {
      return this.databaseSync.prepare(sql);
    }

    return {
      get: async (...parameters) => {
        const result = await this.query(sql, parameters, 'get');
        return result;
      },
      all: async (...parameters) => this.query(sql, parameters, 'all'),
      run: async (...parameters) => this.query(sql, parameters, 'run')
    };
  }

  exec(sql) {
    if (this.databaseSync) {
      return this.databaseSync.exec(sql);
    }
    return this.query(sql, []);
  }

  async query(sql, parameters, mode = 'all') {
    await this.ready;
    if (this.databaseSync) {
      const execute = () => {
        const statement = this.databaseSync.prepare(sql);
        if (mode === 'get') return statement.get(...parameters);
        if (mode === 'run') return statement.run(...parameters);
        return statement.all(...parameters);
      };
      if (this.transactions.getStore() === this.sqliteTransactionToken) {
        return execute();
      }
      return this.withSqliteLock(execute);
    }

    const formattedSql = formatSql(sql, this.dialect);
    const transactionConnection = this.transactions.getStore();

    if (this.dialect === 'postgres') {
      const insertedTable = formattedSql.match(/^\s*INSERT\s+INTO\s+([a-z_]+)/i)?.[1]?.toLowerCase();
      const query = insertedTable && TABLES_WITH_GENERATED_IDS.has(insertedTable)
        && mode === 'run' && !/\bRETURNING\b/i.test(formattedSql)
        ? `${formattedSql} RETURNING id`
        : formattedSql;
      const result = transactionConnection
        ? await transactionConnection.query(query, parameters)
        : await this.pool.query(query, parameters);
      if (mode === 'run') {
        return {
          changes: result.rowCount,
          lastInsertRowid: result.rows[0] ? Number(result.rows[0].id) : undefined
        };
      }
      return mode === 'get' ? result.rows[0] : result.rows;
    }

    const connection = transactionConnection || this.pool;
    const [result] = await connection.execute(formattedSql, parameters);
    if (mode === 'run') {
      return { changes: result.affectedRows, lastInsertRowid: result.insertId };
    }
    return mode === 'get' ? result[0] : result;
  }

  async transaction(operation) {
    if (this.databaseSync) {
      return this.withSqliteLock(async () => {
        this.databaseSync.exec('BEGIN IMMEDIATE');
        try {
          const result = await this.transactions.run(this.sqliteTransactionToken, operation);
          this.databaseSync.exec('COMMIT');
          return result;
        } catch (error) {
          this.databaseSync.exec('ROLLBACK');
          throw error;
        }
      });
    }

    const connection = this.dialect === 'postgres'
      ? await this.pool.connect()
      : await this.pool.getConnection();
    try {
      if (this.dialect === 'postgres') await connection.query('BEGIN');
      else await connection.beginTransaction();
      const result = await this.transactions.run(connection, operation);
      if (this.dialect === 'postgres') await connection.query('COMMIT');
      else await connection.commit();
      return result;
    } catch (error) {
      if (this.dialect === 'postgres') await connection.query('ROLLBACK');
      else await connection.rollback();
      throw error;
    } finally {
      if (this.dialect === 'postgres') connection.release();
      else connection.release();
    }
  }

  async close() {
    if (this.databaseSync) {
      await this.sqliteQueue;
      this.databaseSync.close();
    } else if (this.dialect === 'postgres') {
      await this.pool.end();
    } else {
      await this.pool.end();
    }
  }

  async withSqliteLock(operation) {
    const previous = this.sqliteQueue;
    let release;
    this.sqliteQueue = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

DatabaseConnection.formatSql = formatSql;
DatabaseConnection.getSslConfig = getSslConfig;
DatabaseConnection.removeConnectionStringSslOptions = removeConnectionStringSslOptions;
module.exports = DatabaseConnection;
