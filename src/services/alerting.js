// ══════════════════════════════════════════════════════════════
// Alerting — multi-channel: Slack, Teams, PagerDuty, Discord,
//            Email (via Postfix), Generic Webhook
// ══════════════════════════════════════════════════════════════
'use strict';

const net = require('net');
const config = require('../config');
const { getSettings } = require('../settings');
const { getDashboardStats, getQueueStats } = require('./queries');
const { checkSmtp } = require('./smtp');

const _cooldowns = {}; // key -> last alert timestamp

/**
 * Checks if enough time has passed since the last alert for a given key.
 * Uses the configured cooldown period to prevent alert fatigue.
 * @param {string} key - Alert type identifier (e.g. 'bounce', 'queue', 'health').
 * @returns {boolean} True if the alert should fire.
 */
function shouldAlert(key) {
  const settings = getSettings();
  const cooldown = (settings.alertCooldownMin || 15) * 60 * 1000;
  const last = _cooldowns[key] || 0;
  if (Date.now() - last < cooldown) return false;
  _cooldowns[key] = Date.now();
  return true;
}

// ══════════════════════════════════════════════════════════════
// Formatters — one per service, returns { url, payload } or handles send
// ══════════════════════════════════════════════════════════════

function formatSlackAlert(title, fields, color) {
  return {
    attachments: [{
      color,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*🚨 MailTrail Alert*\n*${title}*` } },
        { type: 'section', fields: fields.map(f => ({ type: 'mrkdwn', text: `*${f.label}*\n${f.value}` })) },
        { type: 'context', elements: [{ type: 'mrkdwn', text: `_${new Date().toISOString()}_` }] },
      ],
    }],
  };
}

function formatTeamsAlert(title, fields, color) {
  const colorMap = { '#dc2626': 'attention', '#f59e0b': 'warning', '#10b981': 'good' };
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        '$schema': 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard', version: '1.4',
        body: [
          { type: 'TextBlock', text: '🚨 MailTrail Alert', weight: 'bolder', size: 'medium', color: colorMap[color] || 'default' },
          { type: 'TextBlock', text: title, weight: 'bolder', wrap: true },
          { type: 'FactSet', facts: fields.map(f => ({ title: f.label, value: f.value })) },
          { type: 'TextBlock', text: new Date().toISOString(), size: 'small', isSubtle: true },
        ],
      },
    }],
  };
}

function formatPagerDutyAlert(title, fields, severity, routingKey) {
  return {
    routing_key: routingKey,
    event_action: 'trigger',
    payload: {
      summary: `MailTrail: ${title}`,
      source: 'mailtrail',
      severity: severity || 'warning',
      custom_details: Object.fromEntries(fields.map(f => [f.label, f.value])),
      timestamp: new Date().toISOString(),
    },
  };
}

function formatDiscordAlert(title, fields, color) {
  const colorInt = { '#dc2626': 0xdc2626, '#f59e0b': 0xf59e0b, '#10b981': 0x10b981 }[color] || 0x5865f2;
  return {
    embeds: [{
      title: '🚨 MailTrail Alert',
      description: title,
      color: colorInt,
      fields: fields.map(f => ({ name: f.label, value: f.value, inline: true })),
      timestamp: new Date().toISOString(),
    }],
  };
}

function formatGenericAlert(title, fields, severity) {
  return {
    source: 'mailtrail',
    severity,
    title,
    fields: Object.fromEntries(fields.map(f => [f.label, f.value])),
    timestamp: new Date().toISOString(),
  };
}

// ── Email via Postfix (raw SMTP) ─────────────────────────────

/**
 * Sends an email alert through the local Postfix relay via raw SMTP.
 * Sanitizes all inputs to prevent CRLF injection.
 * @param {{ service: string, url: string, fromAddress?: string }} channel - Email channel config.
 * @param {string} title - Alert title (used in subject line).
 * @param {{ label: string, value: string }[]} fields - Alert detail fields.
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
function sendEmailAlert(channel, title, fields) {
  return new Promise((resolve) => {
    const settings = getSettings();
    const fromAddr = (channel.fromAddress || settings.alertFromAddress || 'mailtrail-alerts@localhost').replace(/[\r\n]/g, '');
    const fromName = (settings.testSenderName || 'MailTrail').replace(/[\r\n]/g, '');
    const safeToAddr = channel.url.replace(/[\r\n]/g, '');
    const safeTitle = title.replace(/[\r\n]/g, ' ');
    const displayFrom = `${fromName} <${fromAddr}>`;

    const bodyLines = fields.map(f => `${f.label}: ${f.value}`).join('\n');
    const body = `MailTrail Alert\n${'='.repeat(40)}\n\n${safeTitle}\n\n${bodyLines}\n\nTimestamp: ${new Date().toISOString()}\n`;

    const sock = new net.Socket();
    let step = 0, allResponse = '', resolved = false;
    const done = (result) => { if (resolved) return; resolved = true; sock.destroy(); resolve(result); };
    const steps = [
      null,
      `EHLO mailtrail\r\n`,
      `MAIL FROM:<${fromAddr}>\r\n`,
      `RCPT TO:<${safeToAddr}>\r\n`,
      `DATA\r\n`,
      `From: ${displayFrom}\r\nTo: ${safeToAddr}\r\nSubject: [MailTrail Alert] ${safeTitle}\r\nDate: ${new Date().toUTCString()}\r\nX-Mailer: MailTrail/${config.APP_VERSION}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n.\r\n`,
      `QUIT\r\n`,
    ];
    sock.setTimeout(15000);
    sock.on('timeout', () => done({ ok: false, error: 'SMTP timeout' }));
    sock.on('error', (err) => done({ ok: false, error: err.message }));
    sock.on('data', (data) => {
      const response = data.toString();
      allResponse += response;
      if (response.startsWith('4') || response.startsWith('5')) {
        if (step > 0) return done({ ok: false, error: response.trim() });
      }
      step++;
      if (step < steps.length && steps[step]) sock.write(steps[step]);
      else if (step >= steps.length) done({ ok: true });
    });
    sock.on('close', () => { if (!resolved) done({ ok: step >= steps.length - 1 }); });
    sock.connect(config.SMTP_PORT, config.SMTP_HOST);
  });
}

// ══════════════════════════════════════════════════════════════
// Send alert to a single channel
// ══════════════════════════════════════════════════════════════

/**
 * Sends an alert to a single configured channel.
 * Routes to the appropriate formatter based on service type.
 * @param {{ service: string, url: string }} channel - Channel configuration.
 * @param {string} title - Alert title.
 * @param {{ label: string, value: string }[]} fields - Alert detail fields.
 * @param {string} severity - 'critical', 'warning', or 'info'.
 * @returns {Promise<void>}
 */
async function sendToChannel(channel, title, fields, severity) {
  const color = severity === 'critical' ? '#dc2626' : severity === 'warning' ? '#f59e0b' : '#10b981';

  // Email is handled separately (raw SMTP, not HTTP)
  if (channel.service === 'email') {
    try {
      const result = await sendEmailAlert(channel, title, fields);
      if (result.ok) console.log(`[mailtrail] Email alert sent to ${channel.url}: ${title}`);
      else console.error(`[mailtrail] Email alert failed: ${result.error}`);
    } catch (err) {
      console.error(`[mailtrail] Email alert error: ${err.message}`);
    }
    return;
  }

  let url = channel.url;
  let payload;

  switch (channel.service) {
    case 'slack':     payload = formatSlackAlert(title, fields, color); break;
    case 'teams':     payload = formatTeamsAlert(title, fields, color); break;
    case 'pagerduty':
      url = 'https://events.pagerduty.com/v2/enqueue';
      payload = formatPagerDutyAlert(title, fields, severity, channel.url);
      break;
    case 'discord':   payload = formatDiscordAlert(title, fields, color); break;
    case 'webhook':   payload = formatGenericAlert(title, fields, severity); break;
    default: return;
  }

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) console.error(`[mailtrail] Alert to ${channel.service} failed (${resp.status}): ${await resp.text().catch(() => '')}`);
    else console.log(`[mailtrail] Alert sent via ${channel.service}: ${title}`);
  } catch (err) {
    console.error(`[mailtrail] Alert to ${channel.service} error: ${err.message}`);
  }
}

// ══════════════════════════════════════════════════════════════
// Send alert to ALL configured channels
// ══════════════════════════════════════════════════════════════

/**
 * Sends an alert to ALL configured channels in parallel.
 * Uses Promise.allSettled so one channel failure doesn't block others.
 * @param {string} title - Alert title.
 * @param {{ label: string, value: string }[]} fields - Alert detail fields.
 * @param {string} severity - 'critical', 'warning', or 'info'.
 * @returns {Promise<void>}
 */
async function sendAlert(title, fields, severity) {
  const settings = getSettings();
  const channels = settings.alertChannels || [];
  if (!channels.length) return;

  await Promise.allSettled(
    channels.map(ch => sendToChannel(ch, title, fields, severity))
  );
}

// ══════════════════════════════════════════════════════════════
// Periodic alert checks
// ══════════════════════════════════════════════════════════════

/**
 * Runs all configured alert checks (bounce rate, queue depth, health).
 * Called every 60 seconds by the timer. Skips if no channels are configured.
 * @returns {Promise<void>}
 */
async function runAlertChecks() {
  const settings = getSettings();
  const channels = settings.alertChannels || [];
  if (!channels.length) return;

  if (settings.alertBounceEnabled) {
    const stats = getDashboardStats();
    if (stats.bounceRate > (settings.alertBounceThreshold || 5)) {
      if (shouldAlert('bounce')) {
        await sendAlert(`Bounce rate is ${stats.bounceRate}%`, [
          { label: 'Bounce Rate', value: `${stats.bounceRate}%` },
          { label: 'Threshold', value: `${settings.alertBounceThreshold}%` },
          { label: 'Bounced', value: String(stats.bounced) },
          { label: 'Total Sent', value: String(stats.sent) },
        ], stats.bounceRate > 10 ? 'critical' : 'warning');
      }
    }
  }

  if (settings.alertQueueEnabled) {
    const queue = getQueueStats();
    if (queue.total > (settings.alertQueueThreshold || 50)) {
      if (shouldAlert('queue')) {
        await sendAlert(`Queue depth is ${queue.total}`, [
          { label: 'Queue Total', value: String(queue.total) },
          { label: 'Threshold', value: String(settings.alertQueueThreshold) },
          { label: 'Active', value: String(queue.active) },
          { label: 'Deferred', value: String(queue.deferred) },
        ], queue.total > (settings.alertQueueThreshold || 50) * 2 ? 'critical' : 'warning');
      }
    }
  }

  if (settings.alertHealthEnabled) {
    const health = await checkSmtp();
    if (!health.ok) {
      if (shouldAlert('health')) {
        await sendAlert('Postfix is unreachable', [
          { label: 'Error', value: health.error || 'Connection failed' },
          { label: 'Host', value: `${config.SMTP_HOST}:${config.SMTP_PORT}` },
        ], 'critical');
      }
    }
  }
}

/**
 * Starts the alert check timer. Runs every 60 seconds.
 * First check is delayed 15 seconds after startup.
 * @returns {void}
 */
function startAlertChecks() {
  setInterval(runAlertChecks, 60000);
  setTimeout(runAlertChecks, 15000);
}

module.exports = { sendAlert, sendToChannel, runAlertChecks, startAlertChecks };
