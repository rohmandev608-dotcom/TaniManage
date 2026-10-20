const fs = require('node:fs');
const path = require('node:path');
const DatabaseConnection = require('./DatabaseConnection');

class Database {
  constructor(filename) {
    const defaultFilename = path.join(__dirname, '..', '..', 'data', 'fmis.sqlite');
    let connectionString = filename === undefined ? process.env.DATABASE_URL : null;
    let sqliteFilename = filename || defaultFilename;
    if (connectionString && /^sqlite:/i.test(connectionString)) {
      const configuredPath = connectionString.slice('sqlite:'.length).replace(/^\/\//, '');
      sqliteFilename = configuredPath === ':memory:'
        ? ':memory:'
        : path.resolve(decodeURIComponent(configuredPath));
      connectionString = null;
    }
    if (!connectionString && sqliteFilename !== ':memory:') {
      fs.mkdirSync(path.dirname(sqliteFilename), { recursive: true });
    }

    this.connection = new DatabaseConnection({
      filename: sqliteFilename,
      connectionString
    });
    this.dialect = this.connection.dialect;
    if (this.dialect === 'sqlite') {
      this.connection.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
      const schema = fs.readFileSync(
        path.join(__dirname, '..', '..', 'database', 'schema.sql'),
        'utf8'
      );
      this.connection.exec(schema);
      this.migrateCropCycleColumns();
      this.migrateWorkerActivityColumns();
      this.connection.asyncMode = true;
      this.ready = Promise.resolve();
    } else {
      this.ready = this.initializeRemoteSchema();
      this.connection.ready = this.ready;
    }
  }

  async initializeRemoteSchema() {
    const schema = fs.readFileSync(
      path.join(__dirname, '..', '..', 'database', 'schema.sql'),
      'utf8'
    );
    const statements = schema.split(';')
      .map((statement) => statement.trim())
      .filter((statement) => statement && !/^PRAGMA\b/i.test(statement));

    for (const statement of statements) {
      let sql = statement;
      if (this.dialect === 'postgres') {
        sql = sql
          .replace(/\bINTEGER PRIMARY KEY AUTOINCREMENT\b/gi, 'BIGSERIAL PRIMARY KEY')
          .replace(/\bINTEGER\b/gi, 'BIGINT')
          .replace(/\bREAL\b/gi, 'DOUBLE PRECISION')
          .replace(/\b(created_at|updated_at|joined_at|assigned_at|completed_at) TEXT\b/gi, '$1 TIMESTAMPTZ')
          .replace(/\s+COLLATE NOCASE\b/gi, '');
      } else {
        sql = sql
          .replace(/\bINTEGER PRIMARY KEY AUTOINCREMENT\b/gi, 'BIGINT PRIMARY KEY AUTO_INCREMENT')
          .replace(/\bINTEGER\b/gi, 'BIGINT')
          .replace(/\bREAL\b/gi, 'DOUBLE')
          .replace(/\b(created_at|updated_at|joined_at|assigned_at|completed_at) TEXT\b/gi, '$1 DATETIME')
          .replace(/\s+COLLATE NOCASE\b/gi, '');
        sql = sql
          .replace(/\bemail TEXT NOT NULL UNIQUE\b/i, 'email VARCHAR(254) NOT NULL UNIQUE')
          .replace(/\btoken_hash TEXT PRIMARY KEY\b/i, 'token_hash VARCHAR(128) PRIMARY KEY')
          .replace(/\binvite_code TEXT NOT NULL UNIQUE\b/i, 'invite_code VARCHAR(128) NOT NULL UNIQUE')
          .replace(/\bname TEXT NOT NULL\b/g, 'name VARCHAR(100) NOT NULL')
          .replace(/\bunit TEXT NOT NULL\b/g, 'unit VARCHAR(20) NOT NULL');
        if (/^CREATE TABLE IF NOT EXISTS crop_cycles\b/i.test(sql)) {
          sql = sql.replace(
            /completed_at DATETIME,/,
            "completed_at DATETIME,\n  active_field_id BIGINT GENERATED ALWAYS AS (IF(status = 'active', field_id, NULL)) STORED,"
          );
        }
      }

      if (this.dialect === 'mysql' && /^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS\b/i.test(sql)) {
        if (/\sWHERE\s/i.test(sql)) {
          if (!/^CREATE UNIQUE INDEX IF NOT EXISTS crop_cycles_one_active_per_field\b/i.test(sql)) {
            continue;
          }
          sql = sql.replace(
            /ON crop_cycles\s*\(field_id\)\s+WHERE status = 'active'/i,
            'ON crop_cycles(active_field_id)'
          );
        }
        const match = sql.match(/^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS\s+(\w+)\s+ON\s+(\w+)/i);
        if (!match) continue;
        const [indexName, tableName] = [match[1], match[2]];
        const [existing] = await this.connection.pool.execute(
          'SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1',
          [tableName, indexName]
        );
        if (existing.length > 0) continue;
        sql = sql.replace(/\bIF NOT EXISTS\b/i, '');
      }

      await this.connection.pool.query(sql);
    }

    if (this.dialect === 'postgres') {
      await this.connection.pool.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (LOWER(email))'
      );
    }
  }

