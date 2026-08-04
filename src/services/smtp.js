// ══════════════════════════════════════════════════════════════
// SMTP — health check and test email via raw socket
// ══════════════════════════════════════════════════════════════
'use strict';

const net = require('net');
const config = require('../config');

/**
 * Connects to Postfix SMTP and checks for a 220 banner.
 * Times out after 5 seconds.
 * @returns {Promise<{ ok: boolean, banner?: string, error?: string, ms: number }>}
 */
function checkSmtp() {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const t0 = Date.now();
    let banner = '';
    let resolved = false;
    const done = (result) => { if (resolved) return; resolved = true; sock.destroy(); resolve(result); };
    sock.setTimeout(5000);
    sock.on('timeout', () => done({ ok: false, error: 'Connection timeout', ms: Date.now() - t0 }));
    sock.on('error', (err) => done({ ok: false, error: err.message, ms: Date.now() - t0 }));
    sock.on('data', (data) => {
      banner += data.toString();
      if (banner.startsWith('220')) {
        sock.write('QUIT\r\n');
        done({ ok: true, banner: banner.trim().split('\n')[0], ms: Date.now() - t0 });
      }
    });
    sock.on('close', () => done({ ok: false, error: 'Connection closed', ms: Date.now() - t0 }));
    sock.connect(config.SMTP_PORT, config.SMTP_HOST);
  });
}

/**
 * Sends a test email through Postfix via raw SMTP conversation.
 * Walks through EHLO → MAIL FROM → RCPT TO → DATA → QUIT.
 * @param {string} fromAddr - Envelope sender address.
 * @param {string} toAddr - Envelope recipient address.
 * @param {string} [fromName] - Display name for the From header.
 * @returns {Promise<{ ok: boolean, error?: string, log: string }>}
 */
function sendTestEmail(fromAddr, toAddr, fromName) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let step = 0, response = '', allResponse = '', resolved = false;
    const displayFrom = fromName ? `${fromName} <${fromAddr}>` : fromAddr;
    const done = (result) => { if (resolved) return; resolved = true; sock.destroy(); resolve(result); };
    const steps = [
      null,
      `EHLO mailtrail\r\n`,
      `MAIL FROM:<${fromAddr}>\r\n`,
      `RCPT TO:<${toAddr}>\r\n`,
      `DATA\r\n`,
      `From: ${displayFrom}\r\nTo: ${toAddr}\r\nSubject: MailTrail Test Email\r\nDate: ${new Date().toUTCString()}\r\nX-Mailer: MailTrail/1.0\r\n\r\nThis is a test email sent from MailTrail to verify Postfix is working correctly.\r\n\r\nTimestamp: ${new Date().toISOString()}\r\n.\r\n`,
      `QUIT\r\n`,
    ];
    sock.setTimeout(15000);
    sock.on('timeout', () => done({ ok: false, error: 'SMTP timeout', log: allResponse }));
    sock.on('error', (err) => done({ ok: false, error: err.message, log: allResponse }));
    sock.on('data', (data) => {
      response = data.toString();
      allResponse += response;
      if (response.startsWith('4') || response.startsWith('5')) {
        if (step > 0) return done({ ok: false, error: response.trim(), log: allResponse });
      }
      step++;
      if (step < steps.length && steps[step]) sock.write(steps[step]);
      else if (step >= steps.length) done({ ok: true, log: allResponse });
    });
    sock.on('close', () => { if (!resolved) done({ ok: step >= steps.length - 1, log: allResponse }); });
    sock.connect(config.SMTP_PORT, config.SMTP_HOST);
  });
}

module.exports = { checkSmtp, sendTestEmail };
