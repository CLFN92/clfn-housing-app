/* ============================================================
 * shared-config.js — CLFN Housing Suite
 * Nation configuration, module registry, Supabase bootstrap
 * ============================================================
 * Load order: shared.js → THIS FILE → shared-auth.js → shared-ui.js → shared-data.js
 *
 * Exposes (on window):
 *   window.NATION_CONFIG  — immutable nation config object
 *   window.CLFN_MODULES   — module enablement API
 *   window.SUPABASE_URL   — pulled from NATION_CONFIG
 *   window.SUPABASE_ANON  — pulled from NATION_CONFIG
 *   window.STORAGE_BUCKET — pulled from NATION_CONFIG
 *
 * To add a new nation: add one entry to REGISTRY below.
 * No other file needs to change.
 * ============================================================ */

// ── Nation Registry ────────────────────────────────────────────────────────
// Each entry is a fully independent Supabase project → physical data isolation.
// Subdomain routing: clfn.yourdomain.com → REGISTRY['clfn']
// ──────────────────────────────────────────────────────────────────────────
(function initNationConfig() {

  var REGISTRY = {
    'clfn': {
      id:            'clfn',
      display_name:  'Constance Lake First Nation',
      display_short: 'CLFN',
      supabase_url:  'https://fkhzrbalumzeripzolph.supabase.co',
      supabase_anon: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZraHpyYmFsdW16ZXJpcHpvbHBoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMTAwODYsImV4cCI6MjA5MDg4NjA4Nn0.0nazS2W-0xzxWyFOuSe2jHhamC0N2WqKgAjrlRY6NQo',
      storage_bucket: 'housing-files',
      emailjs_service: 'service_35sybq2',
      branding: {
        primary_color: '#F8E41A',
        dark_color:    '#000000',
        font_serif:    'DM Serif Display',
        font_sans:     'DM Sans'
      },
      // Optional modules only — core modules are always enabled.
      modules_enabled: {
        renovations: true,
        finance:     true,
        contractors: true,
        match:       true
      }
    }
    // ── Add new nations here ──────────────────────────────────────────
    // Each nation gets its own Supabase project for data isolation.
    // ,'nation2': {
    //   id: 'nation2',
    //   display_name: 'Nation Name',
    //   display_short: 'NN',
    //   supabase_url: 'https://YOUR_PROJECT.supabase.co',
    //   supabase_anon: 'YOUR_ANON_KEY',
    //   storage_bucket: 'housing-files',
    //   branding: { primary_color: '#...', dark_color: '#...', font_serif: '...', font_sans: '...' },
    //   modules_enabled: { renovations: true, finance: false, contractors: true, match: true }
    // }
  };

  // ── Subdomain → nation resolution ──────────────────────────────────────
  // Strips the first DNS label and looks it up in REGISTRY.
  // Falls back to 'clfn' for localhost, 127.x, and Azure preview URLs.
  function resolveNationId() {
    var host = (window.location.hostname || '').toLowerCase();
    if (!host || host === 'localhost' || host.startsWith('127.') || host.startsWith('192.168.')) {
      return 'clfn'; // dev default
    }
    if (host.indexOf('azurestaticapps.net') !== -1) return 'clfn';
    var first = host.split('.')[0];
    if (first && REGISTRY[first]) return first;
    console.warn('[nation] unknown subdomain "' + first + '" — falling back to clfn');
    return 'clfn';
  }

  var nationId = resolveNationId();
  var config   = REGISTRY[nationId];
  if (!config) throw new Error('[nation] no config registered for "' + nationId + '"');

  window.NATION_CONFIG = Object.freeze(JSON.parse(JSON.stringify(config)));

})();

// ── Module Registry ────────────────────────────────────────────────────────
// Separates "what the app can do" from "what this nation has licensed."
// Core modules are always on. Optional modules are toggled per-nation in
// REGISTRY[nation].modules_enabled above.
// ──────────────────────────────────────────────────────────────────────────
(function initModules() {

  var CORE = Object.freeze([
    'applications',           // Applications + Worklist
    'applications_dashboard', // Dashboard view
    'scoring',                // Scoring model (ED-adjustable)
    'inventory',              // Housing inventory
    'tenants',                // Tenants
    'audit_log',              // Audit log (compliance requirement)
    'exports',                // CSV / Excel / PDF exports
    'reports',                // Reports
    'settings',               // Settings, users, auth
  ]);

  var OPTIONAL = Object.freeze({
    renovations: { depends_on: [],                         auto_enables: ['contractors'] },
    finance:     { depends_on: [],                         auto_enables: [] },
    contractors: { depends_on: [],                         auto_enables: [] },
    match:       { depends_on: ['applications','inventory'], auto_enables: [] }
  });

  var VALID = CORE.concat(Object.keys(OPTIONAL));

  function assertModule(name) {
    if (VALID.indexOf(name) === -1)
      throw new Error('[modules] unknown module "' + name + '". Valid: ' + VALID.join(', '));
    return name;
  }

  function isCore(name) {
    assertModule(name);
    return CORE.indexOf(name) !== -1;
  }

  function isEnabled(name) {
    assertModule(name);
    if (isCore(name)) return true;
    var cfg = (window.NATION_CONFIG && window.NATION_CONFIG.modules_enabled) || {};
    if (cfg[name] === true) return true;
    // Auto-enable via dependency chain
    for (var k in OPTIONAL) {
      if (cfg[k] === true && OPTIONAL[k].auto_enables.indexOf(name) !== -1) return true;
    }
    return false;
  }

  function listEnabled()  { return VALID.filter(isEnabled); }
  function listOptional() { return Object.keys(OPTIONAL); }

  window.CLFN_MODULES = Object.freeze({
    CORE:         CORE,
    OPTIONAL:     OPTIONAL,
    assertModule: assertModule,
    isCore:       isCore,
    isEnabled:    isEnabled,
    listEnabled:  listEnabled,
    listOptional: listOptional
  });

})();

// ── Supabase Bootstrap ─────────────────────────────────────────────────────
// Derive connection constants from NATION_CONFIG so every other module
// can reference SUPABASE_URL / SUPABASE_ANON / STORAGE_BUCKET directly.
// ──────────────────────────────────────────────────────────────────────────
var SUPABASE_URL   = window.NATION_CONFIG.supabase_url;
var SUPABASE_ANON  = window.NATION_CONFIG.supabase_anon;
var STORAGE_BUCKET = window.NATION_CONFIG.storage_bucket || 'housing-files';
