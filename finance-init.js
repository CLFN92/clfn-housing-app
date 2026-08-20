// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
// ROLE SYSTEM
// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

// ROLES map — canonical role keys matching CLFN_PERMS.ROLE_LABELS.
// 'readonly' was removed in Phase F1; no viewer-only role exists yet.
var ROLES = {
  ed:                  { label:'Executive Director',  badge:'ED',          color:'#F8E41A', textColor:'#111', level:6 },
  cfo:                 { label:'CFO / Finance Dir.',  badge:'CFO',         color:'#a78bfa', textColor:'#fff', level:5 },
  housing_manager:     { label:'Housing Manager',     badge:'Manager',     color:'#34d399', textColor:'#111', level:4 },
  housing_employee_l2: { label:'Housing Employee L2', badge:'Staff L2',    color:'#60a5fa', textColor:'#fff', level:3 },
  finance_l1:          { label:'Finance Clerk',       badge:'Fin. Clerk',  color:'#fb923c', textColor:'#fff', level:2 },
  housing_employee_l1: { label:'Housing Employee L1', badge:'Staff',       color:'#94a3b8', textColor:'#fff', level:1 }
};

// Role → permission matrix for the Finance Module.
// Note: HE-L1 has NO finance access (hasFinanceAccess returns false for that
// role), so HE-L1 won't appear below. This module-access gate runs before
// any of these permission checks, so these arrays focus on the roles that
// can reach finance.html at all.
var PERMISSIONS = {
  // View
  view_tenants:        ['finance_l1','housing_employee_l2','housing_manager','cfo','ed'],
  view_ledgers:        ['finance_l1','housing_employee_l2','housing_manager','cfo','ed'],
  view_reports:        ['finance_l1','housing_employee_l2','housing_manager','cfo','ed'],
  view_audit:          ['housing_employee_l2','housing_manager','cfo','ed'],
  // Payments & invoices
  record_payment:      ['finance_l1','housing_employee_l2','housing_manager','cfo','ed'],
  create_invoice:      ['finance_l1','housing_employee_l2','housing_manager','cfo','ed'],
  void_invoice:        ['housing_employee_l2','housing_manager','cfo','ed'],
  reverse_entry:       ['housing_employee_l2','housing_manager','cfo','ed'],
  // Records
  add_tenant:          ['housing_employee_l2','housing_manager','cfo','ed'],
  edit_tenant:         ['housing_employee_l2','housing_manager','cfo','ed'],
  new_arrangement:     ['housing_manager','cfo','ed'],
  new_loan:            ['housing_manager','cfo','ed'],
  flag_collections:    ['finance_l1','housing_employee_l2','housing_manager','cfo','ed'],
  journal_entry:       ['housing_employee_l2','housing_manager','cfo','ed'],
  opening_balance:     ['housing_manager','cfo','ed'],
  // Approvals (ED/CFO only)
  approve_loan:        ['cfo','ed'],
  approve_arrangement: ['cfo','ed'],
  // Admin
  run_auto_engine:     ['housing_manager','cfo','ed'],
  export_data:         ['housing_employee_l2','housing_manager','cfo','ed']
};

// Role comes from the authenticated housing session (set during login in
// housing.html). Normalized through CLFN_PERMS so legacy role strings
// still work while the DB is transitioning.
var _currentRole = (HOUSING_SESSION && window.CLFN_PERMS.normalizeRole(HOUSING_SESSION.role)) || 'housing_employee_l1';
window.currentRole = _currentRole;

function can(permission) {
  var allowed = PERMISSIONS[permission] || [];
  return allowed.indexOf(_currentRole) >= 0;
}

// Applies the current session's role to the header UI. Called once from
// applySessionToUI() at startup. Client cannot self-switch roles; to change
// roles the user must log out and back in as a different account.
function applyBrandingToHeader() {
  var cfg = window.NATION_CONFIG;
  if (!cfg) return;
  // Logo is already baked inline — just set the brand name text
  var nameEl = document.getElementById('hdr-brand-name');
  if (nameEl) nameEl.textContent = cfg.display_short || cfg.display_name || 'Housing';
}



function applyPermissions() {
  // Show/hide nav items based on role
  var auditBtn = document.getElementById('nav-auditlog');
  if (auditBtn) auditBtn.style.display = can('view_audit') ? '' : 'none';

  // Dashboard action buttons
  var actions = {
    'modalRentPayment':     'record_payment',
    'modalNewInvoice':      'create_invoice',
    'modalNewArrangement':  'new_arrangement',
    'modalNewLoan':         'new_loan',
    'modalJournalEntry':    'journal_entry',
    'modalFlagCollections': 'flag_collections'
  };
  // Apply to dashboard action cards
  document.querySelectorAll('.action-btn-card').forEach(function(btn) {
    var onclick = btn.getAttribute('onclick') || '';
    Object.keys(actions).forEach(function(modal) {
      if (onclick.indexOf(modal) >= 0) {
        var perm = actions[modal];
        btn.style.display = can(perm) ? '' : 'none';
      }
    });
    // (auto-engine gating removed — the feature was deleted in the audit cleanup)
  });
}

