// ══════════════════════════════════════════════════════════════
// Log Parser — syslog and JSON line parsing for Postfix logs
// ══════════════════════════════════════════════════════════════
'use strict';

/**
 * Parses a syslog-style timestamp ("Mon DD HH:MM:SS") into ISO + epoch.
 * @param {string} raw - Raw syslog timestamp string.
 * @returns {{ iso: string, epoch: number }}
 */
function parseSyslogTs(raw) {
  try {
    const d = new Date(raw + ' ' + new Date().getFullYear());
    if (!isNaN(d.getTime())) return { iso: d.toISOString(), epoch: d.getTime() };
  } catch {}
  return { iso: raw, epoch: 0 };
}

/**
 * Extracts structured fields (qid, sender, recipient, status, relay, delay, etc.)
 * from the message portion of a Postfix log line. Mutates the entry in place.
 * @param {Object} entry - Log entry object with a `msg` field to parse.
 */
function extractFields(entry) {
  const qidM = entry.msg.match(/^([A-F0-9]{8,12}):\s*(.*)/i);
  if (qidM) {
    entry.qid = qidM[1];
    const d = qidM[2];
    const fromM = d.match(/from=<([^>]*)>/);       if (fromM) entry.sender = fromM[1];
    const toM = d.match(/to=<([^>]*)>/);            if (toM) entry.recipient = toM[1];
    const statusM = d.match(/status=(\w+)/);        if (statusM) entry.status = statusM[1];
    const dsnM = d.match(/dsn=([^\s,]+)/);          if (dsnM) entry.dsn = dsnM[1];
    const relayM = d.match(/relay=([^\s,]+)/);      if (relayM) entry.relay = relayM[1];
    const delayM = d.match(/delay=([^\s,]+)/);      if (delayM) entry.delay = delayM[1];
    const delaysM = d.match(/delays=([^\s,]+)/);    if (delaysM) entry.delays = delaysM[1];
    const sizeM = d.match(/size=(\d+)/);            if (sizeM) entry.size = sizeM[1];
    const nrcptM = d.match(/nrcpt=(\d+)/);          if (nrcptM) entry.nrcpt = nrcptM[1];
    const clientM = d.match(/client=([^\s,]+)/);    if (clientM) entry.client = clientM[1];
  }
  // TLS info on separate lines (no QID prefix)
  if (entry.msg.includes('TLS connection established')) {
    const tlsM = entry.msg.match(/TLS connection established to\s+(\S+).*?:\s+(TLS\S+)\s+with cipher\s+(\S+)/);
    if (tlsM) entry.tls = tlsM[2] + ' ' + tlsM[3];
  }
}

/**
 * Creates a blank log entry object with all fields initialized to empty strings.
 * @param {string} ts - Timestamp (ISO or syslog format).
 * @param {number} tsEpoch - Unix epoch in milliseconds.
 * @param {string} host - Hostname from the log line.
 * @param {string} proc - Process name (e.g. "postfix/smtp").
 * @param {string} pid - Process ID.
 * @param {string} msg - Raw message text.
 * @returns {Object} Entry object with all fields initialized.
 */
function blankEntry(ts, tsEpoch, host, proc, pid, msg) {
  return { ts, ts_epoch: tsEpoch, host, proc, pid, msg,
    qid: '', sender: '', recipient: '', status: '', dsn: '',
    relay: '', delay: '', delays: '', size: '', nrcpt: '',
    client: '', tls: '' };
}

/**
 * Parses a single Postfix log line (syslog or ISO 8601 format).
 * @param {string} line - Raw log line.
 * @returns {Object|null} Structured entry object, or null if unparseable.
 */
function parsePostfixLine(line) {
  // Try ISO 8601 format first
  let m = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+[+-]\d{2}:\d{2})\s+(\S+)\s+(\S+?)(?:\[(\d+)\])?:\s+(.*)$/);
  if (m) {
    const epoch = new Date(m[1]).getTime();
    const entry = blankEntry(m[1], isNaN(epoch) ? 0 : epoch, m[2], m[3], m[4] || '', m[5]);
    extractFields(entry);
    return entry;
  }
  // Fall back to standard syslog
  m = line.match(/^(\w{3}\s+\d+\s+[\d:]+)\s+(\S+)\s+(\S+?)(?:\[(\d+)\])?:\s+(.*)$/);
  if (!m) return null;
  const { iso, epoch } = parseSyslogTs(m[1]);
  const entry = blankEntry(iso, epoch, m[2], m[3], m[4] || '', m[5]);
  extractFields(entry);
  return entry;
}

/**
 * Parses a JSON-formatted log line (from rsyslog MailJSON template).
 * @param {string} line - Raw JSON log line.
 * @returns {Object|null} Structured entry object, or null if invalid JSON.
 */
function parseJsonLine(line) {
  try {
    const obj = JSON.parse(line);
    const ts = obj.ts || '';
    let epoch = 0;
    try { const d = new Date(ts); if (!isNaN(d.getTime())) epoch = d.getTime(); } catch {}
    const entry = blankEntry(ts, epoch, obj.host || '', obj.proc || '', obj.pid || '', obj.msg || '');
    extractFields(entry);
    return entry;
  } catch { return null; }
}

module.exports = { parsePostfixLine, parseJsonLine };
