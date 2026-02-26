const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

class CopytradeDB {
  constructor(options = {}) {
    const dbPath = options.dbPath || process.env.SQLITE_PATH || 'data/copytrade.db';
    this.dbPath = dbPath;

    const dir = path.dirname(dbPath);
    if (dir && dir !== '.' && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this._init();
    this._prepare();
  }

  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tracked_addresses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        address TEXT NOT NULL UNIQUE,
        proxy_wallet TEXT,
        label TEXT,
        added_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );

      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        address_id INTEGER NOT NULL,
        tx_hash TEXT NOT NULL UNIQUE,
        token_in TEXT,
        token_out TEXT,
        amount_in REAL,
        amount_out REAL,
        timestamp INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        profit_loss REAL,
        FOREIGN KEY (address_id) REFERENCES tracked_addresses(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS ai_recommendations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        address_id INTEGER,
        reason TEXT,
        confidence REAL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        FOREIGN KEY (address_id) REFERENCES tracked_addresses(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_trades_address_id ON trades(address_id);
      CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
      CREATE INDEX IF NOT EXISTS idx_recs_type_created ON ai_recommendations(type, created_at);
    `);
  }

  _prepare() {
    this._stmts = {
      getAddressById: this.db.prepare(
        'SELECT id, address, label, added_at FROM tracked_addresses WHERE id = ?'
      ),
      getAddressByAddress: this.db.prepare(
        'SELECT id, address, label, added_at FROM tracked_addresses WHERE address = ?'
      ),
      insertAddress: this.db.prepare(
        'INSERT OR IGNORE INTO tracked_addresses (address, label) VALUES (?, ?)'
      ),
      updateAddressLabel: this.db.prepare(
        'UPDATE tracked_addresses SET label = ? WHERE address = ?'
      ),
      getAllAddresses: this.db.prepare(
        'SELECT id, address, label, added_at FROM tracked_addresses ORDER BY added_at DESC'
      ),
      deleteAddressById: this.db.prepare('DELETE FROM tracked_addresses WHERE id = ?'),
      deleteAddressByAddress: this.db.prepare('DELETE FROM tracked_addresses WHERE address = ?'),
      insertTrade: this.db.prepare(
        `
        INSERT OR IGNORE INTO trades (
          address_id, tx_hash, token_in, token_out, amount_in, amount_out, timestamp, profit_loss
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `.trim()
      ),
      getAddressStatsById: this.db.prepare(
        `
        SELECT
          a.id,
          a.address,
          a.label,
          a.added_at,
          COUNT(t.id) AS trade_count,
          COALESCE(SUM(t.profit_loss), 0) AS total_profit_loss,
          COALESCE(AVG(t.profit_loss), 0) AS avg_profit_loss,
          MAX(t.timestamp) AS last_trade_at
        FROM tracked_addresses a
        LEFT JOIN trades t ON t.address_id = a.id
        WHERE a.id = ?
        GROUP BY a.id
        `.trim()
      ),
      getAllAddressStats: this.db.prepare(
        `
        SELECT
          a.id,
          a.address,
          a.label,
          a.added_at,
          COUNT(t.id) AS trade_count,
          COALESCE(SUM(t.profit_loss), 0) AS total_profit_loss,
          COALESCE(AVG(t.profit_loss), 0) AS avg_profit_loss,
          MAX(t.timestamp) AS last_trade_at
        FROM tracked_addresses a
        LEFT JOIN trades t ON t.address_id = a.id
        GROUP BY a.id
        ORDER BY total_profit_loss DESC
        `.trim()
      ),
      insertRecommendation: this.db.prepare(
        `
        INSERT INTO ai_recommendations (
          type, address_id, reason, confidence, created_at
        ) VALUES (?, ?, ?, ?, ?)
        `.trim()
      ),
      getLatestRecommendations: this.db.prepare(
        `
        SELECT
          r.id,
          r.type,
          r.address_id,
          a.address,
          a.label,
          r.reason,
          r.confidence,
          r.created_at
        FROM ai_recommendations r
        LEFT JOIN tracked_addresses a ON a.id = r.address_id
        WHERE (? IS NULL OR r.type = ?)
          AND (? IS NULL OR r.address_id = ?)
        ORDER BY r.created_at DESC
        LIMIT ?
        `.trim()
      ),
    };
  }

  close() {
    this.db.close();
  }

  addAddress(address, label = null) {
    if (!address || typeof address !== 'string') {
      throw new Error('address is required');
    }

    this._stmts.insertAddress.run(address, label);

    if (label !== null && label !== undefined) {
      this._stmts.updateAddressLabel.run(label, address);
    }

    return this._stmts.getAddressByAddress.get(address);
  }

  getAllAddresses() {
    return this._stmts.getAllAddresses.all();
  }

  removeAddress(identifier) {
    if (identifier === null || identifier === undefined) {
      throw new Error('identifier is required');
    }

    if (typeof identifier === 'number' || (typeof identifier === 'string' && /^\d+$/.test(identifier))) {
      return this._stmts.deleteAddressById.run(Number(identifier)).changes;
    }

    return this._stmts.deleteAddressByAddress.run(String(identifier)).changes;
  }

  addTrade(trade) {
    if (!trade || typeof trade !== 'object') {
      throw new Error('trade is required');
    }

    let addressId = trade.address_id ?? trade.addressId ?? null;

    if (!addressId && trade.address) {
      const existing = this._stmts.getAddressByAddress.get(trade.address);
      if (!existing) {
        const created = this.addAddress(trade.address, trade.label || null);
        addressId = created.id;
      } else {
        addressId = existing.id;
      }
    }

    if (!addressId) {
      throw new Error('address_id or address is required');
    }

    const timestamp = trade.timestamp ?? Math.floor(Date.now() / 1000);

    const result = this._stmts.insertTrade.run(
      addressId,
      trade.tx_hash || trade.txHash,
      trade.token_in || trade.tokenIn || null,
      trade.token_out || trade.tokenOut || null,
      trade.amount_in ?? trade.amountIn ?? null,
      trade.amount_out ?? trade.amountOut ?? null,
      timestamp,
      trade.profit_loss ?? trade.profitLoss ?? null
    );

    return result.changes;
  }

  getAddressStats(identifier) {
    if (identifier === null || identifier === undefined) {
      throw new Error('identifier is required');
    }

    let addressId = identifier;
    if (typeof identifier === 'string' && !/^\d+$/.test(identifier)) {
      const row = this._stmts.getAddressByAddress.get(identifier);
      if (!row) {
        return null;
      }
      addressId = row.id;
    }

    return this._stmts.getAddressStatsById.get(Number(addressId));
  }

  getAllAddressStats() {
    return this._stmts.getAllAddressStats.all();
  }

  saveRecommendation(recommendation) {
    if (!recommendation || typeof recommendation !== 'object') {
      throw new Error('recommendation is required');
    }

    if (!recommendation.type) {
      throw new Error('recommendation.type is required');
    }

    let addressId = recommendation.address_id ?? recommendation.addressId ?? null;

    if (!addressId && recommendation.address) {
      const existing = this._stmts.getAddressByAddress.get(recommendation.address);
      addressId = existing ? existing.id : null;
    }

    const createdAt = recommendation.created_at ?? recommendation.createdAt ?? Math.floor(Date.now() / 1000);

    const info = this._stmts.insertRecommendation.run(
      recommendation.type,
      addressId,
      recommendation.reason || null,
      recommendation.confidence ?? null,
      createdAt
    );

    return info.lastInsertRowid;
  }

  getLatestRecommendations(options = {}) {
    const limit = options.limit ?? 20;
    const type = options.type ?? null;
    let addressId = options.address_id ?? options.addressId ?? null;

    if (!addressId && options.address) {
      const existing = this._stmts.getAddressByAddress.get(options.address);
      addressId = existing ? existing.id : null;
    }

    return this._stmts.getLatestRecommendations.all(type, type, addressId, addressId, limit);
  }
}

module.exports = {
  CopytradeDB,
};
