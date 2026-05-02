/* ============================================================
 * shared-config.js — CLFN Housing Suite
 * ⚠️  REPLACE THE SUPABASE_ANON VALUE BELOW WITH YOUR KEY
 *     From: https://supabase.com/dashboard/project/fkhzrbalumzeripzolph/settings/api
 *     Copy the "anon public" key
 * ============================================================ */

// ── Supabase connection ───────────────────────────────────────────────────────
window.SUPABASE_URL    = 'https://fkhzrbalumzeripzolph.supabase.co';
window.SUPABASE_ANON   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZraHpyYmFsdW16ZXJpcHpvbHBoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMTAwODYsImV4cCI6MjA5MDg4NjA4Nn0.0nazS2W-0xzxWyFOuSe2jHhamC0N2WqKgAjrlRY6NQo';
// Storage bucket for tenant files, photos, contractor docs, SOW attachments.
// Required by SbStorage helpers and the DocLibrary factory.
window.STORAGE_BUCKET  = 'housing-files';

// Sentinel checked by shared-auth.js to confirm this file loaded
window.CLFN_CONFIG_LOADED = true;

// ── Application Form: configurable required fields ────────────────────────────
// Single source of truth for fields the ED can flip required-on/off from
// Settings → App Settings → Required Fields. The registry IS the schema —
// add a new entry to make a field configurable.
//
// Two kinds of entries:
//   • Static fields  — referenced via data-req="<id>" on the .f wrapper in
//                      housing.html. Validator looks up the input by id.
//   • Dynamic-row    — fields inside .rrow templates (Household, References,
//     fields           Pets, Income). `rowOf` is the container selector,
//                      `dataRole` is the data-role attribute on the input.
//                      Validators iterate rows and only enforce the row when
//                      the user has started filling it in (any field truthy).
//
// Each entry's `step` matches the form's #stepN id so the panel can group by
// page and validators can scope to their step.
window.APP_REQ_FIELDS = [
  // ─── Step 0: Applicant Information ───────────────────────────────────────
  { id:'fn',             step:0, label:'First Name',              defaultRequired: true,  errorLabel:'First name is required.' },
  { id:'ln',             step:0, label:'Last Name',               defaultRequired: true,  errorLabel:'Last name is required.' },
  { id:'dob',            step:0, label:'Date of Birth',           defaultRequired: true,  errorLabel:'Date of birth is required.' },
  { id:'reserve',        step:0, label:'On Reserve Status',       defaultRequired: true,  errorLabel:'On Reserve status is required.' },
  { id:'marital',        step:0, label:'Marital Status',          defaultRequired: true,  errorLabel:'Marital status is required.' },
  { id:'phone',          step:0, label:'Cell Phone',              defaultRequired: true,  errorLabel:'Cell phone number is required.' },
  { id:'email',          step:0, label:'Email',                   defaultRequired: true,  errorLabel:'Email address is required.' },
  { id:'classification', step:0, label:'Housing Classification',  defaultRequired: true,  errorLabel:'Housing Classification is required.' },
  { id:'street',         step:0, label:'Street Address',          defaultRequired: true,  errorLabel:'Street address is required.' },
  { id:'city',           step:0, label:'City',                    defaultRequired: true,  errorLabel:'City is required.' },
  { id:'prov',           step:0, label:'Province',                defaultRequired: true,  errorLabel:'Province is required.' },
  { id:'postal',         step:0, label:'Postal Code',             defaultRequired: true,  errorLabel:'Postal code is required.' },
  { id:'occDate',        step:0, label:'Expected Occupancy Date', defaultRequired: true,  errorLabel:'Expected occupancy date is required.' },
  // ─── Step 1: Employment & Income (per row in #incomeList) ────────────────
  { id:'inc_person',    step:1, rowOf:'#incomeList', dataRole:'person',    label:'Person',           defaultRequired: true,  errorLabel:'Income record: person is required.' },
  { id:'inc_type',      step:1, rowOf:'#incomeList', dataRole:'incType',   label:'Income Type',      defaultRequired: false, errorLabel:'Income record: income type is required.' },
  { id:'inc_empStatus', step:1, rowOf:'#incomeList', dataRole:'empStatus', label:'Employment Status',defaultRequired: false, errorLabel:'Income record: employment status is required.' },
  // ─── Step 2: Co-Applicant (only enforced when co_status==='yes') ─────────
  { id:'co_fn',      step:2, label:'Co-Applicant First Name',     defaultRequired: true,  errorLabel:'Co-applicant first name is required.' },
  { id:'co_ln',      step:2, label:'Co-Applicant Last Name',      defaultRequired: true,  errorLabel:'Co-applicant last name is required.' },
  { id:'co_dob',     step:2, label:'Co-Applicant Date of Birth',  defaultRequired: true,  errorLabel:'Co-applicant date of birth is required.' },
  { id:'co_reserve', step:2, label:'Co-Applicant Reserve Status', defaultRequired: true,  errorLabel:'Co-applicant reserve status is required.' },
  { id:'co_cell',    step:2, label:'Co-Applicant Cell Phone',     defaultRequired: true,  errorLabel:'Co-applicant cell phone is required.' },
  { id:'co_email',   step:2, label:'Co-Applicant Email',          defaultRequired: true,  errorLabel:'Co-applicant email is required.' },
  { id:'coOccDate',  step:2, label:'Co-Applicant Occupancy Date', defaultRequired: true,  errorLabel:'Co-applicant occupancy start date is required.' },
  // ─── Step 3: Household Members (per row in #habList) ─────────────────────
  { id:'hab_fn',  step:3, rowOf:'#habList', dataRole:'habFn',  label:'First Name',     defaultRequired: true,  errorLabel:'Household member: first name is required.' },
  { id:'hab_ln',  step:3, rowOf:'#habList', dataRole:'habLn',  label:'Last Name',      defaultRequired: true,  errorLabel:'Household member: last name is required.' },
  { id:'hab_dob', step:3, rowOf:'#habList', dataRole:'habDob', label:'Date of Birth',  defaultRequired: true,  errorLabel:'Household member: date of birth is required.' },
  { id:'hab_rel', step:3, rowOf:'#habList', dataRole:'habRel', label:'Relationship',   defaultRequired: true,  errorLabel:'Household member: relationship is required.' },
  // ─── Step 4: References (per row in #refList) ────────────────────────────
  { id:'ref_fn',    step:4, rowOf:'#refList', dataRole:'refFn',    label:'First Name',    defaultRequired: true,  errorLabel:'Reference: first name is required.' },
  { id:'ref_ln',    step:4, rowOf:'#refList', dataRole:'refLn',    label:'Last Name',     defaultRequired: true,  errorLabel:'Reference: last name is required.' },
  { id:'ref_rel',   step:4, rowOf:'#refList', dataRole:'refRel',   label:'Relationship',  defaultRequired: true,  errorLabel:'Reference: relationship is required.' },
  { id:'ref_phone', step:4, rowOf:'#refList', dataRole:'refPhone', label:'Phone',         defaultRequired: true,  errorLabel:'Reference: phone is required.' },
  { id:'ref_email', step:4, rowOf:'#refList', dataRole:'refEmail', label:'Email',         defaultRequired: false, errorLabel:'Reference: email is required.' },
  // ─── Step 5: Pets (per row in #petList) ──────────────────────────────────
  { id:'pet_name', step:5, rowOf:'#petList', dataRole:'petName', label:'Pet Name', defaultRequired: true,  errorLabel:'Pet: name is required.' },
  { id:'pet_type', step:5, rowOf:'#petList', dataRole:'petType', label:'Pet Type', defaultRequired: true,  errorLabel:'Pet: type is required.' },
  { id:'pet_size', step:5, rowOf:'#petList', dataRole:'petSize', label:'Size',     defaultRequired: true,  errorLabel:'Pet: size is required.' }
];