  migrateCropCycleColumns() {
    const columns = {
      financial_transactions: 'crop_cycle_id INTEGER REFERENCES crop_cycles(id) ON DELETE SET NULL',
      field_activities: 'crop_cycle_id INTEGER REFERENCES crop_cycles(id) ON DELETE SET NULL',
      inventory_movements: 'crop_cycle_id INTEGER REFERENCES crop_cycles(id) ON DELETE SET NULL'
    };

    for (const [table, definition] of Object.entries(columns)) {
      const existingColumns = this.connection.prepare(`PRAGMA table_info(${table})`).all();
      if (!existingColumns.some((column) => column.name === 'crop_cycle_id')) {
        this.connection.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
      }
    }

    this.connection.exec(`
      CREATE INDEX IF NOT EXISTS financial_transactions_cycle_date_idx
        ON financial_transactions(user_id, crop_cycle_id, transaction_date DESC, id DESC);
      CREATE INDEX IF NOT EXISTS field_activities_cycle_date_idx
        ON field_activities(user_id, crop_cycle_id, activity_date DESC, id DESC);
      CREATE INDEX IF NOT EXISTS inventory_movements_cycle_idx
        ON inventory_movements(user_id, crop_cycle_id, id DESC);
    `);
  }

  migrateWorkerActivityColumns() {
    const columns = this.connection.prepare('PRAGMA table_info(field_activities)').all();
    if (!columns.some((column) => column.name === 'worker_id')) {
      this.connection.exec(
        'ALTER TABLE field_activities ADD COLUMN worker_id INTEGER REFERENCES users(id) ON DELETE SET NULL'
      );
    }
    this.connection.exec(
      'CREATE INDEX IF NOT EXISTS field_activities_worker_date_idx ON field_activities(worker_id, activity_date DESC, id DESC)'
    );
  }

  lockClause() {
    return this.dialect === 'sqlite' ? '' : ' FOR UPDATE';
  }

  async createUser({ name, email, passwordHash, role }) {
    const result = await this.connection.prepare(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
    ).run(name, email, passwordHash, role);
    return await this.getPublicUserById(Number(result.lastInsertRowid));
  }

  async findUserByEmail(email) {
    return await this.connection.prepare(
      'SELECT id, name, email, password_hash, role FROM users WHERE LOWER(email) = LOWER(?)'
    ).get(email) || null;
  }

  async getPublicUserById(id) {
    return await this.connection.prepare(
      'SELECT id, name, email, role FROM users WHERE id = ?'
    ).get(id) || null;
  }

  async listPublicUsers() {
    return await this.connection.prepare(
      'SELECT id, name, email, role FROM users ORDER BY id'
    ).all();
  }

  async getUserCount() {
    return Number((await this.connection.prepare('SELECT COUNT(*) AS count FROM users').get()).count);
  }

  async countUsersByRole(role) {
    return Number((await this.connection.prepare('SELECT COUNT(*) AS count FROM users WHERE role = ?')
      .get(role)).count);
  }

  async setUserRole(id, role) {
    return (await this.connection.prepare('UPDATE users SET role = ? WHERE id = ?')
      .run(role, id)).changes;
  }

  async createSession(tokenHash, userId, csrfToken, expiresAt) {
    await this.connection.prepare(
      'INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)'
    ).run(tokenHash, userId, csrfToken, expiresAt);
  }

  async findSession(tokenHash) {
    return await this.connection.prepare(
      'SELECT user_id, csrf_token, expires_at FROM sessions WHERE token_hash = ?'
    ).get(tokenHash) || null;
  }

