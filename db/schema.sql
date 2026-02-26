PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tracked_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL UNIQUE,
  label TEXT,
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address_id INTEGER NOT NULL,
  tx_hash TEXT NOT NULL UNIQUE,
  token_in TEXT NOT NULL,
  token_out TEXT NOT NULL,
  amount_in REAL NOT NULL,
  amount_out REAL NOT NULL,
  timestamp TEXT NOT NULL,
  profit_loss REAL NOT NULL,
  FOREIGN KEY (address_id) REFERENCES tracked_addresses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS portfolio_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  total_profit REAL NOT NULL,
  win_rate REAL NOT NULL,
  active_addresses INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  address_id INTEGER,
  reason TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (address_id) REFERENCES tracked_addresses(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_trades_address_id ON trades(address_id);
CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
CREATE INDEX IF NOT EXISTS idx_ai_recommendations_type ON ai_recommendations(type);
