// ══════════════════════════════════════════════════════════════
// Query Layer — search, dashboard stats, top senders/recipients
// ══════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { db } = require('../db');
const { getSettings } = require('../settings');
const { getLogFiles } = require('./ingest');

/**
 * Searches log entries with optional filters.
 * @param {Object} params - Query parameters.
 * @param {string} [params.q] - Full-text search across msg, sender, recipient, qid.
 * @param {string} [params.from] - Filter by sender address (partial match).
 * @param {string} [params.to] - Filter by recipient address (partial match).
 * @param {string} [params.status] - Filter by exact status (sent, bounced, deferred, reject).
 * @param {string} [params.domain] - Filter by domain in sender or recipient.
 * @param {string} [params.dateFrom] - Start date (YYYY-MM-DD).
 * @param {string} [params.dateTo] - End date (YYYY-MM-DD).
 * @param {number} [params.limit=500] - Max results (capped at 5000).
 * @param {number} [params.offset=0] - Pagination offset.
 * @returns {{ total: number, offset: number, limit: number, entries: Object[] }}
 */
function searchLogs(params) {
  const { q = '', from = '', to = '', status = '', domain = '',
    dateFrom = '', dateTo = '', limit = 500, offset = 0 } = params;

  let where = [];
  let binds = [];

  if (q) {
    where.push('(msg LIKE ? OR sender LIKE ? OR recipient LIKE ? OR qid LIKE ?)');
    const ql = `%${q}%`;
    binds.push(ql, ql, ql, ql);
  }
  if (from) { where.push('sender LIKE ?'); binds.push(`%${from}%`); }
  if (to) { where.push('recipient LIKE ?'); binds.push(`%${to}%`); }
  if (status) { where.push('status = ?'); binds.push(status); }
  if (domain) {
    where.push('(sender LIKE ? OR recipient LIKE ?)');
    binds.push(`%@${domain}%`, `%@${domain}%`);
  }
  if (dateFrom) {
    const dfTs = new Date(dateFrom + 'T00:00:00Z').getTime();
    if (!isNaN(dfTs)) { where.push('ts_epoch >= ?'); binds.push(dfTs); }
  }
  if (dateTo) {
    const dtTs = new Date(dateTo + 'T23:59:59Z').getTime();
    if (!isNaN(dtTs)) { where.push('ts_epoch <= ?'); binds.push(dtTs); }
  }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const lim = Math.min(Math.max(parseInt(limit, 10) || 500, 1), 5000);
  const off = Math.max(parseInt(offset, 10) || 0, 0);

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM logs ${whereClause}`).get(...binds).cnt;
  const entries = db.prepare(
    `SELECT ts, host, proc, pid, qid, sender AS "from", recipient AS "to", status, dsn, relay, delay, size, msg
     FROM logs ${whereClause} ORDER BY ts_epoch DESC LIMIT ? OFFSET ?`
  ).all(...binds, lim, off);

  return { total, offset: off, limit: lim, entries };
}

/**
 * Estimates the current Postfix mail queue by analyzing recent QIDs.
 * Looks at the last 10,000 log entries for QIDs that haven't been "removed".
 * @returns {{ active: number, deferred: number, bounced: number, total: number }}
 */
function getQueueStats() {
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN last_status = 'deferred' THEN 1 ELSE 0 END) AS deferred,
      SUM(CASE WHEN last_status = 'bounced' THEN 1 ELSE 0 END) AS bounced,
      SUM(CASE WHEN last_status NOT IN ('deferred','bounced') THEN 1 ELSE 0 END) AS active
    FROM (
      SELECT qid, MAX(CASE WHEN msg LIKE '%removed%' THEN 'removed' ELSE status END) AS last_status
      FROM logs WHERE qid != '' AND id > (SELECT MAX(id) - 10000 FROM logs)
      GROUP BY qid
      HAVING last_status != 'removed' AND last_status != '' AND last_status != 'sent'
    )
  `).get();
  const d = row.deferred || 0, b = row.bounced || 0, a = row.active || 0;
  return { active: a, deferred: d, bounced: b, total: a + d + b };
}

/**
 * Aggregates all dashboard statistics in a single call.
 * Includes counts, rates, top senders/recipients, domain stats, and system info.
 * @returns {Object} Dashboard stats object consumed by the frontend.
 */
