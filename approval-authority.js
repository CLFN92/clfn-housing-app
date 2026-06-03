/**
 * approval-authority.js — CLFN Housing Suite
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Single source of truth for all approval authorities in the housing system.
 *
 * USAGE:
 *   APPROVAL_AUTHORITY.can('reviewApplication', role)    → true/false
 *   APPROVAL_AUTHORITY.who('finalApproveApp')            → ['ed']
 *   APPROVAL_AUTHORITY.get('sowEdThreshold')             → 25000
 *
 * LOADING:
 *   Defaults are defined here. At login, initApprovalAuthority() is called
 *   which merges any overrides saved in housing_settings (key: 'approval_authority')
 *   on top of the defaults, so ED changes persist across sessions.
 *
 * TO ADD A NEW AUTHORITY:
 *   1. Add a default entry below in the DEFAULTS block
 *   2. Add a row to the Settings UI in housing.html sec_approval section
 *   3. Replace inline role checks in code with APPROVAL_AUTHORITY.can(...)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

var APPROVAL_AUTHORITY = (function() {

  // ── DEFAULTS ────────────────────────────────────────────────────────────
  // These are the baseline rules. All values are overridable via Settings UI.
  // roles must match values in shared-config.js ROLE constants.

  var DEFAULTS = {

    // ── Housing Application workflow ──────────────────────────────────────
    // Who can review a submitted application (first level)
    reviewApplication:        ['housing_manager'],
    // Who can give final approval for housing
    finalApproveApp:          ['ed'],
    // Who can decline an application
    declineApplication:       ['housing_manager', 'ed'],
    // Who can return an application for more info
    returnApplication:        ['housing_manager', 'ed'],

    // ── File Update workflow ──────────────────────────────────────────────
    // File updates only need HM approval — no ED sign-off required
    reviewFileUpdate:         ['housing_manager'],
    approveFileUpdate:        ['housing_manager'],

    // ── Unit Assignment ───────────────────────────────────────────────────
    // Who can assign a unit to an applicant
    assignUnit:               ['housing_manager', 'ed'],
    // Who can override the top match recommendation
    overrideMatch:            ['ed'],
    // Who can assign within the tied score band (notes required)
    assignTiedBand:           ['housing_manager', 'ed'],
    // Who can set / edit a unit's monthly rent amount on the Inventory forms
    assignRentAmount:         ['housing_manager', 'ed'],

    // ── SOW / Renovation Budget ───────────────────────────────────────────
    // Dollar threshold — above this, ED approval required
    sowEdThreshold:           25000,
    // Who can approve SOW under the threshold
    approveSowUnderThreshold: ['housing_manager'],
    // Who can approve SOW over the threshold
    approveSowOverThreshold:  ['ed'],
    // Who can lock a completed SOW
    lockSow:                  ['ed'],

    // ── Contractor approvals ──────────────────────────────────────────────
    // Who can recommend a contractor to ED. HE-L2 included so senior
    // employees can move new contractors forward without HM having to be
    // the bottleneck — ED still owns the final approve/decline.
    recommendContractor:      ['housing_employee_l2', 'housing_manager'],
    // Who gives final contractor approval
    approveContractor:        ['ed'],
    // Who can decline a contractor
    declineContractor:        ['housing_manager', 'ed'],

    // ── Score model ───────────────────────────────────────────────────────
    // Who can edit the scoring model criteria and weights
    editScoreModel:           ['ed'],
    // Who can apply a manual score adjustment on an application
    applyScoreAdjustment:     ['ed'],

    // ── Settings & config ─────────────────────────────────────────────────
    // Who can access the Settings page
    accessSettings:           ['housing_manager', 'ed'],
    // Who can edit approval authorities (this panel)
    editApprovalAuthority:    ['ed'],
    // Who can add/edit staff
    manageStaff:              ['housing_manager', 'ed'],

    // ── Dashboard & inventory ─────────────────────────────────────────────
    // Who can access the management Dashboard view
    accessDashboard:          ['housing_manager', 'ed'],
    // Who can archive a unit (soft-delete from Inventory)
    archiveUnit:              ['ed'],

    // ── Staff management ──────────────────────────────────────────────────
    // Who can edit / deactivate an existing staff record
    manageStaffRecord:        ['ed'],
    // Who can assign / change roles for ANY staff member (vs. only HE roles)
    manageAllStaffRoles:      ['ed'],

    // ── Application visibility & scoring ──────────────────────────────────
    // Who can see the numeric application score (HE_L1 hidden by default)
    viewApplicationScore:     ['ed', 'housing_manager', 'housing_employee_l2', 'cfo', 'finance_l1'],

    // ── Renovation Progress ───────────────────────────────────────────────
    // Who can edit progress percentages and notes on a renovation
    editRenoProgress:         ['ed', 'housing_manager', 'housing_employee_l2'],

    // ── Finance module ────────────────────────────────────────────────────
    viewFinanceCard:          ['ed', 'housing_manager', 'housing_employee_l2', 'housing_employee_l1', 'cfo', 'finance_l1'],
    recordPayment:            ['housing_manager', 'cfo', 'finance_l1', 'ed'],
    createInvoice:            ['housing_manager', 'cfo', 'finance_l1', 'ed'],
    createArrangement:        ['housing_manager', 'ed'],
    manageLoan:               ['ed'],
    reverseTransaction:       ['housing_manager', 'ed'],

  };

  // ── LIVE CONFIG (defaults + any saved overrides) ──────────────────────
  var _live = JSON.parse(JSON.stringify(DEFAULTS));

  // ── PUBLIC API ────────────────────────────────────────────────────────

  return {

    /**
     * Check if a role can perform an action.
     * @param {string} action  — key from DEFAULTS
     * @param {string} role    — current role string (e.g. 'ed', 'housing_manager')
     * @returns {boolean}
     *
     * Super User inheritance: anyone with role='super_user' is treated as
     * having every grant ED has. Saved overrides can still target 'super_user'
     * explicitly to grant access to actions ED doesn't have (rare).
     */
    can: function(action, role) {
      if (!action || !role) return false;
      var allowed = _live[action];
      if (!Array.isArray(allowed)) return false;
      if (allowed.indexOf(role) !== -1) return true;
      // Super User inherits everything granted to ED. If admin later removes
      // ED's authority for an action, super_user loses it too — they're a tier.
      if (role === 'super_user' && allowed.indexOf('ed') !== -1) return true;
      return false;
    },

    /**
     * Get the list of roles allowed for an action, or a threshold value.
     * @param {string} action
     * @returns {Array|number}
     */
    get: function(action) {
      return _live[action] !== undefined ? _live[action] : null;
    },

    /**
     * Get all role-list entries (excludes numeric thresholds).
     * Used by the Settings UI to render the editor.
     * @returns {Object}
     */
    allRoleEntries: function() {
      var out = {};
      Object.keys(_live).forEach(function(k) {
        if (Array.isArray(_live[k])) out[k] = _live[k].slice();
      });
      return out;
    },

    /**
     * Get all threshold entries (numeric values).
     * @returns {Object}
     */
    allThresholds: function() {
      var out = {};
      Object.keys(_live).forEach(function(k) {
        if (typeof _live[k] === 'number') out[k] = _live[k];
      });
      return out;
    },

    /**
     * Merge saved overrides on top of defaults.
     * Called at login after housing_settings loads.
     * @param {Object} saved — parsed JSON from housing_settings 'approval_authority' key
     */
    loadOverrides: function(saved) {
      if (!saved || typeof saved !== 'object') return;
      var self = this;
      Object.keys(saved).forEach(function(k) {
        if (DEFAULTS[k] !== undefined) {
          _live[k] = saved[k];
        }
      });
      console.info('[APPROVAL_AUTHORITY] Loaded overrides:', Object.keys(saved).length, 'keys');
    },

    /**
     * Serialize current live config for saving to housing_settings.
     * Only saves keys that differ from defaults.
     * @returns {Object}
     */
    serialize: function() {
      var out = {};
      Object.keys(_live).forEach(function(k) {
        var liveVal = JSON.stringify(_live[k]);
        var defVal  = JSON.stringify(DEFAULTS[k]);
        if (liveVal !== defVal) out[k] = _live[k];
      });
      return out;
    },

    /**
     * Update a single authority entry and persist.
     * @param {string}        action  — key to update
     * @param {Array|number}  value   — new value
     */
    update: function(action, value) {
      if (DEFAULTS[action] === undefined) {
        console.warn('[APPROVAL_AUTHORITY] Unknown action:', action);
        return;
      }
      _live[action] = value;
    },

    /**
     * Reset a single entry (or all) back to defaults.
     * @param {string} [action] — omit to reset all
     */
    reset: function(action) {
      if (action) {
        _live[action] = JSON.parse(JSON.stringify(DEFAULTS[action]));
      } else {
        _live = JSON.parse(JSON.stringify(DEFAULTS));
      }
    },

    /** Expose defaults for display in Settings UI */
    defaults: DEFAULTS,

    /**
     * Returns all available roles in display order, using CLFN_PERMS if available.
     * Falls back to the known static list if shared.js hasn't loaded yet.
     */
    allRoles: function() {
      if (window.CLFN_PERMS && window.CLFN_PERMS.ROLE_LABELS) {
        return Object.keys(window.CLFN_PERMS.ROLE_LABELS).map(function(k) {
          return { value: k, label: window.CLFN_PERMS.ROLE_LABELS[k] };
        });
      }
      // Static fallback
      return [
        { value: 'ed',                  label: 'Executive Director' },
        { value: 'housing_manager',     label: 'Housing Manager' },
        { value: 'housing_employee_l2', label: 'Housing Employee L2' },
        { value: 'housing_employee_l1', label: 'Housing Employee L1' },
        { value: 'cfo',                 label: 'CFO' },
        { value: 'finance_l1',          label: 'Finance Clerk L1' },
        { value: 'super_user',          label: 'Super User' },
      ];
    },

    /** Human-readable labels for each action key */
    labels: {
      reviewApplication:        'Review submitted application',
      finalApproveApp:          'Final approval — housing application',
      declineApplication:       'Decline application',
      returnApplication:        'Return application for more info',
      reviewFileUpdate:         'Review file update',
      approveFileUpdate:        'Approve file update',
      assignUnit:               'Assign unit to applicant',
      overrideMatch:            'Override top match recommendation',
      assignTiedBand:           'Assign within tied score band',
      assignRentAmount:         'Set / edit unit rent amount',
      sowEdThreshold:           'SOW dollar threshold for ED approval ($)',
      approveSowUnderThreshold: 'Approve SOW under threshold',
      approveSowOverThreshold:  'Approve SOW over threshold',
      lockSow:                  'Lock completed SOW',
      recommendContractor:      'Approve contractor (first stage — HM)',
      approveContractor:        'Final contractor approval',
      declineContractor:        'Decline contractor',
      editScoreModel:           'Edit scoring model',
      applyScoreAdjustment:     'Apply manual score adjustment',
      accessSettings:           'Access settings page',
      editApprovalAuthority:    'Edit approval authorities',
      manageStaff:              'Add / edit staff',
      accessDashboard:          'Access Dashboard view',
      archiveUnit:              'Archive a unit',
      manageStaffRecord:        'Edit / deactivate a staff record',
      manageAllStaffRoles:      'Assign any role to staff',
      viewApplicationScore:     'View application score',
      editRenoProgress:         'Edit renovation progress',
      viewFinanceCard:          'View Financial Information Card',
      recordPayment:            'Record rent / arrangement / loan payments',
      createInvoice:            'Create invoices and charges',
      createArrangement:        'Create payment arrangements',
      manageLoan:               'Create and manage loans',
      reverseTransaction:       'Reverse posted transactions',
    },

    /** Group labels for the Settings UI sections */
    groups: {
      'Housing Application':  ['reviewApplication','finalApproveApp','declineApplication','returnApplication','viewApplicationScore'],
      'File Update':          ['reviewFileUpdate','approveFileUpdate'],
      'Unit Assignment':      ['assignUnit','overrideMatch','assignTiedBand','assignRentAmount'],
      'SOW & Renovation':     ['sowEdThreshold','approveSowUnderThreshold','approveSowOverThreshold','lockSow','editRenoProgress'],
      'Contractors':          ['recommendContractor','approveContractor','declineContractor'],
      'Scoring':              ['editScoreModel','applyScoreAdjustment'],
      'Inventory':            ['archiveUnit'],
      'Dashboard':            ['accessDashboard'],
      'System':               ['accessSettings','editApprovalAuthority','manageStaff','manageStaffRecord','manageAllStaffRoles'],
      'Finance':              ['viewFinanceCard','recordPayment','createInvoice','createArrangement','manageLoan','reverseTransaction'],
    },

  };

})();

/**
 * initApprovalAuthority()
 * Called at login after window._appSettings is populated.
 * Merges any saved overrides from housing_settings into the live config.
 */
function initApprovalAuthority() {
  try {
    var saved = window._appSettings && window._appSettings['approval_authority'];
    if (saved) {
      var parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
      APPROVAL_AUTHORITY.loadOverrides(parsed);
    }
  } catch(e) {
    console.warn('[APPROVAL_AUTHORITY] Could not load overrides:', e);
  }
}
