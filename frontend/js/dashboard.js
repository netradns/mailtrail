// ══════════════════════════════════════════════════════════════
// MailTrail — Dashboard
// Stat cards, hourly chart, status breakdown, top
// senders/recipients, recipient domain stats, throughput,
// health check, test email.
// ══════════════════════════════════════════════════════════════

var _healthTimer = null;

/**
 * Checks Postfix SMTP health and updates the sidebar indicator.
 */
async function checkHealth() {
  if (!_authHeader) return;
  var dot = document.getElementById('health-dot');
  var lbl = document.getElementById('health-label');
  try {
    var r = await api('/api/postfix/health');
    if (!r.ok) throw new Error();
    var d = await r.json();
    if (d.ok) {
      dot.style.background = '#10b981';
      dot.style.boxShadow = '0 0 6px #10b981';
      lbl.textContent = 'Postfix Online';
    } else {
      dot.style.background = 'var(--yellow)';
      dot.style.boxShadow = '0 0 6px var(--yellow)';
      lbl.textContent = 'Postfix Down';
    }
  } catch {
    dot.style.background = 'var(--red)';
    dot.style.boxShadow = '0 0 6px var(--red)';
    lbl.textContent = 'Postfix Unreachable';
  }
}

/**
 * Starts the periodic health check timer.
 */
function startHealthCheck() {
  checkHealth();
  if (!_healthTimer) _healthTimer = setInterval(checkHealth, 60000);
}

/**
 * Fetches dashboard data from the API and renders all sections.
 */
async function loadDashboard() {
  try {
    var r = await api('/api/dashboard');
    if (!r.ok) return;
    var d = await r.json();
    renderDashboard(d);
  } catch (e) { console.error('Dashboard load failed:', e); }
}

/**
 * Renders the complete dashboard from API response data.
 * @param {Object} d - The dashboard API response data.
 */