  async deleteSession(tokenHash) {
    await this.connection.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  async createWorkerActivity(userId, activityDate, activity) {
    const result = await this.connection.prepare(
      'INSERT INTO worker_activities (user_id, activity_date, activity) VALUES (?, ?, ?)'
    ).run(userId, activityDate, activity);
    return await this.connection.prepare(
      'SELECT id, activity_date, activity, created_at FROM worker_activities WHERE id = ?'
    ).get(Number(result.lastInsertRowid));
  }

  async listWorkerActivitiesForUser(userId) {
    return await this.connection.prepare(
      `SELECT id, activity_date, activity, created_at
       FROM worker_activities WHERE user_id = ?
       ORDER BY activity_date DESC, id DESC`
    ).all(userId);
  }

  async ensureOwnerInvite(ownerId, inviteCode) {
    await this.connection.prepare(
      'INSERT INTO owner_invites (owner_id, invite_code) VALUES (?, ?) ON CONFLICT(owner_id) DO NOTHING'
    ).run(ownerId, inviteCode);
    return (await this.connection.prepare(
      'SELECT invite_code FROM owner_invites WHERE owner_id = ?'
    ).get(ownerId)).invite_code;
  }

  async joinWorkerWithInvite(workerId, inviteCode) {
    const worker = await this.connection.prepare(
      "SELECT role FROM users WHERE id = ?"
    ).get(workerId);
    const invite = await this.connection.prepare(
      `SELECT i.owner_id, u.name, u.role
       FROM owner_invites i JOIN users u ON u.id = i.owner_id
       WHERE i.invite_code = ?`
    ).get(inviteCode);
    if (!worker || worker.role !== 'worker' || !invite || invite.role !== 'farmer'
      || workerId === invite.owner_id) {
      const error = new Error('Undangan tidak valid atau tidak tersedia.');
      error.code = 'INVALID_WORKER_INVITE';
      throw error;
    }

    const result = await this.connection.prepare(
      `INSERT INTO owner_workers (owner_id, worker_id) VALUES (?, ?)
       ON CONFLICT(owner_id, worker_id) DO NOTHING`
    ).run(invite.owner_id, workerId);
    return {
      owner: { id: invite.owner_id, name: invite.name },
      alreadyMember: result.changes === 0
    };
  }

  async listOwnerWorkers(ownerId) {
    const workers = await this.connection.prepare(
      `SELECT u.id, u.name, u.email, ow.joined_at
       FROM owner_workers ow
       JOIN users u ON u.id = ow.worker_id AND u.role = 'worker'
       WHERE ow.owner_id = ?
       ORDER BY u.name COLLATE NOCASE, u.id`
    ).all(ownerId);
    const assignments = await this.connection.prepare(
      `SELECT a.id, a.worker_id, a.field_id, l.name AS field_name,
              a.crop_cycle_id, c.commodity_name AS crop_cycle_name, c.status
       FROM owner_worker_assignments a
       JOIN lands l ON l.id = a.field_id AND l.user_id = a.owner_id
       JOIN crop_cycles c ON c.id = a.crop_cycle_id AND c.user_id = a.owner_id
       WHERE a.owner_id = ?
       ORDER BY a.worker_id, a.id DESC`
    ).all(ownerId);
    return { workers, assignments };
  }

  async listOwnerFieldsForWorkerAssignment(ownerId) {
    return await this.connection.prepare(
      `SELECT l.id AS field_id, l.name AS field_name, c.id AS crop_cycle_id,
              c.commodity_name AS crop_cycle_name
       FROM lands l
       JOIN crop_cycles c ON c.field_id = l.id AND c.user_id = l.user_id
       WHERE l.user_id = ? AND c.status = 'active'
       ORDER BY l.name COLLATE NOCASE, c.id`
    ).all(ownerId);
  }

  async assignWorkerToCropCycle(ownerId, workerId, fieldId, cropCycleId) {
    const member = await this.connection.prepare(
      `SELECT u.role FROM owner_workers ow JOIN users u ON u.id = ow.worker_id
       WHERE ow.owner_id = ? AND ow.worker_id = ?`
    ).get(ownerId, workerId);
    if (!member || member.role !== 'worker') {
      const error = new Error('Buruh tidak terhubung dengan owner ini.');
      error.code = 'WORKER_NOT_CONNECTED';
      throw error;
    }
    const cycle = await this.connection.prepare(
      `SELECT id FROM crop_cycles
       WHERE user_id = ? AND field_id = ? AND id = ? AND status = 'active'`
    ).get(ownerId, fieldId, cropCycleId);
    if (!cycle) {
      const error = new Error('Lahan atau musim tanam aktif tidak ditemukan.');
      error.code = 'ASSIGNMENT_CYCLE_NOT_FOUND';
      throw error;
    }
    const result = await this.connection.prepare(
      `INSERT INTO owner_worker_assignments (owner_id, worker_id, field_id, crop_cycle_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(owner_id, worker_id, field_id, crop_cycle_id) DO NOTHING`
    ).run(ownerId, workerId, fieldId, cropCycleId);
    return result.changes > 0;
  }

  async removeWorkerFromOwner(ownerId, workerId) {
    return (await this.connection.prepare(
      'DELETE FROM owner_workers WHERE owner_id = ? AND worker_id = ?'
    ).run(ownerId, workerId)).changes;
  }

  async listWorkerAssignments(workerId) {
    return await this.connection.prepare(
      `SELECT a.id AS assignment_id, a.owner_id, u.name AS owner_name,
              a.field_id, l.name AS field_name, l.commodity,
              a.crop_cycle_id, c.commodity_name AS crop_cycle_name,
              c.start_date
       FROM owner_worker_assignments a
       JOIN owner_workers ow ON ow.owner_id = a.owner_id AND ow.worker_id = a.worker_id
       JOIN users u ON u.id = a.owner_id AND u.role = 'farmer'
       JOIN lands l ON l.id = a.field_id AND l.user_id = a.owner_id
       JOIN crop_cycles c
         ON c.id = a.crop_cycle_id AND c.field_id = a.field_id
        AND c.user_id = a.owner_id AND c.status = 'active'
       WHERE a.worker_id = ?
       ORDER BY u.name COLLATE NOCASE, l.name COLLATE NOCASE`
    ).all(workerId);
  }

  async listWorkerInventoryOptions(workerId) {
    return await this.connection.prepare(
      `SELECT DISTINCT i.id, i.user_id AS owner_id, i.name, i.unit
       FROM owner_worker_assignments a
       JOIN owner_workers ow ON ow.owner_id = a.owner_id AND ow.worker_id = a.worker_id
       JOIN crop_cycles c
         ON c.id = a.crop_cycle_id AND c.field_id = a.field_id
        AND c.user_id = a.owner_id AND c.status = 'active'
       JOIN inventory_items i ON i.user_id = a.owner_id
       WHERE a.worker_id = ?
       ORDER BY i.name COLLATE NOCASE, i.id`
    ).all(workerId);
  }

  async listWorkerFieldActivities(workerId) {
    return await this.connection.prepare(
      `SELECT a.id, a.activity_date, a.activity_type, a.description,
              l.name AS field_name, u.name AS owner_name,
              c.commodity_name AS crop_cycle_name
       FROM field_activities a
       JOIN lands l ON l.id = a.field_id AND l.user_id = a.user_id
       JOIN users u ON u.id = a.user_id
       LEFT JOIN crop_cycles c ON c.id = a.crop_cycle_id AND c.user_id = a.user_id
       WHERE a.worker_id = ?
         AND EXISTS (
           SELECT 1
           FROM owner_worker_assignments assignment
           JOIN owner_workers ow
             ON ow.owner_id = assignment.owner_id AND ow.worker_id = assignment.worker_id
           JOIN crop_cycles active_cycle
             ON active_cycle.id = assignment.crop_cycle_id
            AND active_cycle.field_id = assignment.field_id
            AND active_cycle.user_id = assignment.owner_id
            AND active_cycle.status = 'active'
           WHERE assignment.worker_id = a.worker_id
             AND assignment.owner_id = a.user_id
             AND assignment.field_id = a.field_id
             AND assignment.crop_cycle_id = a.crop_cycle_id
         )
       ORDER BY a.activity_date DESC, a.id DESC`
    ).all(workerId);
  }

  async createLand(userId, land) {
    const result = await this.connection.prepare(
      `INSERT INTO lands
        (user_id, name, area_hectares, soil_type, commodity, coordinates, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      userId,
      land.name,
      land.areaHectares,
      land.soilType,
      land.commodity,
      land.coordinates,
      land.notes
    );
    return await this.getLandForOwner(userId, Number(result.lastInsertRowid));
  }

  async listLandsForOwner(userId) {
    return await this.connection.prepare(
      `SELECT id, name, area_hectares, soil_type, commodity, coordinates, notes,
              created_at, updated_at
       FROM lands WHERE user_id = ? ORDER BY id DESC`
    ).all(userId);
  }

  async getLandForOwner(userId, landId) {
    return await this.connection.prepare(
      `SELECT id, name, area_hectares, soil_type, commodity, coordinates, notes,
              created_at, updated_at
       FROM lands WHERE user_id = ? AND id = ?`
    ).get(userId, landId) || null;
  }

  async updateLandForOwner(userId, landId, land) {
    return (await this.connection.prepare(
      `UPDATE lands
       SET name = ?, area_hectares = ?, soil_type = ?, commodity = ?,
           coordinates = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND id = ?`
    ).run(
      land.name,
      land.areaHectares,
      land.soilType,
      land.commodity,
      land.coordinates,
      land.notes,
      userId,
      landId
    )).changes;
  }

  async deleteLandForOwner(userId, landId) {
    if (await this.connection.prepare(
      'SELECT 1 FROM crop_cycles WHERE user_id = ? AND field_id = ? LIMIT 1'
    ).get(userId, landId)) {
      const error = new Error('Lahan dengan riwayat musim tanam tidak dapat dihapus.');
      error.code = 'LAND_HAS_CROP_CYCLES';
      throw error;
    }
    return (await this.connection.prepare(
      'DELETE FROM lands WHERE user_id = ? AND id = ?'
    ).run(userId, landId)).changes;
  }

  async listCropCyclesForOwner(userId) {
    return await this.connection.prepare(
      `SELECT c.id, c.field_id, l.name AS field_name, c.commodity_name, c.variety,
              c.start_date, c.expected_harvest_date, c.end_date, c.status,
              c.final_income_rupiah, c.final_expense_rupiah, c.final_profit_rupiah,
              c.created_at, c.completed_at
       FROM crop_cycles c
       JOIN lands l ON l.id = c.field_id AND l.user_id = c.user_id
       WHERE c.user_id = ?
       ORDER BY CASE c.status WHEN 'active' THEN 0 ELSE 1 END,
                c.start_date DESC, c.id DESC`
    ).all(userId);
  }

  async getCropCycleForOwner(userId, cycleId) {
    return await this.connection.prepare(
      `SELECT c.id, c.field_id, l.name AS field_name, c.commodity_name, c.variety,
              c.start_date, c.expected_harvest_date, c.end_date, c.status,
              c.final_income_rupiah, c.final_expense_rupiah, c.final_profit_rupiah,
              c.created_at, c.completed_at
       FROM crop_cycles c
       JOIN lands l ON l.id = c.field_id AND l.user_id = c.user_id
       WHERE c.user_id = ? AND c.id = ?${this.lockClause()}`
    ).get(userId, cycleId) || null;
  }

  async getActiveCropCycleForField(userId, fieldId) {
    return await this.connection.prepare(
      `SELECT id, field_id, commodity_name, variety, start_date, expected_harvest_date
       FROM crop_cycles
       WHERE user_id = ? AND field_id = ? AND status = 'active'${this.lockClause()}`
    ).get(userId, fieldId) || null;
  }

  async listLandsWithActiveCropCycleForOwner(userId) {
    return await this.connection.prepare(
      `SELECT l.id, l.name, c.id AS crop_cycle_id, c.commodity_name AS crop_cycle_name
       FROM lands l
       LEFT JOIN crop_cycles c
         ON c.field_id = l.id AND c.user_id = l.user_id AND c.status = 'active'
       WHERE l.user_id = ? ORDER BY l.id DESC`
    ).all(userId);
  }

  async getFarmerDashboardForOwner(userId) {
    const landSummary = await this.connection.prepare(
      `SELECT COUNT(*) AS field_count, COALESCE(SUM(area_hectares), 0) AS total_area
       FROM lands WHERE user_id = ?`
    ).get(userId);
    const inventorySummary = await this.connection.prepare(
      `SELECT COUNT(*) AS item_count
       FROM inventory_items WHERE user_id = ?`
    ).get(userId);
    const activeCycles = await this.connection.prepare(
      `SELECT id, field_id, commodity_name, variety, start_date, expected_harvest_date,
              (SELECT name FROM lands WHERE lands.id = crop_cycles.field_id
                AND lands.user_id = crop_cycles.user_id) AS field_name
       FROM crop_cycles
       WHERE user_id = ? AND status = 'active'
       ORDER BY start_date DESC, id DESC`
    ).all(userId);
    const activeCycleProfit = activeCycles.length === 0
      ? 0
      : Number((await this.connection.prepare(
          `SELECT COALESCE(SUM(CASE
             WHEN type = 'income' THEN amount_rupiah
             WHEN type = 'expense' AND category != 'Pembelian Inventaris' THEN -amount_rupiah
             ELSE 0
           END), 0) AS net_profit
           FROM financial_transactions
           WHERE user_id = ? AND crop_cycle_id IN (
             SELECT id FROM crop_cycles WHERE user_id = ? AND status = 'active'
           )`
        ).get(userId, userId)).net_profit);
    const recentActivities = await this.connection.prepare(
      `SELECT a.id, a.activity_type, a.activity_date, a.description,
              l.name AS field_name, c.commodity_name AS crop_cycle_name
       FROM field_activities a
       JOIN lands l ON l.id = a.field_id AND l.user_id = a.user_id
       LEFT JOIN crop_cycles c ON c.id = a.crop_cycle_id AND c.user_id = a.user_id
       WHERE a.user_id = ?
       ORDER BY a.activity_date DESC, a.id DESC
       LIMIT 5`
    ).all(userId);

    return {
      fieldCount: Number(landSummary.field_count),
      totalAreaHectares: Number(landSummary.total_area),
      inventoryItemCount: Number(inventorySummary.item_count),
      activeCycles,
      activeCycleCount: activeCycles.length,
      activeCycleNetProfitRupiah: activeCycleProfit,
      recentActivities
    };
  }

  async createCropCycle(userId, cycle) {
    return await this.runTransaction(async () => {
      const field = await this.getLandForOwner(userId, cycle.fieldId);
      if (!field) {
        const error = new Error('Lahan tidak ditemukan.');
        error.code = 'LAND_NOT_FOUND';
        throw error;
      }
      if (await this.getActiveCropCycleForField(userId, cycle.fieldId)) {
        const error = new Error('Lahan sudah memiliki musim tanam aktif.');
        error.code = 'ACTIVE_CROP_CYCLE_EXISTS';
        throw error;
      }

      const result = await this.connection.prepare(
        `INSERT INTO crop_cycles
          (user_id, field_id, commodity_name, variety, start_date, expected_harvest_date)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        userId,
        cycle.fieldId,
        cycle.commodityName,
        cycle.variety,
        cycle.startDate,
        cycle.expectedHarvestDate || null
      );
      return await this.getCropCycleForOwner(userId, Number(result.lastInsertRowid));
    });
  }

  async completeCropCycle(userId, cycleId) {
    return await this.runTransaction(async () => {
      const cycle = await this.getCropCycleForOwner(userId, cycleId);
      if (!cycle) {
        const error = new Error('Musim tanam tidak ditemukan.');
        error.code = 'CROP_CYCLE_NOT_FOUND';
        throw error;
      }
      if (cycle.status !== 'active') {
        const error = new Error('Musim tanam ini sudah selesai.');
        error.code = 'CROP_CYCLE_ALREADY_COMPLETED';
        throw error;
      }
      const endDate = new Date().toISOString().slice(0, 10);
      if (endDate < cycle.start_date) {
        const error = new Error('Musim tanam belum dimulai sehingga belum dapat diselesaikan.');
        error.code = 'CROP_CYCLE_NOT_STARTED';
        throw error;
      }

      const summary = await this.getFinancialSummaryForOwner(userId, null, cycleId);
      const income = summary.totalIncome;
      const expense = summary.totalExpense;
      await this.connection.prepare(
        `UPDATE crop_cycles
         SET status = 'completed', end_date = ?, completed_at = CURRENT_TIMESTAMP,
             final_income_rupiah = ?, final_expense_rupiah = ?, final_profit_rupiah = ?
         WHERE user_id = ? AND id = ? AND status = 'active'`
      ).run(endDate, income, expense, income - expense, userId, cycleId);
      return await this.getCropCycleForOwner(userId, cycleId);
    });
  }

  async getCropCycleReportForOwner(userId, cycleId) {
    const cycle = await this.getCropCycleForOwner(userId, cycleId);
    if (!cycle) return null;

    const transactions = await this.connection.prepare(
      `SELECT id, type, category, transaction_date, amount_rupiah, description
       FROM financial_transactions
       WHERE user_id = ? AND crop_cycle_id = ?
       ORDER BY transaction_date DESC, id DESC`
    ).all(userId, cycleId);
    const activities = await this.connection.prepare(
      `SELECT a.id, a.activity_type, a.activity_date, a.description,
              w.name AS worker_name,
              i.name AS item_name, i.unit AS item_unit, m.quantity_milli, m.total_cost_rupiah
       FROM field_activities a
       LEFT JOIN users w ON w.id = a.worker_id
       LEFT JOIN inventory_movements m
         ON m.activity_id = a.id AND m.user_id = a.user_id AND m.movement_type = 'usage'
       LEFT JOIN inventory_items i ON i.id = m.item_id AND i.user_id = m.user_id
       WHERE a.user_id = ? AND a.crop_cycle_id = ?
       ORDER BY a.activity_date DESC, a.id DESC`
    ).all(userId, cycleId);
    const summary = cycle.status === 'completed'
      ? {
          totalIncome: cycle.final_income_rupiah,
          totalExpense: cycle.final_expense_rupiah,
          netProfit: cycle.final_profit_rupiah,
          profitMargin: cycle.final_income_rupiah === 0
            ? 0
            : (cycle.final_profit_rupiah / cycle.final_income_rupiah) * 100
        }
      : await this.getFinancialSummaryForOwner(userId, null, cycleId);

    return { cycle, summary, transactions, activities };
  }

  async createFinancialTransaction(userId, transaction) {
    return await this.runTransaction(async () => {
      let cropCycleId = null;
      if (transaction.fieldId !== null) {
        if (!await this.getLandForOwner(userId, transaction.fieldId)) {
          const error = new Error('Lahan tidak ditemukan.');
          error.code = 'LAND_NOT_FOUND';
          throw error;
        }
        const cycle = await this.getActiveCropCycleForField(userId, transaction.fieldId);
        if (!cycle) {
          const error = new Error('Mulai musim tanam aktif sebelum mencatat transaksi untuk lahan ini.');
          error.code = 'NO_ACTIVE_CROP_CYCLE';
          throw error;
        }
        cropCycleId = cycle.id;
      }

      const result = await this.connection.prepare(
        `INSERT INTO financial_transactions
          (user_id, field_id, crop_cycle_id, type, category, transaction_date, amount_rupiah, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        userId,
        transaction.fieldId,
        cropCycleId,
        transaction.type,
        transaction.category,
        transaction.date,
        transaction.amountRupiah,
        transaction.description
      );
      return await this.getFinancialTransactionForOwner(userId, Number(result.lastInsertRowid));
    });
  }

  async listFinancialTransactionsForOwner(userId, fieldId = null, cropCycleId = null) {
    const fieldFilter = fieldId === 'unassigned'
      ? 'AND t.field_id IS NULL'
      : fieldId === null
        ? ''
        : 'AND t.field_id = ?';
    const parameters = fieldId === null ? [userId] : [userId, ...(fieldId === 'unassigned' ? [] : [fieldId])];
    const cycleFilter = cropCycleId === null ? '' : 'AND t.crop_cycle_id = ?';
    if (cropCycleId !== null) parameters.push(cropCycleId);

    return await this.connection.prepare(
      `SELECT t.id, t.field_id, t.crop_cycle_id, c.commodity_name AS crop_cycle_name,
              l.name AS field_name, t.type, t.category,
              t.transaction_date, t.amount_rupiah, t.description, t.created_at
       FROM financial_transactions t
       LEFT JOIN lands l ON l.id = t.field_id AND l.user_id = t.user_id
       LEFT JOIN crop_cycles c ON c.id = t.crop_cycle_id AND c.user_id = t.user_id
       WHERE t.user_id = ? ${fieldFilter} ${cycleFilter}
       ORDER BY t.transaction_date DESC, t.id DESC`
    ).all(...parameters);
  }

  async getFinancialTransactionForOwner(userId, transactionId) {
    return await this.connection.prepare(
      `SELECT id, field_id, crop_cycle_id, type, category, transaction_date, amount_rupiah,
              description, created_at
       FROM financial_transactions
       WHERE user_id = ? AND id = ?`
    ).get(userId, transactionId) || null;
  }

  async getFinancialSummaryForOwner(userId, fieldId = null, cropCycleId = null) {
    const fieldFilter = fieldId === 'unassigned'
      ? 'AND field_id IS NULL'
      : fieldId === null
        ? ''
        : 'AND field_id = ?';
    const parameters = fieldId === null ? [userId] : [userId, ...(fieldId === 'unassigned' ? [] : [fieldId])];
    const cycleFilter = cropCycleId === null ? '' : 'AND crop_cycle_id = ?';
    if (cropCycleId !== null) parameters.push(cropCycleId);
    const totals = await this.connection.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount_rupiah ELSE 0 END), 0) AS total_income,
         COALESCE(SUM(CASE
           WHEN type = 'expense' AND category != 'Pembelian Inventaris' THEN amount_rupiah
           ELSE 0
         END), 0) AS total_expense
       FROM financial_transactions
       WHERE user_id = ? ${fieldFilter} ${cycleFilter}`
    ).get(...parameters);
    const totalIncome = Number(totals.total_income);
    const totalExpense = Number(totals.total_expense);
    const netProfit = totalIncome - totalExpense;

    return {
      totalIncome,
      totalExpense,
      netProfit,
      profitMargin: totalIncome === 0 ? 0 : (netProfit / totalIncome) * 100
    };
  }

  async runTransaction(operation) {
    await this.ready;
    return this.connection.transaction(operation);
  }

  async listInventoryItemsForOwner(userId) {
    return await this.connection.prepare(
      `SELECT id, name, unit, quantity_milli, average_unit_cost_micros
       FROM inventory_items WHERE user_id = ? ORDER BY name COLLATE NOCASE, id`
    ).all(userId);
  }

  async getInventoryItemForOwner(userId, itemId) {
    return await this.connection.prepare(
      `SELECT id, name, unit, quantity_milli, average_unit_cost_micros
       FROM inventory_items WHERE user_id = ? AND id = ?${this.lockClause()}`
    ).get(userId, itemId) || null;
  }

  async createInventoryItem(userId, name, unit) {
    const result = await this.connection.prepare(
      'INSERT INTO inventory_items (user_id, name, unit) VALUES (?, ?, ?)'
    ).run(userId, name, unit);
    return await this.getInventoryItemForOwner(userId, Number(result.lastInsertRowid));
  }

  async purchaseInventory(userId, purchase) {
    return await this.runTransaction(async () => {
      let item = purchase.itemId === null
        ? await this.createInventoryItem(userId, purchase.itemName, purchase.unit)
        : await this.getInventoryItemForOwner(userId, purchase.itemId);

      if (!item) {
        const error = new Error('Bahan inventaris tidak ditemukan.');
        error.code = 'INVENTORY_ITEM_NOT_FOUND';
        throw error;
      }

      const newQuantityMilli = item.quantity_milli + purchase.quantityMilli;
      if (!Number.isSafeInteger(newQuantityMilli)) {
        const error = new Error('Jumlah stok melebihi batas sistem.');
        error.code = 'INVENTORY_QUANTITY_LIMIT';
        throw error;
      }

      const scale = 1_000_000_000n;
      const amount = BigInt(purchase.amountRupiah);
      const purchaseQuantity = BigInt(purchase.quantityMilli);
      const currentQuantity = BigInt(item.quantity_milli);
      const purchaseCostMicros = (amount * scale + (purchaseQuantity / 2n)) / purchaseQuantity;
      const averageUnitCostMicros = Number(
        (currentQuantity * BigInt(item.average_unit_cost_micros)
          + purchaseQuantity * purchaseCostMicros
          + BigInt(newQuantityMilli) / 2n)
        / BigInt(newQuantityMilli)
      );
      const unitCostMicros = Number(purchaseCostMicros);
      if (!Number.isSafeInteger(unitCostMicros) || !Number.isSafeInteger(averageUnitCostMicros)) {
        const error = new Error('Nilai biaya bahan melebihi batas sistem.');
        error.code = 'INVENTORY_COST_LIMIT';
        throw error;
      }

      await this.connection.prepare(
        `UPDATE inventory_items
         SET quantity_milli = ?, average_unit_cost_micros = ?, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = ? AND id = ?`
      ).run(newQuantityMilli, averageUnitCostMicros, userId, item.id);

      await this.connection.prepare(
        `INSERT INTO inventory_movements
          (user_id, item_id, movement_type, quantity_milli, total_cost_rupiah)
         VALUES (?, ?, 'purchase', ?, ?)`
      ).run(userId, item.id, purchase.quantityMilli, purchase.amountRupiah);

      const description = `Pembelian ${purchase.quantityLabel} ${item.unit} ${item.name}`;
      await this.connection.prepare(
        `INSERT INTO financial_transactions
          (user_id, field_id, type, category, transaction_date, amount_rupiah, description)
         VALUES (?, NULL, 'expense', 'Pembelian Inventaris', ?, ?, ?)`
      ).run(userId, purchase.date, purchase.amountRupiah, description);

      return await this.getInventoryItemForOwner(userId, item.id);
    });
  }

  async createFieldActivityWithInventory(userId, activity, workerId = null) {
    return await this.runTransaction(async () => {
      let ownerId = userId;
      let fieldId = activity.fieldId;
      let cycle = null;
      if (workerId !== null) {
        const assignment = await this.connection.prepare(
          `SELECT a.owner_id, a.field_id, c.id AS crop_cycle_id
           FROM owner_worker_assignments a
           JOIN owner_workers ow ON ow.owner_id = a.owner_id AND ow.worker_id = a.worker_id
           JOIN crop_cycles c
             ON c.id = a.crop_cycle_id AND c.field_id = a.field_id
            AND c.user_id = a.owner_id AND c.status = 'active'
           WHERE a.id = ? AND a.worker_id = ?`
        ).get(activity.assignmentId, workerId);
        if (!assignment) {
          const error = new Error('Penugasan tidak ditemukan atau sudah tidak aktif.');
          error.code = 'WORKER_ASSIGNMENT_NOT_FOUND';
          throw error;
        }
        ownerId = assignment.owner_id;
        fieldId = assignment.field_id;
        cycle = { id: assignment.crop_cycle_id };
      }

      const field = await this.getLandForOwner(ownerId, fieldId);
      if (!field) {
        const error = new Error('Lahan tidak ditemukan.');
        error.code = 'LAND_NOT_FOUND';
        throw error;
      }
      cycle = cycle || await this.getActiveCropCycleForField(ownerId, field.id);
      if (!cycle) {
        const error = new Error('Mulai musim tanam aktif untuk lahan ini sebelum mencatat aktivitas.');
        error.code = 'NO_ACTIVE_CROP_CYCLE';
        throw error;
      }

      let item = null;
      if (activity.itemId !== null) {
        item = await this.getInventoryItemForOwner(ownerId, activity.itemId);
        if (!item) {
          const error = new Error('Bahan inventaris tidak ditemukan.');
          error.code = 'INVENTORY_ITEM_NOT_FOUND';
          throw error;
        }
        if (item.quantity_milli < activity.quantityMilli) {
          const error = new Error('Stok gudang tidak mencukupi untuk aktivitas ini.');
          error.code = 'INSUFFICIENT_STOCK';
          throw error;
        }
      } else if (activity.quantityMilli !== 0) {
        const error = new Error('Jumlah pemakaian harus nol jika tidak memilih bahan.');
        error.code = 'INVALID_USAGE';
        throw error;
      }

      const result = await this.connection.prepare(
        `INSERT INTO field_activities
          (user_id, worker_id, field_id, crop_cycle_id, activity_type, activity_date, description)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(ownerId, workerId, field.id, cycle.id, activity.activityType, activity.date, activity.description);
      const activityId = Number(result.lastInsertRowid);

      let consumedItem = null;
      if (item) {
        const quantity = BigInt(activity.quantityMilli);
        const costRupiah = Math.max(1, Number(
          (quantity * BigInt(item.average_unit_cost_micros) + 500_000_000n)
          / 1_000_000_000n
        ));
        if (!Number.isSafeInteger(costRupiah)) {
          const error = new Error('Biaya pemakaian melebihi batas sistem.');
          error.code = 'INVENTORY_COST_LIMIT';
          throw error;
        }
        const remainingQuantity = item.quantity_milli - activity.quantityMilli;

        await this.connection.prepare(
          `UPDATE inventory_items
           SET quantity_milli = ?, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ? AND id = ?`
        ).run(remainingQuantity, ownerId, item.id);
        await this.connection.prepare(
          `INSERT INTO inventory_movements
            (user_id, item_id, activity_id, crop_cycle_id, movement_type, quantity_milli, total_cost_rupiah)
           VALUES (?, ?, ?, ?, 'usage', ?, ?)`
        ).run(ownerId, item.id, activityId, cycle.id, activity.quantityMilli, costRupiah);
        await this.connection.prepare(
          `INSERT INTO financial_transactions
            (user_id, field_id, crop_cycle_id, type, category, transaction_date, amount_rupiah, description)
           VALUES (?, ?, ?, 'expense', 'Pemakaian Inventaris', ?, ?, ?)`
        ).run(
          ownerId,
          field.id,
          cycle.id,
          activity.date,
          costRupiah,
          `${item.name}: ${activity.quantityLabel} ${item.unit} untuk ${activity.activityType}`
        );

        consumedItem = {
          id: item.id,
          name: item.name,
          unit: item.unit,
          quantityMilli: activity.quantityMilli,
          costRupiah
        };
      }

      return {
        id: activityId,
        fieldId: field.id,
        cropCycleId: cycle.id,
        fieldName: field.name,
        activityType: activity.activityType,
        date: activity.date,
        description: activity.description,
        consumedItem
      };
    });
  }

  async listFieldActivitiesForOwner(userId) {
    return await this.connection.prepare(
      `SELECT a.id, a.field_id, a.crop_cycle_id, c.commodity_name AS crop_cycle_name,
              l.name AS field_name, a.activity_type,
              a.activity_date, a.description, a.created_at,
              w.name AS worker_name,
              i.name AS item_name, i.unit AS item_unit,
              m.quantity_milli, m.total_cost_rupiah
       FROM field_activities a
       JOIN lands l ON l.id = a.field_id AND l.user_id = a.user_id
       LEFT JOIN users w ON w.id = a.worker_id
       LEFT JOIN crop_cycles c ON c.id = a.crop_cycle_id AND c.user_id = a.user_id
       LEFT JOIN inventory_movements m
         ON m.activity_id = a.id AND m.movement_type = 'usage'
       LEFT JOIN inventory_items i ON i.id = m.item_id
       WHERE a.user_id = ?
       ORDER BY a.activity_date DESC, a.id DESC`
    ).all(userId);
  }

  async close() {
    if (this.dialect === 'sqlite') await this.ready;
    await this.connection.close();
  }
}

module.exports = Database;
