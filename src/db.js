// ══════════════════════════════════════════════════════════════
// Database — SQLite setup, schema, prepared statements
// ══════════════════════════════════════════════════════════════
'use strict';

const Database = require('better-sqlite3');
const config = require('./config');

const db = new Database(config.DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -64000'); // 64MB cache

// ── Schema ───────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS logs (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        TEXT NOT NULL,
    ts_epoch  INTEGER NOT NULL,
    host      TEXT DEFAULT '',
    proc      TEXT DEFAULT '',
    pid       TEXT DEFAULT '',
    qid       TEXT DEFAULT '',
    sender    TEXT DEFAULT '',
    recipient TEXT DEFAULT '',
    status    TEXT DEFAULT '',
    dsn       TEXT DEFAULT '',
    relay     TEXT DEFAULT '',
    delay     TEXT DEFAULT '',
    delays    TEXT DEFAULT '',
    size      TEXT DEFAULT '',
    nrcpt     TEXT DEFAULT '',
    client    TEXT DEFAULT '',
    tls       TEXT DEFAULT '',
    msg       TEXT DEFAULT '',
    source    TEXT DEFAULT ''
  );

  CREATE INDEX IF NOT EXISTS idx_ts_epoch   ON logs(ts_epoch);
  CREATE INDEX IF NOT EXISTS idx_sender     ON logs(sender);
  CREATE INDEX IF NOT EXISTS idx_recipient  ON logs(recipient);
  CREATE INDEX IF NOT EXISTS idx_status     ON logs(status);
  CREATE INDEX IF NOT EXISTS idx_qid        ON logs(qid);
  CREATE INDEX IF NOT EXISTS idx_source     ON logs(source);
`);

// ── Schema migrations (safe to re-run) ──────────────────────
try { db.exec("ALTER TABLE logs ADD COLUMN delays TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE logs ADD COLUMN nrcpt TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE logs ADD COLUMN client TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE logs ADD COLUMN tls TEXT DEFAULT ''"); } catch {}

console.log(`[mailtrail] SQLite database: ${config.DB_PATH}`);

// ── Prepared statements for hot paths ────────────────────────
const stmtInsert = db.prepare(`
  INSERT INTO logs (ts, ts_epoch, host, proc, pid, qid, sender, recipient, status, dsn, relay, delay, delays, size, nrcpt, client, tls, msg, source)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

/**
 * Bulk-inserts log entry rows into SQLite within a single transaction.
 * Each row is an array of 19 values matching the logs table columns.
 * @param {Array[]} rows - Array of row arrays to insert.
 */
const insertMany = db.transaction((rows) => {
  for (const r of rows) stmtInsert.run(...r);
});

module.exports = { db, insertMany };
