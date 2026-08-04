// ══════════════════════════════════════════════════════════════
// MailTrail — Settings
// Test email config, retention, credentials, multi-channel
// alerting.
// ══════════════════════════════════════════════════════════════

var _alertChannels = []; // local state before save

var _alertLabels = { slack: 'Webhook URL', teams: 'Webhook URL', pagerduty: 'Integration Key', discord: 'Webhook URL', email: 'Recipient Address', webhook: 'Endpoint URL' };
var _alertPlaceholders = { slack: 'https://hooks.slack.com/services/...', teams: 'https://outlook.office.com/webhook/...', pagerduty: 'your-32-char-integration-key', discord: 'https://discord.com/api/webhooks/...', email: 'ops@example.com', webhook: 'https://your-endpoint.com/alerts' };
var _alertServiceNames = { slack: 'Slack', teams: 'Teams', pagerduty: 'PagerDuty', discord: 'Discord', email: 'Email', webhook: 'Webhook' };
var _alertHelpText = {
  slack: 'Create an <a href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noopener">Incoming Webhook</a> in your Slack workspace and paste the URL above.',
  teams: 'Create an <a href="https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook" target="_blank" rel="noopener">Incoming Webhook</a> in your Teams channel and paste the URL above.',
  pagerduty: 'Create a <a href="https://support.pagerduty.com/main/docs/services-and-integrations#create-a-generic-events-api-integration" target="_blank" rel="noopener">Generic Events API v2 integration</a> on your PagerDuty service and paste the integration key above.',
  discord: 'Go to your Discord channel settings → Integrations → <a href="https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks" target="_blank" rel="noopener">Webhooks</a>, create one, and paste the URL above.',
  email: 'Alerts are sent through the local Postfix relay. Enter the recipient address above and the sender address below. No external SMTP config needed.',
  webhook: 'Enter any HTTP(S) endpoint. MailTrail will POST a JSON payload with alert details.',
};
var _selectedAlertService = 'slack';

/**
 * Updates admin credentials via the API.
 */
async function changePassword() {
  var u = document.getElementById('cpUser').value.trim();
  var p = document.getElementById('cpPass').value;
  var p2 = document.getElementById('cpPass2').value;
  if (!u) { toast('Username is required'); return; }
  if (p.length < 4) { toast('Password must be at least 4 characters'); return; }
  if (p !== p2) { toast('Passwords do not match'); return; }
  try {
    var r = await api('/api/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newUser: u, newPass: p }),
    });
    var d = await r.json();
    if (r.ok) {
      _authHeader = 'Basic ' + btoa(u + ':' + p);
      saveAuth(_authHeader, 'admin');
      document.getElementById('cpUser').value = '';
      document.getElementById('cpPass').value = '';
      document.getElementById('cpPass2').value = '';
      toast('Credentials updated');
    } else { toast(d.error || 'Failed'); }
  } catch (e) { toast('Error: ' + e.message); }
}

/**
 * Loads and displays storage usage information.
 */
async function loadStorageInfo() {
  try {
    var r = await api('/api/dashboard');
    if (!r.ok) return;
    var d = await r.json();
    document.getElementById('storageInfo').innerHTML =
      'Log files on disk: <b>' + d.totalLogSizeMB + ' MB</b> (max <b>' + d.maxLogSizeGB + ' GB</b>)<br>' +
      'SQLite database: <b>' + (d.dbSizeMB || 0) + ' MB</b><br>' +
      'Retention: <b>' + (d.retentionDays || 90) + ' days</b> — entries older than this are purged automatically<br>' +
      'Log files: <b>' + (d.logFiles || []).length + '</b>';
  } catch {}
}

/**
 * Loads all settings from the API and populates form fields.
 */
