/* ============================================================
 * shared-config.js — CLFN Housing Suite
 * ⚠️  REPLACE THE SUPABASE_ANON VALUE BELOW WITH YOUR KEY
 *     From: https://supabase.com/dashboard/project/fkhzrbalumzeripzolph/settings/api
 *     Copy the "anon public" key
 * ============================================================ */

// ── Multi-nation directory + resolver ─────────────────────────────────────────
// The platform serves multiple First Nations from one deployment. Each nation
// maps a hostname (subdomain) to its OWN Supabase project + branding + licensed
// modules — data is physically isolated per nation (database-per-nation). Anon
// keys are *publishable*, so shipping this client-side is safe. The lead nation
// (CLFN) is `_default`, used for localhost / preview / any unmapped host, so
// existing behaviour is unchanged until other nations are added here.
//   • Add a nation → add an entry keyed by its full hostname and/or subdomain.
//   • This object can later be replaced by a fetched `nations.json` (same shape)
//     without touching the resolver. See PLAN.md "Multi-Nation" phase.
window.NATIONS_DIRECTORY = window.NATIONS_DIRECTORY || {
  _default: {
    id:            'clfn',
    display_name:  'Constance Lake First Nation',
    short:         'CLFN',
    supabase_url:  'https://fkhzrbalumzeripzolph.supabase.co',
    supabase_anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZraHpyYmFsdW16ZXJpcHpvbHBoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMTAwODYsImV4cCI6MjA5MDg4NjA4Nn0.0nazS2W-0xzxWyFOuSe2jHhamC0N2WqKgAjrlRY6NQo',
    role_labels:   {},
    email_domain:  'clfn.on.ca',          // staff email domain gate (@<domain> checks)
    housing_email: 'housing@clfn.on.ca',  // the nation's housing dept mailbox (AP/manager defaults)
    modules_licensed: null   // null → all optional modules licensed (defaults apply)
  }
  // Example additional nation (one entry per hostname AND/OR subdomain label):
  // 'nation2.housingapp.ca': {
  //   id:'nation2', display_name:'Second Nation', short:'N2',
  //   supabase_url:'https://xxxxxxxx.supabase.co', supabase_anon:'<publishable anon key>',
  //   role_labels:{}, modules_licensed:{ finance:false, match:true }
  // }
};
window.resolveNation = function(){
  var host = (typeof location !== 'undefined' && location.hostname || '').toLowerCase();
  var dir  = window.NATIONS_DIRECTORY || {};
  var sub  = host.split('.')[0];               // leftmost label, e.g. "clfn" in clfn.app.ca
  return dir[host] || dir[sub] || dir._default || null;
};
window._NATION = window.resolveNation();

// ── Supabase connection (resolved per nation) ─────────────────────────────────
window.SUPABASE_URL    = (window._NATION && window._NATION.supabase_url)  || 'https://fkhzrbalumzeripzolph.supabase.co';
window.SUPABASE_ANON   = (window._NATION && window._NATION.supabase_anon) || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZraHpyYmFsdW16ZXJpcHpvbHBoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMTAwODYsImV4cCI6MjA5MDg4NjA4Nn0.0nazS2W-0xzxWyFOuSe2jHhamC0N2WqKgAjrlRY6NQo';
// Storage bucket for tenant files, photos, contractor docs, SOW attachments.
// Required by SbStorage helpers and the DocLibrary factory.
window.STORAGE_BUCKET  = 'housing-files';

// Sentinel checked by shared-auth.js to confirm this file loaded
window.CLFN_CONFIG_LOADED = true;

// ── Email pipeline reference (display-only) ──────────────────────────────────
// Mirror of the non-secret GRAPH_* values configured as Supabase Edge
// Function secrets. Shown in Settings -> Admin -> Config so an admin can
// verify what's configured without opening the Supabase Dashboard.
// CLIENT_SECRET deliberately omitted - it's a secret and never leaves
// Supabase's secrets storage. Update these constants if the Entra app
// registration or shared mailbox changes; the actual sending continues
// to read from the Edge Function env vars.
window.CLFN_GRAPH_CONFIG = {
  tenantId: '603975c1-4d60-4e17-80bd-61a2b2bb721a',  // CLFN Entra tenant
  clientId: 'fba694aa-791a-4aa4-aeef-f7ce3a1505cb',  // "CLFN Housing App - Notifications" app
  fromUser: 'housing@clfn.on.ca',                      // Shared mailbox sent items appear here
  appName:  'CLFN Housing App - Notifications',
  replyTo:  'housing@clfn.on.ca'
};

