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
 *   edGuard(featureName, callback) — run callback if editScoreModel allowed, else toast and return false
 *   escapeHtml(v)                  — HTML-escape a value for safe innerHTML
 *   applyBrandingToHeader()        — patch nation-name placeholders in the page chrome from NATION_CONFIG
 *   applyNationOverrides()         — merge housing_settings.nation_config_override on top of NATION_CONFIG, then re-brand
 *   buildNationFooterStrip(opts)   — assemble a one-line Confidential footer from NATION_CONFIG contact fields
 *   _showView(id, renderFn)        — hide all + show one view + run renderFn
 *   _navStack                      — navigation history array
 * ============================================================ */

// ── Navigation stack ─────────────────────────────────────────────────────────
window._navStack = [];

// ── escapeHtml ───────────────────────────────────────────────────────────────
// Escape user-supplied data before interpolating it into innerHTML strings.
// Returns the empty string for null/undefined so template literals stay clean.
function escapeHtml(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
function hideAllViews(keepId) {
  var base = [
    'appLayout','settingsView','scorecardView',
    'dashView','employeeHomeView','worklistView','landingView',
    'inventoryView','matchView','tenantsView',
    'renoApprovalsView','renosView','contractorsView',
    'renosLoadingView'
  ];
  var extra = window._extraViewIds || [];
  base.concat(extra).forEach(function(id) {
    if (id === keepId) return; // keep the target visible during transition
    var el = document.getElementById(id);
    if (el) { el.style.display = 'none'; el.style.flex = ''; }
  });
  var spb = document.getElementById('stepProgressBar'); if (spb) spb.style.display = 'none';
  var sn  = document.getElementById('stepNav');          if (sn)  sn.style.display  = 'none';
  var apf = document.getElementById('appProgressFoot'); if (apf) apf.style.display = 'none';
}

// ── _showView ─────────────────────────────────────────────────────────────────
// Show target view first (before hiding others) so there's never a blank frame.
function _showView(id, renderFn) {
  var el = document.getElementById(id);
  // Show target before hiding others — eliminates blank-frame flash
  if (el) { el.style.display = 'flex'; el.style.width = '100%'; }
  hideAllViews(id);
  // Restore after hideAllViews in case it touched the kept element
  if (el) { el.style.display = 'flex'; el.style.width = '100%'; }
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
    (ROLE.isManagement(role)) ? 'flex' : 'none';

  // Show Add Staff only for HM / ED
  var addStaffBtn = document.getElementById('header_addstaff_btn');
  if (addStaffBtn) addStaffBtn.style.display =
    (ROLE.isManagement(role)) ? 'flex' : 'none';
}

// ── headerSignOut ─────────────────────────────────────────────────────────────
function headerSignOut() {
  if (HOUSING_SESSION && HOUSING_SESSION.accessToken) {
    showConfirm({
      title:       'Sign out?',
      message:     'You will be returned to the sign-in screen.',
      confirmText: 'Sign Out'
    }).then(function(ok){ if (ok) doLogout(); });
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
    (ROLE.isManagement(role)) ? 'Dashboard' : 'Home';

  // Hide Settings nav for HE-L1/L2
  var settingsBtn = document.getElementById('tab_settings');
  if (settingsBtn) settingsBtn.style.display =
    (ROLE.isManagement(role)) ? '' : 'none';

  // Notify page — skip during boot to prevent flash back to landing page
  // window._booting is set true before resolveHousingRole and cleared after
  // initHousingPage completes. Interactive role switches (My Role dropdown)
  // happen after boot so _booting is false and _onSwitchRole fires normally.
  if (!window._booting && typeof window._onSwitchRole === 'function') {
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

// ── applyBrandingToHeader ────────────────────────────────────────────────────
// Replaces nation-name placeholders in the static page chrome with the values
// from NATION_CONFIG, so the same HTML can ship to any nation.
//
// Hooks (no-ops if the element/marker isn't present on the current page):
//   - <span class="hbrand-sub">              → NATION_CONFIG.display_name
//   - data-nation="display_name"             → NATION_CONFIG.display_name
//   - data-nation="short"                    → NATION_CONFIG.short
//   - data-nation-template="{NATION} — Housing Department"
//                                            → "{display_name} — Housing Department"
//                                              ({SHORT} → short, {NATION} → display)
//   - <title> — only updated if it contains the placeholder token
//                {NATION_DISPLAY_NAME}
//
// Idempotent: safe to call repeatedly; the boot wiring at the bottom of this
// file invokes it once on DOMContentLoaded.
function applyBrandingToHeader() {
  var cfg = window.NATION_CONFIG;
  if (!cfg) return;
  var disp  = cfg.display_name || cfg.name || '';
  var short = cfg.short        || '';

  // .hbrand-sub appears in the header strip on every top-level page.
  document.querySelectorAll('.hbrand-sub').forEach(function(el){
    if (disp) el.textContent = disp;
  });

  // data-nation="display_name" / data-nation="short" — generic hook for any
  // place we want to inject the nation label without hard-coding a class.
  document.querySelectorAll('[data-nation="display_name"]').forEach(function(el){
    if (disp) el.textContent = disp;
  });
  document.querySelectorAll('[data-nation="short"]').forEach(function(el){
    if (short) el.textContent = short;
  });
  // data-nation-template — supports {NATION} and {SHORT} placeholders so
  // markup can read e.g. "{NATION} — Housing Department" and stay nation-agnostic.
  document.querySelectorAll('[data-nation-template]').forEach(function(el){
    var t = el.getAttribute('data-nation-template') || '';
    el.textContent = t.replace(/\{NATION\}/g, disp).replace(/\{SHORT\}/g, short);
  });

  // data-role-label="ed" → resolves via CLFN_PERMS.roleLabel(role), which
  // honors NATION_CONFIG.role_labels overrides. Keeps inline HTML text
  // ("Executive Director") nation-overridable without hardcoded strings.
  if (window.CLFN_PERMS && window.CLFN_PERMS.roleLabel) {
    document.querySelectorAll('[data-role-label]').forEach(function(el){
      var key = el.getAttribute('data-role-label');
      if (key) el.textContent = window.CLFN_PERMS.roleLabel(key);
    });
  }

  // Document title — only swap if a placeholder token is present so we don't
  // clobber pages that intentionally set a static title (e.g. "Sign In").
  // Supports {NATION_DISPLAY_NAME} and {NATION_SHORT} placeholders.
  if (document.title && /\{NATION_(DISPLAY_NAME|SHORT)\}/.test(document.title)) {
    document.title = document.title
      .replace(/\{NATION_DISPLAY_NAME\}/g, disp)
      .replace(/\{NATION_SHORT\}/g,        short);
  }
}

// Run once at boot. Pages that re-render the header later can call this again.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyBrandingToHeader);
  } else {
    // Document already parsed (deferred shared-ui.js load) — apply immediately.
    applyBrandingToHeader();
  }
}

// ── applyNationOverrides ─────────────────────────────────────────────────────
// Merges window._appSettings.nation_config_override (a {display_name, short,
// role_labels} object saved via Settings → Nation) on top of the build-time
// NATION_CONFIG, then re-runs applyBrandingToHeader() so any new values land
// in the page chrome immediately. Logo overrides ride along on the existing
// theme.logo settings key (handled by _applyTheme), not on this key.
//
// Call this AFTER housing_settings has been hydrated into _appSettings (i.e.
// from the same boot point that runs initApprovalAuthority and _applyTheme).
// Safe to call multiple times — each call overwrites the previous merge.
function applyNationOverrides() {
  try {
    var saved = window._appSettings && window._appSettings['nation_config_override'];
    if (!saved) return;
    var parsed = (typeof saved === 'string') ? JSON.parse(saved) : saved;
    if (!parsed || typeof parsed !== 'object') return;
    if (!window.NATION_CONFIG) window.NATION_CONFIG = {};
    // Logo lives in _appSettings.theme.logo (managed by _applyTheme), NOT here —
    // applyNationOverrides only owns nation identity, contact info, and labels.
    ['display_name', 'name', 'short',
     'mailing_address', 'website', 'phone', 'email'].forEach(function(k){
      if (parsed[k]) window.NATION_CONFIG[k] = parsed[k];
    });
    if (parsed.role_labels && typeof parsed.role_labels === 'object') {
      window.NATION_CONFIG.role_labels = Object.assign(
        {}, window.NATION_CONFIG.role_labels || {}, parsed.role_labels
      );
    }
    if (parsed.socials && typeof parsed.socials === 'object') {
      window.NATION_CONFIG.socials = Object.assign(
        {}, window.NATION_CONFIG.socials || {}, parsed.socials
      );
    }
    applyBrandingToHeader();
  } catch (e) {
    console.warn('[applyNationOverrides] failed:', e);
  }
}

// ── buildNationFooterStrip ───────────────────────────────────────────────────
// Returns a single-line "Confidential" footer string assembled from the saved
// NATION_CONFIG contact fields. Used by every print template (contractor
// agreement, work order, SOW, application snapshot, reno report) so they all
// render the same "{Nation} Housing Department · {address} · {phone} · {email}
// · {website} · Confidential" strip. Empty fields are skipped.
//
//   opts.includeConfidential — when true (default), appends "· Confidential"
//   opts.suffix              — extra trailing text (e.g. "Work Order")
function buildNationFooterStrip(opts) {
  opts = opts || {};
  var cfg = window.NATION_CONFIG || {};
  var disp = cfg.display_name || cfg.name || '';
  // Collapse multi-line addresses to comma-separated for single-line footers.
  var addr = (cfg.mailing_address || '').replace(/\s*\n+\s*/g, ', ').trim();
  var parts = [];
  if (disp)        parts.push(disp + ' Housing Department');
  if (addr)        parts.push(addr);
  if (cfg.phone)   parts.push(cfg.phone);
  if (cfg.email)   parts.push(cfg.email);
  if (cfg.website) parts.push(cfg.website);
  if (opts.suffix) parts.push(opts.suffix);
  if (opts.includeConfidential !== false) parts.push('Confidential');
  return parts.join(' · ');
}

// ── edGuard ───────────────────────────────────────────────────────────────────
// Wraps a callback with the editScoreModel approval gate. If the current role
// is allowed, the callback is invoked and the function returns true (or the
// callback's return value when it returns one). Otherwise a toast is shown
// and false is returned.
// Usage: edGuard('scoring model changes', function(){ ...do edit... });
function edGuard(featureName, callback) {
  var role = window.currentRole;
  if (window.APPROVAL_AUTHORITY && APPROVAL_AUTHORITY.can('editScoreModel', role)) {
    if (typeof callback === 'function') {
      var rv = callback();
      return (rv === undefined) ? true : rv;
    }
    return true;
  }
  showToast((featureName || 'This action') + ' requires Executive Director access.');
  return false;
}
