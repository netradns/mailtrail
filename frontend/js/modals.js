// ══════════════════════════════════════════════════════════════
// MailTrail — Modals & Inline Lookups
// QID message tracking, sender detail, IP geolocation,
// DNS resolution.
// ══════════════════════════════════════════════════════════════

var _ipCache = {};

/**
 * Returns a clickable QID link that opens the message tracking modal.
 * @param {string} qid - The queue ID.
 * @returns {string} HTML string for the clickable QID link.
 */
function qidLink(qid) {
  if (!qid) return '';
  return '<a class="qid-link" onclick="event.preventDefault();showQidTrack(\'' + esc(qid) + '\')" title="Track message ' + esc(qid) + '">' + esc(qid) + '</a>';
}

/**
 * Returns a clickable email address link that opens sender detail.
 * @param {string} addr - The email address.
 * @returns {string} HTML string for the clickable address link.
 */
function addrLink(addr) {
  if (!addr) return '';
  return '<a class="addr-link" onclick="event.preventDefault();showSenderDetail(\'' + esc(addr) + '\')" title="View sender stats">' + esc(addr) + '</a>';
}

/**
 * Parses a relay field and returns clickable domain/IP links.
 * @param {string} text - The relay field text (e.g. "gmail-smtp-in.l.google.com[142.250.x.x]:25").
 * @returns {string} HTML string with clickable domain and IP links.
 */
function domainLink(text) {
  if (!text) return '';
  // Extract domain or IP from relay field like "gmail-smtp-in.l.google.com[142.250.x.x]:25"
  var ipM = text.match(/\[(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\]/);
  var domM = text.match(/^([a-zA-Z0-9.-]+)\[/);
  var parts = '';
  if (domM) parts += '<a class="addr-link" onclick="event.preventDefault();lookupDomain(\'' + esc(domM[1]) + '\',this)" title="Lookup ' + esc(domM[1]) + '">' + esc(domM[1]) + '</a>';
  if (ipM) parts += (domM ? '[' : '') + '<a class="addr-link" onclick="event.preventDefault();lookupIp(\'' + esc(ipM[1]) + '\',this)" title="Lookup ' + esc(ipM[1]) + '">' + esc(ipM[1]) + '</a>' + (domM ? ']' : '');
  if (!parts) return esc(text);
  // Append any remaining text (like :25)
  var remainder = text.replace(/^[^\]]*\]/, '');
  return parts + esc(remainder);
}

/**
 * Positions an inline popup below the anchor element.
 * @param {HTMLElement} popup - The popup element to position.
 * @param {HTMLElement} anchorEl - The anchor element to position relative to.
 */
function positionPopup(popup, anchorEl) {
  document.body.appendChild(popup);
  var rect = anchorEl.getBoundingClientRect();
  popup.style.top = (rect.bottom + 6) + 'px';
  popup.style.left = Math.min(rect.left, window.innerWidth - 420) + 'px';
  // Close on click outside
  var closeHandler = function(e) {
    if (!popup.contains(e.target) && e.target !== anchorEl) {
      popup.remove();
      document.removeEventListener('click', closeHandler, true);
    }
  };
  setTimeout(function() { document.addEventListener('click', closeHandler, true); }, 0);
}

/**
 * Opens an inline IP geolocation popup.
 * @param {string} ip - The IP address to look up.
 * @param {HTMLElement} anchorEl - The element to anchor the popup to.
 */
function lookupIp(ip, anchorEl) {
  var popupId = 'ip-popup-' + ip.replace(/\./g, '-');
  var existingPopup = document.getElementById(popupId);
  if (existingPopup) { existingPopup.remove(); return; }
  var popup = document.createElement('div');
  popup.id = popupId;
  popup.className = 'inline-popup';
  popup.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text-3)">Looking up ' + esc(ip) + '…</div>';
  positionPopup(popup, anchorEl);

  if (_ipCache[ip]) { renderIpPopup(popup, _ipCache[ip]); return; }

  api('/api/lookup/ip?ip=' + encodeURIComponent(ip))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) throw new Error(data.error);
      _ipCache[ip] = data;
      renderIpPopup(popup, data);
    })
    .catch(function() {
      popup.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--red)">Lookup failed — <a href="https://ipinfo.io/' + esc(ip) + '" target="_blank" rel="noopener noreferrer" style="color:var(--blue)">open ipinfo.io</a></div>';
    });
}

