// ══════════════════════════════════════════════════════════════
// MailTrail — Log Search
// Correlated message search, pagination, CSV export.
// ══════════════════════════════════════════════════════════════

var _searchOffset = 0;
var _searchLimit = 200;

/**
 * Executes a correlated message search with the current filter values.
 * @param {number} [offset=0] - The result offset for pagination.
 */
function runSearch(offset) {
  _searchOffset = offset || 0;
  var params = new URLSearchParams();
  var q = document.getElementById('fSearch').value.trim();
  var from = document.getElementById('fFrom').value.trim();
  var to = document.getElementById('fTo').value.trim();
  var domain = document.getElementById('fDomain').value.trim();
  var status = document.getElementById('fStatus').value;
  var dateFrom = document.getElementById('fDateFrom').value;
  var dateTo = document.getElementById('fDateTo').value;

  if (q) params.set('q', q);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (domain) params.set('domain', domain);
  if (status) params.set('status', status);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  params.set('limit', _searchLimit);
  params.set('offset', _searchOffset);

  var out = document.getElementById('logResults');
  out.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-3)"><div class="live-dot-pulse" style="display:inline-block;margin-right:8px"></div>Searching…</div>';

  api('/api/messages?' + params.toString())
    .then(function(r) { return r.json(); })
    .then(function(d) { renderLogResults(d); })
    .catch(function(e) { out.innerHTML = '<div style="padding:24px;color:var(--red)">Search failed: ' + esc(e.message) + '</div>'; });
}

/**
 * Resets all search filters and re-runs the search.
 */
function clearSearch() {
  ['fSearch','fFrom','fTo','fDomain','fDateFrom','fDateTo'].forEach(function(id) {
    document.getElementById(id).value = '';
  });
  document.getElementById('fStatus').value = '';
  // Reset date-to to today
  document.getElementById('fDateTo').value = new Date().toISOString().slice(0, 10);
  runSearch();
}

/**
 * Renders search results table and pagination controls.
 * @param {Object} d - The search API response containing entries and total count.
 */
function renderLogResults(d) {
  var out = document.getElementById('logResults');
  if (!d.entries || !d.entries.length) {
    out.innerHTML = '<div class="empty-state">No log entries match your filters.</div>';
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  var html = '<div class="log-table-wrap"><table class="log-table"><thead><tr>' +
    '<th>Time</th><th>QID</th><th>From</th><th>To</th><th>Status</th><th>Relay</th><th>Delay</th><th>TLS</th><th>Client</th><th></th>' +
    '</tr></thead><tbody>';

  d.entries.forEach(function(e) {
    var st = e.final_status || e.status || '';
    var copyText = [formatTs(e.ts), e.qid, e.from, e.to, st, e.relay, e.delay, e.delays, e.size ? e.size + 'B' : '', e.nrcpt ? e.nrcpt + ' rcpt' : '', e.tls, e.client].filter(Boolean).join(' | ');
    html += '<tr>' +
      '<td style="font-size:11px;color:var(--text-3)">' + esc(formatTs(e.ts)) + '</td>' +
      '<td>' + qidLink(e.qid) + '</td>' +
      '<td>' + addrLink(e.from) + '</td>' +
      '<td>' + addrLink(e.to) + '</td>' +
      '<td>' + statusPill(st) + '</td>' +
      '<td style="font-size:11px;color:var(--text-3)">' + domainLink(e.relay || '') + '</td>' +
      '<td style="font-size:11px">' + esc(e.delay) + (e.delays ? ' <span style="color:var(--text-3);font-size:10px">(' + esc(e.delays) + ')</span>' : '') + '</td>' +
      '<td style="font-size:10px;color:var(--text-3)">' + esc(e.tls || '') + '</td>' +
      '<td style="font-size:10px;color:var(--text-3)">' + esc(e.client || '') + '</td>' +
      '<td><button class="row-copy-btn" onclick="copyRow(this,\'' + esc(copyText).replace(/'/g, "\\'") + '\')" title="Copy">' +
        '<svg width="12" height="12" viewBox="0 0 13 13" fill="none"><rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M3 3V2a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H9" stroke="currentColor" stroke-width="1.2"/></svg>' +
      '</button></td>' +
      '</tr>';
  });

  html += '</tbody></table></div>';
  out.innerHTML = html;

  // Pagination
  var pagEl = document.getElementById('pagination');
  var totalPages = Math.ceil(d.total / _searchLimit);
  var currentPage = Math.floor(_searchOffset / _searchLimit) + 1;

  if (totalPages <= 1) { pagEl.innerHTML = '<span>' + fmtNum(d.total) + ' results</span>'; return; }

  pagEl.innerHTML =
    '<button ' + (_searchOffset <= 0 ? 'disabled' : '') + ' onclick="runSearch(' + (_searchOffset - _searchLimit) + ')">← Prev</button>' +
    '<span>Page ' + currentPage + ' of ' + totalPages + ' (' + fmtNum(d.total) + ' results)</span>' +
    '<button ' + (_searchOffset + _searchLimit >= d.total ? 'disabled' : '') + ' onclick="runSearch(' + (_searchOffset + _searchLimit) + ')">Next →</button>';
}

/**
 * Exports the current search results as a CSV download.
 */
function exportSearch() {
  var params = new URLSearchParams();
  var q = document.getElementById('fSearch').value.trim();
  var from = document.getElementById('fFrom').value.trim();
  var to = document.getElementById('fTo').value.trim();
  var domain = document.getElementById('fDomain').value.trim();
  var status = document.getElementById('fStatus').value;
  var dateFrom = document.getElementById('fDateFrom').value;
  var dateTo = document.getElementById('fDateTo').value;
  if (q) params.set('q', q);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (domain) params.set('domain', domain);
  if (status) params.set('status', status);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);

  // Trigger download via hidden link
  var link = document.createElement('a');
  link.href = '/api/logs/export?' + params.toString();
  // Add auth header via fetch instead
  api('/api/logs/export?' + params.toString())
    .then(function(r) { return r.blob(); })
    .then(function(blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'mailtrail-export.csv';
      a.click();
      URL.revokeObjectURL(url);
      toast('Export downloaded');
    })
    .catch(function() { toast('Export failed'); });
}

// Enter key on search fields
document.querySelectorAll('#page-logs .f-input, #page-logs .f-select').forEach(function(el) {
  el.addEventListener('keydown', function(e) { if (e.key === 'Enter') runSearch(); });
});

// Default "Date To" to today
(function() {
  var el = document.getElementById('fDateTo');
  if (el && !el.value) el.value = new Date().toISOString().slice(0, 10);
})();
