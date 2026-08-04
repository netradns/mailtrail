// ══════════════════════════════════════════════════════════════
// Data Retention — purge old DB entries and manage log file sizes
// ══════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { db } = require('../db');
const { getSettings } = require('../settings');

/**
 * Deletes SQLite log entries older than the configured retention period.
 * Runs PRAGMA optimize after purging to keep query performance healthy.
 * @returns {void}
 */
function purgeOldEntries() {
  const settings = getSettings();
  const days = settings.retentionDays || config.RETENTION_DAYS;
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
  const result = db.prepare('DELETE FROM logs WHERE ts_epoch > 0 AND ts_epoch < ?').run(cutoff);
  if (result.changes > 0) {
    console.log(`[mailtrail] Purged ${result.changes} entries older than ${days} days`);
    db.exec('PRAGMA optimize');
  }
}

/**
 * Deletes the oldest raw log files when total size exceeds the configured limit.
 * Always keeps at least one file. Sorts by modification time (oldest first).
 * @returns {void}
 */
function checkLogSize() {
  const settings = getSettings();
  const maxGB = settings.maxLogSizeGB || config.MAX_LOG_GB;
  try {
    let totalSize = 0;
    const files = fs.readdirSync(config.LOG_DIR)
      .filter(f => f.startsWith('mail.'))
      .map(f => {
        const fp = path.join(config.LOG_DIR, f);
        const stat = fs.statSync(fp);
        return { name: f, path: fp, size: stat.size, mtime: stat.mtimeMs };
      })
      .sort((a, b) => a.mtime - b.mtime);
    for (const f of files) totalSize += f.size;
    const maxBytes = maxGB * 1024 * 1024 * 1024;
    while (totalSize > maxBytes && files.length > 1) {
      const oldest = files.shift();
      console.log(`[mailtrail] Purging old log file: ${oldest.name}`);
      fs.unlinkSync(oldest.path);
      totalSize -= oldest.size;
    }
  } catch (err) { console.error(`[mailtrail] Log cleanup error: ${err.message}`); }
}

/**
 * Starts the retention timer. Runs purge + log size check every hour.
 * First run is delayed 5 seconds after startup to avoid blocking init.
 * @returns {void}
 */
function startRetention() {
  setInterval(() => { purgeOldEntries(); checkLogSize(); }, 3600000);
  setTimeout(() => { purgeOldEntries(); checkLogSize(); }, 5000);
}

module.exports = { purgeOldEntries, checkLogSize, startRetention };