function getDashboardStats() {
  const stats = {};

  stats.totalEntries = db.prepare('SELECT COUNT(*) as cnt FROM logs').get().cnt;

  const statusRows = db.prepare(
    "SELECT status, COUNT(*) as cnt FROM logs WHERE status != '' GROUP BY status ORDER BY cnt DESC"
  ).all();
  stats.statusCounts = {};
  stats.sent = 0; stats.bounced = 0; stats.deferred = 0; stats.rejected = 0;
  for (const r of statusRows) {
    stats.statusCounts[r.status] = r.cnt;
    if (r.status === 'sent') stats.sent = r.cnt;
    else if (r.status === 'bounced') stats.bounced = r.cnt;
    else if (r.status === 'deferred') stats.deferred = r.cnt;
    else if (r.status === 'reject') stats.rejected = r.cnt;
  }

  stats.uniqueSenders = db.prepare("SELECT COUNT(DISTINCT sender) as cnt FROM logs WHERE sender != ''").get().cnt;
  stats.uniqueRecipients = db.prepare("SELECT COUNT(DISTINCT recipient) as cnt FROM logs WHERE recipient != ''").get().cnt;

  const senderDomains = db.prepare(
    "SELECT COUNT(DISTINCT SUBSTR(sender, INSTR(sender, '@') + 1)) AS cnt FROM logs WHERE sender LIKE '%@%'"
  ).get().cnt;
  stats.uniqueDomains = senderDomains;

  const dayAgo = Date.now() - 86400000;
  const hourlyRows = db.prepare(`
    SELECT SUBSTR(ts, 12, 2) as hour, COUNT(*) as cnt
    FROM logs WHERE ts_epoch > ? GROUP BY hour ORDER BY hour
  `).all(dayAgo);
  stats.hourly = {};
  for (const r of hourlyRows) stats.hourly[r.hour] = r.cnt;

  stats.recentErrors = db.prepare(`
    SELECT ts, host, proc, qid, sender AS "from", recipient AS "to", status, msg
    FROM logs WHERE status != '' AND status != 'sent'
    ORDER BY ts_epoch DESC LIMIT 20
  `).all();

  stats.queue = getQueueStats();

  const totalWithStatus = stats.sent + stats.bounced + stats.deferred + stats.rejected;
  stats.bounceRate = totalWithStatus > 0 ? Math.round((stats.bounced / totalWithStatus) * 1000) / 10 : 0;

  const delayRow = db.prepare(
    "SELECT AVG(CAST(delay AS REAL)) AS avg_delay FROM logs WHERE delay != '' AND delay != '0' AND CAST(delay AS REAL) > 0"
  ).get();
  stats.avgDelay = delayRow && delayRow.avg_delay ? Math.round(delayRow.avg_delay * 100) / 100 : 0;

  stats.topSenders = getTopSenders(10);
  stats.topRecipients = getTopRecipients(10);
  stats.topDomains = getTopDomains(10);
  stats.recipientDomainStats = getRecipientDomainStats(10);
  stats.rate = getRateStats();

  stats.logFiles = getLogFiles();
  let totalLogSize = 0;
  try {
    for (const f of fs.readdirSync(config.LOG_DIR)) {
      try { totalLogSize += fs.statSync(path.join(config.LOG_DIR, f)).size; } catch {}
    }
  } catch {}
  stats.totalLogSizeMB = Math.round(totalLogSize / 1024 / 1024 * 10) / 10;

  try { stats.dbSizeMB = Math.round(fs.statSync(config.DB_PATH).size / 1024 / 1024 * 10) / 10; } catch { stats.dbSizeMB = 0; }

  const settings = getSettings();
  stats.maxLogSizeGB = settings.maxLogSizeGB || config.MAX_LOG_GB;
  stats.retentionDays = settings.retentionDays || config.RETENTION_DAYS;
  stats.serverUptime = process.uptime();
  stats.smtpHost = config.SMTP_HOST;
  stats.smtpPort = config.SMTP_PORT;

  return stats;
}

/**
 * Returns the most recent correlated messages for the live tail view.
 * Groups by QID and returns one row per message with merged fields.
 * @param {number} n - Number of messages to return (max 200).
 * @returns {Object[]} Array of correlated message objects.
 */
function getTailMessages(n) {
  return db.prepare(`
    SELECT qid, MAX(ts) AS ts,
      MAX(CASE WHEN sender != '' THEN sender ELSE NULL END) AS "from",
      MAX(CASE WHEN recipient != '' THEN recipient ELSE NULL END) AS "to",
      MAX(CASE WHEN status != '' THEN status ELSE NULL END) AS status,
      MAX(CASE WHEN relay != '' THEN relay ELSE NULL END) AS relay,
      MAX(CASE WHEN delay != '' THEN delay ELSE NULL END) AS delay,
      MAX(CASE WHEN delays != '' THEN delays ELSE NULL END) AS delays,
      MAX(CASE WHEN nrcpt != '' THEN nrcpt ELSE NULL END) AS nrcpt,
      MAX(CASE WHEN client != '' THEN client ELSE NULL END) AS client,
      MAX(CASE WHEN tls != '' THEN tls ELSE NULL END) AS tls,
      COUNT(*) AS log_lines
    FROM logs WHERE qid != '' AND id > (SELECT MAX(id) - 2000 FROM logs)
    GROUP BY qid ORDER BY MAX(ts_epoch) DESC LIMIT ?
  `).all(Math.min(n, 200));
}

