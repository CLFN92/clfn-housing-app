/* ============================================================
 * shared-auth.js — CLFN Housing Suite
 * Session management, authentication state, role resolution
 * ============================================================
 * Depends on: shared-config.js (SUPABASE_URL, SUPABASE_ANON, HOUSING_SESSION)
 * Load order: shared.js → shared-config.js → THIS FILE → shared-ui.js → shared-data.js
 *
 * Exposes (on window):
 *   window.CLFN_AUTH        — auth state object with setSession / clearSession / getRole
 *   window.HOUSING_SESSION  — mutable session bag (email, name, role, accessToken)
 *   window.HOUSING_HEADERS  — Supabase REST headers (kept in sync with auth state)
 *   window.currentRole      — canonical role string (always read from here)
 *   window._realRole        — actual authenticated role (honours view-as separation)
 *   window._viewAsRole      — ED "view as" role override ('' = not overriding)
 *
 *   resolveHousingRole()    — async; looks up staff table, sets role globals
 *   doLogout()              — async; signs out, clears state, fires onLogout hook
 *   _clearLocalClientState()— wipes localStorage, sessionStorage, window caches
 *
 * Page-specific logout behaviour:
 *   Register a callback before calling doLogout():
 *     window._onLogout = function() { showLoginScreen(); applications = []; };
 *   shared-auth.js calls it automatically after clearing state.
 * ============================================================ */

// ── Session bag ─────────────────────────────────────────────────────────────
// Mutable object — auth layer writes to it; app layer reads from it.
// Never cache a copy; always read the current reference.
var HOUSING_SESSION = { email: '', name: '', role: '', accessToken: '' };

// ── Supabase REST headers ───────────────────────────────────────────────────
// Rebuilt on login (Bearer = user access token) and on logout (Bearer = anon).
var HOUSING_HEADERS = {
  'apikey':        SUPABASE_ANON,
  'Authorization': 'Bearer ' + SUPABASE_ANON,
  'Content-Type':  'application/json'
};

// ── Role globals ────────────────────────────────────────────────────────────
window.currentRole  = 'housing_employee_l1'; // effective role (may be view-as)
window._realRole    = null;                   // actual authenticated role
window._viewAsRole  = '';                     // '' = not using view-as

// ── CLFN_AUTH ───────────────────────────────────────────────────────────────
// Central auth state object. All session reads should go through here or
// window.currentRole. Direct reads of HOUSING_SESSION are also fine.
window.CLFL_AUTH_VERSION = '2.0'; // bump when shape changes
window.CLFN_AUTH = {
  currentUser:     null,   // { id, name, email }
  currentRole:     'housing_employee_l1',
  employeeId:      null,
  isAuthenticated: false,

  // ── Called by index.html after successful Supabase login + staff lookup ──
  setSession: function(supabaseUser, staffRow) {
    this.currentUser     = { id: supabaseUser.id, name: staffRow.name, email: supabaseUser.email };
    this.currentRole     = staffRow.role || 'housing_employee_l1';
    this.employeeId      = staffRow.id;
    this.isAuthenticated = true;
    window.currentRole   = this.currentRole;
    window._realRole     = this.currentRole;
    window._viewAsRole   = '';

    // Sync HOUSING_SESSION
    HOUSING_SESSION.email = supabaseUser.email;
    HOUSING_SESSION.name  = staffRow.name || '';
    HOUSING_SESSION.role  = this.currentRole;

    // Update UI if available (page may not have these yet)
    if (typeof switchRole       === 'function') switchRole(this.currentRole);
    if (typeof updateHeaderUser === 'function') updateHeaderUser(this.currentRole);

    var switcher = document.getElementById('roleSwitcher');
    if (switcher) switcher.style.display = 'none';

    console.log('[CLFN] Session set — ' + this.currentUser.name + ' (' + this.currentRole + ')');
  },

  // ── Called on logout ────────────────────────────────────────────────────
  clearSession: function() {
    this.currentUser     = null;
    this.currentRole     = 'housing_employee_l1';
    this.employeeId      = null;
    this.isAuthenticated = false;
    window.currentRole   = 'housing_employee_l1';
    window._realRole     = null;
    window._viewAsRole   = '';
    console.log('[CLFN] Session cleared');
  },

  // ── Role helpers ────────────────────────────────────────────────────────
  getRole:   function() { return window.currentRole || this.currentRole || 'housing_employee_l1'; },
  isManager: function() { var r = this.getRole(); return r === 'housing_manager' || r === 'ed'; },
  isED:      function() { return this.getRole() === 'ed'; }
};

// Convenience global — existing code calls getRole() directly
function getRole() { return window.CLFN_AUTH.getRole(); }