async function loadSettings() {
  try {
    var r = await api('/api/settings');
    if (!r.ok) return;
    var d = await r.json();
    document.getElementById('setTestAddr').value = d.testSenderAddress || '';
    document.getElementById('setTestName').value = d.testSenderName || '';
    document.getElementById('setRetention').value = d.retentionDays || 90;
    document.getElementById('setMaxLog').value = d.maxLogSizeGB || 20;
    // Update the dashboard "From" display
    var fromDisplay = document.getElementById('testFromDisplay');
    if (fromDisplay) fromDisplay.textContent = d.testSenderAddress || '—';
    // Load alert settings
    loadAlertSettings(d);
  } catch {}
}

/**
 * Saves test email sender settings.
 */
async function saveTestSettings() {
  var addr = document.getElementById('setTestAddr').value.trim();
  var name = document.getElementById('setTestName').value.trim();
  if (!addr) { toast('Sender address is required'); return; }
  if (!addr.includes('@')) { toast('Enter a valid email address'); return; }
  try {
    var r = await api('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testSenderAddress: addr, testSenderName: name }),
    });
    var d = await r.json();
    if (r.ok) {
      toast('Settings saved');
      var fromDisplay = document.getElementById('testFromDisplay');
      if (fromDisplay) fromDisplay.textContent = addr;
    } else { toast(d.error || 'Save failed'); }
  } catch (e) { toast('Error: ' + e.message); }
}

/**
 * Saves retention and storage limit settings.
 */
async function saveRetentionSettings() {
  var days = parseInt(document.getElementById('setRetention').value);
  var maxGB = parseFloat(document.getElementById('setMaxLog').value);
  if (isNaN(days) || days < 1 || days > 365) { toast('Retention must be 1–365 days'); return; }
  if (isNaN(maxGB) || maxGB < 1 || maxGB > 100) { toast('Max log size must be 1–100 GB'); return; }
  try {
    var r = await api('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retentionDays: days, maxLogSizeGB: maxGB }),
    });
    var d = await r.json();
    if (r.ok) { toast('Retention settings saved'); loadStorageInfo(); }
    else { toast(d.error || 'Save failed'); }
  } catch (e) { toast('Error: ' + e.message); }
}

/**
 * Toggles the custom service dropdown open/closed.
 */
function toggleAlertDropdown() {
  var select = document.getElementById('alertServiceSelect');
  var dropdown = document.getElementById('alertServiceDropdown');
  var isOpen = select.classList.contains('open');
  select.classList.toggle('open');
  dropdown.classList.toggle('open');
  if (!isOpen) {
    // Close on click outside
    var closeHandler = function(e) {
      if (!select.contains(e.target) && !dropdown.contains(e.target)) {
        select.classList.remove('open');
        dropdown.classList.remove('open');
        document.removeEventListener('click', closeHandler, true);
      }
    };
    setTimeout(function() { document.addEventListener('click', closeHandler, true); }, 0);
  }
}

/**
 * Selects an alert service from the custom dropdown.
 * Updates the label, placeholder, help text, and shows/hides the email sender field.
 * @param {string} service - Service key (slack, teams, pagerduty, discord, email, webhook).
 */
function selectAlertService(service) {
  _selectedAlertService = service;
  document.getElementById('setAlertService').value = service;
  document.getElementById('alertServiceLabel').textContent = _alertServiceNames[service] || service;
  document.getElementById('alertUrlLabel').textContent = _alertLabels[service] || 'URL';
  document.getElementById('setAlertUrl').placeholder = _alertPlaceholders[service] || '';
  document.getElementById('setAlertUrl').value = '';
  document.getElementById('alertHelp').innerHTML = _alertHelpText[service] || '';
  // Show/hide email sender field
  var emailGroup = document.getElementById('alertEmailFromGroup');
  if (emailGroup) emailGroup.style.display = service === 'email' ? '' : 'none';
  // Update selected state in dropdown
  document.querySelectorAll('.custom-select-option').forEach(function(opt) {
    opt.classList.toggle('selected', opt.getAttribute('data-value') === service);
  });
  // Close dropdown
  document.getElementById('alertServiceSelect').classList.remove('open');
  document.getElementById('alertServiceDropdown').classList.remove('open');
}

