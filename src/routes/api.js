// ══════════════════════════════════════════════════════════════
// API Routes — all HTTP endpoint handlers
// ══════════════════════════════════════════════════════════════
'use strict';

const url = require('url');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { setSecurityHeaders } = require('../middleware/security');
const { getAuthRole, checkAuth, isAdmin, saveCredentials } = require('../middleware/auth');
const { checkRateLimit } = require('../middleware/rateLimit');
const { getSettings, saveSettings } = require('../settings');
const { checkSmtp, sendTestEmail } = require('../services/smtp');
const { sendAlert, sendToChannel } = require('../services/alerting');
const { getLogFiles } = require('../services/ingest');
const { serveStatic } = require('./static');
const queries = require('../services/queries');

// ── Helpers ──────────────────────────────────────────────────

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function unauthorized(res) {
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Unauthorized' }));
}

function readBody(req, maxBytes = 1048576) {
  return new Promise((resolve, reject) => {
    let b = '';
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > maxBytes) { req.destroy(); reject(new Error('Request body too large')); return; }
      b += c;
    });
    req.on('end', () => resolve(b));
    req.on('error', reject);
  });
}

// ── Route handler ────────────────────────────────────────────

async function handler(req, res) {
  const parsed = url.parse(req.url, true);
  const p = parsed.pathname;
  setSecurityHeaders(res);

  // Health (public)
  if (p === '/api/health' && req.method === 'GET')
    return json(res, 200, { status: 'ok', uptime: process.uptime(), version: config.APP_VERSION, timezone: process.env.TZ || 'UTC' });

  // Auth check (rate limited)
  if (p === '/api/auth' && req.method === 'POST') {
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
    if (!checkRateLimit(clientIp)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Too many attempts. Try again in 5 minutes.' }));
    }
    const role = getAuthRole(req);
    return json(res, role ? 200 : 401, { ok: !!role, role: role || null });
  }

  // Dashboard
  if (p === '/api/dashboard' && req.method === 'GET') {
    if (!checkAuth(req)) return unauthorized(res);
    return json(res, 200, queries.getDashboardStats());
  }

  // Postfix SMTP health
  if (p === '/api/postfix/health' && req.method === 'GET') {
    if (!checkAuth(req)) return unauthorized(res);
    return json(res, 200, await checkSmtp());
  }

  // Send test email (admin only)
  if (p === '/api/postfix/test' && req.method === 'POST') {
    if (!isAdmin(req)) return unauthorized(res);
    try {
      const body = JSON.parse(await readBody(req));
      const settings = getSettings();
      const fromAddr = (body.from || settings.testSenderAddress).trim().replace(/[\r\n]/g, '');
      const fromName = (settings.testSenderName || '').replace(/[\r\n]/g, '');
      const toAddr = (body.to || '').trim().replace(/[\r\n]/g, '');
      if (!fromAddr || !toAddr) return json(res, 400, { error: 'from and to are required' });
      if (!fromAddr.includes('@') || !toAddr.includes('@')) return json(res, 400, { error: 'Invalid email address' });
      if (fromAddr.length > 254 || toAddr.length > 254) return json(res, 400, { error: 'Email address too long' });
      const result = await sendTestEmail(fromAddr, toAddr, fromName);
      return json(res, result.ok ? 200 : 500, result);
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  // Settings
  if (p === '/api/settings' && req.method === 'GET') {
    if (!checkAuth(req)) return unauthorized(res);
    return json(res, 200, getSettings());
  }
  if (p === '/api/settings' && req.method === 'PUT') {
    if (!isAdmin(req)) return unauthorized(res);
    try {
      const body = JSON.parse(await readBody(req));
      const allowed = {};
      if (typeof body.testSenderAddress === 'string') allowed.testSenderAddress = body.testSenderAddress.trim();
      if (typeof body.testSenderName === 'string') allowed.testSenderName = body.testSenderName.trim();
      if (typeof body.retentionDays === 'number' && body.retentionDays >= 1 && body.retentionDays <= 365) allowed.retentionDays = Math.floor(body.retentionDays);
      if (typeof body.maxLogSizeGB === 'number' && body.maxLogSizeGB >= 1 && body.maxLogSizeGB <= 100) allowed.maxLogSizeGB = Math.round(body.maxLogSizeGB * 10) / 10;
      // Alert channels (array of { service, url })
      const validServices = ['slack', 'teams', 'pagerduty', 'discord', 'email', 'webhook'];
      if (Array.isArray(body.alertChannels)) {
        allowed.alertChannels = body.alertChannels
          .filter(ch => {
            if (!ch || !validServices.includes(ch.service) || typeof ch.url !== 'string' || !ch.url.trim()) return false;
            if (ch.service === 'email') return ch.url.includes('@') && ch.url.length <= 254;
            if (ch.service === 'pagerduty') return ch.url.trim().length >= 10;
            return ch.url.trim().startsWith('http://') || ch.url.trim().startsWith('https://');
          })
          .map(ch => {
            const mapped = { service: ch.service, url: ch.url.trim() };
            // Email channels can include an optional sender address
            if (ch.service === 'email' && typeof ch.fromAddress === 'string' && ch.fromAddress.trim()) {
              mapped.fromAddress = ch.fromAddress.trim().replace(/[\r\n]/g, '');
            }
            return mapped;
          })
          .slice(0, 10); // max 10 channels
      }
      if (typeof body.alertFromAddress === 'string') allowed.alertFromAddress = body.alertFromAddress.trim();
      if (typeof body.alertBounceEnabled === 'boolean') allowed.alertBounceEnabled = body.alertBounceEnabled;
      if (typeof body.alertBounceThreshold === 'number' && body.alertBounceThreshold >= 1 && body.alertBounceThreshold <= 100) allowed.alertBounceThreshold = body.alertBounceThreshold;
      if (typeof body.alertQueueEnabled === 'boolean') allowed.alertQueueEnabled = body.alertQueueEnabled;
      if (typeof body.alertQueueThreshold === 'number' && body.alertQueueThreshold >= 1 && body.alertQueueThreshold <= 10000) allowed.alertQueueThreshold = Math.floor(body.alertQueueThreshold);
      if (typeof body.alertHealthEnabled === 'boolean') allowed.alertHealthEnabled = body.alertHealthEnabled;
      if (typeof body.alertCooldownMin === 'number' && body.alertCooldownMin >= 1 && body.alertCooldownMin <= 1440) allowed.alertCooldownMin = Math.floor(body.alertCooldownMin);
      if (!Object.keys(allowed).length) return json(res, 400, { error: 'No valid settings provided' });
      return json(res, 200, { ok: true, settings: saveSettings(allowed) });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  // Test alert (admin only) — sends to all channels or a specific one
  if (p === '/api/alerts/test' && req.method === 'POST') {
    if (!isAdmin(req)) return unauthorized(res);
    try {
      const body = JSON.parse(await readBody(req));
      const testFields = [
        { label: 'Status', value: 'This is a test alert' },
        { label: 'Server', value: `${config.SMTP_HOST}:${config.SMTP_PORT}` },
        { label: 'Uptime', value: `${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m` },
      ];
      // Accept a channel object directly for testing unsaved channels
      if (body.channel && body.channel.service && body.channel.url) {
        const validServices = ['slack', 'teams', 'pagerduty', 'discord', 'email', 'webhook'];
        if (!validServices.includes(body.channel.service)) return json(res, 400, { error: 'Invalid service' });
        await sendToChannel(body.channel, 'Test alert from MailTrail', testFields, 'info');
      } else {
        // Send to all saved channels
        await sendAlert('Test alert from MailTrail', testFields, 'info');
      }
      return json(res, 200, { ok: true });
    } catch (e) { return json(res, 500, { error: e.message }); }
  }

  // Search logs
  if (p === '/api/logs' && req.method === 'GET') {
    if (!checkAuth(req)) return unauthorized(res);
    return json(res, 200, queries.searchLogs(parsed.query));
  }

  // Log files list
  if (p === '/api/logs/files' && req.method === 'GET') {
    if (!checkAuth(req)) return unauthorized(res);
    const files = getLogFiles().map(f => {
      try {
        const stat = fs.statSync(path.join(config.LOG_DIR, f));
        return { name: f, size: stat.size, modified: stat.mtime.toISOString() };
      } catch { return { name: f, size: 0, modified: '' }; }
    });
    return json(res, 200, files);
  }

  // Live tail
  if (p === '/api/logs/tail' && req.method === 'GET') {
    if (!checkAuth(req)) return unauthorized(res);
    const n = parseInt(parsed.query.n || '50', 10);
    return json(res, 200, { entries: queries.getTailMessages(n) });
  }

  // Correlated message search
  if (p === '/api/messages' && req.method === 'GET') {
    if (!checkAuth(req)) return unauthorized(res);
    return json(res, 200, queries.getCorrelatedMessages(parsed.query));
  }

  // QID tracking
  if (p === '/api/logs/qid' && req.method === 'GET') {
    if (!checkAuth(req)) return unauthorized(res);
    const qid = (parsed.query.id || '').trim();
    if (!qid) return json(res, 400, { error: 'id parameter required' });
    return json(res, 200, queries.trackQid(qid));
  }

  // Top senders
  if (p === '/api/stats/top-senders' && req.method === 'GET') {
    if (!checkAuth(req)) return unauthorized(res);
    return json(res, 200, queries.getTopSenders(parseInt(parsed.query.limit || '15', 10)));
  }

  // Top recipients
  if (p === '/api/stats/top-recipients' && req.method === 'GET') {
    if (!checkAuth(req)) return unauthorized(res);
    return json(res, 200, queries.getTopRecipients(parseInt(parsed.query.limit || '15', 10)));
  }

  // Top domains
  if (p === '/api/stats/top-domains' && req.method === 'GET') {
    if (!checkAuth(req)) return unauthorized(res);
    return json(res, 200, queries.getTopDomains(parseInt(parsed.query.limit || '15', 10)));
  }

  // Recipient domain stats
  if (p === '/api/stats/recipient-domains' && req.method === 'GET') {
    if (!checkAuth(req)) return unauthorized(res);
    return json(res, 200, queries.getRecipientDomainStats(parseInt(parsed.query.limit || '15', 10)));
  }

  // Rate stats
  if (p === '/api/stats/rate' && req.method === 'GET') {
    if (!checkAuth(req)) return unauthorized(res);
    return json(res, 200, queries.getRateStats());
  }

  // Sender detail
  if (p === '/api/stats/sender' && req.method === 'GET') {
    if (!checkAuth(req)) return unauthorized(res);
    const addr = (parsed.query.address || '').trim();
    if (!addr) return json(res, 400, { error: 'address parameter required' });
    return json(res, 200, queries.getSenderStats(addr));
  }

  // Export CSV
  if (p === '/api/logs/export' && req.method === 'GET') {
    if (!checkAuth(req)) return unauthorized(res);
    const result = queries.getCorrelatedMessages({ ...parsed.query, limit: 10000, offset: 0 });
    const header = 'Timestamp,QueueID,From,To,Status,DSN,Relay,Delay,Delays,Size,Recipients,Client,TLS\n';
    const csvEsc = (f) => '"' + String(f || '').replace(/"/g, '""').slice(0, 500) + '"';
    const rows = result.entries.map(e =>
      [e.ts, e.qid, e.from, e.to, e.final_status, e.dsn, e.relay, e.delay, e.delays, e.size, e.nrcpt, e.client, e.tls].map(csvEsc).join(',')
    ).join('\n');
    res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="mailtrail-export.csv"' });
    return res.end(header + rows);
  }

  // IP geolocation proxy
  if (p === '/api/lookup/ip' && req.method === 'GET') {
    if (!checkAuth(req)) return unauthorized(res);
    const ip = (parsed.query.ip || '').trim();
    if (!ip || !/^[\d.]+$/.test(ip)) return json(res, 400, { error: 'Invalid IP' });
    try {
      const resp = await fetch(`http://ip-api.com/json/${ip}?fields=status,query,city,regionName,country,countryCode,isp,org,as,timezone`);
      const data = await resp.json();
      if (data.status === 'success') {
        return json(res, 200, { ip: data.query, city: data.city, region: data.regionName, country: data.countryCode, org: ((data.as || '') + ' ' + (data.isp || '')).trim(), timezone: data.timezone });
      }
      return json(res, 200, { ip, error: 'Not found' });
    } catch (e) { return json(res, 500, { ip, error: e.message }); }
  }

  // DNS lookup proxy
  if (p === '/api/lookup/dns' && req.method === 'GET') {
    if (!checkAuth(req)) return unauthorized(res);
    const domain = (parsed.query.domain || '').trim();
    if (!domain || !/^[a-zA-Z0-9.-]+$/.test(domain)) return json(res, 400, { error: 'Invalid domain' });
    try {
      const resp = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=A`, { headers: { 'Accept': 'application/dns-json' } });
      const data = await resp.json();
      return json(res, 200, { domain, answers: (data.Answer || []).map(a => a.data) });
    } catch (e) { return json(res, 500, { domain, error: e.message }); }
  }

  // Password change (admin only)
  if (p === '/api/password' && req.method === 'PUT') {
    if (!isAdmin(req)) return unauthorized(res);
    try {
      const d = JSON.parse(await readBody(req));
      const u = (d.newUser || '').trim(), pw = d.newPass || '';
      if (!u) return json(res, 400, { error: 'Username is required' });
      if (pw.length < 4) return json(res, 400, { error: 'Password must be at least 4 characters' });
      saveCredentials(u, pw);
      return json(res, 200, { ok: true });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  // Purge all data (admin only — destructive)
  if (p === '/api/purge' && req.method === 'POST') {
    if (!isAdmin(req)) return unauthorized(res);
    try {
      const body = JSON.parse(await readBody(req));
      if (body.confirm !== 'CONFIRM') return json(res, 400, { error: 'Type CONFIRM to proceed' });
      // 1. Delete all SQLite log entries
      const { db } = require('../db');
      const deleted = db.prepare('DELETE FROM logs').run();
      db.exec('VACUUM');
      // 2. Reset ingestion cursor
      const { writeJSON } = require('../settings');
      writeJSON(config.CURSOR_FILE, {});
      // 3. Delete raw log files
      const logFiles = fs.readdirSync(config.LOG_DIR).filter(f => f.startsWith('mail.'));
      let filesDeleted = 0;
      for (const f of logFiles) {
        try { fs.unlinkSync(path.join(config.LOG_DIR, f)); filesDeleted++; } catch {}
      }
      console.log(`[mailtrail] PURGE: Deleted ${deleted.changes} DB entries, ${filesDeleted} log files`);
      return json(res, 200, { ok: true, entriesDeleted: deleted.changes, filesDeleted });
    } catch (e) { return json(res, 500, { error: e.message }); }
  }

  // Static files (fallback)
  let fp = p === '/' ? '/index.html' : p;
  fp = path.normalize(fp).replace(/^(\.\.[\/\\])+/, '');
  serveStatic(res, fp);
}

module.exports = { handler };
