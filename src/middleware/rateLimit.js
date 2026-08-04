// ══════════════════════════════════════════════════════════════
// Rate Limiting — per-IP auth attempt throttling
// ══════════════════════════════════════════════════════════════
'use strict';

const _authAttempts = new Map(); // ip -> { count, resetAt }
const AUTH_MAX_ATTEMPTS = 10;
const AUTH_WINDOW_MS = 300000; // 5 minutes

/**
 * Checks if an IP address has exceeded the auth attempt limit.
 * Allows AUTH_MAX_ATTEMPTS (10) attempts per AUTH_WINDOW_MS (5 min) window.
 * @param {string} ip - Client IP address.
 * @returns {boolean} True if the request should be allowed.
 */
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = _authAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    _authAttempts.set(ip, { count: 1, resetAt: now + AUTH_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= AUTH_MAX_ATTEMPTS;
}

// Clean up expired entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of _authAttempts) {
    if (now > entry.resetAt) _authAttempts.delete(ip);
  }
}, 600000);

module.exports = { checkRateLimit };