// ── Build-time fallback logo ────────────────────────────────────────────────
// Used when no theme.logo override is saved in housing_settings. Lives here
// (loaded on every page) so the login screen, the shared header, and any
// future per-page logo placeholder all read from a single source of truth.
// Per-nation overrides will eventually come from NATION_CONFIG.logo (Phase A
// multi-nation work); _applyTheme already rewrites every img.hlogo src when a
// theme.logo override exists in settings.
window.CLFN_LOGO_DATA_URL = "data:image/png;base64,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";

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
  FIELD_EMPLOYEE:  'field_employee',
  CFO:             'cfo',
  FINANCE_L1:      'finance_l1',
  SUPER_USER:      'super_user',
  isManagement: function(r) {
    return r === 'ed' || r === 'housing_manager' || r === 'super_user';
  },
  hasAccess: function(r) {
    return r === 'ed' || r === 'housing_manager' || r === 'super_user' ||
           r === 'housing_employee_l2' || r === 'housing_employee_l1' ||
           r === 'field_employee';
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
  field_employee:      'Housing',
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
  // Role-based super-user wins — anyone in the staff table with
  // role='super_user' is treated as a super user regardless of email.
  // The email allowlist is kept as a bootstrap (so the platform owner can
  // promote new super users without being one themselves yet).
  var sess = window.HOUSING_SESSION || {};
  var role = (sess.role || window._realRole || '').toLowerCase();
  if (role === 'super_user') return true;
  var email = (sess.email || '').toLowerCase();
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
  _enabled:  { finance: true, match: true, contractors: true, renovations: true, rfq: true, mapping: true, ai_assistant: true, inspections: true },
  _licensed: { finance: true, match: true, contractors: true, renovations: true, rfq: true, mapping: true, ai_assistant: true, inspections: true },

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
    // Mark hydrated as soon as settings are available, even if this nation
    // never saved an override (so moduleOn() doesn't re-hydrate every call).
    if(window._appSettings) window._moduleEnablementHydrated = true;
    var saved = window._appSettings && window._appSettings['module_enablement'];
    if(!saved) return;
    var parsed = (typeof saved === 'string') ? JSON.parse(saved) : saved;
    window.CLFN_MODULES.loadOverrides(parsed);
    console.info('[CLFN_MODULES] Loaded saved enablement overrides.');
  } catch(e) {
    console.warn('[CLFN_MODULES] Could not load saved overrides:', e);
  }
}

// moduleOn(mod) — convenience gate used by feature entry points across pages.
// Only housing.html calls initModuleEnablement() at login; sub-pages (renos,
// inventory, tenants, rfq) load _appSettings without hydrating CLFN_MODULES, so
// this lazily applies the saved overrides on first use. Defaults to true if the
// registry isn't available yet (fail open — never hide a feature on error).
window.moduleOn = function(mod) {
  if(!window._moduleEnablementHydrated && window._appSettings && typeof initModuleEnablement === 'function'){
    try { initModuleEnablement(); } catch(e) {}
  }
  try { return !window.CLFN_MODULES || window.CLFN_MODULES.isEnabled(mod); }
  catch(e) { return true; }
};

// ── Nation config ─────────────────────────────────────────────────────────────
// Per-nation branding + display overrides. The role *keys* ('ed',
// 'housing_manager', etc.) are stable identifiers across all nations — only
// the human-readable display strings change. Add `role_labels` here to
// override any subset of the defaults from CLFN_PERMS.ROLE_LABELS for this
// nation. Example for a nation that calls their ED "Lands Director":
//   role_labels: { ed: 'Lands Director', housing_manager: 'Housing Lead' }
// `email_domain` is the nation's staff email domain (drives the "@<domain>"
// placeholder/validation gates via nationEmailDomain()); `housing_email` is the
// nation's housing-department mailbox (AP-email / manager_email defaults). Both
// come from the NATIONS_DIRECTORY entry (see _default for CLFN's values).
// Built from the resolved nation (window._NATION); falls back to CLFN so the
// lead nation is byte-identical. Per-nation overrides from housing_settings
// (nation_config_override) are still merged on top at login via
// applyNationOverrides().
window.NATION_CONFIG = window.NATION_CONFIG || (function(){
  var n = window._NATION || {};
  var disp = n.display_name || 'Constance Lake First Nation';
  return {
    id:           n.id    || 'clfn',
    name:         disp,
    display_name: disp,
    short:        n.short || 'CLFN',
    role_labels:  n.role_labels || {}, // empty for CLFN — CLFN_PERMS.ROLE_LABELS defaults apply
    email_domain:  n.email_domain  || 'clfn.on.ca',
    housing_email: n.housing_email || 'housing@clfn.on.ca'
  };
})();

