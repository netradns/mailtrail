// ══════════════════════════════════════════════════════════════
// MailTrail — Theme & Timezone
// Light/dark/system theme toggle, timezone selector, live clock.
// ══════════════════════════════════════════════════════════════

var _theme = localStorage.getItem('mt-theme') || 'system';
applyTheme(_theme);

/**
 * Sets and persists the theme preference.
 * @param {string} t - Theme value: 'light', 'dark', or 'system'.
 */
function setTheme(t) {
  _theme = t;
  localStorage.setItem('mt-theme', t);
  applyTheme(t);
}

/**
 * Applies the resolved theme to the document.
 * @param {string} t - Theme value: 'light', 'dark', or 'system'.
 */
function applyTheme(t) {
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  var resolved = t === 'system' ? (mq.matches ? 'dark' : 'light') : t;
  document.documentElement.setAttribute('data-theme', resolved);
  ['light','dark','system'].forEach(function(k) {
    var el = document.getElementById('tt-' + k);
    if (el) el.classList.toggle('active', k === t);
  });
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() {
  if (_theme === 'system') applyTheme('system');
});

/**
 * Sets and persists the timezone preference.
 * Updates the custom dropdown label and selected state.
 * @param {string} tz - Timezone identifier (e.g. 'local', 'UTC', or IANA name).
 */
function setTimezone(tz) {
  _timezone = tz;
  localStorage.setItem('mt-tz', tz);
  updateTzDropdownState();
}

/** Maps timezone values to display labels. */
var _tzLabels = {
  'local': 'Local', 'UTC': 'UTC', 'America/New_York': 'US Eastern',
  'America/Chicago': 'US Central', 'America/Denver': 'US Mountain',
  'America/Los_Angeles': 'US Pacific', 'Europe/London': 'London',
  'Europe/Berlin': 'Berlin', 'Asia/Tokyo': 'Tokyo',
};

/** Updates the TZ dropdown label and selected option to match current _timezone. */
function updateTzDropdownState() {
  var label = document.getElementById('tzSelectLabel');
  if (label) label.textContent = _tzLabels[_timezone] || _timezone;
  document.querySelectorAll('.tz-option').forEach(function(opt) {
    opt.classList.toggle('selected', opt.getAttribute('data-tz') === _timezone);
  });
}

/** Toggles the timezone custom dropdown open/closed. */
function toggleTzDropdown() {
  var wrap = document.getElementById('tzSelectWrap');
  var dropdown = document.getElementById('tzDropdown');
  var isOpen = wrap.classList.contains('open');
  wrap.classList.toggle('open');
  dropdown.classList.toggle('open');
  if (!isOpen) {
    var closeHandler = function(e) {
      if (!wrap.contains(e.target) && !dropdown.contains(e.target)) {
        wrap.classList.remove('open');
        dropdown.classList.remove('open');
        document.removeEventListener('click', closeHandler, true);
      }
    };
    setTimeout(function() { document.addEventListener('click', closeHandler, true); }, 0);
  }
}

/**
 * Selects a timezone from the custom dropdown.
 * @param {string} tz - Timezone identifier.
 */
function selectTz(tz) {
  setTimezone(tz);
  document.getElementById('tzSelectWrap').classList.remove('open');
  document.getElementById('tzDropdown').classList.remove('open');
}

// Init timezone dropdown on load
(function() {
  updateTzDropdownState();
})();

/**
 * Updates the live clock display in the topbar.
 */
function updateClock() {
  var el = document.getElementById('liveClock');
  if (!el) return;
  var now = new Date();
  try {
    if (_timezone === 'local') {
      el.textContent = now.toLocaleTimeString();
    } else if (_timezone === 'UTC') {
      el.textContent = now.toISOString().slice(11, 19) + ' UTC';
    } else {
      el.textContent = now.toLocaleTimeString('en-US', { timeZone: _timezone, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
  } catch { el.textContent = now.toLocaleTimeString(); }
}
setInterval(updateClock, 1000);
updateClock();
