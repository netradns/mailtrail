// ══════════════════════════════════════════════════════════════
// Security Headers — CSP, X-Frame-Options, etc.
// ══════════════════════════════════════════════════════════════
'use strict';

/**
 * Sets security headers on every HTTP response.
 * Includes CSP, X-Frame-Options, XSS protection, referrer policy,
 * and permissions policy.
 * @param {import('http').ServerResponse} res
 */
function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; connect-src 'self'; " +
    "img-src 'self' data:; frame-ancestors 'none'"
  );
}

module.exports = { setSecurityHeaders };