// Apply per-nation module licensing from the directory (which paid-for modules
// this nation has). null → leave the all-licensed defaults in place.
(function(){
  var lic = window._NATION && window._NATION.modules_licensed;
  if(lic && typeof lic === 'object' && window.CLFN_MODULES && window.CLFN_MODULES._licensed){
    Object.keys(lic).forEach(function(k){
      if(window.CLFN_MODULES._licensed[k] !== undefined) window.CLFN_MODULES._licensed[k] = !!lic[k];
    });
  }
})();
window.CLFN_DEBUG = false;

// ── Renovation / scoring model defaults (single source of truth) ──────────────
// Previously duplicated in scoring.js AND renos.html and had DRIFTED (the reno
// 'Request Scope' labels differed). Consolidated here because shared-config.js is
// the ONE file loaded on EVERY page (scoring.js and shared-sow.js are not), so all
// consumers -- shared-data.js getUnitScoreModel/calcRenoScore, housing-modals-sow.js,
// and renos.html -- resolve the same definitions. Do NOT re-declare these elsewhere.

var DEFAULT_UNIT_SCORE_MODEL = [
  {id:'bed_exact',   factor:'Bedroom Fit',       condition:'Exact match',             pts:10, max:10, group:'bed', editable:true,  notes:'Unit bedrooms = household need'},
  {id:'bed_larger',  factor:'Bedroom Fit',       condition:'Larger than needed',      pts:5,  max:10, group:'bed', editable:true,  notes:'Unit has more beds than needed'},
  {id:'bed_one_short',factor:'Bedroom Fit',      condition:'One bedroom short',       pts:3,  max:10, group:'bed', editable:true,  notes:'Unit is 1 bed under household need'},
  {id:'bed_insuff',  factor:'Bedroom Fit',       condition:'Insufficient bedrooms',   pts:0,  max:10, group:'bed', editable:false, notes:'2+ beds under need (no points)'},
  {id:'acc_met',     factor:'Accessibility',     condition:'Need met by unit',        pts:8,  max:8,  group:'acc', editable:true,  notes:'Applicant needs accessible unit and unit qualifies'},
  {id:'acc_unmet',   factor:'Accessibility',     condition:'Need not met (penalty)',  pts:-4, max:8,  group:'acc', editable:true,  notes:'Applicant needs accessible unit but unit does not qualify'},
  {id:'acc_na',      factor:'Accessibility',     condition:'Not required',            pts:0,  max:8,  group:'acc', editable:false, notes:'No accessibility need'},
  {id:'eld_matched', factor:'Elders Eligibility',condition:'Eligible + Elders unit',  pts:6,  max:6,  group:'eld', editable:true,  notes:'Applicant is 55+ and unit is Elders Unit'},
  {id:'eld_ineligible',factor:'Elders Eligibility',condition:'Not eligible (penalty)',pts:-2, max:6,  group:'eld', editable:true,  notes:'Applicant under 55 but unit is Elders Unit'},
  {id:'eld_standard',factor:'Elders Eligibility',condition:'Eligible, standard unit', pts:0,  max:6,  group:'eld', editable:false, notes:'Applicant is 55+ but standard unit'},
  {id:'eld_na',      factor:'Elders Eligibility',condition:'Not applicable',           pts:0,  max:6,  group:'eld', editable:false, notes:'Applicant under 55, standard unit'},
];

