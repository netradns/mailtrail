// ══════════════════════════════════════════════════════════════
// Log Ingestion — tails Postfix log files and inserts into SQLite
// ══════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { insertMany } = require('../db');
const { readJSON, writeJSON } = require('../settings');
const { parsePostfixLine, parseJsonLine } = require('./parser');

let cursor = readJSON(config.CURSOR_FILE, {});
let _ingesting = false;
const MAX_INGEST_BYTES = 10 * 1024 * 1024; // 10MB max per file per cycle

/** Persists the current cursor positions to disk. */
function saveCursor() { writeJSON(config.CURSOR_FILE, cursor); }

/**
 * Returns a sorted list of mail log filenames in LOG_DIR.
 * Matches files starting with "mail." and ending with ".log" or ".json".
 * @returns {string[]} Array of filenames (not full paths).
 */
function getLogFiles() {
  try {
    return fs.readdirSync(config.LOG_DIR)
      .filter(f => f.startsWith('mail.') && (f.endsWith('.log') || f.endsWith('.json')))
      .sort();
  } catch { return []; }
}

/**
 * Reads new lines from each log file since the last cursor position,
 * parses them, and bulk-inserts into SQLite.
 */
function ingestLogs() {
  if (_ingesting) return;
  _ingesting = true;

  try {
    const files = getLogFiles();
    let totalInserted = 0;

    for (const filename of files) {
      const fp = path.join(config.LOG_DIR, filename);
      let stat;
      try { stat = fs.statSync(fp); } catch { continue; }

      const prevOffset = cursor[filename] || 0;

      // File was truncated/rotated — reset cursor
      if (stat.size < prevOffset) {
        cursor[filename] = 0;
      }

      if (stat.size <= (cursor[filename] || 0)) continue;

      const startOffset = cursor[filename] || 0;
      const bytesToRead = Math.min(stat.size - startOffset, MAX_INGEST_BYTES);

      const fd = fs.openSync(fp, 'r');
      const buf = Buffer.alloc(bytesToRead);
      fs.readSync(fd, buf, 0, bytesToRead, startOffset);
      fs.closeSync(fd);

      const chunk = buf.toString('utf8');
      const lastNewline = bytesToRead < (stat.size - startOffset) ? chunk.lastIndexOf('\n') : chunk.length;
      if (lastNewline <= 0) { cursor[filename] = startOffset; continue; }

      const safeChunk = chunk.slice(0, lastNewline);
      const lines = safeChunk.split('\n').filter(Boolean);
      const isJson = filename.endsWith('.json');

      const rows = [];
      for (const line of lines) {
        const entry = isJson ? parseJsonLine(line) : parsePostfixLine(line);
        if (!entry) continue;
        // Filter out MailTrail's own health check connections
        if (entry.msg.includes('mailtrail') && (entry.msg.includes('connect from') || entry.msg.includes('disconnect from')) && entry.msg.includes('quit=1 commands=1')) continue;
        rows.push([
          entry.ts, entry.ts_epoch, entry.host, entry.proc, entry.pid,
          entry.qid, entry.sender, entry.recipient, entry.status,
          entry.dsn, entry.relay, entry.delay, entry.delays, entry.size,
          entry.nrcpt, entry.client, entry.tls, entry.msg, filename,
        ]);
      }

      if (rows.length) {
        insertMany(rows);
        totalInserted += rows.length;
      }

      cursor[filename] = startOffset + lastNewline;
    }

    if (totalInserted > 0) {
      saveCursor();
      if (totalInserted > 10) console.log(`[mailtrail] Ingested ${totalInserted} log entries`);
    }
  } catch (err) {
    console.error(`[mailtrail] Ingestion error: ${err.message}`);
  } finally {
    _ingesting = false;
  }
}

/**
 * Starts the ingestion timer. Call once at startup.
 */
function startIngestion() {
  setInterval(ingestLogs, config.INGEST_INTERVAL);
  setTimeout(ingestLogs, 500);
  console.log(`[mailtrail] Log ingestion every ${config.INGEST_INTERVAL}ms from ${config.LOG_DIR}`);
}

module.exports = { getLogFiles, ingestLogs, startIngestion };