/**
 * Renders the list of configured alert channel cards.
 */
function renderAlertChannels() {
  var el = document.getElementById('alertChannelList');
  if (!_alertChannels.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--text-3);padding:8px 0">No alert channels configured.</div>';
    return;
  }
  el.innerHTML = _alertChannels.map(function(ch, i) {
    var display = ch.service === 'email' ? ch.url : (ch.url.length > 50 ? ch.url.slice(0, 50) + '…' : ch.url);
    var fromNote = (ch.service === 'email' && ch.fromAddress) ? ' <span style="color:var(--text-3);font-size:11px">from ' + esc(ch.fromAddress) + '</span>' : '';
    return '<div class="alert-channel-card">' +
      '<span class="svc-badge svc-' + esc(ch.service) + '">' + esc(_alertServiceNames[ch.service] || ch.service) + '</span>' +
      '<span class="channel-url" title="' + esc(ch.url) + '">' + esc(display) + fromNote + '</span>' +
      '<div class="channel-actions">' +
        '<button class="btn btn-ghost btn-sm" onclick="testAlertChannel(' + i + ')">Test</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="removeAlertChannel(' + i + ')" style="color:var(--red)">Remove</button>' +
      '</div></div>';
  }).join('');
}

/**
 * Collects current alert settings from the UI and saves to the API.
 * Called automatically when channels or triggers change.
 */
async function autoSaveAlertSettings() {
  var payload = {
    alertChannels: _alertChannels,
    alertBounceEnabled: document.getElementById('setAlertBounce').checked,
    alertBounceThreshold: parseInt(document.getElementById('setAlertBounceThresh').value, 10) || 5,
    alertQueueEnabled: document.getElementById('setAlertQueue').checked,
    alertQueueThreshold: parseInt(document.getElementById('setAlertQueueThresh').value, 10) || 50,
    alertHealthEnabled: document.getElementById('setAlertHealth').checked,
    alertCooldownMin: parseInt(document.getElementById('setAlertCooldown').value, 10) || 15,
  };
  try {
    var r = await api('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    var d = await r.json();
    if (r.ok) toast('Saved');
    else toast(d.error || 'Save failed');
  } catch (e) { toast('Error: ' + e.message); }
}

/**
 * Adds a new alert channel from the form inputs and auto-saves.
 */
function addAlertChannel() {
  var service = document.getElementById('setAlertService').value;
  var url = document.getElementById('setAlertUrl').value.trim();
  if (!url) { toast('Enter a URL or address'); return; }
  if (service === 'email' && !url.includes('@')) { toast('Enter a valid email address'); return; }
  var channel = { service: service, url: url };
  if (service === 'email') {
    var fromAddr = (document.getElementById('setAlertFrom').value || '').trim();
    if (fromAddr) channel.fromAddress = fromAddr;
  }
  _alertChannels.push(channel);
  document.getElementById('setAlertUrl').value = '';
  if (document.getElementById('setAlertFrom')) document.getElementById('setAlertFrom').value = '';
  renderAlertChannels();
  autoSaveAlertSettings();
}

/**
 * Removes an alert channel by index and auto-saves.
 * @param {number} index - The index of the channel to remove.
 */
function removeAlertChannel(index) {
  _alertChannels.splice(index, 1);
  renderAlertChannels();
  autoSaveAlertSettings();
}

/**
 * Sends a test alert to a specific channel.
 * Sends the channel object directly so it works before saving.
 * @param {number} index - The index of the channel in _alertChannels.
 */
async function testAlertChannel(index) {
  var ch = _alertChannels[index];
  if (!ch) { toast('Channel not found'); return; }
  try {
    var r = await api('/api/alerts/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: ch }),
    });
    var d = await r.json();
    if (r.ok) toast('Test alert sent to ' + _alertServiceNames[ch.service]);
    else toast(d.error || 'Test failed');
  } catch (e) { toast('Error: ' + e.message); }
}