var DEFAULT_RENO_SCORE_MODEL = [
  // Unit Condition (from unit record)
  {id:'rs_cond_critical', group:'condition', factor:'Unit Condition', condition:'Condemned / Critical',         pts:20, editable:true,  notes:'Unit status is condemned'},
  {id:'rs_cond_poor',     group:'condition', factor:'Unit Condition', condition:'Poor — major repairs needed',  pts:15, editable:true,  notes:'Home condition rated Poor'},
  {id:'rs_cond_average',  group:'condition', factor:'Unit Condition', condition:'Average — minor wear',         pts:8,  editable:true,  notes:'Home condition rated Average'},
  {id:'rs_cond_good',     group:'condition', factor:'Unit Condition', condition:'Good — well maintained',       pts:2,  editable:true,  notes:'Home condition rated Good'},
  // Critical Systems (from SOW line items — additive, each system that appears in SOW adds points)
  {id:'rs_sys_furnace',   group:'systems',   factor:'Critical Systems (additive)', condition:'Furnace / Heating system',      pts:14, editable:true,  notes:'SOW contains Heating / HVAC work'},
  {id:'rs_sys_hvac',      group:'systems',   factor:'Critical Systems (additive)', condition:'HVAC / Ventilation',            pts:12, editable:true,  notes:'SOW contains HVAC / Ventilation work'},
  {id:'rs_sys_electrical',group:'systems',   factor:'Critical Systems (additive)', condition:'Electrical system',             pts:13, editable:true,  notes:'SOW contains Electrical work'},
  {id:'rs_sys_roof',      group:'systems',   factor:'Critical Systems (additive)', condition:'Roof replacement / repair',     pts:15, editable:true,  notes:'SOW contains Roofing work'},
  {id:'rs_sys_windows',   group:'systems',   factor:'Critical Systems (additive)', condition:'Exterior windows & doors',      pts:10, editable:true,  notes:'SOW contains Windows & Doors work'},
  // SOW Cost (from Scope of Work)
  {id:'rs_cost_5',        group:'cost',      factor:'SOW Est. Cost',  condition:'$50,000+',                    pts:18, editable:true,  notes:'Major renovation — highest urgency'},
  {id:'rs_cost_4',        group:'cost',      factor:'SOW Est. Cost',  condition:'$25,001 – $50,000',           pts:14, editable:true,  notes:'Significant renovation'},
  {id:'rs_cost_3',        group:'cost',      factor:'SOW Est. Cost',  condition:'$10,001 – $25,000',           pts:10, editable:true,  notes:'Moderate renovation'},
  {id:'rs_cost_2',        group:'cost',      factor:'SOW Est. Cost',  condition:'$2,501 – $10,000',            pts:5,  editable:true,  notes:'Minor repairs'},
  {id:'rs_cost_1',        group:'cost',      factor:'SOW Est. Cost',  condition:'$0 – $2,500',                 pts:2,  editable:true,  notes:'Routine maintenance'},
  // Health & Safety Concerns (from SOW checkboxes — each adds points, higher = more urgent)
  {id:'rs_haz_mold',      group:'hazard',    factor:'Health & Safety Concerns (additive)', condition:'Mould / Mildew',              pts:8,  editable:true,  notes:'Health risk — increases reno urgency'},
  {id:'rs_haz_asbestos',  group:'hazard',    factor:'Health & Safety Concerns (additive)', condition:'Asbestos Risk',               pts:12, editable:true,  notes:'Serious health hazard — high urgency'},
  {id:'rs_haz_electrical',group:'hazard',    factor:'Health & Safety Concerns (additive)', condition:'Electrical Hazard',           pts:10, editable:true,  notes:'Fire/safety risk — high urgency'},
  {id:'rs_haz_structural',group:'hazard',    factor:'Health & Safety Concerns (additive)', condition:'Structural Concern',          pts:10, editable:true,  notes:'Structural failure risk — high urgency'},
  {id:'rs_haz_plumbing',  group:'hazard',    factor:'Health & Safety Concerns (additive)', condition:'Plumbing/Sewage',             pts:7,  editable:true,  notes:'Health/sanitation risk'},
  {id:'rs_haz_fire',      group:'hazard',    factor:'Health & Safety Concerns (additive)', condition:'Fire Safety',                 pts:12, editable:true,  notes:'Fire safety risk — high urgency'},
  // SOW Scope (number of line items — additive)
  {id:'rs_items_5',       group:'scope',     factor:'Request Scope',      condition:'10+ work items',              pts:8,  editable:true,  notes:'Very broad scope'},
  {id:'rs_items_4',       group:'scope',     factor:'Request Scope',      condition:'6 – 9 work items',            pts:5,  editable:true,  notes:'Broad scope'},
  {id:'rs_items_3',       group:'scope',     factor:'Request Scope',      condition:'3 – 5 work items',            pts:3,  editable:true,  notes:'Moderate scope'},
  {id:'rs_items_2',       group:'scope',     factor:'Request Scope',      condition:'1 – 2 work items',            pts:1,  editable:true,  notes:'Targeted repair'},
  {id:'rs_items_1',       group:'scope',     factor:'Request Scope',      condition:'No request filed',                pts:0,  editable:false, notes:'No maintenance request submitted'},
  // Occupancy impact
  {id:'rs_occ_displaced', group:'occupancy', factor:'Occupancy',      condition:'Tenant displaced (under repair)', pts:10, editable:true,  notes:'Unit status is under_repair with tenant'},
  {id:'rs_occ_condemned', group:'occupancy', factor:'Occupancy',      condition:'Condemned — uninhabitable',   pts:12, editable:true,  notes:'Unit is condemned'},
  {id:'rs_occ_vacant',    group:'occupancy', factor:'Occupancy',      condition:'Vacant — no tenant impact',   pts:3,  editable:true,  notes:'Unit is vacant'},
  {id:'rs_occ_occupied',  group:'occupancy', factor:'Occupancy',      condition:'Occupied — tenant in place',  pts:0,  editable:false, notes:'Active tenant — lower urgency'},
  // Tenant Accountability — Damage & Conduct (increases urgency — unit needs repair because of tenant)
  {id:'rs_ten_damage',    group:'conduct',   factor:'Tenant Conduct — Damage (additive)', condition:'Damage caused by tenant',     pts:-12, editable:true,  notes:'Tenant caused damage — reduces reno priority'},
  {id:'rs_ten_negligence',group:'conduct',   factor:'Tenant Conduct — Damage (additive)', condition:'Negligence (failure to maintain/report)', pts:-10, editable:true, notes:'Failure to maintain or report — reduces priority'},
  {id:'rs_ten_vandalism', group:'conduct',   factor:'Tenant Conduct — Damage (additive)', condition:'Vandalism',                   pts:-15, editable:true,  notes:'Intentional damage — tenant liability reduces priority'},
  {id:'rs_ten_police',    group:'conduct',   factor:'Tenant Conduct — Damage (additive)', condition:'Police report on file',       pts:-5,  editable:true,  notes:'Police involvement — reduces reno priority'},
  // Tenant Arrears — mirrors housing app scoring but as penalty (negative points = lower priority)
  // A payment plan reduces the penalty, mirroring the payment arrangement bonus in the housing app
  {id:'rs_arr_0',         group:'arrears',   factor:'Tenant Arrears',  condition:'$0 — no arrears',             pts:0,  editable:false, notes:'No arrears — no impact on score'},
  {id:'rs_arr_1',         group:'arrears',   factor:'Tenant Arrears',  condition:'$1 – $500',                   pts:0,  editable:true,  notes:'Minor arrears — no penalty'},
  {id:'rs_arr_2',         group:'arrears',   factor:'Tenant Arrears',  condition:'$501 – $1,500',               pts:-1, editable:true,  notes:'Mirrors housing app arrears score'},
  {id:'rs_arr_3',         group:'arrears',   factor:'Tenant Arrears',  condition:'$1,501 – $3,000',             pts:-2, editable:true,  notes:'Mirrors housing app arrears score'},
  {id:'rs_arr_4',         group:'arrears',   factor:'Tenant Arrears',  condition:'$3,001 – $5,000',             pts:-3, editable:true,  notes:'Mirrors housing app arrears score'},
  {id:'rs_arr_5',         group:'arrears',   factor:'Tenant Arrears',  condition:'$5,001+',                     pts:-5, editable:true,  notes:'Mirrors housing app arrears score'},
  // Payment arrangement — mirrors housing app: shorter plan = larger bonus that offsets arrears penalty
  {id:'rs_pay_1',         group:'arrears',   factor:'Tenant Arrears',  condition:'Payment plan 0–12 months',    pts:5,  editable:true,  notes:'Mirrors payment arrangement bonus — short plan reduces penalty most'},
  {id:'rs_pay_2',         group:'arrears',   factor:'Tenant Arrears',  condition:'Payment plan 13–36 months',   pts:4,  editable:true,  notes:'Mirrors payment arrangement bonus'},
  {id:'rs_pay_3',         group:'arrears',   factor:'Tenant Arrears',  condition:'Payment plan 37–60 months',   pts:3,  editable:true,  notes:'Mirrors payment arrangement bonus'},
  {id:'rs_pay_4',         group:'arrears',   factor:'Tenant Arrears',  condition:'Payment plan 61–120 months',  pts:2,  editable:true,  notes:'Mirrors payment arrangement bonus'},
  {id:'rs_pay_5',         group:'arrears',   factor:'Tenant Arrears',  condition:'Payment plan 121–180 months', pts:1,  editable:true,  notes:'Mirrors payment arrangement bonus'},
  {id:'rs_pay_6',         group:'arrears',   factor:'Tenant Arrears',  condition:'Payment plan 181+ months',    pts:0,  editable:true,  notes:'Very long plan — no bonus'},
];

