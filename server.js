// ══════════════════════════════════════════════════════════════
// MailTrail — Postfix Log Viewer
// Entry point: wires up services and starts the HTTP server
// ══════════════════════════════════════════════════════════════
'use strict';

const http = require('http');
const fs = require('fs');
const config = require('./src/config');
const { db } = require('./src/db');
const { getCredentials } = require('./src/middleware/auth');
const { startIngestion } = require('./src/services/ingest');
const { startRetention } = require('./src/services/retention');
const { startAlertChecks } = require('./src/services/alerting');
const { handler } = require('./src/routes/api');

// ── Ensure data directory exists ─────────────────────────────
if (!fs.existsSync(config.DATA_DIR)) {
  fs.mkdirSync(config.DATA_DIR, { recursive: true });
}

// ── Start background services ────────────────────────────────
startIngestion();
startRetention();
startAlertChecks();

// ── HTTP server ──────────────────────────────────────────────
http.createServer(async (req, res) => {
  try {
    await handler(req, res);
  } catch (err) {
    console.error(`[mailtrail] Request error ${req.method} ${req.url}: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }
}).listen(config.PORT, () => {
  const c = getCredentials();
  console.log(`[mailtrail] Running on :${config.PORT}`);
  console.log(`[mailtrail] Log dir: ${config.LOG_DIR}`);
  console.log(`[mailtrail] Retention: ${config.RETENTION_DAYS} days, max log files: ${config.MAX_LOG_GB}GB`);
  console.log(`[mailtrail] Admin: ${c.user} / ${'*'.repeat(c.pass.length)}`);
});

// ── Graceful shutdown ────────────────────────────────────────
process.on('SIGTERM', () => { db.close(); process.exit(0); });
process.on('SIGINT', () => { db.close(); process.exit(0); });

process.on('uncaughtException', (err) => {
  console.error(`[mailtrail] FATAL uncaught exception: ${err.message}`);
  console.error(err.stack);
  try { db.close(); } catch {}
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error(`[mailtrail] Unhandled rejection: ${err}`);
});
