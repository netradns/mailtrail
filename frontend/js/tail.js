// ══════════════════════════════════════════════════════════════
// MailTrail — Live Tail
// Real-time correlated message stream with auto-refresh.
// ══════════════════════════════════════════════════════════════

var _tailTimer = null;

/**
 * Starts the live tail auto-refresh timer.
 */
function startTail() {
  stopTail();
  refreshTail();
  _tailTimer = setInterval(refreshTail, 5000);
}

/**
 * Stops the live tail auto-refresh timer.
 */
function stopTail() {
  if (_tailTimer) { clearInterval(_tailTimer); _tailTimer = null; }
}

/**
 * Fetches and renders the latest tail entries.
 */
function refreshTail() {
  api('/api/logs/tail?n=50')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var out = document.getElementById('tailResults');
      if (!d.entries || !d.entries.length) {
        out.innerHTML = '<div class="empty-state">No log entries yet. Waiting for mail activity…</div>';
        return;
      }
      var html = '<table class="log-table"><thead><tr><th>Time</th><th>QID</th><th>From</th><th>To</th><th>Status</th><th>Relay</th><th>Delay</th><th>TLS</th><th>Client</th><th></th></tr></thead><tbody>';
      d.entries.forEach(function(e) {
        var copyText = [formatTs(e.ts), e.qid, e.from, e.to, e.status, e.relay, e.delay, e.delays, e.tls, e.client].filter(Boolean).join(' | ');
        html += '<tr><td style="font-size:11px;color:var(--text-3)">' + esc(formatTs(e.ts)) + '</td>' +
          '<td>' + qidLink(e.qid) + '</td>' +
          '<td>' + addrLink(e.from) + '</td><td>' + addrLink(e.to) + '</td>' +
          '<td>' + statusPill(e.status) + '</td>' +
          '<td style="font-size:11px;color:var(--text-3)">' + domainLink(e.relay || '') + '</td>' +
          '<td style="font-size:11px">' + esc(e.delay) + (e.delays ? ' <span style="color:var(--text-3);font-size:10px">(' + esc(e.delays) + ')</span>' : '') + '</td>' +
          '<td style="font-size:10px;color:var(--text-3)">' + esc(e.tls || '') + '</td>' +
          '<td style="font-size:10px;color:var(--text-3)">' + esc(e.client || '') + '</td>' +
          '<td><button class="row-copy-btn" onclick="copyRow(this,\'' + esc(copyText).replace(/'/g, "\\'") + '\')" title="Copy">' +
            '<svg width="12" height="12" viewBox="0 0 13 13" fill="none"><rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M3 3V2a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H9" stroke="currentColor" stroke-width="1.2"/></svg>' +
          '</button></td></tr>';
      });
      html += '</tbody></table>';
      out.innerHTML = html;
    })
    .catch(function() {});
}