// Funding rules by funder type.
// band_rep is eligible for all unit types.
// fncfs is shown conditionally in the SOW form based on the configured
// dependent age threshold (Settings → Reno Budget → FNCFS Dependent Age).
var RENO_FUND_RULES = {
  'ISC':        { pools:['rrap','band','ofnlp','band_rep'],         label:'ISC House',       rule:'Eligible: RRAP + Band Funds + OFNLP + Band Rep Funds' },
  'CMHC_95':    { pools:['cmhc','band','ofnlp','band_rep'],         label:'CMHC Section 95', rule:'Eligible: CMHC + Band Funds + OFNLP + Band Rep Funds' },
  'section_10': { pools:['rrap','isc','band','ofnlp','band_rep'],   label:'Section 10',      rule:'Eligible: RRAP + ISC + Band Funds + OFNLP + Band Rep Funds', repayment:true },
  'rent_to_own':{ pools:['rrap','isc','band','ofnlp','band_rep'],   label:'Rent-to-Own',     rule:'Eligible: RRAP + ISC + Band Funds + OFNLP + Band Rep Funds. Tenant repayment expected.', repayment:true },
  'band_house': { pools:['rrap','isc','band','ofnlp','band_rep'],   label:'Band House',      rule:'Eligible: RRAP + ISC + Band Funds + OFNLP + Band Rep Funds' },
  '':           { pools:['rrap','isc','band','ofnlp','band_rep'],   label:'Band House',      rule:'Eligible: RRAP + ISC + Band Funds + OFNLP + Band Rep Funds' },
};

