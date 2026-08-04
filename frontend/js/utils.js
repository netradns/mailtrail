// ══════════════════════════════════════════════════════════════
// MailTrail — Shared Utilities
// HTML escaping, number formatting, status pills, toast
// notifications, clipboard, authenticated fetch wrapper.
// ══════════════════════════════════════════════════════════════

var _authHeader = '';
var _authRole = '';
var _authExpiry = 184 * 24 * 60 * 60 * 1000; // 184 days
var _timezone = localStorage.getItem('mt-tz') || 'local';

// Restore auth from localStorage with expiry check
(function() {
  try {
    var stored = JSON.parse(localStorage.getItem('mt-auth') || 'null');
    if (stored && stored.token && stored.expires > Date.now()) {
      _authHeader = stored.token;
      _authRole = stored.role || '';
    } else {
      localStorage.removeItem('mt-auth');
    }
  } catch { localStorage.removeItem('mt-auth'); }
})();

/**
 * Saves authentication credentials to memory and localStorage.
 * @param {string} token - The auth token (e.g. Basic header).
 * @param {string} role - The user role (e.g. 'admin', 'viewer').
 */
function saveAuth(token, role) {
  _authHeader = token;
  _authRole = role || '';
  localStorage.setItem('mt-auth', JSON.stringify({ token: token, role: role, expires: Date.now() + _authExpiry }));
}

/**
 * Clears authentication credentials from memory and localStorage.
 */
function clearAuth() {
  _authHeader = '';
  _authRole = '';
  localStorage.removeItem('mt-auth');
}

/**
 * Escapes HTML special characters to prevent XSS.
 * @param {string} s - The string to escape.
 * @returns {string} The escaped string.
 */
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/**
 * Formats a number with locale-appropriate separators.
 * @param {number} n - The number to format.
 * @returns {string} The formatted number string.
 */
function fmtNum(n) { return Number(n).toLocaleString(); }

/**
 * Returns an HTML pill badge for a delivery status.
 * @param {string} status - The delivery status (e.g. 'sent', 'bounced', 'deferred', 'reject').
 * @returns {string} HTML string for the status pill.
 */
function statusPill(status) {
  if (!status) return '';
  var cls = { sent: 'p-green', bounced: 'p-red', deferred: 'p-yellow', reject: 'p-red' }[status] || 'p-gray';
  return '<span class="pill ' + cls + '">' + esc(status) + '</span>';
}

/**
 * Shows a brief toast notification at the bottom of the screen.
 * @param {string} msg - The message to display.
 */
function toast(msg) {
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(function() { el.classList.remove('show'); }, 2000);
}

/**
 * Copies text to clipboard and shows a visual confirmation on the button.
 * @param {HTMLElement} btn - The button element to show confirmation on.
 * @param {string} text - The text to copy to clipboard.
 */
function copyRow(btn, text) {
  navigator.clipboard.writeText(text).then(function() {
    btn.classList.add('copied');
    setTimeout(function() { btn.classList.remove('copied'); }, 1500);
  }).catch(function() {});
}

/**
 * Fetch wrapper that automatically includes the auth header.
 * @param {string} path - The API endpoint path.
 * @param {Object} [opts] - Optional fetch options.
 * @returns {Promise<Response>} The fetch response promise.
 */
function api(path, opts) {
  opts = opts || {};
  opts.headers = opts.headers || {};
  opts.headers['Authorization'] = _authHeader;
  return fetch(path, opts);
}

/**
 * Formats a timestamp string according to the user's selected timezone.
 * @param {string} ts - The timestamp string to format.
 * @returns {string} The formatted timestamp string.
 */
function formatTs(ts) {
  if (!ts) return '—';
  try {
    // Try ISO format first (from JSON logs)
    var d = new Date(ts);
    if (isNaN(d.getTime())) {
      // Syslog format: "Mon DD HH:MM:SS" — add year
      d = new Date(ts + ' ' + new Date().getFullYear());
    }
    if (isNaN(d.getTime())) return ts;
    if (_timezone === 'local') return d.toLocaleString();
    if (_timezone === 'UTC') return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    return d.toLocaleString('en-US', { timeZone: _timezone, dateStyle: 'short', timeStyle: 'medium' });
  } catch { return ts; }
}
