// ══════════════════════════════════════════════════════════════
// Authentication — credentials, roles, Basic auth
// ══════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const config = require('../config');
const { readJSON, writeJSON } = require('../settings');

// ── Credential cache (reloads from disk every 30s) ───────────
let _credCache = null;
let _credCacheTs = 0;

/**
 * Returns the current admin and viewer credentials.
 * Reads from auth.json if it exists, otherwise falls back to env vars.
 * Cached for 30 seconds to avoid repeated disk reads.
 * @returns {{ user: string, pass: string, viewerUser: string, viewerPass: string }}
 */
function getCredentials() {
  if (_credCache && Date.now() - _credCacheTs < 30000) return _credCache;
  if (fs.existsSync(config.AUTH_FILE)) {
    const d = readJSON(config.AUTH_FILE, null);
    if (d && d.user && d.pass) {
      d.viewerUser = d.viewerUser || config.VIEWER_USER;
      d.viewerPass = d.viewerPass || config.VIEWER_PASS;
      _credCache = d; _credCacheTs = Date.now(); return d;
    }
  }
  return {
    user: config.DEFAULT_USER,
    pass: config.DEFAULT_PASS,
    viewerUser: config.VIEWER_USER,
    viewerPass: config.VIEWER_PASS,
  };
}

/**
 * Saves new admin credentials to auth.json and invalidates the cache.
 * @param {string} u - New admin username.
 * @param {string} p - New admin password.
 */
function saveCredentials(u, p) {
  const current = readJSON(config.AUTH_FILE, {});
  writeJSON(config.AUTH_FILE, { ...current, user: u, pass: p });
  _credCache = null;
}

/**
 * Saves new viewer credentials to auth.json and invalidates the cache.
 * @param {string} u - New viewer username.
 * @param {string} p - New viewer password.
 */
function saveViewerCredentials(u, p) {
  const current = readJSON(config.AUTH_FILE, {});
  writeJSON(config.AUTH_FILE, { ...current, viewerUser: u, viewerPass: p });
  _credCache = null;
}

/**
 * Returns 'admin', 'viewer', or false based on the Authorization header.
 * @param {import('http').IncomingMessage} req
 * @returns {'admin'|'viewer'|false}
 */
function getAuthRole(req) {
  const h = req.headers['authorization'] || '';
  if (!h.startsWith('Basic ')) return false;
  const decoded = Buffer.from(h.slice(6), 'base64').toString();
  const idx = decoded.indexOf(':');
  if (idx < 0) return false;
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  const creds = getCredentials();
  if (user === creds.user && pass === creds.pass) return 'admin';
  if (user === creds.viewerUser && pass === creds.viewerPass) return 'viewer';
  return false;
}

/**
 * Returns true if the request has valid admin or viewer credentials.
 * @param {import('http').IncomingMessage} req
 * @returns {boolean}
 */
function checkAuth(req) { return !!getAuthRole(req); }

/**
 * Returns true if the request has valid admin credentials.
 * @param {import('http').IncomingMessage} req
 * @returns {boolean}
 */
function isAdmin(req) { return getAuthRole(req) === 'admin'; }

module.exports = {
  getCredentials,
  saveCredentials,
  saveViewerCredentials,
  getAuthRole,
  checkAuth,
  isAdmin,
};