// Section-level toggles for dynamic-row steps. Controls whether a step
// requires AT LEAST ONE row. Persisted alongside the field config in
// housing_settings.required_fields under the same object.
window.APP_REQ_SECTIONS = [
  { id:'sec_step1', step:1, label:'At least one Income record required',     defaultRequired: false, errorLabel:'At least one income record is required.' },
  { id:'sec_step3', step:3, label:'At least one Household Member required',  defaultRequired: false, errorLabel:'At least one household member is required.' },
  { id:'sec_step4', step:4, label:'At least one Reference required',         defaultRequired: true,  errorLabel:'At least one reference is required.' },
  { id:'sec_step5', step:5, label:'At least one Pet required',               defaultRequired: false, errorLabel:'At least one pet is required.' }
];

// Display order + labels for step sub-tabs inside the Required Fields panel
window.APP_REQ_STEPS = [
  { step:0, label:'Applicant Information' },
  { step:1, label:'Employment & Income'   },
  { step:2, label:'Co-Applicant'          },
  { step:3, label:'Household Members'     },
  { step:4, label:'References'            },
  { step:5, label:'Pets'                  }
];

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

// ── Forced department by role ────────────────────────────────────────────────
// Some roles are tied to a specific department regardless of what the user
// chose in the staff form. Used in staff add/edit flows to override the
// dept dropdown so the staff row matches what sbMapRole expects on read.
//   var staffDept = ROLE_FORCED_DEPT[role] || chosenDept;
window.ROLE_FORCED_DEPT = {
  housing_manager:     'Housing',
  housing_employee_l2: 'Housing',
  housing_employee_l1: 'Housing',
  cfo:                 'Finance',
  finance_l1:          'Finance'
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

// ── Super-user identity ──────────────────────────────────────────────────────
// Platform / app-owner identities. These users see super-user-only controls
// (e.g. the module enable/disable toggles in Settings → Nation). Anyone else
// sees those panels read-only.
//
// This is a UX boundary, not a security boundary — Supabase RLS still governs
// what any session can actually write. For real subscription enforcement, swap
// to a `staff.is_super_user` boolean column + matching RLS policy.
window.CLFN_SUPER_USERS = [
  'kevin.proctor@clfn.on.ca'
];
window.isSuperUser = function() {
  var email = (window.HOUSING_SESSION && HOUSING_SESSION.email || '').toLowerCase();
  return window.CLFN_SUPER_USERS.map(function(e){ return e.toLowerCase(); }).indexOf(email) !== -1;
};

// ── Module feature flags ──────────────────────────────────────────────────────
// Two-layer enablement so subscription billing can be enforced separately from
// the customer-side on/off toggle:
//   _licensed[mod]  — set by the platform owner; reflects subscription status.
//                     Non-super-users cannot change this.
//   _enabled[mod]   — set by the super user via the Settings UI; reflects
//                     whether this nation has the module turned on right now.
//
// isEnabled(mod) returns true only if BOTH are true (or the module is CORE).
// Defaults below assume "all licensed, all on" for the lead nation; runtime
// hydration via initModuleEnablement() merges saved overrides from
// housing_settings (key: 'module_enablement').
window.CLFN_MODULES = {
  CORE: ['applications', 'inventory', 'tenants', 'worklist'],
  _enabled:  { finance: true, match: true, contractors: true, renovations: true },
  _licensed: { finance: true, match: true, contractors: true, renovations: true },

  isEnabled: function(mod) {
    if(this.CORE.indexOf(mod) !== -1) return true;
    return !!this._enabled[mod] && !!this._licensed[mod];
  },
  isLicensed: function(mod) {
    if(this.CORE.indexOf(mod) !== -1) return true;
    return !!this._licensed[mod];
  },
  enable:       function(mod) { this._enabled[mod] = true; },
  disable:      function(mod) { this._enabled[mod] = false; },
  setLicensed:  function(mod, val) { this._licensed[mod] = !!val; },
  listOptional: function() { return Object.keys(this._enabled); },

  // Apply saved overrides on top of defaults. Called at login with the parsed
  // value of housing_settings['module_enablement'].
  loadOverrides: function(saved) {
    if(!saved || typeof saved !== 'object') return;
    var self = this;
    if(saved._enabled && typeof saved._enabled === 'object'){
      Object.keys(saved._enabled).forEach(function(k){
        if(self._enabled[k] !== undefined) self._enabled[k] = !!saved._enabled[k];
      });
    }
    if(saved._licensed && typeof saved._licensed === 'object'){
      Object.keys(saved._licensed).forEach(function(k){
        if(self._licensed[k] !== undefined) self._licensed[k] = !!saved._licensed[k];
      });
    }
  },
  // Serialize current state for persisting back to housing_settings.
  serialize: function() {
    return { _enabled: Object.assign({}, this._enabled), _licensed: Object.assign({}, this._licensed) };
  }
};

// initModuleEnablement() — called at login alongside initApprovalAuthority().
// Reads the saved overrides from window._appSettings and applies them.
function initModuleEnablement() {
  try {
    var saved = window._appSettings && window._appSettings['module_enablement'];
    if(!saved) return;
    var parsed = (typeof saved === 'string') ? JSON.parse(saved) : saved;
    window.CLFN_MODULES.loadOverrides(parsed);
    console.info('[CLFN_MODULES] Loaded saved enablement overrides.');
  } catch(e) {
    console.warn('[CLFN_MODULES] Could not load saved overrides:', e);
  }
}

// ── Nation config ─────────────────────────────────────────────────────────────
// Per-nation branding + display overrides. The role *keys* ('ed',
// 'housing_manager', etc.) are stable identifiers across all nations — only
// the human-readable display strings change. Add `role_labels` here to
// override any subset of the defaults from CLFN_PERMS.ROLE_LABELS for this
// nation. Example for a nation that calls their ED "Lands Director":
//   role_labels: { ed: 'Lands Director', housing_manager: 'Housing Lead' }
window.NATION_CONFIG = window.NATION_CONFIG || {
  id:           'clfn',
  name:         'Constance Lake First Nation',
  display_name: 'Constance Lake First Nation',
  short:        'CLFN',
  role_labels:  {} // empty for CLFN — defaults from CLFN_PERMS.ROLE_LABELS apply
};