// ── resolveHousingRole ───────────────────────────────────────────────────────
// Called after navigation to a housing/renos page to re-establish the role
// from the staff table using the stored session token.
// Depends on: sbMapRole() from shared-data.js (loaded after this file).
async function resolveHousingRole() {
  try {
    var r = await fetch(
      SUPABASE_URL + '/rest/v1/staff?select=role,department,name&email=eq.' +
      encodeURIComponent(HOUSING_SESSION.email) + '&is_active=eq.true',
      { headers: HOUSING_HEADERS }
    );
    var rows = r.ok ? await r.json() : [];
    if (rows && rows.length) {
      var staffRow    = rows[0];
      var housingRole = (typeof sbMapRole === 'function')
        ? sbMapRole(staffRow)
        : (staffRow.role || 'housing_employee_l1');

      HOUSING_SESSION.name = staffRow.name || HOUSING_SESSION.name;
      HOUSING_SESSION.role = housingRole;
      window.currentRole   = housingRole;
      window._realRole     = housingRole;
      window._viewAsRole   = '';
      window.CLFN_AUTH.isAuthenticated = true;
      window.CLFN_AUTH.currentRole     = housingRole;

      if (typeof switchRole           === 'function') switchRole(housingRole);
      if (typeof setupHeaderRoleToggle === 'function') setupHeaderRoleToggle(housingRole);

      var addStaffBtn = document.getElementById('header_addstaff_btn');
      if (addStaffBtn) {
        addStaffBtn.style.display =
          (housingRole === 'ed' || housingRole === 'housing_manager') ? 'flex' : 'none';
      }
    } else {
      HOUSING_SESSION.role = 'housing_employee_l1';
      window.currentRole   = 'housing_employee_l1';
    }
  } catch(e) {
    console.warn('[HOUSING] role lookup failed:', e);
    HOUSING_SESSION.role = 'housing_employee_l1';
    window.currentRole   = 'housing_employee_l1';
  }
}

// ── _clearLocalClientState ───────────────────────────────────────────────────
// Wipes all client-side state: localStorage keys, sessionStorage keys,
// and in-memory window caches. Called on logout and on session expiry.
function _clearLocalClientState() {
  // localStorage
  var lsKeys = [
    'clfn_applications', 'clfn_housing_units',
    'clfn_scoring_model', 'clfn_scoring_model_v2', 'clfn_scoring_tiers_v2',
    'clfn_budget_pools', 'clfn_reno_score_model_v3', 'clfn_unit_score_model',
    'HOUSING_REMEMBER_KEY'
  ];
  try { lsKeys.forEach(function(k) { try { localStorage.removeItem(k); } catch(e) {} }); } catch(e) {}

  // sessionStorage
  try {
    ['clfn_housing_token','clfn_housing_role','clfn_housing_name','clfn_housing_email_session']
      .forEach(function(k) { try { sessionStorage.removeItem(k); } catch(e) {} });
  } catch(e) {}

  // In-memory window caches
  var winKeys = [
    '_contractors','_sowCache','_renoProgress','_appSettings','_renoBudget',
    '_unitPhotos','_staffCache','_editingUnitId','_rbaUnitId','_sowUnitId',
    '_currentDetailUnitId','_ctLastSaved','_pendingLookupUser','_currentScorecardApp',
    '_auStagedPhotos','_ueStagedPhotos','_rpPendingPhotos','_rpStoredPhotos',
    '_rpUnitId','_tenantFilesUnitId','_appFormReturnTo','_appMenuId',
    '_userLookupTimer','_ctEditIdx','_ctFilter','_sowWasPreviouslySaved',
    '_sowAfterContractorSave','_rpAfterContractorSave','_printPanelDoc'
  ];
  winKeys.forEach(function(k) { try { window[k] = undefined; delete window[k]; } catch(e) {} });
}

// ── doLogout ─────────────────────────────────────────────────────────────────
// Signs the user out of Supabase, clears all client state, resets headers,
// then calls window._onLogout() if registered (page-specific: show login screen,
// clear data arrays, etc.).
async function doLogout() {
  try {
    await fetch(SUPABASE_URL + '/auth/v1/logout', { method: 'POST', headers: HOUSING_HEADERS });
  } catch(e) {}

  _clearLocalClientState();
  window.CLFN_AUTH.clearSession();

  HOUSING_SESSION = { email: '', name: '', role: '', accessToken: '' };
  HOUSING_HEADERS['Authorization'] = 'Bearer ' + SUPABASE_ANON;

  // Notify the page — each page registers window._onLogout to handle
  // page-specific teardown (show login screen, clear data arrays, etc.)
  if (typeof window._onLogout === 'function') {
    try { window._onLogout(); } catch(e) { console.warn('[auth] _onLogout error:', e); }
  }
}