function renderDashboard(d) {
  // Update timestamp
  var updEl = document.getElementById('dashUpdated');
  if (updEl) updEl.textContent = 'Updated ' + new Date().toLocaleTimeString();

  var cards = document.getElementById('dashCards');
  var q = d.queue || { active: 0, deferred: 0, total: 0 };

  cards.innerHTML =
    statCard('Total Entries', fmtNum(d.totalEntries), 'var(--blue-light)', 'var(--blue)') +
    statCard('Sent', fmtNum(d.sent), 'var(--green-light)', 'var(--green)') +
    statCard('Bounced', fmtNum(d.bounced), 'var(--red-light)', 'var(--red)') +
    statCard('Bounce Rate', (d.bounceRate || 0) + '%', d.bounceRate > 5 ? 'var(--red-light)' : 'var(--green-light)', d.bounceRate > 5 ? 'var(--red)' : 'var(--green)') +
    statCard('Deferred', fmtNum(d.deferred), 'var(--yellow-light)', 'var(--yellow)') +
    statCard('Queue', fmtNum(q.total), q.deferred > 0 ? 'var(--yellow-light)' : 'var(--green-light)', q.deferred > 0 ? 'var(--yellow)' : 'var(--green)') +
    statCard('Avg Delay', (d.avgDelay || 0) + 's', d.avgDelay > 10 ? 'var(--yellow-light)' : 'var(--green-light)', d.avgDelay > 10 ? 'var(--yellow)' : 'var(--green)') +
    statCard('Msgs/Hour', d.rate ? fmtNum(d.rate.hour1) : '0', 'var(--teal-light)', 'var(--teal)');

  // Postfix health section
  renderPostfixHealth();

  // Hourly chart
  var hourlyEl = document.getElementById('hourlyChart');
  var maxH = Math.max.apply(null, Object.values(d.hourly).concat([1]));
  var barsHtml = '<div class="hourly-bars">';
  var labelsHtml = '<div class="hourly-labels">';
  for (var h = 0; h < 24; h++) {
    var hk = String(h).padStart(2, '0');
    var count = d.hourly[hk] || 0;
    var pct = Math.round((count / maxH) * 100);
    barsHtml += '<div class="hourly-bar" style="height:' + Math.max(pct, 2) + '%" data-label="' + hk + ':00 — ' + count + ' msgs"></div>';
    labelsHtml += '<div class="hourly-label">' + (h % 3 === 0 ? hk : '') + '</div>';
  }
  barsHtml += '</div>';
  labelsHtml += '</div>';
  hourlyEl.innerHTML = barsHtml + labelsHtml;

  // Status breakdown
  var statusEl = document.getElementById('statusBreakdown');
  var statusColors = { sent: 'var(--green)', bounced: 'var(--red)', deferred: 'var(--yellow)', reject: 'var(--red)' };
  var maxS = Math.max.apply(null, Object.values(d.statusCounts).concat([1]));
  var statusHtml = '';
  Object.keys(d.statusCounts).sort(function(a, b) { return d.statusCounts[b] - d.statusCounts[a]; }).forEach(function(s) {
    var count = d.statusCounts[s];
    var pct = Math.round((count / maxS) * 100);
    statusHtml += '<div class="status-row">' +
      '<span class="status-name">' + statusPill(s) + '</span>' +
      '<div class="status-bar-wrap"><div class="status-bar" style="width:' + pct + '%;background:' + (statusColors[s] || 'var(--text-3)') + '"></div></div>' +
      '<span class="status-count">' + fmtNum(count) + '</span></div>';
  });
  statusEl.innerHTML = statusHtml || '<div class="empty-state">No status data yet</div>';

  // Recent errors
  var errorEl = document.getElementById('errorList');
  document.getElementById('errorCount').textContent = d.recentErrors.length;
  if (!d.recentErrors.length) {
    errorEl.innerHTML = '<div class="empty-state">No recent errors — looking good</div>';
  } else {
    errorEl.innerHTML = d.recentErrors.map(function(e) {
      var copyText = [formatTs(e.ts), e.qid, e.from, e.to, e.status, e.msg].filter(Boolean).join(' | ');
      return '<div class="error-row"><div class="error-ts">' + formatTs(e.ts) + ' ' + statusPill(e.status) +
        (e.qid ? ' ' + qidLink(e.qid) : '') +
        '<button class="error-copy-btn" onclick="event.stopPropagation();copyRow(this,\'' + esc(copyText).replace(/'/g, "\\'") + '\')" title="Copy">' +
          '<svg width="11" height="11" viewBox="0 0 13 13" fill="none"><rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M3 3V2a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H9" stroke="currentColor" stroke-width="1.2"/></svg>' +
        '</button>' +
        '</div><div class="error-msg">' + esc(e.msg) + '</div></div>';
    }).join('');
  }

  // Top senders
  var topSendEl = document.getElementById('topSenders');
  if (topSendEl && d.topSenders && d.topSenders.length) {
    var maxTS = d.topSenders[0].cnt;
    topSendEl.innerHTML = d.topSenders.map(function(s) {
      var pct = Math.round((s.cnt / maxTS) * 100);
      return '<div class="status-row">' +
        '<span class="status-name" style="width:auto;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + addrLink(s.address) + '</span>' +
        '<div class="status-bar-wrap"><div class="status-bar" style="width:' + pct + '%;background:var(--purple)"></div></div>' +
        '<span class="status-count">' + fmtNum(s.cnt) + '</span></div>';
    }).join('');
  } else if (topSendEl) { topSendEl.innerHTML = '<div class="empty-state">No data yet</div>'; }

  // Top recipients
  var topRecvEl = document.getElementById('topRecipients');
  if (topRecvEl && d.topRecipients && d.topRecipients.length) {
    var maxTR = d.topRecipients[0].cnt;
    topRecvEl.innerHTML = d.topRecipients.map(function(s) {
      var pct = Math.round((s.cnt / maxTR) * 100);
      return '<div class="status-row">' +
        '<span class="status-name" style="width:auto;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + addrLink(s.address) + '</span>' +
        '<div class="status-bar-wrap"><div class="status-bar" style="width:' + pct + '%;background:var(--teal)"></div></div>' +
        '<span class="status-count">' + fmtNum(s.cnt) + '</span></div>';
    }).join('');
  } else if (topRecvEl) { topRecvEl.innerHTML = '<div class="empty-state">No data yet</div>'; }

  // Recipient domain stats
  renderRecipientDomainStats(d.recipientDomainStats);

  // Rate stats
  var rateEl = document.getElementById('rateStats');
  if (rateEl && d.rate) {
    rateEl.innerHTML =
      '<div style="padding:14px 18px;display:flex;gap:20px;flex-wrap:wrap">' +
        rateBadge('1 min', d.rate.min1) + rateBadge('5 min', d.rate.min5) +
        rateBadge('1 hour', d.rate.hour1) + rateBadge('24 hours', d.rate.day1) +
      '</div>';
  }
}

/**
 * Returns HTML for a single stat card.
 * @param {string} label - The card label text.
 * @param {string} value - The card value text.
 * @param {string} bg - The background color CSS value.
 * @param {string} color - The text/icon color CSS value.
 * @returns {string} HTML string for the stat card.
 */
function statCard(label, value, bg, color) {
  return '<div class="stat-card"><div class="stat-ico" style="background:' + bg + ';color:' + color + '">' +
    '<svg width="14" height="14" viewBox="0 0 15 15" fill="none"><rect x="2" y="4" width="11" height="8" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M2 6L7.5 10L13 6" stroke="currentColor" stroke-width="1.2"/></svg>' +
    '</div><div class="stat-value" style="color:' + color + '">' + value + '</div><div class="stat-label">' + label + '</div></div>';
}

/**
 * Returns HTML for a throughput rate badge.
 * @param {string} label - The time period label (e.g. '1 min', '1 hour').
 * @param {number} count - The message count for the period.
 * @returns {string} HTML string for the rate badge.
 */
function rateBadge(label, count) {
  return '<div style="text-align:center"><div style="font-size:20px;font-weight:700;font-family:\'DM Mono\',monospace;color:var(--text)">' + fmtNum(count) + '</div>' +
    '<div style="font-size:10px;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em">' + label + '</div></div>';
}

/**
 * Renders the Postfix health status section on the dashboard.
 */
async function renderPostfixHealth() {
  var el = document.getElementById('postfixHealth');
  if (!el) return;
  el.innerHTML = '<div style="padding:14px 18px;font-size:12px;color:var(--text-3)">Checking SMTP connection…</div>';
  try {
    var r = await api('/api/postfix/health');
    var d = await r.json();
    if (d.ok) {
      el.innerHTML =
        '<div style="padding:14px 18px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
          '<div style="width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 6px var(--green)"></div>' +
          '<span style="font-size:13px;font-weight:500;color:var(--green)">Postfix is responding</span>' +
          '<span class="pill p-green">' + d.ms + 'ms</span>' +
          '<span style="font-size:11px;color:var(--text-3);font-family:\'DM Mono\',monospace;margin-left:auto">' + esc(d.banner || '') + '</span>' +
        '</div>';
    } else {
      el.innerHTML =
        '<div style="padding:14px 18px;display:flex;align-items:center;gap:12px">' +
          '<div style="width:8px;height:8px;border-radius:50%;background:var(--red);box-shadow:0 0 6px var(--red)"></div>' +
          '<span style="font-size:13px;font-weight:500;color:var(--red)">Postfix unreachable</span>' +
          '<span style="font-size:12px;color:var(--text-3)">' + esc(d.error || 'Connection failed') + '</span>' +
        '</div>';
    }
  } catch {
    el.innerHTML = '<div style="padding:14px 18px;color:var(--red);font-size:12px">Health check failed</div>';
  }
}

/**
 * Sends a test email via the API and displays the result.
 */
async function sendTestEmail() {
  var toEl = document.getElementById('testTo');
  var btn = document.getElementById('testSendBtn');
  var resultEl = document.getElementById('testResult');

  var toAddr = toEl.value.trim();
  if (!toAddr) { toast('Enter a recipient address'); return; }

  btn.disabled = true;
  btn.textContent = 'Sending…';
  resultEl.innerHTML = '';

  try {
    var r = await api('/api/postfix/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: toAddr }),
    });
    var d = await r.json();
    if (d.ok) {
      resultEl.innerHTML = '<div style="margin-top:8px;padding:10px 14px;background:var(--green-light);border:1px solid var(--green-border);border-radius:6px;font-size:12px;color:var(--green)">Test email sent successfully. Check the recipient\'s inbox (and spam folder).</div>';
      toast('Test email sent');
    } else {
      resultEl.innerHTML = '<div style="margin-top:8px;padding:10px 14px;background:var(--red-light);border:1px solid var(--red-border);border-radius:6px;font-size:12px;color:var(--red)">Send failed: ' + esc(d.error || 'Unknown error') + '</div>';
    }
  } catch (e) {
    resultEl.innerHTML = '<div style="margin-top:8px;padding:10px 14px;background:var(--red-light);border:1px solid var(--red-border);border-radius:6px;font-size:12px;color:var(--red)">Error: ' + esc(e.message) + '</div>';
  }

  btn.disabled = false;
  btn.textContent = 'Send Test';
}

