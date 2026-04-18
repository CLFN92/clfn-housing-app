/* ============================================================
 * shared-ui.js — CLFN Housing Suite
 * UI primitives: toast, navigation stack, header, role switcher
 * ============================================================
 * Depends on: shared-config.js, shared-auth.js
 * Load order: shared.js → shared-config.js → shared-auth.js → THIS FILE → shared-data.js
 *
 * Exposes (as globals):
 *   showToast(msg, opts)           — notification toast
 *   pushNav(viewName)              — push to navigation stack
 *   goBack()                       — pop navigation stack and navigate
 *   setNavActive(id)               — highlight a sidebar nav button
 *   hideAllViews()                 — hide all page view containers
 *   updateHeaderUser(role)         — update header avatar/name/badge
 *   headerSignOut()                — prompt and sign out
 *   switchRole(role)               — set effective role + refresh UI
 *   updateRoleSwitcherVisibility() — no-op (handled by updateHeaderUser)
 *   setupHeaderRoleToggle(role)    — build the ED "view as" dropdown
 *   edGuard(role, featureName)     — show alert and return false if not ED
 *   _showView(id, renderFn)        — hide all + show one view + run renderFn
 *   _navStack                      — navigation history array
 * ============================================================ */

// ── Navigation stack ─────────────────────────────────────────────────────────
window._navStack = [];

// ── showToast ────────────────────────────────────────────────────────────────
// Unified toast for all pages.
// opts.duration  — ms before dismissal (default 2800)
// opts.position  — 'top' (default) | 'bottom'
// opts.type      — 'default' (default) | 'error'
function showToast(msg, opts) {
  opts = opts || {};
  var duration = opts.duration || 2800;
  var position = opts.position || 'top';
  var isError  = opts.type === 'error';

  var t = document.createElement('div');
  t.textContent = msg;

  var pos = position === 'bottom'
    ? 'bottom:24px;top:auto;'
    : 'top:20px;';
  var colors = isError
    ? 'background:#3b0a0a;color:#fca5a5;border:1.5px solid #7f1d1d;'
    : 'background:#111;color:#F8E41A;';

  t.style.cssText = [
    'position:fixed;', pos,
    'left:50%;transform:translateX(-50%);',
    colors,
    'padding:10px 22px;border-radius:8px;',
    'font-size:13px;font-weight:600;font-family:DM Sans,sans-serif;',
    'z-index:99999;box-shadow:0 4px 24px rgba(0,0,0,0.5);',
    'white-space:nowrap;pointer-events:none;'
  ].join('');

  document.body.appendChild(t);
  setTimeout(function() { if(t.parentNode) t.remove(); }, duration);
}

// Convenience alias used in some places
function _toastError(msg) { showToast(msg, { type: 'error' }); }

// ── pushNav ───────────────────────────────────────────────────────────────────
function pushNav(viewName) {
  var stack = window._navStack;
  if (stack.length && stack[stack.length - 1] === viewName) return; // no duplicates
  stack.push(viewName);
  if (stack.length > 20) stack.shift(); // cap
}

// ── goBack ────────────────────────────────────────────────────────────────────
// Pops the navigation stack and navigates to the previous view.
// Pages register their view→function map via window._navMap.
// Default map covers the common views; pages can extend it.
function goBack() {
  var stack = window._navStack;
  if (stack.length) stack.pop();
  while (stack.length && stack[stack.length - 1] === 'app') stack.pop();
  var prev    = stack.length ? stack[stack.length - 1] : null;
  var navMap  = window._navMap || {};
  var handler = prev && navMap[prev];
  if (typeof handler === 'function') {
    handler();
  } else if (typeof showEmployeeHome === 'function') {
    showEmployeeHome();
  }
}

// ── setNavActive ──────────────────────────────────────────────────────────────
function setNavActive(id) {
  var allTabs = [
    'tab_app','tab_dash','tab_scores','tab_settings','tab_match',
    'tab_inventory','tab_contractors','tab_tenants','tab_renos','tab_budget'
  ];
  allTabs.forEach(function(tid) {
    var b = document.getElementById(tid);
    if (b) { b.classList.remove('nav-active'); b.style.background = ''; b.style.color = ''; b.style.borderColor = ''; }
  });
  var el = document.getElementById(id);
  if (!el) return;
  if (id === 'tab_settings') {
    el.style.background   = 'rgba(248,228,26,0.12)';
    el.style.color        = 'var(--yellow)';
    el.style.borderColor  = 'var(--yellow)';
  } else {
    el.style.background   = 'var(--yellow)';
    el.style.color        = '#111';
    el.style.borderColor  = 'var(--yellow)';
  }
  el.classList.add('nav-active');
}

// ── hideAllViews ──────────────────────────────────────────────────────────────
// Hides every top-level view container. Pages can extend window._viewIds
// to include page-specific view IDs.
function hideAllViews() {
  var base = [
    'appLayout','settingsView','scorecardView',
    'dashView','employeeHomeView','worklistView',
    'inventoryView','matchView','tenantsView',
    'renoApprovalsView','renosView','contractorsView'
  ];
  var extra = window._extraViewIds || [];
  base.concat(extra).forEach(function(id) {
    var el = document.getElementById(id);
    if (el) { el.style.display = 'none'; el.style.flex = ''; }
  });
  var spb = document.getElementById('stepProgressBar'); if (spb) spb.style.display = 'none';
  var sn  = document.getElementById('stepNav');          if (sn)  sn.style.display  = 'none';
  var apf = document.getElementById('appProgressFoot'); if (apf) apf.style.display = 'none';
}