/**
 * Searches logs with QID correlation — one row per message.
 * Merges sender, recipient, status, relay, etc. from multiple log lines per QID.
 * @param {Object} params - Same filter params as searchLogs.
 * @returns {{ total: number, offset: number, limit: number, entries: Object[] }}
 */
function getCorrelatedMessages(params) {
  const { q = '', from = '', to = '', status = '', domain = '',
    dateFrom = '', dateTo = '', limit = 200, offset = 0 } = params;

  let where = ["qid != ''"];
  let binds = [];
  let having = [];

  if (q) {
    where.push('(msg LIKE ? OR sender LIKE ? OR recipient LIKE ? OR qid LIKE ?)');
    const ql = `%${q}%`;
    binds.push(ql, ql, ql, ql);
  }
  if (from) { where.push("sender LIKE ?"); binds.push(`%${from}%`); }
  if (to) { where.push("recipient LIKE ?"); binds.push(`%${to}%`); }
  if (status) { having.push("final_status = ?"); binds.push(status); }
  if (domain) {
    where.push('(sender LIKE ? OR recipient LIKE ?)');
    binds.push(`%@${domain}%`, `%@${domain}%`);
  }
  if (dateFrom) {
    const dfTs = new Date(dateFrom + 'T00:00:00Z').getTime();
    if (!isNaN(dfTs)) { where.push('ts_epoch >= ?'); binds.push(dfTs); }
  }
  if (dateTo) {
    const dtTs = new Date(dateTo + 'T23:59:59Z').getTime();
    if (!isNaN(dtTs)) { where.push('ts_epoch <= ?'); binds.push(dtTs); }
  }

  const whereClause = 'WHERE ' + where.join(' AND ');
  const havingClause = having.length ? 'HAVING ' + having.join(' AND ') : '';
  const lim = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 5000);
  const off = Math.max(parseInt(offset, 10) || 0, 0);

  const total = db.prepare(`SELECT COUNT(*) AS cnt FROM (
    SELECT qid FROM logs ${whereClause} GROUP BY qid ${havingClause}
  )`).get(...binds).cnt;

  const entries = db.prepare(`
    SELECT qid, MAX(ts) AS ts,
      MAX(CASE WHEN sender != '' THEN sender ELSE NULL END) AS "from",
      MAX(CASE WHEN recipient != '' THEN recipient ELSE NULL END) AS "to",
      MAX(CASE WHEN status != '' THEN status ELSE NULL END) AS final_status,
      MAX(CASE WHEN relay != '' THEN relay ELSE NULL END) AS relay,
      MAX(CASE WHEN delay != '' THEN delay ELSE NULL END) AS delay,
      MAX(CASE WHEN delays != '' THEN delays ELSE NULL END) AS delays,
      MAX(CASE WHEN size != '' THEN size ELSE NULL END) AS size,
      MAX(CASE WHEN dsn != '' THEN dsn ELSE NULL END) AS dsn,
      MAX(CASE WHEN nrcpt != '' THEN nrcpt ELSE NULL END) AS nrcpt,
      MAX(CASE WHEN client != '' THEN client ELSE NULL END) AS client,
      MAX(CASE WHEN tls != '' THEN tls ELSE NULL END) AS tls,
      COUNT(*) AS log_lines
    FROM logs ${whereClause}
    GROUP BY qid ${havingClause}
    ORDER BY MAX(ts_epoch) DESC LIMIT ? OFFSET ?
  `).all(...binds, lim, off);

  return { total, offset: off, limit: lim, entries };
}

/**
 * Returns all log entries for a specific Queue ID in chronological order.
 * Used for the message tracking modal.
 * @param {string} qid - Postfix Queue ID.
 * @returns {{ qid: string, count: number, entries: Object[] }}
 */
function trackQid(qid) {
  const entries = db.prepare(`
    SELECT ts, host, proc, pid, qid, sender AS "from", recipient AS "to",
           status, dsn, relay, delay, size, msg
    FROM logs WHERE qid = ? ORDER BY ts_epoch ASC
  `).all(qid);
  return { qid, count: entries.length, entries };
}

/**
 * Returns the top sender addresses by message count.
 * @param {number} [limit=15] - Max results.
 * @returns {{ address: string, cnt: number }[]}
 */
function getTopSenders(limit = 15) {
  return db.prepare(`
    SELECT sender AS address, COUNT(*) AS cnt
    FROM logs WHERE sender != '' GROUP BY sender ORDER BY cnt DESC LIMIT ?
  `).all(limit);
}