/**
 * Renders the recipient domain stats table on the dashboard.
 * @param {Array} data - Array of recipient domain stat objects.
 */
function renderRecipientDomainStats(data) {
  var el = document.getElementById('recipientDomainStats');
  if (!el) return;
  if (!data || !data.length) {
    el.innerHTML = '<div class="empty-state">No recipient domain data yet</div>';
    return;
  }
  var html = '<div class="log-table-wrap"><table class="log-table"><thead><tr>' +
    '<th>Domain</th><th>Total</th><th>Sent</th><th>Bounced</th><th>Deferred</th><th>Rejected</th>' +
    '</tr></thead><tbody>';
  data.forEach(function(d) {
    html += '<tr>' +
      '<td style="font-family:\'DM Mono\',monospace;font-size:12px">' + esc(d.domain) + '</td>' +
      '<td>' + fmtNum(d.total) + '</td>' +
      '<td><span class="pill p-green">' + fmtNum(d.sent) + '</span></td>' +
      '<td>' + (d.bounced > 0 ? '<span class="pill p-red">' + fmtNum(d.bounced) + '</span>' : '0') + '</td>' +
      '<td>' + (d.deferred > 0 ? '<span class="pill p-yellow">' + fmtNum(d.deferred) + '</span>' : '0') + '</td>' +
      '<td>' + (d.rejected > 0 ? '<span class="pill p-red">' + fmtNum(d.rejected) + '</span>' : '0') + '</td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  el.innerHTML = html;
}
