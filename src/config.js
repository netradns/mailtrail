// ══════════════════════════════════════════════════════════════
// Configuration — environment variables and defaults
// ══════════════════════════════════════════════════════════════
'use strict';

const path = require('path');

const DATA_DIR     = process.env.DATA_DIR || '/data';

module.exports = {
  PORT:             parseInt(process.env.PORT || '3000', 10),
  LOG_DIR:          process.env.LOG_DIR || '/logs',
  DATA_DIR,
  DB_PATH:          path.join(DATA_DIR, 'mailtrail.db'),
  AUTH_FILE:        path.join(DATA_DIR, 'auth.json'),
  SETTINGS_FILE:    path.join(DATA_DIR, 'settings.json'),
  CURSOR_FILE:      path.join(DATA_DIR, 'ingest-cursor.json'),
  MAX_LOG_GB:       parseFloat(process.env.MAX_LOG_SIZE_GB || '20'),
  RETENTION_DAYS:   parseInt(process.env.RETENTION_DAYS || '90', 10),
  DEFAULT_USER:     process.env.ADMIN_USER || 'admin',
  DEFAULT_PASS:     process.env.ADMIN_PASS || 'admin',
  VIEWER_USER:      process.env.VIEWER_USER || 'viewer',
  VIEWER_PASS:      process.env.VIEWER_PASS || 'viewer',
  SMTP_HOST:        process.env.SMTP_HOST || 'postfix',
  SMTP_PORT:        parseInt(process.env.SMTP_PORT || '25', 10),
  INGEST_INTERVAL:  parseInt(process.env.INGEST_INTERVAL_MS || '3000', 10),
  APP_VERSION:      process.env.APP_VERSION || (() => { try { return require('fs').readFileSync(require('path').join(__dirname, '..', '.version'), 'utf8').trim(); } catch { return '1.0.0'; } })(),
};