/**
 * Returns the top recipient addresses by message count.
 * @param {number} [limit=15] - Max results.
 * @returns {{ address: string, cnt: number }[]}
 */
function getTopRecipients(limit = 15) {
  return db.prepare(`
    SELECT recipient AS address, COUNT(*) AS cnt
    FROM logs WHERE recipient != '' GROUP BY recipient ORDER BY cnt DESC LIMIT ?
  `).all(limit);
}

/**
 * Returns the top domains by combined sender + recipient message count.
 * @param {number} [limit=15] - Max results.
 * @returns {{ domain: string, total: number }[]}
 */
function getTopDomains(limit = 15) {
  return db.prepare(`
    SELECT domain, SUM(cnt) AS total FROM (
      SELECT SUBSTR(sender, INSTR(sender, '@') + 1) AS domain, COUNT(*) AS cnt
      FROM logs WHERE sender LIKE '%@%' GROUP BY domain
      UNION ALL
      SELECT SUBSTR(recipient, INSTR(recipient, '@') + 1) AS domain, COUNT(*) AS cnt
      FROM logs WHERE recipient LIKE '%@%' GROUP BY domain
    ) GROUP BY domain ORDER BY total DESC LIMIT ?
  `).all(limit);
}

/**
 * Returns delivery status breakdown per recipient domain.
 * Shows sent, bounced, deferred, and rejected counts for each domain.
 * @param {number} [limit=15] - Max results.
 * @returns {{ domain: string, total: number, sent: number, bounced: number, deferred: number, rejected: number }[]}
 */
function getRecipientDomainStats(limit = 15) {
  return db.prepare(`
    SELECT
      SUBSTR(recipient, INSTR(recipient, '@') + 1) AS domain,
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) AS bounced,
      SUM(CASE WHEN status = 'deferred' THEN 1 ELSE 0 END) AS deferred,
      SUM(CASE WHEN status = 'reject' THEN 1 ELSE 0 END) AS rejected
    FROM logs WHERE recipient LIKE '%@%' AND status != ''
    GROUP BY domain ORDER BY total DESC LIMIT ?
  `).all(limit);
}

/**
 * Returns message throughput stats for the last 1min, 5min, 1hr, and 24hr.
 * Also includes per-minute buckets for the last hour (for sparkline charts).
 * @returns {{ min1: number, min5: number, hour1: number, day1: number, minutely: Object[] }}
 */
function getRateStats() {
  const now = Date.now();
  const min1  = db.prepare('SELECT COUNT(*) AS cnt FROM logs WHERE ts_epoch > ?').get(now - 60000).cnt;
  const min5  = db.prepare('SELECT COUNT(*) AS cnt FROM logs WHERE ts_epoch > ?').get(now - 300000).cnt;
  const hour1 = db.prepare('SELECT COUNT(*) AS cnt FROM logs WHERE ts_epoch > ?').get(now - 3600000).cnt;
  const day1  = db.prepare('SELECT COUNT(*) AS cnt FROM logs WHERE ts_epoch > ?').get(now - 86400000).cnt;

  const minutely = db.prepare(`
    SELECT (ts_epoch / 60000) AS bucket, COUNT(*) AS cnt
    FROM logs WHERE ts_epoch > ? GROUP BY bucket ORDER BY bucket
  `).all(now - 3600000);

  return { min1, min5, hour1, day1, minutely };
}

/**
 * Returns detailed stats for a specific sender address.
 * Includes status breakdown, top recipients, and recent messages.
 * @param {string} address - Email address to look up.
 * @returns {{ address: string, total: number, statuses: Object[], recipients: Object[], recent: Object[] }}
 */
function getSenderStats(address) {
  const total = db.prepare('SELECT COUNT(*) AS cnt FROM logs WHERE sender = ?').get(address).cnt;
  const statuses = db.prepare(
    "SELECT status, COUNT(*) AS cnt FROM logs WHERE sender = ? AND status != '' GROUP BY status ORDER BY cnt DESC"
  ).all(address);
  const recipients = db.prepare(
    "SELECT recipient AS address, COUNT(*) AS cnt FROM logs WHERE sender = ? AND recipient != '' GROUP BY recipient ORDER BY cnt DESC LIMIT 20"
  ).all(address);
  const recent = db.prepare(
    `SELECT ts, qid, recipient AS "to", status, relay, delay, msg
     FROM logs WHERE sender = ? ORDER BY ts_epoch DESC LIMIT 50`
  ).all(address);
  return { address, total, statuses, recipients, recent };
}

module.exports = {
  searchLogs,
  getQueueStats,
  getDashboardStats,
  getTailMessages,
  getCorrelatedMessages,
  trackQid,
  getTopSenders,
  getTopRecipients,
  getTopDomains,
  getRecipientDomainStats,
  getRateStats,
  getSenderStats,
};
