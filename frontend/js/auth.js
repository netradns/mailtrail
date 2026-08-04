// ══════════════════════════════════════════════════════════════
// MailTrail — Authentication
// Login, logout, session management, role-based UI.
// ══════════════════════════════════════════════════════════════

/**
 * Validates credentials against the server. Returns role string or false.
 * @param {string} h - The Authorization header value.
 * @returns {Promise<string|false>} The role string if valid, false otherwise.
 */
async function checkServerAuth(h) {
  var r = await fetch('/api/auth', { method: 'POST', headers: { 'Authorization': h } });
  if (!r.ok) return false;
  var d = await r.json();
  return d.ok ? (d.role || 'viewer') : false;
}

/**
 * Handles the login form submission.
 * @param {Event} e - The form submit event.
 * @returns {false} Always returns false to prevent form submission.
 */
async function handleLogin(e) {
  e.preventDefault();
  var u = document.getElementById('loginUser').value.trim();
  var p = document.getElementById('loginPass').value;
  var err = document.getElementById('loginError');
  if (!u || !p) { err.textContent = 'Please enter both fields.'; return false; }
  var h = 'Basic ' + btoa(u + ':' + p);
  var role = await checkServerAuth(h);
  if (role) {
    saveAuth(h, role);
    err.textContent = '';
    showAdmin();
  } else {
    err.textContent = 'Invalid username or password.';
    document.getElementById('loginPass').value = '';
    document.getElementById('loginPass').focus();
  }
  return false;
}

/**
 * Transitions from login overlay to the main app.
 */
function showAdmin() {
  document.getElementById('loginOverlay').classList.add('hidden');
  applyRole();
  loadDashboard();
  startHealthCheck();
  // Load sender address for test email display
  api('/api/settings').then(function(r) { return r.ok ? r.json() : null; }).then(function(d) {
    if (d) {
      var el = document.getElementById('testFromDisplay');
      if (el) el.textContent = d.testSenderAddress || '—';
    }
  }).catch(function() {});
}

/**
 * Shows/hides admin-only UI elements based on the current role.
 */
function applyRole() {
  // Hide admin-only elements for viewers
  var isViewer = _authRole === 'viewer';
  document.querySelectorAll('[data-role="admin"]').forEach(function(el) {
    el.style.display = isViewer ? 'none' : '';
  });
  // Hide settings nav for viewers
  var settingsNav = document.getElementById('nav-settings');
  if (settingsNav) settingsNav.style.display = isViewer ? 'none' : '';
}

/**
 * Clears auth and reloads the page.
 */
function logout() {
  clearAuth();
  window.location.reload();
}

// Auto-login if session exists
(async function() {
  if (_authHeader) {
    var role = await checkServerAuth(_authHeader);
    if (role) { _authRole = role; showAdmin(); }
    else { clearAuth(); }
  }
})();

// Fetch version + server timezone from server (public endpoint, no auth)
(async function() {
  try {
    var r = await fetch('/api/health');
    if (r.ok) {
      var d = await r.json();
      var el = document.getElementById('appVersion');
      if (el && d.version) el.textContent = 'v' + d.version;
      // Set default timezone from server if user hasn't chosen one
      if (!localStorage.getItem('mt-tz') && d.timezone) {
        setTimezone(d.timezone);
      }
    }
  } catch {}
})();
