/* ============================================================
 * shared-config.js — CLFN Housing Suite
 * ⚠️  REPLACE THE SUPABASE_ANON VALUE BELOW WITH YOUR KEY
 *     From: https://supabase.com/dashboard/project/fkhzrbalumzeripzolph/settings/api
 *     Copy the "anon public" key
 * ============================================================ */

// ── Supabase connection ───────────────────────────────────────────────────────
window.SUPABASE_URL  = 'https://fkhzrbalumzeripzolph.supabase.co';
window.SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZraHpyYmFsdW16ZXJpcHpvbHBoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMTAwODYsImV4cCI6MjA5MDg4NjA4Nn0.0nazS2W-0xzxWyFOuSe2jHhamC0N2WqKgAjrlRY6NQo';

// Sentinel checked by shared-auth.js to confirm this file loaded
window.CLFN_CONFIG_LOADED = true;

// ── Role constants ────────────────────────────────────────────────────────────
window.ROLE = {
  ED:              'ed',
  HOUSING_MANAGER: 'housing_manager',
  HE_L2:           'housing_employee_l2',
  HE_L1:           'housing_employee_l1',
  CFO:             'cfo',
  FINANCE_L1:      'finance_l1',
  isManagement: function(r) {
    return r === 'ed' || r === 'housing_manager';
  },
  hasAccess: function(r) {
    return r === 'ed' || r === 'housing_manager' ||
           r === 'housing_employee_l2' || r === 'housing_employee_l1';
  }
};

// ── Application status constants ──────────────────────────────────────────────
window.APP_STATUS = {
  DRAFT:        'draft',
  SUBMITTED:    'submitted',
  FILE_UPDATE:  'file_update',
  MGR_APPROVED: 'mgr_approved',
  HM_APPROVED:  'hm_approved',
  ED_APPROVED:  'ed_approved',
  DECLINED:     'declined',
  RETURNED:     'returned',
  ASSIGNED:     'assigned',
  ARCHIVED:     'archived'
};

// ── Module feature flags ──────────────────────────────────────────────────────
window.CLFN_MODULES = {
  _enabled: { finance: true, match: true, contractors: true, renos: true },
  isEnabled: function(mod) { return !!this._enabled[mod]; },
  enable:    function(mod) { this._enabled[mod] = true; },
  disable:   function(mod) { this._enabled[mod] = false; }
};

// ── Nation config ─────────────────────────────────────────────────────────────
window.NATION_CONFIG = window.NATION_CONFIG || {
  name:  'Constance Lake First Nation',
  short: 'CLFN'
};
