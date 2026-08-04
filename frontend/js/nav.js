// ══════════════════════════════════════════════════════════════
// MailTrail — Navigation
// Sidebar toggle, page switching, topbar breadcrumb.
// ══════════════════════════════════════════════════════════════

var pageTitles = {
  dashboard: '<b>Dashboard</b> &mdash; Mail Health',
  logs: '<b>Log Search</b> &mdash; Filter & Explore',
  live: '<b>Live Tail</b> &mdash; Real-time Logs',
  settings: '<b>Settings</b> &mdash; Admin',
};

/**
 * Opens the mobile sidebar overlay.
 */
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sbOverlay').classList.add('open');
}

/**
 * Closes the mobile sidebar overlay.
 */
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sbOverlay').classList.remove('open');
}

/**
 * Switches to the specified page and updates navigation state.
 * @param {string} id - The page identifier (e.g. 'dashboard', 'logs', 'live', 'settings').
 */
function showPage(id) {
  document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.sb-item').forEach(function(b) { b.classList.remove('active'); });
  document.getElementById('page-' + id).classList.add('active');
  document.getElementById('nav-' + id).classList.add('active');
  document.getElementById('topbar-title').innerHTML = pageTitles[id] || '';
  closeSidebar();

  if (id === 'dashboard') loadDashboard();
  if (id === 'live') startTail();
  if (id !== 'live') stopTail();
  if (id === 'settings') { loadStorageInfo(); loadSettings(); }
}