// ── _showView ─────────────────────────────────────────────────────────────────
// Hide everything, show one view, run its render function.
function _showView(id, renderFn) {
  hideAllViews();
  var el = document.getElementById(id);
  if (el) { el.style.display = 'flex'; el.style.flexDirection = 'column'; }
  if (typeof renderFn === 'function') renderFn();
}

// ── updateHeaderUser ──────────────────────────────────────────────────────────
// Updates avatar initials, name label, role badge, and conditional buttons.
// Uses CLFN_PERMS.roleLabel() for display names when available.
function updateHeaderUser(role) {
  var perms = window.CLFN_PERMS;

  // Display label — use CLFN_PERMS if available, fall back to simple map
  var label = (perms && perms.roleLabel) ? perms.roleLabel(role) : (
    { housing_employee_l1: 'Housing Staff', housing_employee_l2: 'Housing Staff',
      housing_manager: 'Housing Manager', ed: 'Executive Director',
      cfo: 'CFO', finance_l1: 'Finance Clerk' }[role] || 'Staff'
  );

  // Short badge (shown next to name)
  var badge = { housing_manager: 'HM', ed: 'ED', cfo: 'CFO' }[role] || '';

  // Avatar initials
  var initials = { housing_employee_l1: 'ST', housing_employee_l2: 'ST',
                   housing_manager: 'HM', ed: 'ED', cfo: 'CF', finance_l1: 'FC' }[role] || '?';

  // Override with real name initials if session has a name
  if (HOUSING_SESSION && HOUSING_SESSION.name) {
    var parts = HOUSING_SESSION.name.trim().split(/\s+/);
    initials = parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : HOUSING_SESSION.name.slice(0, 2).toUpperCase();
  }

  var av     = document.getElementById('header_avatar');     if (av)     av.textContent = initials;
  var nameEl = document.getElementById('header_user_name');  if (nameEl) nameEl.textContent = HOUSING_SESSION.name || label;
  var badgeEl= document.getElementById('header_role_badge');
  if (badgeEl) { badgeEl.textContent = badge; badgeEl.style.display = badge ? '' : 'none'; }

  // Show Settings only for HM / ED
  var settingsBtn = document.getElementById('header_settings_btn');
  if (settingsBtn) settingsBtn.style.display =
    (role === 'housing_manager' || role === 'ed') ? 'flex' : 'none';

  // Show Add Staff only for HM / ED
  var addStaffBtn = document.getElementById('header_addstaff_btn');
  if (addStaffBtn) addStaffBtn.style.display =
    (role === 'housing_manager' || role === 'ed') ? 'flex' : 'none';
}

// ── headerSignOut ─────────────────────────────────────────────────────────────
function headerSignOut() {
  if (HOUSING_SESSION && HOUSING_SESSION.accessToken) {
    if (confirm('Sign out of CLFN Housing?')) doLogout();
  } else {
    switchRole('housing_employee_l1');
    showToast('Signed out.');
  }
}

// ── switchRole ────────────────────────────────────────────────────────────────
// Sets the effective role (honours view-as). Pages that need post-switch
// rendering should register window._onSwitchRole = function(role){...}
function switchRole(role) {
  window.currentRole = role;
  updateHeaderUser(role);
  updateRoleSwitcherVisibility();

  // Update nav dashboard label
  var dashLabel = document.getElementById('tab_dash_label');
  if (dashLabel) dashLabel.textContent =
    (role === 'housing_manager' || role === 'ed') ? 'Dashboard' : 'Home';

  // Hide Settings nav for HE-L1/L2
  var settingsBtn = document.getElementById('tab_settings');
  if (settingsBtn) settingsBtn.style.display =
    (role === 'housing_manager' || role === 'ed') ? '' : 'none';

  // Notify page — e.g. housing.html refreshes scorecard actions, applies field locks
  if (typeof window._onSwitchRole === 'function') {
    try { window._onSwitchRole(role); } catch(e) { console.warn('[ui] _onSwitchRole error:', e); }
  }
}

// ── updateRoleSwitcherVisibility ──────────────────────────────────────────────
// No-op — handled by updateHeaderUser and setupHeaderRoleToggle.
// Kept as a stub so any residual calls don't throw.
function updateRoleSwitcherVisibility() { /* handled by updateHeaderUser */ }

// ── setupHeaderRoleToggle ─────────────────────────────────────────────────────
// Builds the "View As" dropdown for ED. Non-ED roles get the dropdown hidden.
function setupHeaderRoleToggle(realRole) {
  var toggleEl = document.getElementById('roleSwitcher');
  var selectEl = document.getElementById('rb_select');
  if (!toggleEl || !selectEl) return;

  var perms = window.CLFN_PERMS;
  if (!perms) { toggleEl.style.display = 'none'; return; }

  var normalized = perms.normalizeRole(realRole);
  var options    = perms.getViewAsOptions(normalized);

  if (options.length === 0) { toggleEl.style.display = 'none'; return; }

  toggleEl.style.display = 'flex';

  var html = '<option value="">My Role</option>';
  options.forEach(function(roleKey) {
    html += '<option value="' + roleKey + '">' + perms.roleLabel(roleKey) + '</option>';
  });
  selectEl.innerHTML = html;
  selectEl.value = window._viewAsRole || '';
}

// ── edGuard ───────────────────────────────────────────────────────────────────
// Returns true if the user is ED. Shows a toast and returns false otherwise.
// Usage: if (!edGuard(role, 'scoring model changes')) return;
function edGuard(role, featureName) {
  if (role === 'ed') return true;
  showToast((featureName || 'This action') + ' requires Executive Director access.');
  return false;
}