/**
 * Renders IP geolocation data inside a popup.
 * @param {HTMLElement} popup - The popup element to render into.
 * @param {Object} data - The IP geolocation data object.
 */
function renderIpPopup(popup, data) {
  var fields = [['IP', data.ip], ['Hostname', data.hostname], ['City', data.city],
    ['Region', data.region], ['Country', data.country], ['Org', data.org], ['Timezone', data.timezone]].filter(function(f) { return f[1]; });
  popup.innerHTML = '<div class="popup-grid">' + fields.map(function(f) {
    return '<div class="popup-cell"><div class="popup-lbl">' + esc(f[0]) + '</div><div class="popup-val">' + esc(f[1]) + '</div></div>';
  }).join('') + '</div>';
}

/**
 * Opens an inline DNS lookup popup.
 * @param {string} domain - The domain name to resolve.
 * @param {HTMLElement} anchorEl - The element to anchor the popup to.
 */
function lookupDomain(domain, anchorEl) {
  var popupId = 'dns-popup-' + domain.replace(/\./g, '-');
  var existingPopup = document.getElementById(popupId);
  if (existingPopup) { existingPopup.remove(); return; }
  var popup = document.createElement('div');
  popup.id = popupId;
  popup.className = 'inline-popup';
  popup.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--text-3)">Resolving ' + esc(domain) + '…</div>';
  positionPopup(popup, anchorEl);

  api('/api/lookup/dns?domain=' + encodeURIComponent(domain))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var answers = data.answers || [];
      popup.innerHTML = '<div class="popup-grid">' +
        '<div class="popup-cell"><div class="popup-lbl">Domain</div><div class="popup-val">' + esc(domain) + '</div></div>' +
        '<div class="popup-cell"><div class="popup-lbl">A Records</div><div class="popup-val">' + (answers.length ? answers.map(function(a) {
          return '<a class="addr-link" onclick="event.preventDefault();lookupIp(\'' + esc(a) + '\',this)">' + esc(a) + '</a>';
        }).join(', ') : 'None') + '</div></div></div>';
    })
    .catch(function() { popup.innerHTML = '<div style="padding:10px;font-size:12px;color:var(--red)">DNS lookup failed</div>'; });
}

/**
 * Opens a modal showing the full message lifecycle for a queue ID.
 * @param {string} qid - The queue ID to track.
 */