/**
 * Populates alert settings form fields from settings object.
 * @param {Object} settings - The settings object from the API.
 */
function loadAlertSettings(settings) {
  if (!settings) return;
  _alertChannels = (settings.alertChannels || []).slice();
  renderAlertChannels();
  var bounce = document.getElementById('setAlertBounce');
  if (bounce) bounce.checked = !!settings.alertBounceEnabled;
  var bounceT = document.getElementById('setAlertBounceThresh');
  if (bounceT) bounceT.value = settings.alertBounceThreshold || 5;
  var queue = document.getElementById('setAlertQueue');
  if (queue) queue.checked = !!settings.alertQueueEnabled;
  var queueT = document.getElementById('setAlertQueueThresh');
  if (queueT) queueT.value = settings.alertQueueThreshold || 50;
  var health = document.getElementById('setAlertHealth');
  if (health) health.checked = !!settings.alertHealthEnabled;
  var cooldown = document.getElementById('setAlertCooldown');
  if (cooldown) cooldown.value = settings.alertCooldownMin || 15;
}

// saveAlertSettings is now handled by autoSaveAlertSettings (called on every change)

// Load test sender into dashboard on init
(async function() {
  if (!_authHeader) return;
  try {
    var r = await api('/api/settings');
    if (!r.ok) return;
    var d = await r.json();
    var testFrom = document.getElementById('testFrom');
    if (testFrom) {
      testFrom.value = d.testSenderAddress || '';
      testFrom.readOnly = true;
      testFrom.style.opacity = '.6';
    }
  } catch {}
})();

// ══════════════════════════════════════════════════════════════
// Danger Zone — Purge All Data
// ══════════════════════════════════════════════════════════════

/**
 * Shows the purge confirmation step (type CONFIRM).
 */
function showPurgeConfirm() {
  document.getElementById('purgeStep1').style.display = 'none';
  document.getElementById('purgeStep2').style.display = '';
  document.getElementById('purgeConfirmInput').value = '';
  document.getElementById('purgeResult').innerHTML = '';
  document.getElementById('purgeConfirmInput').focus();
}

/**
 * Hides the purge confirmation and returns to the initial button.
 */
function cancelPurge() {
  document.getElementById('purgeStep1').style.display = '';
  document.getElementById('purgeStep2').style.display = 'none';
}

/**
 * Executes the purge after validating the CONFIRM input.
 * Deletes all DB entries, raw log files, and resets the ingestion cursor.
 */
async function executePurge() {
  var input = document.getElementById('purgeConfirmInput').value.trim();
  if (input !== 'CONFIRM') {
    toast('Type CONFIRM to proceed');
    document.getElementById('purgeConfirmInput').focus();
    return;
  }
  var resultEl = document.getElementById('purgeResult');
  resultEl.innerHTML = '<div style="font-size:12px;color:var(--text-3)">Purging data…</div>';
  try {
    var r = await api('/api/purge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'CONFIRM' }),
    });
    var d = await r.json();
    if (r.ok) {
      resultEl.innerHTML = '<div style="padding:10px 14px;background:var(--green-light);border:1px solid var(--green-border);border-radius:6px;font-size:12px;color:var(--green)">Purge complete. Deleted ' + fmtNum(d.entriesDeleted) + ' database entries and ' + d.filesDeleted + ' log files.</div>';
      toast('All data purged');
      // Reset the UI back to step 1 after a delay
      setTimeout(function() { cancelPurge(); }, 5000);
    } else {
      resultEl.innerHTML = '<div style="padding:10px 14px;background:var(--red-light);border:1px solid var(--red-border);border-radius:6px;font-size:12px;color:var(--red)">Purge failed: ' + esc(d.error || 'Unknown error') + '</div>';
    }
  } catch (e) {
    resultEl.innerHTML = '<div style="padding:10px 14px;background:var(--red-light);border:1px solid var(--red-border);border-radius:6px;font-size:12px;color:var(--red)">Error: ' + esc(e.message) + '</div>';
  }
}
