PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'farmer'
    CHECK (role IN ('farmer', 'worker', 'admin')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS worker_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_date TEXT NOT NULL,
  activity TEXT NOT NULL CHECK (length(activity) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS worker_activities_owner_date_idx
  ON worker_activities(user_id, activity_date DESC, id DESC);

CREATE TABLE IF NOT EXISTS owner_invites (
  owner_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  invite_code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS owner_workers (
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  worker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (owner_id, worker_id),
  CHECK (owner_id != worker_id)
);

CREATE INDEX IF NOT EXISTS owner_workers_worker_idx
  ON owner_workers(worker_id, joined_at DESC);

CREATE TABLE IF NOT EXISTS lands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 100),
  area_hectares REAL NOT NULL CHECK (area_hectares > 0 AND area_hectares <= 100000),
  soil_type TEXT NOT NULL DEFAULT ''
    CHECK (soil_type IN ('', 'alluvial', 'volcanic', 'humus', 'latosol')),
  commodity TEXT NOT NULL DEFAULT '' CHECK (length(commodity) <= 100),
  coordinates TEXT NOT NULL DEFAULT '' CHECK (length(coordinates) <= 100),
  notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS lands_owner_idx ON lands(user_id, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS lands_owner_id_unique ON lands(user_id, id);

CREATE TABLE IF NOT EXISTS crop_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field_id INTEGER NOT NULL REFERENCES lands(id) ON DELETE RESTRICT,
  commodity_name TEXT NOT NULL CHECK (length(commodity_name) BETWEEN 2 AND 100),
  variety TEXT NOT NULL DEFAULT '' CHECK (length(variety) <= 100),
  start_date TEXT NOT NULL,
  expected_harvest_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  final_income_rupiah INTEGER CHECK (final_income_rupiah IS NULL OR final_income_rupiah >= 0),
  final_expense_rupiah INTEGER CHECK (final_expense_rupiah IS NULL OR final_expense_rupiah >= 0),
  final_profit_rupiah INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  UNIQUE (user_id, field_id, id),
  FOREIGN KEY (user_id, field_id) REFERENCES lands(user_id, id) ON DELETE RESTRICT,
  CHECK (
    (status = 'active' AND end_date IS NULL AND completed_at IS NULL
      AND final_income_rupiah IS NULL AND final_expense_rupiah IS NULL AND final_profit_rupiah IS NULL)
    OR
    (status = 'completed' AND end_date IS NOT NULL AND completed_at IS NOT NULL
      AND final_income_rupiah IS NOT NULL AND final_expense_rupiah IS NOT NULL AND final_profit_rupiah IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS crop_cycles_one_active_per_field
  ON crop_cycles(field_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS crop_cycles_owner_status_idx
  ON crop_cycles(user_id, status, start_date DESC, id DESC);

CREATE TABLE IF NOT EXISTS financial_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field_id INTEGER REFERENCES lands(id) ON DELETE SET NULL,
  crop_cycle_id INTEGER REFERENCES crop_cycles(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  category TEXT NOT NULL CHECK (length(category) BETWEEN 1 AND 60),
  transaction_date TEXT NOT NULL,
  amount_rupiah INTEGER NOT NULL CHECK (amount_rupiah > 0),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS financial_transactions_owner_date_idx
  ON financial_transactions(user_id, transaction_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS financial_transactions_field_date_idx
  ON financial_transactions(user_id, field_id, transaction_date DESC, id DESC);

CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 100),
  unit TEXT NOT NULL CHECK (length(unit) BETWEEN 1 AND 20),
  quantity_milli INTEGER NOT NULL DEFAULT 0 CHECK (quantity_milli >= 0),
  average_unit_cost_micros INTEGER NOT NULL DEFAULT 0 CHECK (average_unit_cost_micros >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, name, unit)
);

CREATE INDEX IF NOT EXISTS inventory_items_owner_name_idx
  ON inventory_items(user_id, name);

CREATE TABLE IF NOT EXISTS field_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  worker_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  field_id INTEGER NOT NULL REFERENCES lands(id) ON DELETE CASCADE,
  crop_cycle_id INTEGER REFERENCES crop_cycles(id) ON DELETE SET NULL,
  activity_type TEXT NOT NULL CHECK (length(activity_type) BETWEEN 1 AND 60),
  activity_date TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS field_activities_owner_date_idx
  ON field_activities(user_id, activity_date DESC, id DESC);

CREATE TABLE IF NOT EXISTS owner_worker_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  worker_id INTEGER NOT NULL,
  field_id INTEGER NOT NULL,
  crop_cycle_id INTEGER NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id, worker_id)
    REFERENCES owner_workers(owner_id, worker_id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, field_id)
    REFERENCES lands(user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id, field_id, crop_cycle_id)
    REFERENCES crop_cycles(user_id, field_id, id) ON DELETE CASCADE,
  UNIQUE (owner_id, worker_id, field_id, crop_cycle_id)
);

CREATE INDEX IF NOT EXISTS owner_worker_assignments_worker_idx
  ON owner_worker_assignments(worker_id, owner_id, id);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  activity_id INTEGER REFERENCES field_activities(id) ON DELETE SET NULL,
  crop_cycle_id INTEGER REFERENCES crop_cycles(id) ON DELETE SET NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('purchase', 'usage')),
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  total_cost_rupiah INTEGER NOT NULL CHECK (total_cost_rupiah >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS inventory_movements_owner_date_idx
  ON inventory_movements(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS inventory_movements_activity_idx
  ON inventory_movements(activity_id);