async function showQidTrack(qid) {
  var overlay = document.getElementById('modalOverlay');
  var content = document.getElementById('modalContent');
  overlay.style.display = 'flex';
  content.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-3)"><div class="live-dot-pulse" style="display:inline-block;margin-right:8px"></div>Loading message trail for ' + esc(qid) + '…</div>';

  try {
    var r = await api('/api/logs/qid?id=' + encodeURIComponent(qid));
    var d = await r.json();
    var html = '<div style="padding:20px"><div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">' +
      '<div style="font-size:16px;font-weight:600">Message Trail</div>' +
      '<span class="pill p-blue">' + esc(qid) + '</span>' +
      '<span style="font-size:12px;color:var(--text-3)">' + d.count + ' log entries</span>' +
      '<button class="btn btn-ghost btn-sm" onclick="closeModal()" style="margin-left:auto">✕ Close</button></div>';

    if (!d.entries.length) {
      html += '<div class="empty-state">No entries found for this queue ID.</div>';
    } else {
      html += '<div class="log-table-wrap" style="max-height:60vh;overflow-y:auto"><table class="log-table"><thead><tr>' +
        '<th>Time</th><th>Process</th><th>From</th><th>To</th><th>Status</th><th>Relay</th><th>Message</th></tr></thead><tbody>';
      d.entries.forEach(function(e) {
        html += '<tr><td style="font-size:11px;color:var(--text-3)">' + esc(formatTs(e.ts)) + '</td>' +
          '<td style="font-size:11px;color:var(--text-3)">' + esc(e.proc) + '</td>' +
          '<td>' + (e.from ? addrLink(e.from) : '') + '</td>' +
          '<td>' + (e.to ? addrLink(e.to) : '') + '</td>' +
          '<td>' + statusPill(e.status) + '</td>' +
          '<td style="font-size:11px">' + domainLink(e.relay) + '</td>' +
          '<td class="msg-cell">' + esc(e.msg) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '</div>';
    content.innerHTML = html;
  } catch (e) {
    content.innerHTML = '<div style="padding:24px;color:var(--red)">Failed to load: ' + esc(e.message) + '</div>';
  }
}

/**
 * Opens a modal showing per-sender delivery stats.
 * @param {string} address - The sender email address.
 */
async function showSenderDetail(address) {
  var overlay = document.getElementById('modalOverlay');
  var content = document.getElementById('modalContent');
  overlay.style.display = 'flex';
  content.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-3)"><div class="live-dot-pulse" style="display:inline-block;margin-right:8px"></div>Loading stats for ' + esc(address) + '…</div>';

  try {
    var r = await api('/api/stats/sender?address=' + encodeURIComponent(address));
    var d = await r.json();
    var html = '<div style="padding:20px"><div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">' +
      '<div style="font-size:16px;font-weight:600">Sender Detail</div>' +
      '<span style="font-family:\'DM Mono\',monospace;font-size:13px;color:var(--blue)">' + esc(address) + '</span>' +
      '<span class="pill p-blue">' + fmtNum(d.total) + ' total</span>' +
      '<button class="btn btn-ghost btn-sm" onclick="closeModal()" style="margin-left:auto">✕ Close</button></div>';

    // Status breakdown
    if (d.statuses.length) {
      html += '<div style="margin-bottom:16px"><div style="font-size:12px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Delivery Status</div>';
      var maxSS = d.statuses[0].cnt;
      d.statuses.forEach(function(s) {
        var pct = Math.round((s.cnt / maxSS) * 100);
        var color = { sent: 'var(--green)', bounced: 'var(--red)', deferred: 'var(--yellow)' }[s.status] || 'var(--text-3)';
        html += '<div class="status-row">' + '<span class="status-name">' + statusPill(s.status) + '</span>' +
          '<div class="status-bar-wrap"><div class="status-bar" style="width:' + pct + '%;background:' + color + '"></div></div>' +
          '<span class="status-count">' + fmtNum(s.cnt) + '</span></div>';
      });
      html += '</div>';
    }

    // Top recipients
    if (d.recipients.length) {
      html += '<div style="margin-bottom:16px"><div style="font-size:12px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Top Recipients</div>';
      d.recipients.slice(0, 10).forEach(function(r) {
        html += '<div class="status-row"><span class="status-name" style="width:auto;flex:1">' + addrLink(r.address) + '</span><span class="status-count">' + fmtNum(r.cnt) + '</span></div>';
      });
      html += '</div>';
    }

    // Recent messages
    if (d.recent.length) {
      html += '<div><div style="font-size:12px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Recent Messages</div>' +
        '<div class="log-table-wrap" style="max-height:300px;overflow-y:auto"><table class="log-table"><thead><tr><th>Time</th><th>QID</th><th>To</th><th>Status</th><th>Relay</th></tr></thead><tbody>';
      d.recent.forEach(function(e) {
        html += '<tr><td style="font-size:11px;color:var(--text-3)">' + esc(formatTs(e.ts)) + '</td>' +
          '<td>' + qidLink(e.qid) + '</td><td>' + esc(e.to) + '</td>' +
          '<td>' + statusPill(e.status) + '</td><td style="font-size:11px">' + domainLink(e.relay) + '</td></tr>';
      });
      html += '</tbody></table></div></div>';
    }

    html += '</div>';
    content.innerHTML = html;
  } catch (e) {
    content.innerHTML = '<div style="padding:24px;color:var(--red)">Failed to load: ' + esc(e.message) + '</div>';
  }
}

/**
 * Closes the currently open modal.
 */
function closeModal() { document.getElementById('modalOverlay').style.display = 'none'; }
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeModal(); });
