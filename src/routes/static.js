// ══════════════════════════════════════════════════════════════
// Static File Serving — frontend assets with path traversal protection
// ══════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

const FRONTEND_DIR = path.resolve(path.join(__dirname, '..', '..', 'frontend'));

/**
 * Serves a static file from the frontend directory.
 * Includes path traversal protection and MIME type detection.
 * @param {import('http').ServerResponse} res
 * @param {string} fp - Relative file path within the frontend directory.
 */
function serveStatic(res, fp) {
  const full = path.resolve(path.join(FRONTEND_DIR, fp));
  // Prevent path traversal
  if (!full.startsWith(FRONTEND_DIR + path.sep) && full !== FRONTEND_DIR) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  if (!fs.existsSync(full)) { res.writeHead(404); res.end('Not found'); return; }
  const ext = path.extname(full);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  res.end(fs.readFileSync(full));
}

module.exports = { serveStatic };
