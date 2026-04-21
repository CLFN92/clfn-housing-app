/**
 * approval-authority.js
 * CLFN Housing — Approval Authority System
 *
 * Single source of truth for who can perform each approval action.
 * All permission gates call APPROVAL_AUTHORITY.can('actionKey', role)
 * instead of raw role === ROLE.ED / role === ROLE.HOUSING_MANAGER checks.
 *
 * Load this file BEFORE shared-data.js in housing.html and renos.html.
 * Call initApprovalAuthority() at login after window._appSettings loads.
 */

(function () {
  'use strict';

  // ── Known roles ────────────────────────────────────────────────────────────
  var ALL_ROLES = [
    'ed',
    'housing_manager',
    'housing_employee_l1'
  ];

  // ── Default authority configuration ───────────────────────────────────────
  // Each key is either:
  //   role-list  → array of role strings that may perform the action
  //   threshold  → a number used for budget/value comparisons
  var DEFAULTS = {
    // Application approval workflow
    reviewApplication:       ['housing_manager'],
    finalApproveApp:         ['ed'],
    declineApplication:      ['housing_manager', 'ed'],
    returnApplication:       ['housing_manager', 'ed'],

    // File update workflow
    reviewFileUpdate:        ['housing_manager'],
    approveFileUpdate:       ['housing_manager'],

    // Unit assignment
    assignUnit:              ['housing_manager', 'ed'],
    overrideMatch:           ['ed'],
    assignTiedBand:          ['housing_manager', 'ed'],

    // SOW & budget
    sowEdThreshold:          25000,                       // threshold (number)
    approveSowUnderThreshold:['housing_manager', 'ed'],
    approveSowOverThreshold: ['ed'],
    lockSow:                 ['ed'],

    // Contractor workflow
    recommendContractor:     ['housing_manager'],
    approveContractor:       ['ed'],
    declineContractor:       ['housing_manager', 'ed'],

    // Score model & system
    editScoreModel:          ['ed'],
    applyScoreAdjustment:    ['ed'],
    accessSettings:          ['housing_manager', 'ed'],
    editApprovalAuthority:   ['ed'],
    manageStaff:             ['housing_manager', 'ed']
  };

  // Live overrides merged from housing_settings at login
  var _overrides = {};

  /**
   * Resolve current value for an action.
   * Returns the override if one exists, otherwise the default.
   */
  function _resolve(action) {
    return Object.prototype.hasOwnProperty.call(_overrides, action)
      ? _overrides[action]
      : DEFAULTS[action];
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  var APPROVAL_AUTHORITY = {

    /**
     * can(action, role)
     * Returns true if `role` is permitted to perform `action`.
     * For threshold actions, always returns false (use .get() for comparisons).
     */
    can: function (action, role) {
      if (!action || !role) return false;
      var val = _resolve(action);
      if (typeof val === 'number') return false; // threshold — not a permission list
      if (!Array.isArray(val)) return false;
      var r = (role || '').toLowerCase().trim();
      return val.indexOf(r) !== -1;
    },

    /**
     * get(action)
     * Returns the current value for an action (array or number).
     */
    get: function (action) {
      return _resolve(action);
    },

    /**
     * loadOverrides(savedObj)
     * Merges saved overrides from housing_settings['approval_authority'].
     * Called once at login after window._appSettings is populated.
     */
    loadOverrides: function (savedObj) {
      if (!savedObj || typeof savedObj !== 'object') return;
      var self = this;
      Object.keys(savedObj).forEach(function (key) {
        if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) return;
        var def = DEFAULTS[key];
        var val = savedObj[key];
        // Validate: threshold must stay a number, role-list must stay an array
        if (typeof def === 'number' && typeof val === 'number') {
          _overrides[key] = val;
        } else if (Array.isArray(def) && Array.isArray(val)) {
          // Only allow known role strings
          var clean = val.filter(function (r) {
            return ALL_ROLES.indexOf(r) !== -1;
          });
          _overrides[key] = clean;
        }
      });
    },

    /**
     * serialize()
     * Returns a plain object suitable for saving to housing_settings.
     */
    serialize: function () {
      var out = {};
      Object.keys(_overrides).forEach(function (k) {
        out[k] = _overrides[k];
      });
      return out;
    },

    /**
     * update(action, value)
     * Updates a single action in memory (not persisted — call serialize() then sbSaveSetting()).
     */
    update: function (action, value) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULTS, action)) return;
      _overrides[action] = value;
    },

    /**
     * reset(action)
     * Removes any override for `action`, reverting to default.
     */
    reset: function (action) {
      delete _overrides[action];
    },

    /**
     * allRoles()
     * Returns all known role strings.
     */
    allRoles: function () {
      return ALL_ROLES.slice();
    },

    /**
     * allActions()
     * Returns all defined action keys.
     */
    allActions: function () {
      return Object.keys(DEFAULTS);
    },

    /**
     * isModified(action)
     * True if action has a saved override different from default.
     */
    isModified: function (action) {
      return Object.prototype.hasOwnProperty.call(_overrides, action);
    }
  };

  // Expose globally
  window.APPROVAL_AUTHORITY = APPROVAL_AUTHORITY;

})();

// ── initApprovalAuthority ─────────────────────────────────────────────────────
// Call this once at login after window._appSettings is loaded.
// Merges any saved overrides from housing_settings['approval_authority'].
function initApprovalAuthority() {
  try {
    var saved = (window._appSettings || {})['approval_authority'];
    if (saved && typeof saved === 'object') {
      APPROVAL_AUTHORITY.loadOverrides(saved);
    }
  } catch (e) {
    console.warn('[AA] initApprovalAuthority error:', e);
  }
}
