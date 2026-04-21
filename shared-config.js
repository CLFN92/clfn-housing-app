/* ============================================================
 * shared-config.js — CLFN Housing Suite
 * Global configuration: ROLE constants, APP_STATUS, CLFN_MODULES
 * Loaded first — all other shared files depend on this.
 * ============================================================ */

// ── Role constants ────────────────────────────────────────────────────────────
window.ROLE = {
  ED:              'ed',
  HOUSING_MANAGER: 'housing_manager',
  HE_L2:           'housing_employee_l2',
  HE_L1:           'housing_employee_l1',
  CFO:             'cfo',
  FINANCE_L1:      'finance_l1',

  // Returns true if the role has management-level access (HM or ED)
  isManagement: function(r) {
    return r === 'ed' || r === 'housing_manager';
  },

  // Returns true if the role has any housing app access
  hasAccess: function(r) {
    return r === 'ed' || r === 'housing_manager' ||
           r === 'housing_employee_l2' || r === 'housing_employee_l1';
  }
};

// ── Application status constants ──────────────────────────────────────────────
window.APP_STATUS = {
  DRAFT:       'draft',
  SUBMITTED:   'submitted',
  FILE_UPDATE: 'file_update',
  MGR_APPROVED:'mgr_approved',
  HM_APPROVED: 'hm_approved',
  ED_APPROVED: 'ed_approved',
  DECLINED:    'declined',
  RETURNED:    'returned',
  ASSIGNED:    'assigned',
  ARCHIVED:    'archived'
};

// ── Module feature flags ──────────────────────────────────────────────────────
window.CLFN_MODULES = {
  _enabled: {
    finance:     true,
    match:       true,
    contractors: true,
    renos:       true
  },
  isEnabled: function(mod) {
    return !!this._enabled[mod];
  },
  enable:  function(mod) { this._enabled[mod] = true; },
  disable: function(mod) { this._enabled[mod] = false; }
};

// ── Nation config (SaaS portability) ─────────────────────────────────────────
// Overridden per-nation in window.NATION_CONFIG if set
window.NATION_CONFIG = window.NATION_CONFIG || {
  name:       'Constance Lake First Nation',
  short:      'CLFN',
  supabaseUrl: null,  // set from housing.html / renos.html
  supabaseKey: null
};