// Phase F1: client-side role switcher removed. Roles come from the
// authenticated housing session only. `toggleRoleMenu` is kept as a no-op
// so any stale onclick handlers don't throw.
function toggleRoleMenu() { /* disabled in Phase F1 */ }

// \u2500\u2500 App Init \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500


// ── Page hooks for shared modules ──────────────────────────────
window._onLogout = function() {
  window.location.replace('index.html');
};
// ── Branded confirm dialog ──────────────────────────────────────────────
// Usage: showConfirm('Title', 'Message', function() { /* on confirm */ })
// Replaces all browser confirm() calls with a styled modal.
function showConfirm(title, message, onConfirm, confirmLabel, isDanger) {
  var titleEl = document.getElementById('confirm-title');
  var msgEl   = document.getElementById('confirm-message');
  var okBtn   = document.getElementById('confirm-ok-btn');
  if (!titleEl || !msgEl || !okBtn) { if (confirm(message)) onConfirm(); return; }
  titleEl.textContent = title || 'Are you sure?';
  msgEl.textContent   = message || '';
  okBtn.textContent   = confirmLabel || 'Confirm';
  okBtn.className     = 'btn ' + (isDanger === false ? 'btn-primary' : 'btn-danger');
  // Remove previous listener and attach new one
  var newBtn = okBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(newBtn, okBtn);
  newBtn.textContent = confirmLabel || 'Confirm';
  newBtn.className   = 'btn ' + (isDanger === false ? 'btn-primary' : 'btn-danger');
  newBtn.addEventListener('click', function() {
    closeModal('modalConfirm');
    onConfirm();
  });
  openModal('modalConfirm');
}

document.addEventListener('DOMContentLoaded', async function() {
  // Global error trap - surfaces crashes visibly on iPhone
  window.onerror = function(msg, src, line, col, err) {
    var div = document.createElement('div');
    div.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#dc2626;color:#fff;padding:12px 16px;font-size:13px;z-index:99999;font-family:monospace;white-space:pre-wrap;';
    div.textContent = 'JS ERROR:\n' + msg + '\nLine: ' + line + ' Col: ' + col + '\nFile: ' + (src||'').split('/').pop();
    document.body.appendChild(div);
    return false;
  };
  try {
    applyPermissions();

    // Phase F3: hydrate _memStore from Supabase before the first render.
    // Every getData() call after this returns real data instead of an empty shell.
    // seedIfEmpty() is a no-op in F3 — real tenants come from the housing→tenants
    // trigger-sync installed by the F2 migration.
    await _bootLoadFinanceData();

    // Populate avatar initials + role badge now that HOUSING_SESSION is confirmed.
    // Other pages do this in their -init.js boot hooks; finance.html does it here.
    if (typeof updateHeaderUser === 'function') updateHeaderUser(_currentRole);
    if (typeof applyRoleVisibility === 'function') applyRoleVisibility(_currentRole);

    // In-memory fix for legacy journal entries loaded with status='posted'
    // (old _journalFromRow default before encoded-reference was introduced).
    // Any entry with reference='' (decoded from null) and no approvedBy is
    // assumed to still be pending-ed. New saves will persist status correctly.
    // Legacy journal status fix removed — _journalFromRow now correctly
    // decodes status from the encoded reference column ('status|groupRef').
    // Old entries with reference=null decode as 'posted' which is correct
    // (they predate the multi-line JE feature and have no pending status).

    // Check for ?fic=tenantId URL param (e.g. navigated from TIC Finance Card button)
    var _ficParam = new URLSearchParams(window.location.search).get('fic');
    if (_ficParam && typeof openFinanceCard === 'function') {
      showPage('home');
      initTenantSelects();
      openFinanceCard(_ficParam);
    } else {
      showPage('home');
      initTenantSelects();
    }
  document.addEventListener('click', function(e) {
    if (!e.target.closest('.search-wrap') && !e.target.closest('.tenant-search-results')) {
      document.querySelectorAll('.tenant-search-results').forEach(function(el){
        el.style.display = 'none';
        el.innerHTML = ''; // clear content so nothing bleeds through
      });
      // Also clear the dash search input text
      var di = document.getElementById('dashTenantSearch');
      if (di && di.value) { /* leave value, just hide results */ }
    }
  });
  } catch(e) {
    window.onerror(e.message, '', 0, 0, e);
  }
});

