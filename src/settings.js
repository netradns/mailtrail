// ══════════════════════════════════════════════════════════════
// Settings — cached read/write with disk persistence
// ══════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const config = require('./config');

/**
 * Reads and parses a JSON file from disk.
 * @param {string} file - Absolute path to the JSON file.
 * @param {*} fallback - Value to return if the file doesn't exist or is invalid.
 * @returns {*} Parsed JSON or the fallback value.
 */
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

/**
 * Writes a JavaScript object to disk as formatted JSON.
 * @param {string} file - Absolute path to write to.
 * @param {*} data - Object to serialize.
 */
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ── Settings (cached — reloads from disk every 30s) ──────────
let _cache = null;
let _cacheTs = 0;

const DEFAULTS = {
  testSenderAddress: 'mailtrail-test@example.com',
  testSenderName: 'MailTrail Test',
  retentionDays: config.RETENTION_DAYS,
  maxLogSizeGB: config.MAX_LOG_GB,
  alertChannels: [],            // [{ service: 'slack', url: '...' }, ...]
  alertFromAddress: 'mailtrail-alerts@localhost',
  alertBounceEnabled: false,
  alertBounceThreshold: 5,
  alertQueueEnabled: false,
  alertQueueThreshold: 50,
  alertHealthEnabled: false,
  alertCooldownMin: 15,
};

/**
 * Returns the current settings, merged with defaults.
 * Cached for 30 seconds to avoid repeated disk reads.
 * @returns {Object} Settings object with all fields populated.
 */
function getSettings() {
  if (_cache && Date.now() - _cacheTs < 30000) return _cache;
  const merged = { ...DEFAULTS, ...readJSON(config.SETTINGS_FILE, {}) };
  _cache = merged;
  _cacheTs = Date.now();
  return merged;
}

/**
 * Merges updates into the current settings and persists to disk.
 * @param {Object} updates - Key/value pairs to merge into settings.
 * @returns {Object} The full merged settings object.
 */
function saveSettings(updates) {
  const merged = { ...getSettings(), ...updates };
  writeJSON(config.SETTINGS_FILE, merged);
  _cache = merged;
  _cacheTs = Date.now();
  return merged;
}

module.exports = { getSettings, saveSettings, readJSON, writeJSON };