// Critical system SOW categories — must be funded first
var CRITICAL_SOW_CATS = ['Heating / HVAC','Electrical','Roofing','Windows & Doors','Plumbing'];

// Single accessor for the nation's short identifier. Replaces a fallback that
// hardcoded 'CLFN' in ~13 places (a HARD-RULE violation). NATION_CONFIG.short is
// set at boot (see NATIONS_DIRECTORY resolver above, where the CLFN default
// legitimately lives); this generic 'Housing' fallback only applies pre-boot /
// if config is missing, and keeps 'CLFN' out of consumer code.
window.nationShort = function nationShort(){
  return (window.NATION_CONFIG && window.NATION_CONFIG.short) || 'Housing';
};

// Single accessor for the nation's full display name. Same rationale as
// nationShort(): keeps '... || "CLFN"'-style fallbacks out of consumer code.
window.nationDisplay = function nationDisplay(){
  return (window.NATION_CONFIG && (NATION_CONFIG.display_name || NATION_CONFIG.name)) || nationShort() || '';
};

// Single accessor for the nation's staff email domain (no leading '@').
// Consumers build gates/placeholders as '@' + nationEmailDomain(). The CLFN
// literal here is the config-file default (the sanctioned home for it).
window.nationEmailDomain = function nationEmailDomain(){
  return (window.NATION_CONFIG && NATION_CONFIG.email_domain) || 'clfn.on.ca';
};
