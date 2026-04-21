/* ============================================================
 * shared-data.js — CLFN Housing Suite
 * Supabase data layer: role mapping, CRUD operations, audit
 * ============================================================
 * Depends on: shared-config.js (SUPABASE_URL, SUPABASE_ANON)
 *             shared-auth.js   (HOUSING_SESSION, HOUSING_HEADERS)
 * Load order: shared.js → shared-config.js → shared-auth.js → shared-ui.js → THIS FILE
 *
 * Exposes (as globals):
 *   sbMapRole(staffRow)            — canonical role from a staff table row
 *   sbLoadApplications()           — fetch + map all applications
 *   sbSaveApplication(app)         — upsert one application
 *   sbSaveAllApplications(apps)    — batch upsert (used during migration)
 *   sbLoadUnits()                  — fetch + map all housing units
 *   sbSaveUnit(u)                  — upsert one unit
 *   sbSaveAllUnits(units)          — batch upsert
 *   sbLoadAuditLog(limit)          — fetch recent audit entries
 *   sbSaveSetting(key, value)      — upsert a housing_settings row
 *   sbLoadContractors()            — fetch + map contractors
 *   sbSaveContractor(ct)           — upsert one contractor
 *   auditEntry(appId, action, detail, user) — write to in-memory log + Supabase
 *
 * Design notes:
 *   - All functions are fire-and-forget safe (catch + warn, never throw to caller)
 *   - Upserts use Prefer: resolution=merge-duplicates so callers don't need
 *     to distinguish insert vs update
 *   - auditEntry writes to both the in-memory auditLog[] array (for display)
 *     and the Supabase housing_audit_log table (for persistence + compliance)
 * ============================================================ */

// ── Module-level state ────────────────────────────────────────────────────────
// Declare all implicit globals here so they're never undefined on first access.
var _raFilter        = '';   // reno approvals active filter key
var _scoresSortKey   = 'score';
var _scoresSortDir   = -1;

// ── sbMapRole ─────────────────────────────────────────────────────────────────
// Maps a staff table row to a canonical role string.
// Uses CLFN_PERMS.normalizeRole() to handle legacy aliases.
function sbMapRole(staffRow) {
  if (!staffRow) return 'housing_employee_l1';
  var raw = staffRow.role;
  // Legacy guard: 'manager' from a non-Housing department → base access only
  if (raw === 'manager' && !(staffRow.department || '').toLowerCase().includes('housing')) {
    return 'housing_employee_l1';
  }
  if (window.CLFN_PERMS && window.CLFN_PERMS.isValidRole(raw)) {
    return window.CLFN_PERMS.normalizeRole(raw);
  }
  return 'housing_employee_l1';
}

// ── sbLoadApplications ────────────────────────────────────────────────────────
// Fetches all applications and maps DB columns → app object shape.
// Prefers dedicated columns over the jsonb data blob for queryable fields.
async function sbLoadApplications() {
  try {
    var r = await fetch(
      SUPABASE_URL + '/rest/v1/housing_applications?select=*&order=submitted_at.desc&limit=9999',
      { headers: HOUSING_HEADERS }
    );
    if (!r.ok) return null;
    var data = await r.json();
    return data.map(function(row) {
      return Object.assign({}, row.data || {}, {
        // Identity
        id:               row.id,
        // Status & scoring
        status:           row.status,
        score:            row.score,
        tier:             row.tier,
        classification:   row.classification,
        reserve:          row.reserve,
        archived:         !!row.archived,
        // Unit assignment
        assignedUnit:     row.assigned_unit_id,
        assignedAddress:  row.assigned_address,
        submittedAt:      row.submitted_at,
        // Application type
        appType:          row.app_type         || (row.data || {}).appType         || 'new_housing',
        transferPending:  row.transfer_pending !== undefined ? !!row.transfer_pending : !!(row.data || {}).transferPending,
        // V2 scoring inputs (dedicated columns win over jsonb)
        urgentNeed:          row.urgent_need           || (row.data || {}).urgentNeed          || 'none',
        healthRisk:          row.health_risk           || (row.data || {}).healthRisk          || 'none',
        personsOverStandard: row.persons_over_standard !== undefined ? row.persons_over_standard : ((row.data || {}).personsOverStandard || 0),
        loneParent:          row.lone_parent           !== undefined ? !!row.lone_parent        : !!(row.data || {}).loneParent,
        elderInHousehold:    row.elder_in_household    !== undefined ? !!row.elder_in_household : !!(row.data || {}).elderInHousehold,
        householdDisability: row.household_disability  !== undefined ? !!row.household_disability : !!(row.data || {}).householdDisability,
        incomeStability:     row.income_stability      || (row.data || {}).incomeStability      || 'stable',
        arrears_status:      row.arrears_status        || (row.data || {}).arrears_status       || 'none',
        // Prior tenancy (HM/ED assessed fields)
        rentPaymentHistory:  row.rent_payment_history  || (row.data || {}).rentPaymentHistory   || 'no_history',
        unitCondition:       row.unit_condition        || (row.data || {}).unitCondition        || 'no_history',
        tenancyConduct:      row.tenancy_conduct       || (row.data || {}).tenancyConduct       || 'no_history',
        // V2 scoring outputs
        score_v2:            row.score_v2 !== undefined ? row.score_v2 : (row.data || {}).score_v2,
        tier_v2:             row.tier_v2              || (row.data || {}).tier_v2,
        scoreBreakdown:      row.score_breakdown_v2   || (row.data || {}).scoreBreakdown || null,
        // Ownership (RLS — HE-L1 own-draft rule)
        created_by_email:    row.created_by_email     || null,
        // Columns added via migration 2026-04-19
        spId:                row.sp_id                || null,
        noPriorTenancy:      row.no_prior_tenancy     !== undefined ? !!row.no_prior_tenancy : !!(row.data || {}).noPriorTenancy
      });
    });
  } catch(e) {
    console.warn('[SB] load applications failed:', e);
    return null;
  }
}

// ── sbSaveApplication ─────────────────────────────────────────────────────────
// Upserts one application. All V2 scoring fields are promoted to dedicated
// columns so they're queryable; the full app object is also stored in data jsonb.
// COLUMNS: only send columns confirmed to exist in housing_applications table.
// Columns data, archived, no_prior_tenancy, sp_id require a migration before
// being re-enabled (see CLFN Supabase migration notes).
async function sbSaveApplication(app) {
  var row = {
    id:               app.id,
    status:           app.status || 'draft',
    score:            typeof app.score === 'number' ? app.score : null,
    tier:             app.tier || null,
    classification:   app.classification || null,
    reserve:          app.reserve || null,
    assigned_unit_id: app.assignedUnit || null,
    assigned_address: app.assignedAddress || null,
    submitted_at:     app.submittedAt || null,
    // V2 scoring inputs (all confirmed in table)
    urgent_need:           app.urgentNeed           || app.urgent_need           || 'none',
    health_risk:           app.healthRisk           || app.health_risk           || 'none',
    persons_over_standard: parseInt(app.personsOverStandard || app.persons_over_standard || 0) || 0,
    lone_parent:           !!(app.loneParent        || app.lone_parent),
    elder_in_household:    !!(app.elderInHousehold  || app.elder_in_household),
    household_disability:  !!(app.householdDisability || app.household_disability),
    rent_payment_history:  app.rentPaymentHistory   || app.rent_payment_history  || 'no_history',
    unit_condition:        app.unitCondition        || app.unit_condition        || 'no_history',
    tenancy_conduct:       app.tenancyConduct       || app.tenancy_conduct       || 'no_history',
    income_stability:      app.incomeStability      || app.income_stability      || 'stable',
    arrears_status:        app.arrearsStatus        || app.arrears_status        || 'none',
    // V2 scoring outputs (all confirmed in table)
    score_v2:           typeof app.score_v2 === 'number' ? app.score_v2 : (typeof app.score === 'number' ? app.score : null),
    tier_v2:            app.tier_v2 || app.tier || null,
    score_breakdown_v2: app.scoreBreakdown || null,
    // Application type (confirmed in table)
    app_type:           app.appType || app.app_type || 'new_housing',
    transfer_pending:   !!(app.transferPending || app.transfer_pending),
    // Ownership (confirmed in table)
    created_by_email:   app.created_by_email || HOUSING_SESSION.email || null,
    // Columns added via migration 2026-04-19
    sp_id:            app.spId || null,
    data:             app,
    archived:         !!app.archived,
    no_prior_tenancy: (app.noPriorTenancy !== undefined ? !!app.noPriorTenancy : !!(app.no_prior_tenancy !== false))
  };
  try {
    var r = await fetch(SUPABASE_URL + '/rest/v1/housing_applications', {
      method:  'POST',
      headers: Object.assign({}, HOUSING_HEADERS, {
        'Prefer': 'resolution=merge-duplicates,return=minimal',
        'Accept-Profile': 'public',
        'Content-Profile': 'public'
      }),
      body:    JSON.stringify(row)
    });
    if (!r.ok) {
      var e = await r.text();
      console.error('[SB] save application 400 — Supabase says:', e);
      console.error('[SB] row keys sent:', Object.keys(row).join(', '));
      return false;
    }
    return true;
  } catch(e) {
    console.warn('[SB] save application error:', e);
    return false;
  }
}

// ── sbSaveAllApplications ─────────────────────────────────────────────────────
// Batch upsert — used during localStorage→Supabase migration and bulk ops.
async function sbSaveAllApplications(apps) {
  var rows = apps.map(function(app) {
    return {
      id:               app.id,
      sp_id:            app.spId || null,
      data:             app,
      status:           app.status || 'draft',
      score:            typeof app.score === 'number' ? app.score : null,
      tier:             app.tier || null,
      classification:   app.classification || null,
      reserve:          app.reserve || null,
      archived:         !!app.archived,
      assigned_unit_id: app.assignedUnit || null,
      assigned_address: app.assignedAddress || null,
      submitted_at:     app.submittedAt || null,
      created_by_email: app.created_by_email || null
    };
  });
  for (var i = 0; i < rows.length; i += 100) {
    var batch = rows.slice(i, i + 100);
    var r = await fetch(SUPABASE_URL + '/rest/v1/housing_applications', {
      method:  'POST',
      headers: Object.assign({}, HOUSING_HEADERS, { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
      body:    JSON.stringify(batch)
    });
    if (!r.ok) { console.warn('[SB] batch save applications failed:', await r.text()); return false; }
  }
  return true;
}

// ── sbLoadUnits ───────────────────────────────────────────────────────────────
async function sbLoadUnits() {
  try {
    var r = await fetch(
      SUPABASE_URL + '/rest/v1/housing_units?select=*&order=street,num&limit=9999',
      { headers: HOUSING_HEADERS }
    );
    if (!r.ok) return null;
    var data = await r.json();
    return data.map(function(row) {
      return Object.assign({}, row.data || {}, {
        id:          row.id,
        num:         row.num,
        street:      row.street,
        bedrooms:    row.bedrooms,
        bathrooms:   row.bathrooms,
        type:        row.type,
        foundation:  row.foundation,
        funder:      row.funder,
        status:      row.status,
        accessible:  !!row.accessible,
        isElders:    !!row.is_elders,
        archived:    !!row.archived,
        assignedTo:  row.assigned_to,
        assignedName:row.assigned_name,
        assignedDate:row.assigned_date
      });
    });
  } catch(e) {
    console.warn('[SB] load units failed:', e);
    return null;
  }
}

// ── sbSaveUnit ────────────────────────────────────────────────────────────────
async function sbSaveUnit(u) {
  var row = {
    id:            u.id,
    num:           u.num           || null,
    street:        u.street        || null,
    bedrooms:      u.bedrooms      || null,
    bathrooms:     u.bathrooms     || null,
    type:          u.type          || null,
    foundation:    u.foundation    || null,
    funder:        u.funder        || null,
    status:        u.status        || 'vacant',
    accessible:    !!u.accessible,
    is_elders:     !!u.isElders,
    archived:      !!u.archived,
    assigned_to:   u.assignedTo   || null,
    assigned_name: u.assignedName || null,
    assigned_date: u.assignedDate || null,
    data:          u
  };
  try {
    var r = await fetch(SUPABASE_URL + '/rest/v1/housing_units', {
      method:  'POST',
      headers: Object.assign({}, HOUSING_HEADERS, { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
      body:    JSON.stringify(row)
    });
    if (!r.ok) { console.warn('[SB] save unit failed:', await r.text()); return false; }
    return true;
  } catch(e) {
    console.warn('[SB] save unit error:', e);
    return false;
  }
}

// ── sbSaveAllUnits ────────────────────────────────────────────────────────────
async function sbSaveAllUnits(units) {
  if (!units || !units.length) return true;
  var rows = units.map(function(u) {
    return {
      id:            u.id,
      num:           u.num           || null,
      street:        u.street        || null,
      bedrooms:      u.bedrooms      || null,
      bathrooms:     u.bathrooms     || null,
      type:          u.type          || null,
      foundation:    u.foundation    || null,
      funder:        u.funder        || null,
      status:        u.status        || 'vacant',
      accessible:    !!u.accessible,
      is_elders:     !!u.isElders,
      archived:      !!u.archived,
      assigned_to:   u.assignedTo   || null,
      assigned_name: u.assignedName || null,
      assigned_date: u.assignedDate || null,
      data:          u
    };
  });
  for (var i = 0; i < rows.length; i += 100) {
    var batch = rows.slice(i, i + 100);
    var r = await fetch(SUPABASE_URL + '/rest/v1/housing_units', {
      method:  'POST',
      headers: Object.assign({}, HOUSING_HEADERS, { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
      body:    JSON.stringify(batch)
    });
    if (!r.ok) { console.warn('[SB] batch save units failed:', await r.text()); return false; }
  }
  return true;
}

// ── sbLoadAuditLog ────────────────────────────────────────────────────────────
async function sbLoadAuditLog(limit) {
  try {
    var r = await fetch(
      SUPABASE_URL + '/rest/v1/housing_audit_log?select=*&order=created_at.desc&limit=' + (limit || 500),
      { headers: HOUSING_HEADERS }
    );
    if (!r.ok) return null;
    var data = await r.json();
    return data.map(function(row) {
      var d = (typeof row.detail === 'object' ? row.detail : null)
           || (function() { try { return JSON.parse(row.detail || '{}'); } catch(e) { return {}; } })();
      return {
        ts:     row.created_at,
        appId:  row.entity_id,
        action: row.action,
        detail: d.detail || d.summary || '',
        user:   row.actor
      };
    });
  } catch(e) {
    console.warn('[SB] load audit log failed:', e);
    return null;
  }
}

// ── sbSaveSetting ─────────────────────────────────────────────────────────────
async function sbSaveSetting(key, value) {
  try {
    var r = await fetch(SUPABASE_URL + '/rest/v1/housing_settings', {
      method:  'POST',
      headers: Object.assign({}, HOUSING_HEADERS, { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
      body:    JSON.stringify({ key: key, value: value })
    });
    if (!r.ok) { console.warn('[SB] save setting failed:', await r.text()); return false; }
    return true;
  } catch(e) {
    console.warn('[SB] save setting error:', e);
    return false;
  }
}

// ── sbLoadContractors ─────────────────────────────────────────────────────────
async function sbLoadContractors() {
  try {
    var r = await fetch(
      SUPABASE_URL + '/rest/v1/housing_contractors?select=*&order=created_at',
      { headers: HOUSING_HEADERS }
    );
    if (!r.ok) return null;
    var data = await r.json();
    return data.map(function(row) {
      return Object.assign({}, row.data || {}, {
        id:     row.id,
        name:   row.name,
        trade:  row.trade,
        status: row.status
      });
    });
  } catch(e) {
    console.warn('[SB] load contractors failed:', e);
    return null;
  }
}

// ── sbSaveContractor ──────────────────────────────────────────────────────────
async function sbSaveContractor(ct) {
  try {
    var r = await fetch(SUPABASE_URL + '/rest/v1/housing_contractors', {
      method:  'POST',
      headers: Object.assign({}, HOUSING_HEADERS, { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
      body:    JSON.stringify({
        id:         ct.id,
        name:       ct.name   || null,
        trade:      ct.trade  || null,
        status:     ct.status || 'pending_review',
        data:       ct,
        updated_at: new Date().toISOString()
      })
    });
    if (!r.ok) { console.warn('[SB] save contractor failed:', await r.text()); return false; }
    return true;
  } catch(e) {
    console.warn('[SB] save contractor error:', e);
    return false;
  }
}

// ── auditEntry ────────────────────────────────────────────────────────────────
// Writes one entry to both:
//   1. window.auditLog[]  — in-memory array for current-session display
//   2. housing_audit_log  — Supabase table for persistence and compliance
//
// entity_type is derived from the appId prefix convention:
//   'SOW:UNIT-123'  → 'sow'
//   'CT:abc'        → 'contractor'
//   'UNIT:xyz'      → 'unit'
//   'SETTINGS'      → 'settings'
//   anything else   → 'application'
function auditEntry(appId, action, detail, user) {
  var actor = user || window.currentRole || 'Staff';
  var entry = { ts: new Date().toISOString(), appId: appId, action: action, detail: detail, user: actor };

  // In-memory log (page-scoped array, may not exist on all pages)
  if (typeof auditLog !== 'undefined') {
    auditLog.unshift(entry);
    if (auditLog.length > 500) auditLog = auditLog.slice(0, 500);
  }

  // Derive entity_type from appId prefix convention
  var sid   = String(appId || '');
  var etype = sid.startsWith('SOW:')  ? 'sow'
            : sid.startsWith('CT:')   ? 'contractor'
            : sid.startsWith('UNIT:') ? 'unit'
            : sid === 'SETTINGS'      ? 'settings'
            : 'application';

  // Persist to Supabase (fire-and-forget)
  fetch(SUPABASE_URL + '/rest/v1/housing_audit_log', {
    method:  'POST',
    headers: Object.assign({}, HOUSING_HEADERS, { 'Prefer': 'return=minimal' }),
    body: JSON.stringify({
      entity_type: etype,
      entity_id:   sid,
      action:      action,
      detail:      JSON.stringify({ detail: detail }),
      actor:       actor,
      created_at:  new Date().toISOString()
    })
  }).catch(function(e) { console.warn('[audit] save failed:', e); });
}


/* ════════════════════════════════════════════════════════════════════════════
 * SHARED DOMAIN FUNCTIONS
 * These were identical in housing.html and renos.html. Single source here.
 * Pages reference them directly — no import/export needed (all globals).
 *
 * Sections:
 *  A. Field helpers          — g(), fv(), fb(), fmtCurrency()
 *  B. Navigation utilities   — goBack variants, showDash, showWorklist...
 *  C. Worklist rendering     — renderWorklist, wlSection, wlEmpty...
 *  D. Contractor workflow    — open/close/save/render contractor modals
 *  E. SOW (Scope of Work)    — modal, save, collect, recalc
 *  F. Reno + Budget          — renderRenosView, budget pools, RBA
 *  G. Scoring                — renderScoresTable, unit score model
 *  H. Staff management       — lookupUser, renderHousingUserTable
 *  I. Exports + Print        — exportInventory, exportRenos, triggerPrint
 *  J. Photos + Files         — removeRenoPhoto, scLoadDocs
 *  K. Miscellaneous          — _rsm, _realRoleForPermissions, sig helpers
 * ════════════════════════════════════════════════════════════════════════════ */
function _buildContractorAgreementHTML(ct) {
  var today = new Date().toLocaleDateString('en-CA');
  var logoSrc = (document.querySelector('.app-logo img')||{}).src || '';

  var classLabels = {
    internal_indigenous:     'Internal — Indigenous',
    external_indigenous:     'External — Indigenous',
    external_non_indigenous: 'External — Non-Indigenous'
  };
  var classLabel = classLabels[ct.classification] || '—';

  

  return '<!DOCTYPE html><html lang="en"><head>'
    +'<meta charset="UTF-8"/>'
    +'<title>Contractor Agreement — CLFN Housing</title>'
    +'<style>'
    +'*{box-sizing:border-box;margin:0;padding:0;}'
    +'body{font-family:Georgia,serif;font-size:11px;color:#111;background:#fff;}'
    +'@page{size:letter portrait;margin:15mm 15mm 18mm 15mm;}'
    +'@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}.no-print{display:none!important;}}'
    +'.header{background:#000;color:#fff;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;}'
    +'.org{font-size:13px;font-weight:bold;color:#F8E41A;letter-spacing:.04em;}'
    +'.dept{font-size:10px;color:#ccc;margin-top:2px;}'
    +'.doc-type{font-size:16px;font-weight:bold;color:#F8E41A;letter-spacing:.05em;text-align:right;}'
    +'.doc-date{font-size:9px;color:#aaa;margin-top:3px;text-align:right;}'
    +'.yellow-bar{background:#F8E41A;height:4px;}'
    +'.body{padding:18px 0 0;}'
    +'.section{margin-bottom:18px;}'
    +'.section-title{font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:.08em;color:#fff;background:#000;padding:5px 10px;}'
    +'.section-body{border:1px solid #ddd;border-top:none;padding:12px 14px;}'
    +'.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;}'
    +'.grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px 18px;}'
    +'.field label{display:block;font-size:8.5px;font-weight:bold;text-transform:uppercase;letter-spacing:.06em;color:#666;margin-bottom:3px;}'
    +'.field span{display:block;font-size:11px;color:#111;min-height:14px;border-bottom:1px solid #e0e0e0;padding-bottom:3px;}'
    +'.class-badge{display:inline-block;background:#F8E41A;color:#000;font-size:9px;font-weight:bold;padding:3px 10px;border-radius:3px;margin-top:4px;}'
    +'table{width:100%;border-collapse:collapse;}'
    +'th{background:#000;color:#F8E41A;padding:6px 10px;text-align:left;font-size:9px;font-weight:bold;text-transform:uppercase;}'
    +'td{padding:6px 10px;font-size:10px;border-bottom:1px solid #eee;}'
    +'.tor-clause{margin-bottom:8px;padding:8px 12px;background:#f9f9f7;border-left:3px solid #F8E41A;font-size:9.5px;color:#333;line-height:1.6;}'
    +'.tor-clause strong{display:block;font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#000;margin-bottom:3px;}'
    +'.sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:4px;}'
    +'.footer{margin-top:20px;border-top:3px solid #F8E41A;padding-top:8px;display:flex;justify-content:space-between;}'
    +'.footer span{font-size:8px;color:#888;}'
    +'</style></head><body>'

    /* HEADER */
    +'<div class="header">'
      +'<div style="display:flex;align-items:center;gap:14px;">'
        +(logoSrc ? '<img src="'+logoSrc+'" style="height:48px;width:auto;" alt="CLFN"/>' : '')
        +'<div><div class="org">Constance Lake First Nation</div><div class="dept">Housing Department — Contractor Registry</div></div>'
      +'</div>'
      +'<div><div class="doc-type">CONTRACTOR AGREEMENT</div><div class="doc-date">Generated: '+today+'</div></div>'
    +'</div>'
    +'<div class="yellow-bar"></div>'

    +'<div class="body">'

    /* Company Information */
    +'<div class="section"><div class="section-title">Contractor Information</div>'
    +'<div class="section-body"><div class="grid-3">'
      +'<div class="field"><label>Company / Name</label><span>'+(ct.name||'—')+'</span></div>'
      +'<div class="field"><label>Trade / Specialty</label><span>'+(ct.trade||'—')+'</span></div>'
      +'<div class="field"><label>HST / Business #</label><span>'+(ct.hst||'—')+'</span></div>'
      +'<div class="field"><label>Phone</label><span>'+(ct.phone||'—')+'</span></div>'
      +'<div class="field"><label>Email</label><span>'+(ct.email||'—')+'</span></div>'
      +'<div class="field"><label>Address</label><span>'+(ct.address||'—')+'</span></div>'
    +'</div></div></div>'

    /* Classification */
    +'<div class="section"><div class="section-title">Business Classification</div>'
    +'<div class="section-body">'
      +'<div class="field"><label>Classification</label>'
        +'<span class="class-badge">'+classLabel+'</span>'
      +'</div>'
      +(ct.classProof ? '<div class="field" style="margin-top:8px;"><label>Proof of Indigenous Ownership</label><span>'+ct.classProof+'</span></div>' : '')
    +'</div></div>'

    /* Compliance */
    +'<div class="section"><div class="section-title">Compliance &amp; Insurance</div>'
    +'<div class="section-body"><div class="grid-3">'
      +'<div class="field"><label>WSIB Account #</label><span>'+(ct.wsibNum||'—')+'</span></div>'
      +'<div class="field"><label>WSIB Expiry</label><span>'+(ct.wsibExpiry||'—')+'</span></div>'
      +'<div class="field"></div>'
      +'<div class="field"><label>Insurance Provider</label><span>'+(ct.insProvider||'—')+'</span></div>'
      +'<div class="field"><label>Policy #</label><span>'+(ct.insPolicy||'—')+'</span></div>'
      +'<div class="field"><label>Coverage / Expiry</label><span>'+(ct.insAmount||'—')+' · '+(ct.insExpiry||'—')+'</span></div>'
    +'</div></div></div>'

    /* Terms of Reference */
    +'<div class="section"><div class="section-title">Terms of Reference</div>'
    +'<div class="section-body">'
      +'<div class="tor-clause"><strong>1. Scope of Engagement</strong>The contractor agrees to perform only the work described in the approved SOW. No work beyond the approved scope may commence without written amendment signed by the Housing Manager or Executive Director.</div>'
      +'<div class="tor-clause"><strong>2. Licensing &amp; Insurance</strong>The contractor warrants that it holds all required trade licences, WSIB clearance, and liability insurance in force for the duration of the work. Expiry of any required coverage automatically suspends the right to work on CLFN property.</div>'
      +'<div class="tor-clause"><strong>3. Invoicing &amp; Payment</strong>Invoices must reference the SOW number, unit address, and work completed. Payment is subject to satisfactory inspection. Standard payment terms are Net 30 days from invoice approval. Holdback provisions apply per the Construction Act (Ontario).</div>'
      +'<div class="tor-clause"><strong>4. On-Reserve Conduct</strong>The contractor and all workers must conduct themselves respectfully on reserve lands. Alcohol, drugs, and firearms are prohibited on all work sites. All workers must check in with the Housing Department on first arrival.</div>'
      +'<div class="tor-clause"><strong>5. Deficiency &amp; Warranty</strong>The contractor guarantees all labour and materials for a minimum of one (1) year from the date of completion. Deficiencies must be rectified within 30 days at no additional cost to CLFN.</div>'
      +'<div class="tor-clause"><strong>6. Indigenous Procurement Priority</strong>CLFN is committed to economic reconciliation. Classification provided is subject to verification. Misrepresentation of Indigenous status may result in termination and removal from the approved contractor list.</div>'
      +'<div class="tor-clause"><strong>7. Termination</strong>CLFN may terminate with 5 days written notice for convenience, or immediately for cause. The contractor is entitled to payment only for work satisfactorily completed to the date of termination.</div>'
      +(ct.torAgreed ? '<div style="margin-top:10px;padding:6px 12px;background:#f0fdf4;border:1px solid #86efac;border-radius:4px;font-size:9px;color:#15803d;font-weight:bold;">✓ Terms agreed by contractor representative — '+( ct.torAgreedAt||today)+'</div>' : '')
    +'</div></div>'

    /* Signatures */
    +'<div class="section"><div class="section-title">Signatures &amp; Acknowledgement</div>'
    +'<div class="section-body">'
      +'<div style="font-size:9.5px;color:#444;line-height:1.6;margin-bottom:14px;padding:10px 12px;background:#f9f9f7;border-left:3px solid #F8E41A;">'
        +'By signing below, the contractor representative confirms that all information provided is accurate and complete, and that they have read and agree to the Terms of Reference above. The CLFN Housing staff member confirms this registration is authorized.'
      +'</div>'
      +'<div class="sig-grid">'
        +sigBlock('CLFN Housing Staff', ct.sigStaff && ct.sigStaff.name, '', ct.sigStaff && ct.sigStaff.date, ct.sigStaff && ct.sigStaff.image)
        +sigBlock('Contractor Representative', ct.sigCt && ct.sigCt.name, ct.sigCt && ct.sigCt.title, ct.sigCt && ct.sigCt.date, ct.sigCt && ct.sigCt.image)
      +'</div>'
    +'</div></div>'

    +'</div>' /* end body */

    +'<div class="footer"><span>Constance Lake First Nation — Housing Department · Contractor Registry</span><span>Generated '+today+' · CONFIDENTIAL</span></div>'
    +'</body></html>';
}
function _ctRenderActions(ct) {
  var el = document.getElementById('ctap_actions');
  if(!el) return;
  var role = window.currentRole || 'housing_employee_l1';
  var status = ct.status || 'pending_review';
  var actions = [];

  if(role === ROLE.HOUSING_MANAGER) {
    if(status === 'pending_review' || status === 'returned') {
      actions.push({label:'✅ Recommend to ED', cls:'btn-primary', action:'hm_recommended', needsNotes:false});
      actions.push({label:'↩ Return for Info',  cls:'btn-ghost',   action:'returned',       needsNotes:true});
      actions.push({label:'❌ Decline',           cls:'btn-ghost',   action:'declined',       needsNotes:true, danger:true});
    }
  }
  if(role === ROLE.ED) {
    if(status === 'hm_recommended' || status === 'pending_review') {
      actions.push({label:'✅ Final Approval',  cls:'btn-primary', action:'approved',  needsNotes:false});
      actions.push({label:'↩ Return to HM',    cls:'btn-ghost',   action:'returned',  needsNotes:true});
      actions.push({label:'❌ Decline',          cls:'btn-ghost',   action:'declined',  needsNotes:true, danger:true});
    }
    if(status === 'approved') {
      actions.push({label:'⛔ Revoke Approval', cls:'btn-ghost',  action:'declined',  needsNotes:true, danger:true});
    }
  }

  if(!actions.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--muted);text-align:center;padding:10px;">No actions available for your role at this stage.</div>';
    return;
  }
  el.innerHTML = actions.map(function(a){
    var style = a.danger ? 'background:none;border:1.5px solid #b91c1c;color:#b91c1c;' : '';
    return '<button class="btn '+a.cls+'" style="width:100%;'+style+'" data-act="'+a.action+'" data-notes="'+(a.needsNotes?'1':'0')+'">'+a.label+'</button>';
  }).join('');
  el.querySelectorAll('[data-act]').forEach(function(b){
    b.addEventListener('click',function(){initCtAction(b.getAttribute('data-act'),b.getAttribute('data-notes')==='1');});
  });
}
function _ctRenderAudit(ctId) {
  var el = document.getElementById('ctap_audit');
  if(!el) return;
  var log = [];
  // audit log loaded from Supabase
  var prefix = 'CT:' + ctId;
  var entries = log.filter(function(e){ return e.appId === prefix || (e.appId||'').startsWith(prefix); });
  if(!entries.length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--muted);font-style:italic;">No audit entries yet.</div>';
    return;
  }
  el.innerHTML = entries.map(function(e){
    var actionColors = {ct_submitted:'#15803d',hm_recommended:'#1d4ed8',approved:'#15803d',declined:'#b91c1c',returned:'#7c3aed',ct_updated:'#888'};
    var col = actionColors[e.action]||'#888';
    return '<div style="padding:8px 10px;background:var(--bg);border-radius:7px;border-left:3px solid '+col+';">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">'
        +'<span style="font-size:11px;font-weight:700;color:'+col+';">'+e.action.replace(/_/g,' ').replace(/ct /i,'')+'</span>'
        +'<span style="font-size:10px;color:var(--muted);">'+(e.ts?e.ts.slice(0,10):'—')+'</span>'
      +'</div>'
      +'<div style="font-size:11px;color:var(--muted);">'+e.detail+'</div>'
      +'<div style="font-size:10px;color:var(--muted);margin-top:2px;">by '+e.user+'</div>'
      +'</div>';
  }).join('');
}
function _ctRenderFlow(status, ct) {
  var flow = document.getElementById('ctap_flow');
  if(!flow) return;

  var steps = [
    {key:'pending_review', label:'Employee\nSubmits',   icon:'👤'},
    {key:'hm_recommended', label:'HM\nVerifies',        icon:'🏠'},
    {key:'approved',       label:'ED\nApproves',         icon:'✅'}
  ];

  var order = ['pending_review','hm_recommended','approved'];
  var declined = status==='declined';
  var returned = status==='returned';
  var currentIdx = order.indexOf(status);
  if(declined||returned) currentIdx = order.indexOf(declined?'pending_review':'pending_review')-1;

  var hmAt = ct.hmActionAt ? ct.hmActionAt.slice(0,10) : '';
  var edAt = ct.edActionAt ? ct.edActionAt.slice(0,10) : '';

  flow.innerHTML = steps.map(function(step, i){
    var done = i < currentIdx || (i===2 && status==='approved');
    var active = i === currentIdx && !declined && !returned;
    var bg = done?'#15803d':active?'var(--yellow)':'var(--border)';
    var col = done?'#fff':active?'#111':'#888';
    var note = i===1&&hmAt?hmAt:i===2&&edAt?edAt:'';
    return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;position:relative;">'
      +(i>0?'<div style="position:absolute;left:-50%;top:18px;width:100%;height:2px;background:'+(done?'#15803d':'var(--border)')+'"></div>':'')
      +'<div style="width:36px;height:36px;border-radius:50%;background:'+bg+';display:flex;align-items:center;justify-content:center;font-size:14px;z-index:1;">'+step.icon+'</div>'
      +'<div style="font-size:9px;font-weight:700;text-align:center;color:'+(done||active?'var(--text)':'var(--muted)')+';white-space:pre-line;line-height:1.3;">'+step.label+'</div>'
      +(note?'<div style="font-size:9px;color:var(--muted);">'+note+'</div>':'')
      +'</div>';
  }).join('');

  if(declined) {
    flow.innerHTML += '<div style="margin-left:12px;padding:4px 10px;background:#fef2f2;border-radius:6px;font-size:10px;font-weight:700;color:#b91c1c;">Declined'+(ct.declinedAt?' '+ct.declinedAt.slice(0,10):'')+'</div>';
  } else if(returned) {
    flow.innerHTML += '<div style="margin-left:12px;padding:4px 10px;background:#faf5ff;border-radius:6px;font-size:10px;font-weight:700;color:#7c3aed;">Returned'+(ct.returnedAt?' '+ct.returnedAt.slice(0,10):'')+'</div>';
  }
}
function _doExport(format, headers, data, filename, colWidths, pdfLandscape) {
  if(format==='csv') {
    var csv = [headers].concat(data).map(function(r){
      return r.map(function(v){ return '"'+(String(v||'').replace(/"/g,'""'))+'"'; }).join(',');
    }).join('\r\n');
    var blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href=url; a.download=filename+'.csv'; a.click();
    URL.revokeObjectURL(url);
    showToast('CSV exported — '+data.length+' rows');

  } else if(format==='excel') {
    var loadXLSX = function(cb){
      if(window.XLSX){ cb(); return; }
      var s=document.createElement('script');
      s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload=cb; s.onerror=function(){showToast('Could not load Excel library.');};
      document.head.appendChild(s);
    };
    loadXLSX(function(){
      var wb = XLSX.utils.book_new();
      var ws = XLSX.utils.aoa_to_sheet([headers].concat(data));
      ws['!cols'] = (colWidths||headers.map(function(){return 16;})).map(function(w){return{wch:w};});
      XLSX.utils.book_append_sheet(wb, ws, 'Data');
      XLSX.writeFile(wb, filename+'.xlsx');
      showToast('Excel exported — '+data.length+' rows');
    });

  } else if(format==='pdf') {
    var loadjsPDF = function(cb){
      if(window.jspdf&&window.jspdf.jsPDF){ cb(); return; }
      var s1=document.createElement('script');
      s1.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s1.onload=function(){
        var s2=document.createElement('script');
        s2.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js';
        s2.onload=cb; s2.onerror=function(){showToast('Could not load PDF library.');};
        document.head.appendChild(s2);
      };
      s1.onerror=function(){showToast('Could not load PDF library.');};
      document.head.appendChild(s1);
    };
    loadjsPDF(function(){
      var doc = new window.jspdf.jsPDF({orientation: pdfLandscape?'landscape':'portrait', unit:'mm', format:'a4'});
      doc.setFontSize(13); doc.setFont('helvetica','bold');
      doc.text('CLFN — '+filename.replace('CLFN_','').replace(/_/g,' '), 14, 16);
      doc.setFontSize(8); doc.setFont('helvetica','normal');
      doc.text('Exported: '+new Date().toLocaleDateString('en-CA')+'  |  '+data.length+' records', 14, 22);
      var totalWidth = pdfLandscape ? 267 : 180;
      var cellW = colWidths ? colWidths.map(function(w){ return w * totalWidth / colWidths.reduce(function(a,b){return a+b;},0); }) : null;
      var colStyles = {};
      if(cellW) cellW.forEach(function(w,i){ colStyles[i]={cellWidth:w}; });
      doc.autoTable({
        startY:27, head:[headers], body:data, theme:'striped',
        headStyles:{fillColor:[17,17,15],textColor:[248,228,26],fontSize:8,fontStyle:'bold'},
        bodyStyles:{fontSize:7.5},
        alternateRowStyles:{fillColor:[248,248,246]},
        columnStyles: colStyles,
        margin:{left:14,right:14}
      });
      doc.save(filename+'.pdf');
      showToast('PDF exported — '+data.length+' records');
    });
  }
}
function _getHmLimit() {
  try { return parseFloat((window._appSettings||{}).hmBudgetLimit)||25000; } catch(e) { return 25000; }
}
function _getPoolSpent(pid) {
  // Sum all previously approved reno budgets for this pool
  var total = 0;
  var allUnits = (typeof housingUnits!=='undefined'&&housingUnits.length)?housingUnits:(window.HOUSING_UNITS_DATA||[]);
  allUnits.forEach(function(u){
    try{
      var approval = (window._renoBudget && window._renoBudget[u.id]) || null;
      if(!approval || !approval.allocations) return;
      Object.keys(approval.allocations).forEach(function(key){
        var a = approval.allocations[key];
        if(a.pool===pid) total += parseFloat(a.amount)||0;
      });
    }catch(e){}
  });
  return total;
}
function _initSigPad(canvasId) {
  var canvas = document.getElementById(canvasId);
  if (!canvas || _sigPads[canvasId]) return;
  var ctx = canvas.getContext('2d');
  var drawing = false;
  var lastX = 0, lastY = 0;
  function getPos(e) {
    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width / rect.width;
    var scaleY = canvas.height / rect.height;
    var src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - rect.left) * scaleX, y: (src.clientY - rect.top) * scaleY };
  }
  function start(e) { e.preventDefault(); drawing = true; var p = getPos(e); lastX = p.x; lastY = p.y; }
  function move(e) {
    if (!drawing) return; e.preventDefault();
    var p = getPos(e);
    ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.stroke();
    lastX = p.x; lastY = p.y;
    canvas.classList.add('has-sig');
  }
  function end() { drawing = false; }
  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  canvas.addEventListener('mouseup', end);
  canvas.addEventListener('mouseleave', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);
  _sigPads[canvasId] = true;
}
function _rbaAllocRow(key, label, suggestedCost, eligiblePools, budgetData, approval) {
  var prevAlloc = approval && approval.allocations && approval.allocations[key];
  var poolOpts = eligiblePools.map(function(pid){
    var pool = BUDGET_POOLS.find(function(p){ return p.id===pid; });
    return '<option value="'+pid+'"'+(prevAlloc&&prevAlloc.pool===pid?' selected':'')+'>'+((pool&&pool.label)||pid)+'</option>';
  }).join('');
  return '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px 14px;display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;">'
    +'<div style="font-size:13px;font-weight:600;color:var(--text);">'+label+'</div>'
    +'<select id="rba_pool_'+key+'" style="padding:6px 10px;border:1px solid var(--border);border-radius:7px;font-size:12px;font-family:\'DM Sans\',sans-serif;background:var(--surface);color:var(--text);">'+poolOpts+'</select>'
    +'<input type="number" id="rba_amt_'+key+'" value="'+(prevAlloc?prevAlloc.amount:Math.round(suggestedCost))+'" min="0" step="100" '
      +'style="width:110px;padding:6px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;font-weight:700;text-align:right;background:var(--surface);color:var(--text);" placeholder="$"/>'
    +'</div>';
}
function _rbaStat(label, value, col) {
  return '<div style="text-align:center;">'
    +'<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--muted);margin-bottom:4px;">'+label+'</div>'
    +'<div style="font-size:16px;font-weight:800;color:'+col+';">'+value+'</div>'
    +'</div>';
}
function _readContractorFormData() {
  // Reads the current state of the contractor form without requiring a save
  var get = function(id){ var el=document.getElementById(id); return el ? el.value.trim() : ''; };
  var classRadio = document.querySelector('input[name="ct_classification"]:checked');
  var torEl = document.getElementById('ct_tor_agreed');
  return {
    id:          '',
    name:        get('ct_name'),
    trade:       get('ct_trade'),
    phone:       get('ct_phone'),
    email:       get('ct_email'),
    address:     get('ct_address'),
    hst:         get('ct_hst'),
    wsibNum:     get('ct_wsib_num'),
    wsibExpiry:  get('ct_wsib_expiry'),
    insProvider: get('ct_ins_provider'),
    insPolicy:   get('ct_ins_policy'),
    insAmount:   get('ct_ins_amount'),
    insExpiry:   get('ct_ins_expiry'),
    notes:       get('ct_notes'),
    classification: classRadio ? classRadio.value : '',
    classProof:  get('ct_class_proof'),
    torAgreed:   torEl ? torEl.checked : false,
    torAgreedAt: torEl && torEl.checked ? new Date().toISOString().split('T')[0] : '',
    sigStaff: {
      name:  get('ct_sig_staff_name'),
      date:  get('ct_sig_staff_date'),
      image: (typeof getSigDataURL === 'function') ? getSigDataURL('ct_sig_canvas_staff') : ''
    },
    sigCt: {
      name:  get('ct_sig_ct_name'),
      title: get('ct_sig_ct_title'),
      date:  get('ct_sig_ct_date'),
      image: (typeof getSigDataURL === 'function') ? getSigDataURL('ct_sig_canvas_ct') : ''
    },
    people: (typeof ctGetPeople === 'function') ? ctGetPeople() : []
  };
}
function _renderRpPendingPhotos() {
  var preview = document.getElementById('rp_photo_preview');
  if(!preview) return;
  var stored  = (window._rpStoredPhotos||[]).map(function(src, i) {
    return '<div style="position:relative;width:80px;height:80px;border-radius:8px;overflow:hidden;border:1px solid var(--border);">'
      +'<img src="'+src+'" style="width:100%;height:100%;object-fit:cover;"/>'
      +'<button type="button" onclick="removeRenoPhoto('+i+')" style="position:absolute;top:3px;right:3px;background:rgba(0,0,0,0.6);border:none;color:#fff;border-radius:50%;width:18px;height:18px;font-size:11px;cursor:pointer;line-height:1;">✕</button>'
      +'</div>';
  });
  var pending = (window._rpPendingPhotos||[]).map(function(src) {
    return '<div style="position:relative;width:80px;height:80px;border-radius:8px;overflow:hidden;border:2px solid var(--yellow);" title="New — not yet saved">'
      +'<img src="'+src+'" style="width:100%;height:100%;object-fit:cover;"/>'
      +'<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(248,228,26,0.85);font-size:8px;font-weight:700;text-align:center;padding:2px;color:#111;">NEW</div>'
      +'</div>';
  });
  preview.innerHTML = stored.concat(pending).join('');
}
function _restoreSigCanvas(canvasId, dataURL) {
  if(!dataURL || !dataURL.startsWith('data:')) return;
  var canvas = document.getElementById(canvasId);
  if(!canvas) return;
  var img = new Image();
  img.onload = function() {
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  };
  img.src = dataURL;
}
function _rsm(model, id) {
  var r = model.find(function(x){ return x.id === id; });
  return r ? (r.pts||0) : 0;
}
function _sendCtWorkflowEmail(event, ct) {
  if(!window.emailjs) return;
  var contacts = getContactSettings();
  var hmName  = contacts.hm_name  || 'Housing Manager';
  var hmEmail = contacts.hm_email || '';
  var edName  = contacts.ed_name  || 'Executive Director';
  var edEmail = contacts.ed_email || '';

  var configs = {
    hm_recommended: { to_name: edName,  to_email: edEmail,  subject: 'CLFN Housing — Contractor Application Recommended: '+ct.name, message: 'The Housing Manager has reviewed and recommended the contractor application for '+ct.name+' ('+ct.trade+'). Your final approval is required.' },
    approved:       { to_name: hmName,  to_email: hmEmail,  subject: 'CLFN Housing — Contractor Approved: '+ct.name,                 message: 'The Executive Director has granted final approval for '+ct.name+'. They are now listed as an approved contractor.' },
    declined:       { to_name: hmName,  to_email: hmEmail,  subject: 'CLFN Housing — Contractor Application Declined: '+ct.name,      message: 'The application for '+ct.name+' has been declined.'+(ct.declinedReason?' Reason: '+ct.declinedReason:'') },
    returned:       { to_name: hmName,  to_email: hmEmail,  subject: 'CLFN Housing — Contractor Application Returned: '+ct.name,      message: 'The application for '+ct.name+' has been returned for more information.'+(ct.returnedNotes?' Notes: '+ct.returnedNotes:'') }
  };
  var cfg = configs[event];
  if(!cfg || !cfg.to_email) return;
  emailjs.send('service_35sybq2','template_d0wynda',{
    to_name:cfg.to_name, to_email:cfg.to_email, from_name:'CLFN Housing App',
    subject:cfg.subject, message:cfg.message,
    app_name:ct.name, app_id:ct.id||'—', app_score:'—', app_tier:'—', notes:'', action_url:window.location.href
  }).then(function(){console.log('CT email sent:',event);}).catch(function(e){console.error(e);});
}
function _updateRbaAllocSummary(totalCost, eligiblePools, budgetData) {
  var totalAlloc = 0;
  document.querySelectorAll('#rba_alloc_rows input[type="number"]').forEach(function(inp){
    totalAlloc += parseFloat(inp.value)||0;
  });
  var diff = totalAlloc - totalCost;
  var overBudget = false;

  // Check per-pool over-budget
  var poolTotals = {};
  document.querySelectorAll('#rba_alloc_rows [id^="rba_pool_"]').forEach(function(sel){
    var key = sel.id.replace('rba_pool_','');
    var amtEl = document.getElementById('rba_amt_'+key);
    var amt = parseFloat((amtEl&&amtEl.value)||0)||0;
    var pid = sel.value;
    poolTotals[pid] = (poolTotals[pid]||0)+amt;
  });

  var poolWarnings = [];
  eligiblePools.forEach(function(pid){
    var pool = BUDGET_POOLS.find(function(p){ return p.id===pid; });
    var poolData = budgetData.pools[pid]||{allocated:0};
    var allocated = poolData.allocated||0;
    var spent = _getPoolSpent(pid);
    var available = allocated - spent;
    var using = poolTotals[pid]||0;
    if(using > available) {
      overBudget = true;
      poolWarnings.push((pool?pool.label:pid)+' is over available balance by $'+Math.round(using-available).toLocaleString());
    }
  });

  var summaryEl = document.getElementById('rba_alloc_summary');
  var overBudgetSection = document.getElementById('rba_over_budget_section');
  var statusBadge = document.getElementById('rba_status_badge');

  if(overBudget) {
    summaryEl.style.background='#fef2f2'; summaryEl.style.border='1px solid #b91c1c';
    summaryEl.innerHTML = '<div style="color:#b91c1c;font-weight:700;margin-bottom:4px;">⚠️ Over Budget</div>'
      +'<div style="font-size:11px;color:#b91c1c;">'+poolWarnings.join('<br/>')+'</div>';
    overBudgetSection.style.display='block';
    var msg = document.getElementById('rba_over_budget_msg');
    if(msg) msg.textContent = 'The allocated amounts exceed available pool balances. Executive Director approval and written justification are required.';
    statusBadge.textContent='Over Budget — ED Approval Required'; statusBadge.style.background='#fef2f2'; statusBadge.style.color='#b91c1c';
  } else {
    summaryEl.style.background='#f0fdf4'; summaryEl.style.border='1px solid #bbf7d0';
    summaryEl.innerHTML = '<div style="color:#15803d;font-weight:700;">✓ Within Budget</div>'
      +'<div style="font-size:11px;color:#15803d;">Total allocated: $'+Math.round(totalAlloc).toLocaleString()+' of $'+Math.round(totalCost).toLocaleString()+' SOW cost</div>';
    overBudgetSection.style.display='none';
    statusBadge.textContent='Pending Approval'; statusBadge.style.background='var(--bg)'; statusBadge.style.color='var(--muted)';
  }
}
function addScoringCriteria(){
  var cat  = (document.getElementById('ac_category')||{}).value||'Custom';
  var lbl  = (document.getElementById('ac_label')||{}).value||'';
  var cond = (document.getElementById('ac_condition')||{}).value||'';
  var pts  = parseInt((document.getElementById('ac_points')||{}).value)||0;
  if(!lbl){ showToast('Label is required'); return; }
  var newRow = {
    id: 'custom_'+Date.now(), category: cat, label: lbl,
    condition_key: cond, min_value: null, max_value: null,
    points: pts, sortOrder: 9999
  };
  liveScoreModel.push(newRow);
  saveScoringModel();
  renderScoringModelTable();
  closeAddCriteriaModal();
  rescoreAllApplications();
  showToast('Criteria added');
}
function addSowItem(data){
  var cont=document.getElementById('sow_items');if(!cont)return;
  var idx=_sowItemIdx++;
  var catOpts=SOW_CATEGORIES.map(function(cat){return '<option value="'+cat+'"'+(data&&data.category===cat?' selected':'')+'>'+cat+'</option>';}).join('');
  var div=document.createElement('div');div.id='sow_item_'+idx;
  div.style.cssText='display:grid;grid-template-columns:160px 1fr 110px auto;gap:8px;align-items:start;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px;';
  div.innerHTML='<select data-sow="category" style="font-size:12px;padding:6px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);"><option value="">Category</option>'+catOpts+'</select>'
    +'<input data-sow="description" type="text" placeholder="Describe the work required…" value="'+(data&&data.description?data.description.replace(/"/g,'&quot;'):'')+'" style="font-size:12px;padding:6px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);"/>'
    +'<div style="display:flex;flex-direction:column;gap:3px;">'
    +'<input data-sow="cost" type="number" placeholder="Est. $" min="0" step="100" value="'+(data&&data.cost?parseFloat((data.cost||'').replace(/[^0-9.]/g,''))||'':'')+'" style="font-size:11px;padding:5px 6px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);" oninput="recalcSowTotal()" title="Internal estimate (not shown on work order)"/>'
    +'<input data-sow="quote" type="number" placeholder="Quote $" min="0" step="100" value="'+(data&&data.quote?parseFloat((data.quote||'').replace(/[^0-9.]/g,''))||'':'')+'" style="font-size:11px;padding:5px 6px;border:1px solid #1d4ed833;border-radius:6px;background:#eff6ff;color:var(--text);" title="Contractor quoted price (shown on work order)"/>'
    +'<div style="font-size:9px;color:var(--muted);text-align:center;line-height:1.2;">Est / Quote</div>'
    +'</div>'
    +'<button type="button" data-sow-del="'+idx+'" style="background:none;border:1px solid #b91c1c33;color:#b91c1c;border-radius:6px;padding:6px 8px;cursor:pointer;font-size:12px;">✕</button>';
  cont.appendChild(div);
  div.querySelector('[data-sow-del]').addEventListener('click',function(){
    var el=document.getElementById('sow_item_'+idx);if(el)el.remove();
    recalcSowTotal();
  });
  recalcSowTotal();
}
function cancelCtAction() {
  _ctPendingAction = null;
  var nw = document.getElementById('ctap_notes_wrap');
  if(nw) nw.style.display='none';
  var ni = document.getElementById('ctap_notes');
  if(ni) ni.value='';
}
function closeAddContractorModal(){
  var acm=document.getElementById('addContractorModal');if(acm)acm.style.display='none';
  // If search modal was the caller and is still mounted, refresh its results
  var sm = document.getElementById('contractorSearchModal');
  if(sm && sm.style.display !== 'none') {
    var inp = document.getElementById('ct_search_input');
    contractorSearchFilter(inp ? inp.value : '');
  }
}
function closeCtApprovalPanel() {
  var panel = document.getElementById('ctApprovalPanel');
  if(panel) panel.style.display='none';
  _ctApprovalIdx = -1;
  _ctPendingAction = null;
}
function closePrintPanel() {
  var panel = document.getElementById('printPanel');
  if(panel) panel.style.display = 'none';
  document.body.style.overflow = '';
  _printPanelDoc = '';
}
function closeRenoBudget() {
  var modal = document.getElementById('renoBudgetModal');
  if(modal) modal.style.display='none';
}
function closeRenoProgress() {
  var modal = document.getElementById('renoProgressModal');
  if(modal) modal.style.display = 'none';
  window._rpPendingPhotos = [];
  window._rpStoredPhotos = [];
}
function closeSowModal() {
  var modal = document.getElementById('sowModal');
  if(modal) modal.style.display = 'none';
}
function collectSowItems(){
  var items=[];
  document.querySelectorAll('#sow_items > div').forEach(function(row){
    items.push({
      category:    (row.querySelector('[data-sow="category"]')||{}).value||'',
      description: (row.querySelector('[data-sow="description"]')||{}).value||'',
      cost:        (row.querySelector('[data-sow="cost"]')||{}).value||'',
      quote:       (row.querySelector('[data-sow="quote"]')||{}).value||''
    });
  });
  return items;
}
function confirmCtAction() {
  if(!_ctPendingAction) return;
  var action = _ctPendingAction.action;
  var needsNotes = _ctPendingAction.needsNotes;
  var notes = (document.getElementById('ctap_notes')||{}).value||'';
  notes = notes.trim();

  if(needsNotes && !notes) {
    showToast('Please add a note explaining this decision.');
    document.getElementById('ctap_notes').focus();
    return;
  }

  var contractors = [];
  var contractors = window._contractors || [];
  if(_ctApprovalIdx < 0 || _ctApprovalIdx >= contractors.length) return;
  var ct = contractors[_ctApprovalIdx];
  var role = window.currentRole || 'staff';
  var today = new Date().toISOString().split('T')[0];

  // Apply status change
  ct.status = action;
  if(action === 'hm_recommended') { ct.hmActionAt = today; ct.hmActionBy = role; ct.hmNotes = notes; }
  if(action === 'approved')        { ct.edActionAt = today; ct.edActionBy = role; ct.edNotes  = notes; }
  if(action === 'declined')        { ct.declinedAt = today; ct.declinedBy = role; ct.declinedReason = notes; }
  if(action === 'returned')        { ct.returnedAt = today; ct.returnedBy = role; ct.returnedNotes  = notes; }

  contractors[_ctApprovalIdx] = ct;
  window._contractors = contractors;

  // Audit entry
  var actionLabels = {hm_recommended:'HM verified and recommended to ED',approved:'ED granted final approval',declined:'Application declined'+(notes?' — '+notes:''),returned:'Returned for more information'+(notes?' — '+notes:'')};
  auditEntry('CT:'+ct.id, action, (actionLabels[action]||action)+': '+ct.name, role);

  // Workflow email
  _sendCtWorkflowEmail(action, ct);

  var toastLabels = {hm_recommended:'Recommended to ED',approved:'Contractor approved',declined:'Application declined',returned:'Returned for more info'};
  showToast(toastLabels[action]||action);
  cancelCtAction();
  openCtApprovalPanel(_ctApprovalIdx); // refresh panel
  renderContractorsView();
}
function ctFileDragLeave(zoneId){var z=document.getElementById(zoneId);if(z){z.style.borderColor='var(--border)';z.style.background='var(--bg)';}}
function ctFileUpload(input,bucket){
  if(!input.files||!input.files.length)return;
  if(!window._ctFiles)window._ctFiles={wsib:[],insurance:[],other:[]};
  Array.from(input.files).forEach(function(file){
    var reader=new FileReader();
    reader.onload=function(e){
      window._ctFiles[bucket].push({name:file.name,type:file.type,size:file.size,data:e.target.result,added:new Date().toISOString().slice(0,10)});
      renderCtFilePreview(bucket);
    };
    reader.readAsDataURL(file);
  });
  input.value='';
}
function ctGetPeople() {
  var people = [];
  var rows = document.querySelectorAll('#ct_people_list [data-pi]');
  var seen = {};
  rows.forEach(function(el) {
    var i = parseInt(el.getAttribute('data-pi'));
    if(!seen[i]) { seen[i] = {name:'', phone:'', email:''}; people[i] = seen[i]; }
    if(el.classList.contains('ct-person-name'))  seen[i].name  = el.value.trim();
    if(el.classList.contains('ct-person-phone')) seen[i].phone = el.value.trim();
    if(el.classList.contains('ct-person-email')) seen[i].email = el.value.trim();
  });
  return people.filter(function(p){ return p && (p.name||p.phone||p.email); });
}
function ctRenderPeople(people) {
  var list = document.getElementById('ct_people_list');
  if(!list) return;
  people = people || [];
  if(!people.length) { list.innerHTML = '<div style="font-size:12px;color:var(--muted);font-style:italic;padding:4px 0;">No key contacts added yet.</div>'; return; }
  list.innerHTML = people.map(function(p, i) {
    return '<div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;align-items:center;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px;">'
      +'<input type="text" class="ct-person-name" data-pi="'+i+'" value="'+(p.name||'')+'" placeholder="Full name" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:DM Sans,sans-serif;background:var(--surface);color:var(--text);"/>'
      +'<input type="tel" class="ct-person-phone" data-pi="'+i+'" value="'+(p.phone||'')+'" placeholder="Phone" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:DM Sans,sans-serif;background:var(--surface);color:var(--text);"/>'
      +'<input type="email" class="ct-person-email" data-pi="'+i+'" value="'+(p.email||'')+'" placeholder="Email" style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:DM Sans,sans-serif;background:var(--surface);color:var(--text);"/>'
      +'<button type="button" onclick="ctRemovePerson('+i+')" style="background:none;border:none;color:#b91c1c;cursor:pointer;font-size:16px;padding:2px 4px;line-height:1;" title="Remove">✕</button>'
      +'</div>';
  }).join('');
}
function ctSetFilter(status) {
  window._ctFilter = status;
  renderContractorsView();
}
function ctUpdateClassBorders() {
  var labels = document.querySelectorAll('input[name="ct_classification"]');
  labels.forEach(function(radio) {
    var label = radio.closest('label');
    if(!label) return;
    label.style.borderColor = radio.checked ? 'var(--yellow)' : 'var(--border)';
    label.style.background  = radio.checked ? 'rgba(248,228,26,0.06)' : '';
    // Show/hide proof field for indigenous types
    var proofRow = document.getElementById('ct_class_proof_row');
    var anyIndigenous = document.querySelector('input[name="ct_classification"][value="internal_indigenous"]:checked')
                     || document.querySelector('input[name="ct_classification"][value="external_indigenous"]:checked');
    if(proofRow) proofRow.style.display = anyIndigenous ? '' : 'none';
  });
}
async function deactivateStaff(id, btn){
  if(!confirm('Deactivate this staff member? They will lose access to the app.')) return;
  if(btn){btn.disabled=true;btn.textContent='...';}
  try {
    var r = await fetch(SUPABASE_URL+'/rest/v1/staff?id=eq.'+id,{
      method:'PATCH',
      headers:Object.assign({},HOUSING_HEADERS,{'Prefer':'return=minimal'}),
      body:JSON.stringify({is_active:false})
    });
    if(r.ok){
      showToast('Staff member deactivated');
      renderHousingUserTable();
    } else {
      showToast('Could not deactivate — check permissions');
      if(btn){btn.disabled=false;btn.textContent='Deactivate';}
    }
  } catch(e){
    showToast('Error: '+e.message);
    if(btn){btn.disabled=false;btn.textContent='Deactivate';}
  }
}
async function _sbEditStaffModal(id) {
  // Fetch current staff record
  var r = await fetch(SUPABASE_URL+'/rest/v1/staff?id=eq.'+id+'&select=*', { headers: HOUSING_HEADERS });
  var data = await r.json();
  var u = data[0];
  if(!u) { showToast('Staff member not found'); return; }

  // Determine current housing role
  var currentHrole = sbMapRole(u);

  // Build modal
  var modal = document.getElementById('editStaffModal');
  if(!modal) {
    modal = document.createElement('div');
    modal.id = 'editStaffModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    document.body.appendChild(modal);
  }

  modal.innerHTML = '<div style="background:var(--surface);border-radius:12px;padding:28px;max-width:460px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.3);">'
    +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">'
    +'<div style="font-size:15px;font-weight:700;">Edit Staff Member</div>'
    +'<button id="editStaffClose" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--muted);">&times;</button>'
    +'</div>'
    +'<div style="display:flex;flex-direction:column;gap:14px;">'
    +'<div class="f"><label>Full Name</label><input type="text" id="edit_staff_name" value="'+u.name.replace(/"/g,'&quot;')+'" style="padding:8px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;font-family:DM Sans,sans-serif;background:var(--surface);color:var(--text);width:100%;box-sizing:border-box;"/></div>'
    +'<div class="f"><label>Email</label><input type="text" value="'+u.email+'" disabled style="padding:8px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;font-family:DM Sans,sans-serif;background:var(--bg);color:var(--muted);width:100%;box-sizing:border-box;" title="Email cannot be changed"/></div>'
    +'<div class="f"><label>Housing Role</label>'
    +'<select id="edit_staff_role" style="padding:8px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;font-family:DM Sans,sans-serif;background:var(--surface);color:var(--text);width:100%;">'
    + (function(){
        var perms = window.CLFN_PERMS;
        if(!perms) return '<option value="housing_employee_l1">Housing Employee L1</option>';
        return Object.keys(perms.ROLE_LABELS).map(function(k){
          return '<option value="'+k+'"'+(currentHrole===k?' selected':'')+'>'+perms.roleLabel(k)+'</option>';
        }).join('');
      })()
    +'</select></div>'
    +'<div style="font-size:11px;color:var(--muted);background:var(--bg);border-radius:6px;padding:8px 10px;">Changing the role takes effect the next time this staff member signs in.</div>'
    +'</div>'
    +'<div style="display:flex;gap:10px;margin-top:20px;justify-content:flex-end;">'
    +'<button id="editStaffCancel" style="background:none;border:1px solid var(--border);color:var(--muted);padding:8px 18px;border-radius:7px;font-size:13px;font-weight:600;cursor:pointer;font-family:DM Sans,sans-serif;">Cancel</button>'
    +'<button id="editStaffSave" style="background:var(--yellow);border:none;color:#111;padding:8px 20px;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;">Save Changes</button>'
    +'</div>'
    +'</div>';

  modal.style.display = 'flex';
  document.getElementById('editStaffClose').addEventListener('click', function(){ modal.remove(); });
  document.getElementById('editStaffCancel').addEventListener('click', function(){ modal.remove(); });
  document.getElementById('editStaffSave').addEventListener('click', function(){ saveStaffEdit(id, u, modal); });
}
function emailContractorAgreement() {
  var ct = window._ctLastSaved || _readContractorFormData();
  if(!ct.email) { showToast('No email address on file for this contractor'); return; }
  if(!window.emailjs) { showToast('EmailJS not available — will be configured at launch'); return; }

  var today = new Date().toLocaleDateString('en-CA');
  var classLabels = {
    internal_indigenous:     'Internal — Indigenous',
    external_indigenous:     'External — Indigenous',
    external_non_indigenous: 'External — Non-Indigenous'
  };

  var params = {
    to_name:    ct.name,
    to_email:   ct.email,
    from_name:  'CLFN Housing Department',
    subject:    'CLFN Housing — Contractor Agreement Confirmation: ' + ct.name,
    message:    'Please find below a summary of your contractor registration with CLFN Housing, completed on ' + today + '. Contractor: ' + ct.name + '. Trade: ' + (ct.trade||'--') + '. Classification: ' + (classLabels[ct.classification]||'--') + '. WSIB: ' + (ct.wsibNum||'--') + ' (Expiry: ' + (ct.wsibExpiry||'--') + '). Insurance: ' + (ct.insProvider||'--') + ' ' + (ct.insAmount||'--') + ' (Expiry: ' + (ct.insExpiry||'--') + '). Terms of Reference: ' + (ct.torAgreed ? 'Agreed on ' + (ct.torAgreedAt||today) : 'Not yet agreed') + '. A signed copy has been retained on file by CLFN Housing.',
    app_name:   ct.name,
    app_id:     ct.id || '—',
    app_score:  '—',
    app_tier:   '—',
    notes:      '',
    action_url: window.location.href
  };

  showToast('Sending agreement to ' + ct.email + '…');
  emailjs.send('service_35sybq2', 'template_d0wynda', params)
    .then(function(){
      showToast('✓ Agreement emailed to ' + ct.email);
      // Mark as emailed in the contractor record
      try {
        var contractors = (window._contractors || []).slice();
        var idx = contractors.findIndex(function(c){ return c.id === ct.id; });
        if(idx >= 0) { contractors[idx].agreementEmailedAt = new Date().toISOString().split('T')[0]; window._contractors = contractors; sbSaveContractor(contractors[idx]).catch(function(){}); }
      } catch(e) {}
    })
    .catch(function(err){ showToast('Email failed — check EmailJS config'); console.error(err); });
}
function exportContractors(format) {
  var contractors = window._contractors || [];
  var headers=['Company','Trade','Phone','Email','Address','HST #','WSIB #','WSIB Expiry','Insurance Provider','Insurance Expiry','Key Contacts'];
  var data=contractors.map(function(ct){
    var people=(ct.people||[]).map(function(p){return p.name+(p.phone?' ('+p.phone+')':'');}).join('; ');
    return[ct.name||'',ct.trade||'',ct.phone||'',ct.email||'',ct.address||'',ct.hst||'',ct.wsibNum||'',ct.wsibExpiry||'',ct.insProvider||'',ct.insExpiry||'',people];
  });
  _doExport(format,headers,data,'CLFN_Contractors_'+new Date().toISOString().slice(0,10),[28,18,14,24,24,14,14,14,20,14,24],true);
}
function exportInventory(format) {
  var units = (typeof housingUnits!=='undefined'&&housingUnits.length)?housingUnits:(window.HOUSING_UNITS_DATA||[]);
  var search=(document.getElementById('inv_search')||{}).value||'';
  var fStatus=(document.getElementById('inv_filter_status')||{}).value||'';
  var fType=(document.getElementById('inv_filter_type')||{}).value||'';
  var fAccess=(document.getElementById('inv_filter_access')||{}).value||'';
  var rows=units.filter(function(u){
    if(search&&!(u.street+' '+u.num).toLowerCase().includes(search.toLowerCase())) return false;
    if(fStatus&&u.status!==fStatus) return false;
    if(fType){var t=(u.type||'').toLowerCase();if(fType==='detached'&&!t.includes('detached'))return false;if(fType==='duplex'&&!t.includes('duplex'))return false;if(fType==='plex'&&!t.match(/plex/))return false;if(fType==='complex'&&!t.includes('complex'))return false;if(fType==='mobile'&&!t.includes('mobile'))return false;}
    if(fAccess==='yes'&&!u.accessible)return false;
    if(fAccess==='no'&&u.accessible)return false;
    return true;
  });
  var headers=['Address','Beds','Baths','Type','Foundation','Accessible','Funder','Status','Tenant','Phase'];
  var data=rows.map(function(u){return[u.num+' '+u.street,u.bedrooms,(u.bathrooms&&u.bathrooms!=='0'&&u.bathrooms!=='nan')?u.bathrooms:'',(u.type&&u.type!=='0'&&u.type!=='nan')?u.type:'',(u.foundation&&u.foundation!=='nan'&&u.foundation!=='0')?u.foundation:'',u.accessible?'Yes':'No',u.funder||'',u.status,u.assignedName||'',(u.phase&&u.phase!=='nan'&&u.phase!=='0')?u.phase:''];});
  _doExport(format,headers,data,'CLFN_Housing_Inventory_'+new Date().toISOString().slice(0,10),[28,6,6,18,14,10,12,14,22,8],true);
}
function exportMatch(format) {
  var allApps=(typeof applications!=='undefined'?applications:[]);
  var search=(document.getElementById('match_search')||{}).value||'';
  var fTier=(document.getElementById('match_filter_tier')||{}).value||'';
  var fStatus=(document.getElementById('match_filter_status')||{}).value||'';
  var rows=allApps.filter(function(a){
    if(a.status===APP_STATUS.DRAFT||a.status===APP_STATUS.ARCHIVED) return false;
    if(fTier&&a.tier!==fTier) return false;
    if(fStatus&&a.status!==fStatus) return false;
    if(search){var name=((a.fn||'')+' '+(a.ln||'')).toLowerCase();if(!name.includes(search.toLowerCase())&&!(a.id||'').toLowerCase().includes(search.toLowerCase())) return false;}
    return true;
  });
  var headers=['App ID','Name','Score','Tier','Status','Classification','Band Member','Reserve','Bedrooms Needed','Accessibility','Arrears'];
  var data=rows.map(function(a){return[a.id,(a.fn||'')+' '+(a.ln||''),a.score||0,a.tier||'',a.status,a.classification||'',a.band?'Yes':'No',a.reserve||'',a.bedNeed||'',(a.accessibility?'Yes':'No'),(a.hasArrears?'Yes':'No')];});
  _doExport(format,headers,data,'CLFN_Match_'+new Date().toISOString().slice(0,10),[16,22,10,16,14,20,12,14,14,12,10],true);
}


function g(id)  { const e=document.getElementById(id); return e?e.value:''; }
function getDefaultBudget(){
  var obj={fiscalYear:'2025-2026',pools:{}};
  BUDGET_POOLS.forEach(function(p){ obj.pools[p.id]={allocated:0,notes:''}; });
  return obj;
}
function getRenoScoreModel() {
  var model = (typeof DEFAULT_RENO_SCORE_MODEL !== 'undefined') ? DEFAULT_RENO_SCORE_MODEL : [];
  if (!model.length) return [];
  try {
    var saved = (window._appSettings && window._appSettings['reno_score_model']) || null;
    if(!saved) return model.map(function(r){ return Object.assign({},r); });
    return model.map(function(def) {
      var match = saved.find(function(s){ return s.id === def.id; });
      return match ? Object.assign({},def,{pts:match.pts}) : Object.assign({},def);
    });
  } catch(e) { return model.map(function(r){ return Object.assign({},r); }); }
}
function getUnitScoreModel(){
  var saved=loadUnitScoreModel();
  if(!saved)return DEFAULT_UNIT_SCORE_MODEL.map(function(r){return Object.assign({},r);});
  return DEFAULT_UNIT_SCORE_MODEL.map(function(def){
    var match=saved.find(function(s){return s.id===def.id;});
    return match?Object.assign({},def,{pts:match.pts}):Object.assign({},def);
  });
}
function headerExport(format) {
  var m = document.getElementById('header_export_menu');
  if(m) m.style.display='none';
  var view = window._currentExportView;
  if(view==='inventory')   exportInventory(format);
  else if(view==='match')  exportMatch(format);
  else if(view==='renos')  exportRenos(format);
  else if(view==='contractors') exportContractors(format);
  else showToast('Nothing to export on this page.');
}
function initCtAction(action, needsNotes) {
  _ctPendingAction = {action:action, needsNotes:needsNotes};
  var nw = document.getElementById('ctap_notes_wrap');
  var nr = document.getElementById('ctap_notes_req');
  var cb = document.getElementById('ctap_confirm_btn');
  var actionLabels = {hm_recommended:'Confirm Recommendation',approved:'Confirm Approval',declined:'Confirm Decline',returned:'Confirm Return'};
  if(nw) nw.style.display='block';
  if(nr) nr.textContent = needsNotes?'*':'';
  if(cb) cb.textContent = actionLabels[action]||action;
}
function loadBudgetData(){
  return (window._appSettings && window._appSettings['budget_pools']) || null;
}
function loadUnitScoreModel(){
  return (window._appSettings && window._appSettings['unit_score_model']) || null;
}
async function lookupUser(){
  var emailEl = document.getElementById('user_lookup_email');
  var email = emailEl ? emailEl.value.trim().toLowerCase() : '';
  var resultEl = document.getElementById('user_lookup_result');
  if(!resultEl) return;
  if(!email){ resultEl.style.display='none'; return; }
  if(!email.endsWith('@clfn.on.ca')){
    resultEl.style.display='block';
    resultEl.innerHTML='<div style="padding:10px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;font-size:12px;color:#b91c1c;">Only @clfn.on.ca email addresses can be added.</div>';
    return;
  }
  resultEl.innerHTML='<div style="padding:10px;font-size:12px;color:var(--muted);">Searching…</div>';
  resultEl.style.display='block';
  try {
    var r = await fetch(SUPABASE_URL+'/rest/v1/staff?select=*&email=eq.'+encodeURIComponent(email),{headers:HOUSING_HEADERS});
    var rows = await r.json();
    if(rows&&rows.length){
      var u=rows[0];
      var housingRole=sbMapRole(u);
      resultEl.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#fef9ec;border:1px solid var(--yellow-mid);border-radius:8px;">'
        +'<div><div style="font-size:13px;font-weight:600;">'+u.name+'</div>'
        +'<div style="font-size:11px;color:var(--muted);">'+email+' &middot; '+u.department+' &middot; <strong>'+housingRole+'</strong></div></div>'
        +'<span style="font-size:11px;color:#7a6000;font-weight:600;">Already registered</span>'
        +'</div>';
    } else {
      window._pendingLookupUser = {email:email};
      resultEl.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:var(--bg);border:1px solid var(--border);border-radius:8px;">'
        +'<div style="font-size:13px;color:var(--muted);">'+email+' — not yet in staff directory</div>'
        +'<button onclick="showAddHousingStaff()" class="btn btn-primary" style="font-size:12px;">Add Staff Member</button>'
        +'</div>';
    }
  } catch(e){
    resultEl.innerHTML='<div style="padding:10px;font-size:12px;color:#b91c1c;">Error: '+e.message+'</div>';
  }
}
function openAddContractorModal(editIdx){
  window._ctEditIdx = (editIdx !== undefined) ? editIdx : -1;
  window._ctLastSaved = null;
  window._ctFiles={wsib:[],insurance:[],other:[]};
  ['ct_print_btn','ct_email_btn'].forEach(function(id){var e=document.getElementById(id);if(e)e.style.display='none';});
  ['ct_name','ct_trade','ct_phone','ct_email','ct_notes','ct_address','ct_hst',
   'ct_wsib_num','ct_wsib_expiry','ct_ins_provider','ct_ins_policy','ct_ins_amount','ct_ins_expiry',
   'ct_class_proof','ct_sig_staff_name','ct_sig_staff_date','ct_sig_ct_name','ct_sig_ct_title','ct_sig_ct_date'
  ].forEach(function(id){var el=document.getElementById(id);if(el)el.value='';});
  ['ct_wsib_preview','ct_ins_preview','ct_other_preview'].forEach(function(id){
    var el=document.getElementById(id);if(el)el.innerHTML='';
  });
  // Reset classification
  document.querySelectorAll('input[name="ct_classification"]').forEach(function(r){r.checked=false;});
  ctUpdateClassBorders();
  var torAgreed=document.getElementById('ct_tor_agreed'); if(torAgreed)torAgreed.checked=false;
  // Reset sig canvases
  ['ct_sig_canvas_staff','ct_sig_canvas_ct'].forEach(function(id){clearSig(id);});
  ctRenderPeople([]);
  // Init sig pads after modal is visible
  setTimeout(function(){
    ['ct_sig_canvas_staff','ct_sig_canvas_ct'].forEach(_initSigPad);
  }, 80);
  // Pre-fill if editing
  if(window._ctEditIdx >= 0) {
    var contractors = [];
    var contractors = window._contractors || [];
    var ct = contractors[window._ctEditIdx];
    if(ct) {
      var set = function(id,v){ var el=document.getElementById(id); if(el) el.value=v||''; };
      set('ct_name', ct.name); set('ct_trade', ct.trade); set('ct_phone', ct.phone);
      set('ct_email', ct.email); set('ct_notes', ct.notes); set('ct_address', ct.address);
      set('ct_hst', ct.hst); set('ct_wsib_num', ct.wsibNum); set('ct_wsib_expiry', ct.wsibExpiry);
      set('ct_ins_provider', ct.insProvider); set('ct_ins_policy', ct.insPolicy);
      set('ct_ins_amount', ct.insAmount); set('ct_ins_expiry', ct.insExpiry);
      // New fields
      if(ct.classification){ var r=document.querySelector('input[name="ct_classification"][value="'+ct.classification+'"]'); if(r){r.checked=true;} ctUpdateClassBorders(); }
      set('ct_class_proof', ct.classProof);
      set('ct_sig_staff_name', ct.sigStaff && ct.sigStaff.name);
      set('ct_sig_staff_date', ct.sigStaff && ct.sigStaff.date);
      set('ct_sig_ct_name',  ct.sigCt && ct.sigCt.name);
      set('ct_sig_ct_title', ct.sigCt && ct.sigCt.title);
      set('ct_sig_ct_date',  ct.sigCt && ct.sigCt.date);
      var torEl=document.getElementById('ct_tor_agreed'); if(torEl)torEl.checked=!!ct.torAgreed;
      setTimeout(function(){
        ['ct_sig_canvas_staff','ct_sig_canvas_ct'].forEach(_initSigPad);
        if(ct.sigStaff && ct.sigStaff.image) _restoreSigCanvas('ct_sig_canvas_staff', ct.sigStaff.image);
        if(ct.sigCt    && ct.sigCt.image)    _restoreSigCanvas('ct_sig_canvas_ct',    ct.sigCt.image);
      }, 80);
      ctRenderPeople(ct.people || []);
    }
    // Update modal title and button
    var title = document.getElementById('ct_modal_title');
    if(title) title.textContent = 'Edit Contractor Application';
    var btn = document.getElementById('ct_save_btn');
    if(btn) btn.textContent = 'Save Changes';
  } else {
    var title = document.getElementById('ct_modal_title');
    if(title) title.textContent = 'Contractor Application';
    var btn = document.getElementById('ct_save_btn');
    if(btn) btn.textContent = 'Add Contractor';
  }
  var acm=document.getElementById('addContractorModal');
  if(acm){acm.style.removeProperty('display');acm.style.setProperty('display','flex','important');}
}
function openCtApprovalPanel(idx) {
  var contractors = [];
  var contractors = window._contractors || [];
  var ct = contractors[idx];
  if(!ct) return;
  _ctApprovalIdx = idx;

  var classLabels = {internal_indigenous:'Internal — Indigenous',external_indigenous:'External — Indigenous',external_non_indigenous:'External — Non-Indigenous'};
  var setT = function(id,v){ var el=document.getElementById(id); if(el) el.textContent=v||'—'; };

  setT('ctap_name',  ct.name);
  setT('ctap_trade', ct.trade);
  setT('ctap_phone', ct.phone);
  setT('ctap_email', ct.email);
  setT('ctap_class', classLabels[ct.classification]||ct.classification||'Not specified');
  setT('ctap_hst',   ct.hst);
  setT('ctap_wsib',  ct.wsibNum ? ct.wsibNum + (ct.wsibExpiry?' · Exp '+ct.wsibExpiry:'') : '—');
  setT('ctap_ins',   ct.insExpiry||'—');
  setT('ctap_tor',   ct.torAgreed ? 'Yes — '+( ct.torAgreedAt||'on file') : 'Not agreed');
  setT('ctap_submitted', ct.submittedAt||'—');

  // Status banner
  var ctStatusStyle = {
    pending_review: {bg:'#fffbeb',c:'#92400e',label:'⏳ Pending Housing Manager Review'},
    hm_recommended: {bg:'#eff6ff',c:'#1d4ed8',label:'📋 HM Recommended — Awaiting ED Approval'},
    approved:       {bg:'#f0fdf4',c:'#15803d',label:'✅ Approved — Active Contractor'},
    declined:       {bg:'#fef2f2',c:'#b91c1c',label:'❌ Declined'},
    returned:       {bg:'#faf5ff',c:'#7c3aed',label:'↩ Returned for More Information'}
  };
  var ss = ctStatusStyle[ct.status||'pending_review'] || {bg:'#f4f4f0',c:'#888',label:ct.status};
  var banner = document.getElementById('ctap_status_banner');
  if(banner){ banner.textContent=ss.label; banner.style.background=ss.bg; banner.style.color=ss.c; }

  // Render approval flow diagram
  _ctRenderFlow(ct.status||'pending_review', ct);

  // Render action buttons
  _ctRenderActions(ct);

  // Reset notes area
  var nw = document.getElementById('ctap_notes_wrap');
  if(nw) nw.style.display='none';
  var ni = document.getElementById('ctap_notes');
  if(ni) ni.value='';
  _ctPendingAction = null;

  // Render audit trail
  _ctRenderAudit(ct.id);

  // Show panel
  var panel = document.getElementById('ctApprovalPanel');
  if(panel){ panel.style.removeProperty('display'); panel.style.setProperty('display','flex','important'); }
}
function populateSettings(){
  // Populate HM budget limit
  var limitEl = document.getElementById('settings_hm_budget_limit');
  if(limitEl) {
    var s = window._appSettings || {};
    limitEl.value = s.hmBudgetLimit || 25000;
  }
  var settings = window._appSettings || {};
  // Also populate contact fields
  if(typeof populateContactSettings === 'function') populateContactSettings();
  ['hm_name','hm_email','hm_title','hm_phone','ed_name','ed_email','ed_title','ed_phone'].forEach(function(id){var el=document.getElementById(id);if(el&&settings[id])el.value=settings[id];});
  // Load user table from Supabase
  renderHousingUserTable();
  // Show and render the scoring model section
  var sms = document.getElementById('scoring_model_section');
  if(sms) sms.style.display = 'block';
  // V2 scoring editor — ED only
  if (window.currentRole === ROLE.ED) {
    renderV2ScoringEditor();
  } else {
    var wrap = document.getElementById('scoring_model_table_wrap');
    if (wrap) wrap.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-style:italic;">Scoring model configuration is only available to the Executive Director.</div>';
  }
}
function populateSow(data){
  var set=function(id,v){ var el=document.getElementById(id); if(el) el.value=v||''; };
  set('sow_address',data.address); set('sow_date',data.date); set('sow_prepared_by',data.preparedBy);
  set('sow_tenant_name',data.tenantName);
  set('sow_contractor',data.contractor); set('sow_condition',data.condition);
  var sowHid = document.getElementById('sow_contractor_id'); if(sowHid) sowHid.value = data.contractorId||'';
  set('sow_total_cost',data.totalCost); set('sow_start_date',data.startDate);
  set('sow_end_date',data.endDate); set('sow_notes',data.notes);
  set('sow_hm_name',data.hmName); set('sow_hm_date',data.hmDate);
  set('sow_ed_name',data.edName); set('sow_ed_date',data.edDate);
  // Restore signatures
  if(data.tenantSig) {
    set('sow_sig_tenant_name', data.tenantSig.name);
    set('sow_sig_tenant_date', data.tenantSig.date);
    setTimeout(function(){ _restoreSigCanvas('sow_sig_canvas_tenant', data.tenantSig.image); }, 150);
  }
  if(data.staffSig) {
    set('sow_sig_staff_name', data.staffSig.name);
    set('sow_sig_staff_date', data.staffSig.date);
    setTimeout(function(){ _restoreSigCanvas('sow_sig_canvas_staff', data.staffSig.image); }, 150);
  }
  var chk=function(id,v){ var el=document.getElementById(id); if(el) el.checked=!!v; };
  chk('sow_mold',data.mold); chk('sow_asbestos',data.asbestos);
  chk('sow_electrical',data.electrical); chk('sow_structural',data.structural);
  chk('sow_plumbing',data.plumbing); chk('sow_fire',data.fire);
  chk('sow_rent_arrears',data.rentArrears); chk('sow_tenant_damage',data.tenantDamage);
  chk('sow_negligence',data.negligence); chk('sow_vandalism',data.vandalism);
  chk('sow_police_report',data.policeReport);
  set('sow_accountability_notes', data.accountabilityNotes);
  var cont=document.getElementById('sow_items'); if(cont) cont.innerHTML='';
  _sowItemIdx=0;
  if(data.items && data.items.length) { data.items.forEach(function(item){ addSowItem(item); }); }
  else { addSowItem(); }
}
function printContractorAgreement() {
  // Read live form data — no save required to print
  var ct = window._ctLastSaved || _readContractorFormData();
  var html = _buildContractorAgreementHTML(ct);
  var w = window.open('','_blank','width=900,height=750,toolbar=0,menubar=0');
  if(!w){ showToast('Please allow popups to print'); return; }
  w.document.open(); w.document.write(html); w.document.close();
  w.onload = function(){ w.focus(); w.print(); };
}
function printSOW(){
  saveSOW();
  var get = function(id){ var el=document.getElementById(id); return el ? el.value.trim() : ''; };
  var chk = function(id){ var el=document.getElementById(id); return el && el.checked; };
  var items   = collectSowItems();
  var hazards = [
    {id:'sow_mold',       label:'Mould / Mildew'},
    {id:'sow_asbestos',   label:'Asbestos Risk'},
    {id:'sow_electrical', label:'Electrical Hazard'},
    {id:'sow_structural', label:'Structural Concern'},
    {id:'sow_plumbing',   label:'Plumbing / Sewage'},
    {id:'sow_fire',       label:'Fire Safety'}
  ].filter(function(h){ return chk(h.id); }).map(function(h){ return h.label; });

  var totalCost = get('sow_total_cost');
  var today = new Date().toLocaleDateString('en-CA');

  // Tenant / staff signature data
  var tenantName     = get('sow_sig_tenant_name') || get('sow_tenant_name') || '—';
  var tenantDate     = get('sow_sig_tenant_date') || '—';
  var tenantSigImg   = (typeof getSigDataURL === 'function') ? getSigDataURL('sow_sig_canvas_tenant') : '';
  var staffName      = get('sow_sig_staff_name') || get('sow_prepared_by') || '—';
  var staffDate      = get('sow_sig_staff_date') || today;
  var staffSigImg    = (typeof getSigDataURL === 'function') ? getSigDataURL('sow_sig_canvas_staff') : '';

  // Accountability flags
  var acctFlags = [];
  if(chk('sow_rent_arrears'))   acctFlags.push('Rent arrears');
  if(chk('sow_tenant_damage'))  acctFlags.push('Tenant damage');
  if(chk('sow_negligence'))     acctFlags.push('Negligence');
  if(chk('sow_vandalism'))      acctFlags.push('Vandalism');
  if(chk('sow_police_report'))  acctFlags.push('Police report on file');
  var acctNotes = get('sow_accountability_notes');

  // Helper: render a signature block (with or without image)
  

  // Helper: approval sig block (no canvas — printed blanks or filled names)
  function approvalBlock(role, name, date) {
    return '<div style="break-inside:avoid;">'
      +'<div style="font-size:8.5px;font-weight:bold;text-transform:uppercase;letter-spacing:.06em;color:#666;margin-bottom:4px;">'+role+'</div>'
      +'<div style="font-size:11px;font-weight:bold;color:#111;margin-bottom:6px;">'+(name||'_____________________________')+'</div>'
      +'<div style="height:40px;border-bottom:1px solid #555;margin-bottom:4px;"></div>'
      +'<div style="font-size:9px;color:#555;">Date: '+(date||'_____________')+'</div>'
      +'</div>';
  }

  var itemRows = items.filter(function(it){ return it.category||it.description||it.cost; }).map(function(it, i){
    var cost = it.cost ? '$'+parseFloat(it.cost).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) : '—';
    return '<tr style="'+(i%2===1?'background:#f8f8f8;':'')+'">'
      +'<td style="padding:7px 10px;border-bottom:1px solid #e5e5e5;font-size:10px;color:#444;">'+( it.category||'—')+'</td>'
      +'<td style="padding:7px 10px;border-bottom:1px solid #e5e5e5;font-size:10px;color:#222;">'+(it.description||'—')+'</td>'
      +'<td style="padding:7px 10px;border-bottom:1px solid #e5e5e5;font-size:10px;text-align:right;font-weight:600;color:#222;">'+cost+'</td>'
      +'</tr>';
  }).join('');

  var html = '<!DOCTYPE html><html lang="en"><head>'
    +'<meta charset="UTF-8"/>'
    +'<title>Scope of Work — CLFN Housing</title>'
    +'<style>'
    +'*{box-sizing:border-box;margin:0;padding:0;}'
    +'body{font-family:Georgia,serif;font-size:11px;color:#111;background:#fff;}'
    +'@page{size:letter portrait;margin:15mm 15mm 18mm 15mm;}'
    +'@media print{'
      +'body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}'
      +'.no-print{display:none!important;}'
      +'.page-break{page-break-before:always;}'
    +'}'
    +'.header{background:#000;color:#fff;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;margin-bottom:0;}'
    +'.header-left{display:flex;align-items:center;gap:14px;}'
    +'.header-logo{height:48px;width:auto;background:#000;}'
    +'.header-title{font-family:Georgia,serif;}'
    +'.header-title .org{font-size:13px;font-weight:bold;color:#F8E41A;letter-spacing:.04em;}'
    +'.header-title .dept{font-size:10px;color:#ccc;margin-top:2px;}'
    +'.header-right{text-align:right;}'
    +'.header-right .doc-type{font-size:16px;font-weight:bold;color:#F8E41A;letter-spacing:.05em;}'
    +'.header-right .doc-date{font-size:9px;color:#aaa;margin-top:3px;}'
    +'.yellow-bar{background:#F8E41A;height:4px;}'
    +'.body{padding:20px 0 0;}'
    +'.section{margin-bottom:20px;}'
    +'.section-title{font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:.08em;color:#fff;background:#000;padding:5px 10px;margin-bottom:0;}'
    +'.section-body{border:1px solid #ddd;border-top:none;padding:12px 14px;}'
    +'.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;}'
    +'.grid-4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px 16px;}'
    +'.field label{display:block;font-size:8.5px;font-weight:bold;text-transform:uppercase;letter-spacing:.06em;color:#666;margin-bottom:3px;}'
    +'.field span{display:block;font-size:11px;color:#111;min-height:14px;border-bottom:1px solid #e0e0e0;padding-bottom:3px;}'
    +'table{width:100%;border-collapse:collapse;font-size:10px;}'
    +'th{background:#000;color:#F8E41A;padding:7px 10px;text-align:left;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:.05em;}'
    +'th.right{text-align:right;}'
    +'.total-row td{background:#F8E41A;color:#000;font-weight:bold;padding:8px 10px;font-size:11px;}'
    +'.hazard-badge{display:inline-block;background:#fff0f0;color:#b91c1c;border:1px solid #fca5a5;padding:3px 9px;border-radius:3px;font-size:9px;font-weight:bold;margin:2px;}'
    +'.sig-block{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:4px;}'
    +'.sig-line{margin-top:32px;border-top:1px solid #333;padding-top:5px;font-size:9px;color:#555;}'
    +'.sig-name{font-size:11px;font-weight:bold;color:#111;margin-bottom:2px;}'
    +'.footer{margin-top:24px;border-top:3px solid #F8E41A;padding-top:8px;display:flex;justify-content:space-between;align-items:center;}'
    +'.footer-left{font-size:8.5px;color:#666;}'
    +'.footer-right{font-size:8.5px;color:#666;}'
    +'</style>'
    +'</head><body>'

    /* HEADER */
    +'<div class="header">'
      +'<div class="header-left">'
        +'<img class="header-logo" src="LOGO_SRC" alt="CLFN"/>'
        +'<div class="header-title">'
          +'<div class="org">Constance Lake First Nation</div>'
          +'<div class="dept">Housing Department</div>'
        +'</div>'
      +'</div>'
      +'<div class="header-right">'
        +'<div class="doc-type">SCOPE OF WORK</div>'
        +'<div class="doc-date">Generated: '+today+'</div>'
      +'</div>'
    +'</div>'
    +'<div class="yellow-bar"></div>'

    /* BODY */
    +'<div class="body">'

    /* Unit Info */
    +'<div class="section">'
      +'<div class="section-title">Unit Information</div>'
      +'<div class="section-body">'
        +'<div class="grid-4">'
          +'<div class="field"><label>Unit Address</label><span>'+get('sow_address')+'</span></div>'
          +'<div class="field"><label>Current Tenant</label><span>'+(get('sow_tenant_name')||'—')+'</span></div>'
          +'<div class="field"><label>Date Prepared</label><span>'+get('sow_date')+'</span></div>'
          +'<div class="field"><label>Prepared By</label><span>'+get('sow_prepared_by')+'</span></div>'
          +'<div class="field"><label>Contractor</label><span>'+(get('sow_contractor')||'—')+'</span></div>'
          +'<div class="field"></div>'
        +'</div>'
      +'</div>'
    +'</div>'

    /* Condition & Schedule */
    +'<div class="section">'
      +'<div class="section-title">Condition Assessment &amp; Schedule</div>'
      +'<div class="section-body">'
        +'<div class="grid-4">'
          +'<div class="field"><label>Overall Condition</label><span>'+get('sow_condition')+'</span></div>'
          +'<div class="field"><label>Estimated Total Cost</label><span>'+totalCost+'</span></div>'
          +'<div class="field"><label>Target Start Date</label><span>'+get('sow_start_date')+'</span></div>'
          +'<div class="field"><label>Target Completion</label><span>'+get('sow_end_date')+'</span></div>'
        +'</div>'
      +'</div>'
    +'</div>'

    /* Scope Items */
    +'<div class="section">'
      +'<div class="section-title">Scope of Work Items</div>'
      +'<table>'
        +'<thead><tr>'
          +'<th style="width:22%">Category</th>'
          +'<th>Description of Work</th>'
          +'<th class="right" style="width:14%">Est. Cost</th>'
        +'</tr></thead>'
        +'<tbody>'+itemRows+'</tbody>'
        +'<tfoot>'
          +'<tr class="total-row">'
            +'<td colspan="2" style="text-align:right;padding-right:16px;">TOTAL ESTIMATED COST</td>'
            +'<td style="text-align:right;">'+totalCost+'</td>'
          +'</tr>'
        +'</tfoot>'
      +'</table>'
    +'</div>'

    /* Health & Safety */
    +(hazards.length
      ? '<div class="section">'
          +'<div class="section-title">Health &amp; Safety Concerns</div>'
          +'<div class="section-body">'
            +hazards.map(function(h){ return '<span class="hazard-badge">⚠ '+h+'</span>'; }).join('')
          +'</div>'
        +'</div>'
      : '')

    /* Notes */
    +(get('sow_notes')
      ? '<div class="section">'
          +'<div class="section-title">Additional Notes</div>'
          +'<div class="section-body" style="font-size:11px;line-height:1.6;color:#222;">'+get('sow_notes')+'</div>'
        +'</div>'
      : '')

    /* Accountability */
    +((acctFlags.length || acctNotes)
      ? '<div class="section">'
          +'<div class="section-title">Tenant Accountability</div>'
          +'<div class="section-body">'
            +(acctFlags.length ? '<div style="margin-bottom:8px;">'+acctFlags.map(function(f){ return '<span class="hazard-badge">'+f+'</span>'; }).join(' ')+'</div>' : '')
            +(acctNotes ? '<div style="font-size:10px;color:#444;line-height:1.5;">'+acctNotes+'</div>' : '')
          +'</div>'
        +'</div>'
      : '')

    /* Terms & Conditions */
    +'<div class="section">'      +'<div class="section-title">Terms &amp; Conditions</div>'      +'<div class="section-body" style="font-size:9.5px;color:#444;line-height:1.65;">'        +'<p style="font-size:8.5px;font-weight:bold;text-transform:uppercase;letter-spacing:.05em;color:#888;margin-bottom:10px;">Constance Lake First Nation &mdash; Housing Department</p>'        +'<div style="margin-bottom:7px;"><strong>1. Prioritization of Requests.</strong> Renovation requests are assessed and prioritized based on urgency of need, health and safety risk to occupants, and overall unit condition. Immediate hazards &mdash; structural, electrical, plumbing, or fire safety &mdash; take priority over general maintenance and cosmetic work.</div>'        +'<div style="margin-bottom:7px;"><strong>2. Funding Eligibility &amp; Unit Qualifying Criteria.</strong> Approval is subject to available funding and the qualifying criteria of the unit under its applicable program (e.g. ISC, CMHC Sec. 95, CMHC Sec. 56.1, or Band-funded). Funding availability may affect the scope, cost ceiling, or timing of approved work.</div>'        +'<div style="margin-bottom:7px;"><strong>3. Budget Authority &amp; Approval Routing.</strong> Requests within the Housing Manager&rsquo;s approved budget authority may be approved by the HM. Requests exceeding that threshold require Executive Director approval before work commences. No work begins until all approvals are documented.</div>'        +'<div style="margin-bottom:7px;"><strong>4. Tenant Responsibilities.</strong> The tenant must provide timely access to the unit for inspection and work. Damage, negligence, or vandalism attributed to the tenant may reduce priority and may result in financial responsibility for a portion of repair costs.</div>'        +'<div style="margin-bottom:7px;"><strong>5. No Guarantee of Approval or Timeline.</strong> Submission does not guarantee approval or a specific completion date. Decisions will be communicated in writing. Priority and scheduling may change based on available resources and emerging urgent community needs.</div>'        +'<div><strong>6. Accuracy of Information.</strong> All information must be accurate and complete. False or misleading information may result in the request being cancelled, delayed, or referred for further review.</div>'      +'</div>'    +'</div>'
    /* Acknowledgement & Signatures */
    +'<div class="section">'
      +'<div class="section-title">Signatures &amp; Acknowledgement</div>'
      +'<div class="section-body">'
        /* Declaration text */
        +'<div style="font-size:9.5px;color:#444;line-height:1.6;margin-bottom:14px;padding:10px 12px;background:#f9f9f7;border-left:3px solid #F8E41A;">'
          +'By signing below, the tenant acknowledges the scope of work described in this document and grants access to the unit for the purpose of completing the renovation. '
          +'The Housing Staff member confirms this Scope of Work is accurate and complete.'
        +'</div>'
        /* Tenant + Staff */
        +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:20px;">'
          +sigBlock('Tenant Signature', tenantName, tenantDate, tenantSigImg)
          +sigBlock('Housing Staff Signature', staffName, staffDate, staffSigImg)
        +'</div>'
      +'</div>'
    +'</div>'

    /* Approvals */
    +'<div class="section">'
      +'<div class="section-title">Management Approvals</div>'
      +'<div class="section-body">'
        +'<div style="font-size:9px;color:#888;margin-bottom:12px;">Budget authority: HM may approve up to the configured limit. Work exceeding this limit requires Executive Director approval.</div>'
        +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">'
          +approvalBlock('Housing Manager Approval', get('sow_hm_name'), get('sow_hm_date'))
          +approvalBlock('Executive Director Approval', get('sow_ed_name'), get('sow_ed_date'))
        +'</div>'
      +'</div>'
    +'</div>'

    +'</div>'/* /body */

    /* FOOTER */
    +'<div class="footer">'
      +'<div class="footer-left">Constance Lake First Nation — Housing Department &nbsp;|&nbsp; Confidential</div>'
      +'<div class="footer-right">Generated '+today+'</div>'
    +'</div>'

    +'</body></html>';

  /* Inject logo */
  html = html.replace('LOGO_SRC', 'data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAbXB9ADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB//9k=');

  var w = window.open('','_blank','width=900,height=750,toolbar=0,menubar=0');
  if(!w){ showToast('Please allow popups to print'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.onload = function(){ w.focus(); w.print(); };
}
function printWorkOrder(){
  saveSOW();
  var get = function(id){ var el=document.getElementById(id); return el ? el.value.trim() : ''; };
  var items = collectSowItems().filter(function(it){ return it.category||it.description||it.quote||it.cost; });
  var today = new Date().toLocaleDateString('en-CA');
  var address  = get('sow_address');
  var contractor = get('sow_contractor');
  var startDate  = get('sow_start_date');
  var endDate    = get('sow_end_date');
  var preparedBy = get('sow_prepared_by');
  var tenantName = get('sow_tenant_name');

  // Quote total — use contractor quote if available, else blank
  var quoteTotal = 0;
  var hasQuotes = false;
  items.forEach(function(it){
    if(it.quote && parseFloat(it.quote) > 0) {
      quoteTotal += parseFloat(it.quote);
      hasQuotes = true;
    }
  });

  // Get logo
  var logoSrc = '';
  try {
    var logoImg = document.querySelector('.hlogo');
    if(logoImg && logoImg.src) logoSrc = logoImg.src;
  } catch(e) {}

  var itemRows = items.map(function(it, i){
    var quote = (it.quote && parseFloat(it.quote) > 0)
      ? '$'+parseFloat(it.quote).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})
      : '<span style="color:#aaa;">Pending</span>';
    return '<tr style="'+(i%2===1?'background:#f8f8f8;':'')+'">'
      +'<td style="padding:8px 10px;border-bottom:1px solid #e5e5e5;font-size:10px;color:#444;width:140px;">'+( it.category||'—')+'</td>'
      +'<td style="padding:8px 10px;border-bottom:1px solid #e5e5e5;font-size:10px;color:#222;">'+(it.description||'—')+'</td>'
      +'<td style="padding:8px 10px;border-bottom:1px solid #e5e5e5;font-size:11px;text-align:right;font-weight:600;color:#222;width:110px;">'+quote+'</td>'
      +'</tr>';
  }).join('');

  var totalRow = hasQuotes
    ? '<tr class="total-row"><td colspan="2" style="text-align:right;padding:9px 10px;font-size:10px;font-weight:bold;text-transform:uppercase;letter-spacing:.04em;">Total Quoted Amount</td><td style="text-align:right;padding:9px 10px;font-size:12px;font-weight:bold;">$'+quoteTotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})+'</td></tr>'
    : '<tr><td colspan="3" style="padding:9px 10px;font-size:10px;color:#888;font-style:italic;">Pricing to be confirmed by contractor</td></tr>';

  var html = '<!DOCTYPE html><html lang="en"><head>'
    +'<meta charset="UTF-8"/>'
    +'<title>Work Order — CLFN Housing</title>'
    +'<style>'
    +'*{box-sizing:border-box;margin:0;padding:0;}'
    +'body{font-family:Georgia,serif;font-size:11px;color:#111;background:#fff;}'
    +'@page{size:letter portrait;margin:15mm 15mm 18mm 15mm;}'
    +'@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}.no-print{display:none!important;}}'
    +'.header{background:#000;color:#fff;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;}'
    +'.org{font-size:13px;font-weight:bold;color:#F8E41A;}'
    +'.dept{font-size:10px;color:#ccc;margin-top:2px;}'
    +'.doc-type{font-size:18px;font-weight:bold;color:#F8E41A;letter-spacing:.05em;}'
    +'.doc-sub{font-size:9px;color:#aaa;margin-top:3px;}'
    +'.yellow-bar{background:#F8E41A;height:4px;}'
    +'.section-title{font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:.08em;color:#fff;background:#000;padding:5px 10px;}'
    +'.section-body{border:1px solid #ddd;border-top:none;padding:12px 14px;}'
    +'.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;}'
    +'.field label{display:block;font-size:8px;font-weight:bold;text-transform:uppercase;letter-spacing:.06em;color:#666;margin-bottom:3px;}'
    +'.field span{display:block;font-size:11px;color:#111;border-bottom:1px solid #e0e0e0;padding-bottom:3px;min-height:15px;}'
    +'table{width:100%;border-collapse:collapse;}'
    +'th{background:#000;color:#F8E41A;padding:7px 10px;text-align:left;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:.05em;}'
    +'th.r{text-align:right;}'
    +'.total-row td{background:#F8E41A;color:#000;font-weight:bold;padding:9px 10px;}'
    +'.notice{background:#fffbeb;border:1px solid #fde68a;border-radius:4px;padding:10px 14px;font-size:10px;color:#7a6000;margin-top:16px;line-height:1.6;}'
    +'.sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:8px;}'
    +'.sig-box .role{font-size:8px;font-weight:bold;text-transform:uppercase;letter-spacing:.05em;color:#666;margin-bottom:6px;}'
    +'.sig-box .sig-line{height:48px;border-bottom:1.5px solid #333;margin-bottom:5px;}'
    +'.sig-box .sig-label{font-size:9px;color:#555;}'
    +'.footer{margin-top:20px;border-top:3px solid #F8E41A;padding-top:8px;display:flex;justify-content:space-between;font-size:8.5px;color:#666;}'
    +'</style></head><body>'
    // Header
    +'<div class="header">'
      +'<div style="display:flex;align-items:center;gap:14px;">'
        +(logoSrc?'<img src="'+logoSrc+'" style="height:44px;width:auto;" alt="CLFN"/>':'')
        +'<div><div class="org">Constance Lake First Nation</div><div class="dept">Housing Department</div></div>'
      +'</div>'
      +'<div style="text-align:right;"><div class="doc-type">WORK ORDER</div><div class="doc-sub">Date: '+today+'</div></div>'
    +'</div>'
    +'<div class="yellow-bar"></div>'
    // Project info
    +'<div style="margin-top:16px;">'
    +'<div class="section-title">Project Information</div>'
    +'<div class="section-body">'
      +'<div class="grid-2" style="margin-bottom:10px;">'
        +'<div class="field"><label>Unit Address</label><span>'+( address||'—')+'</span></div>'
        +'<div class="field"><label>Tenant</label><span>'+(tenantName||'—')+'</span></div>'
        +'<div class="field"><label>Contractor</label><span>'+(contractor||'—')+'</span></div>'
        +'<div class="field"><label>Issued By</label><span>'+(preparedBy||'—')+'</span></div>'
        +'<div class="field"><label>Start Date</label><span>'+(startDate||'—')+'</span></div>'
        +'<div class="field"><label>Completion Date</label><span>'+(endDate||'—')+'</span></div>'
      +'</div>'
    +'</div>'
    // Scope items
    +'<div style="margin-top:16px;">'
    +'<div class="section-title">Scope of Work</div>'
    +'<table><thead><tr>'
      +'<th>Category</th><th>Description of Work</th><th class="r">Quoted Price</th>'
    +'</tr></thead><tbody>'
    +itemRows
    +totalRow
    +'</tbody></table>'
    +'</div>'
    // Terms notice
    +'<div class="notice">'
      +'<strong>Work Authorization:</strong> The contractor is authorized to perform only the work described above. '
      +'Any additional work or changes to scope must be approved in writing by the CLFN Housing Manager or Executive Director before work commences. '
      +'Invoices must reference this work order and unit address. Payment is subject to satisfactory completion and inspection.'
    +'</div>'
    // Signatures
    +'<div style="margin-top:24px;">'
    +'<div class="section-title">Authorization</div>'
    +'<div class="section-body">'
      +'<div class="sig-grid">'
        +'<div class="sig-box"><div class="role">Contractor Representative</div><div class="sig-line"></div><div class="sig-label">Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date: ____________</div><div style="margin-top:8px;font-size:9px;color:#555;">Print name: ____________________________</div></div>'
        +'<div class="sig-box"><div class="role">CLFN Housing — Authorized Signatory</div><div class="sig-line"></div><div class="sig-label">Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date: ____________</div><div style="margin-top:8px;font-size:9px;color:#555;">Print name: ____________________________</div></div>'
      +'</div>'
    +'</div></div>'
    +'<div class="footer"><span>CLFN Housing Department · Work Order</span><span>Generated: '+today+'</span></div>'
    +'</body></html>';

  var w = window.open('','_blank');
  if(w) {
    w.document.write(html);
    w.document.close();
    setTimeout(function(){ w.print(); }, 400);
  }
}
function raSetFilter(f) {
  _raFilter = f;
  renderRenoApprovalsView();
}
function recalcSowTotal(){
  var total=0;
  document.querySelectorAll('#sow_items [data-sow="cost"]').forEach(function(inp){
    var v=parseFloat((inp.value||'').replace(/[^0-9.]/g,''))||0;
    total+=v;
  });
  var el=document.getElementById('sow_total_cost');
  if(el) el.value = total>0 ? '$'+total.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) : '';
}
function removeRenoPhoto(idx) {
  window._rpStoredPhotos = window._rpStoredPhotos || [];
  window._rpStoredPhotos.splice(idx, 1);
  var preview = document.getElementById('rp_photo_preview');
  if(preview) {
    preview.innerHTML = window._rpStoredPhotos.map(function(src, i) {
      return '<div style="position:relative;width:80px;height:80px;border-radius:8px;overflow:hidden;border:1px solid var(--border);">'
        +'<img src="'+src+'" style="width:100%;height:100%;object-fit:cover;"/>'
        +'<button type="button" onclick="removeRenoPhoto('+i+')" style="position:absolute;top:3px;right:3px;background:rgba(0,0,0,0.6);border:none;color:#fff;border-radius:50%;width:18px;height:18px;font-size:11px;cursor:pointer;line-height:1;">✕</button>'
        +'</div>';
    }).join('');
    _renderRpPendingPhotos();
  }
}
function renderBudgetPools(){
  var tbody = document.getElementById('budget_pools_tbody');
  if(!tbody) return;
  var fyEl = document.getElementById('budget_fiscal_year');
  var data = loadBudgetData() || getDefaultBudget();
  if(fyEl) fyEl.value = data.fiscalYear || '2025-2026';

  var total = 0;
  tbody.innerHTML = BUDGET_POOLS.map(function(p){
    var pool = data.pools[p.id] || {allocated:0, notes:''};
    var alloc = pool.allocated || 0;
    total += alloc;
    return '<tr style="border-bottom:1px solid var(--border);">'
      +'<td style="padding:10px 12px;">'
        +'<div style="display:flex;align-items:center;gap:8px;">'
          +'<span style="font-size:16px;">'+p.icon+'</span>'
          +'<span style="font-size:13px;font-weight:600;color:var(--text);">'+p.label+'</span>'
        +'</div>'
      +'</td>'
      +'<td style="padding:10px 12px;text-align:right;">'
        +'<input type="number" id="budget_alloc_'+p.id+'" value="'+alloc+'" min="0" step="1000"'
          +' style="width:140px;text-align:right;padding:6px 10px;border:1px solid var(--border);border-radius:7px;font-size:14px;font-weight:700;background:var(--surface);color:var(--text);"'
          +' oninput="updateBudgetTotal()"/>'
      +'</td>'
      +'<td style="padding:10px 12px;">'
        +'<input type="text" id="budget_notes_'+p.id+'" value="'+(pool.notes||'').replace(/"/g,'&quot;')+'" placeholder="e.g. approved projects, restrictions…"'
          +' style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:7px;font-size:12px;background:var(--surface);color:var(--text);box-sizing:border-box;"/>'
      +'</td>'
      +'</tr>';
  }).join('');

  var gt = document.getElementById('budget_grand_total');
  if(gt) gt.textContent = '$' + Math.round(total).toLocaleString();
}
function renderContractorsView(){
  var list=document.getElementById('contractors_list');
  if(!list) return;
  var contractors = window._contractors || [];
  if(!contractors.length){
    list.innerHTML='<div style="grid-column:1/-1;" class="card"><div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:20px;text-align:center;"><span style="font-size:32px;">🧰</span><div style="font-weight:600;font-size:14px;">No contractors added yet</div><div style="color:var(--muted);font-size:13px;">Click "Add Contractor" to build your directory.</div></div></div>';
    return;
  }
  
  var ctFilter = window._ctFilter || '';
  var filtered = contractors.map(function(ct,i){ return {ct:ct, i:i}; }).filter(function(obj){
    if(!ctFilter) return true;
    return (obj.ct.status||'pending_review') === ctFilter;
  });

  var ctStatusStyle = {
    pending_review: {bg:'#fffbeb',c:'#92400e',label:'⏳ Pending HM Review'},
    hm_recommended: {bg:'#eff6ff',c:'#1d4ed8',label:'📋 Awaiting ED Approval'},
    approved:       {bg:'#f0fdf4',c:'#15803d',label:'✅ Approved'},
    declined:       {bg:'#fef2f2',c:'#b91c1c',label:'❌ Declined'},
    returned:       {bg:'#faf5ff',c:'#7c3aed',label:'↩ Returned for Info'}
  };

  var role = window.currentRole || 'housing_employee_l1';

  if(!filtered.length) {
    list.innerHTML = '<div style="grid-column:1/-1;padding:32px;text-align:center;color:var(--muted);font-size:13px;">No contractors match this filter.</div>';
    return;
  }

  list.innerHTML = filtered.map(function(obj){
    var ct = obj.ct; var i = obj.i;
    var wsibFiles=[];
    var insFiles=[];
    var otherFiles=[];
    var totalFiles=wsibFiles.length+insFiles.length+otherFiles.length;
    var ss = ctStatusStyle[ct.status||'pending_review'] || {bg:'#f4f4f0',c:'#888',label:ct.status||'Unknown'};
    var classLabels = {internal_indigenous:'Internal — Indigenous',external_indigenous:'External — Indigenous',external_non_indigenous:'External — Non-Indigenous'};
    return '<div class="card" style="position:relative;cursor:pointer;" onclick="openCtApprovalPanel('+i+')" title="View application">'
      +'<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:10px;">'
        +'<div style="width:38px;height:38px;border-radius:8px;background:var(--dark);color:var(--yellow);font-size:18px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">🧰</div>'
        +'<div style="flex:1;min-width:0;">'
          +'<div style="font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+ct.name+'</div>'
          +'<div style="font-size:12px;color:var(--muted);">'+(ct.trade||'General Contractor')+'</div>'
        +'</div>'
        +'<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:'+ss.bg+';color:'+ss.c+';white-space:nowrap;">'+ss.label+'</span>'
      +'</div>'
      +(ct.phone?'<div style="font-size:12px;color:var(--muted);margin-bottom:2px;">📞 '+ct.phone+'</div>':'')
      +(ct.email?'<div style="font-size:12px;color:var(--muted);margin-bottom:6px;">✉ '+ct.email+'</div>':'')
      +(ct.classification?'<div style="font-size:11px;color:var(--muted);margin-bottom:6px;">🏷 '+(classLabels[ct.classification]||ct.classification)+'</div>':'')
      +'<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:8px;padding-top:8px;border-top:1px solid var(--border);">'
        +(function(dateStr,label){
            if(!dateStr) return '';
            var days=Math.round((new Date(dateStr)-new Date())/(1000*60*60*24));
            var c=days<0?'#b91c1c':days<30?'#d97706':'#15803d';
            var t=days<0?'Expired':days<30?'Expiring soon':'Valid';
            return '<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;background:'+c+'22;color:'+c+';">'+label+': '+t+'</span>';
          })(ct.wsibExpiry,'WSIB')
        +' '+(function(dateStr,label){
            if(!dateStr) return '';
            var days=Math.round((new Date(dateStr)-new Date())/(1000*60*60*24));
            var c=days<0?'#b91c1c':days<30?'#d97706':'#15803d';
            var t=days<0?'Expired':days<30?'Expiring soon':'Valid';
            return '<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;background:'+c+'22;color:'+c+';">'+label+': '+t+'</span>';
          })(ct.insExpiry,'Insurance')
      +'</div>'
      +(totalFiles?'<div style="font-size:11px;color:var(--muted);margin-top:5px;">📎 '+totalFiles+' file'+(totalFiles!==1?'s':'')+' on file</div>':'')
      +'<div style="display:flex;gap:6px;margin-top:10px;padding-top:8px;border-top:1px solid var(--border);">'
        +(ROLE.isManagement(role)
          ?'<button type="button" onclick="event.stopPropagation();openCtApprovalPanel('+i+')" style="flex:1;background:none;border:1px solid var(--border);color:var(--text);padding:5px 0;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;font-family:DM Sans,sans-serif;">Review</button>'
          :'')
        +'<button type="button" onclick="event.stopPropagation();openAddContractorModal('+i+')" style="flex:1;background:none;border:1px solid var(--border);color:var(--muted);padding:5px 0;border-radius:6px;cursor:pointer;font-size:11px;font-family:DM Sans,sans-serif;">Edit</button>'
        +'<button type="button" onclick="event.stopPropagation();deleteContractor('+i+')" style="background:none;border:1px solid var(--border);color:#b91c1c;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:11px;font-family:DM Sans,sans-serif;">✕</button>'
      +'</div>'
      +'</div>';
  }).join('');
  // Update tab active states
  ['all','pending','hm','approved','declined'].forEach(function(k){
    var el = document.getElementById('ct_tab_'+k);
    if(!el) return;
    var match = k==='all'?'':k==='pending'?'pending_review':k==='hm'?'hm_recommended':k;
    var active = (window._ctFilter||'') === match;
    el.style.background = active ? 'var(--yellow)' : '';
    el.style.color = active ? '#111' : '';
    el.style.border = active ? 'none' : '';
  });
}
function renderCtFilePreview(bucket){
  var container=document.getElementById('ct_'+bucket+'_preview');
  if(!container)return;
  var files=(window._ctFiles||{})[bucket]||[];
  container.innerHTML=files.map(function(f,i){
    return '<div style="display:flex;align-items:center;gap:5px;padding:4px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-size:11px;">'
      +(f.type&&f.type.includes('pdf')?'📄':'📎')+' <span style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+f.name+'</span>'
      +'<button type="button" data-bucket="'+bucket+'" data-idx="'+i+'" style="background:none;border:none;color:#b91c1c;cursor:pointer;font-size:12px;padding:0 2px;">✕</button></div>';
  }).join('');
  container.querySelectorAll('button[data-bucket]').forEach(function(btn){
    btn.onclick=function(){window._ctFiles[btn.getAttribute('data-bucket')].splice(parseInt(btn.getAttribute('data-idx')),1);renderCtFilePreview(btn.getAttribute('data-bucket'));};
  });
}
async function renderHousingUserTable(){
  var tbody = document.getElementById('userTableBody');
  if(!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" style="padding:16px;text-align:center;color:var(--muted);font-size:12px;">Loading…</td></tr>';
  try {
    var r = await fetch(SUPABASE_URL+'/rest/v1/staff?select=*&is_active=eq.true&order=name',{headers:HOUSING_HEADERS});
    var staff = await r.json();
    if(!staff||!staff.length){
      tbody.innerHTML='<tr><td colspan="4" style="padding:16px;text-align:center;color:var(--muted);font-size:12px;">No staff found.</td></tr>';
      return;
    }
    var roleColors = {ed:'#15803d', housing_manager:'#1d4ed8', employee:'#888'};
    var roleLabels = {ed:'Executive Director', housing_manager:'Housing Manager', employee:'Employee'};
    window._staffCache = {};
    staff.forEach(function(u){ window._staffCache[u.id] = u; });
    tbody.innerHTML = staff.map(function(u){
      var hr = sbMapRole(u);
      var rc = roleColors[hr]||'#888';
      var rl = roleLabels[hr]||hr;
      var isMe = HOUSING_SESSION.email === u.email.toLowerCase();
      return '<tr style="border-bottom:1px solid var(--border);">'
        +'<td style="padding:10px 12px;font-weight:600;font-size:13px;">'+u.name+'</td>'
        +'<td style="padding:10px 12px;color:var(--muted);font-size:12px;">'+u.email+'</td>'
        +'<td style="padding:10px 12px;"><span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:8px;background:'+rc+'22;color:'+rc+';">'+rl+'</span></td>'
        +'<td style="padding:10px 12px;text-align:right;">'
        +(isMe ? '<span style="font-size:11px;color:var(--muted);">You</span>'
          : (window.currentRole=== ROLE.ED
            ? '<div style="display:flex;gap:6px;justify-content:flex-end;">'
              +'<button onclick="_sbEditStaffModal('+u.id+')" style="background:none;border:1px solid var(--border);color:var(--muted);border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer;font-family:DM Sans,sans-serif;">Edit</button>'
              +'<button onclick="deactivateStaff('+u.id+',this)" style="background:none;border:1px solid #fecaca;color:#b91c1c;border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer;font-family:DM Sans,sans-serif;">Deactivate</button>'
              +'</div>'
            : ''))
        +'</td>'
        +'</tr>';
    }).join('');
  } catch(e){
    tbody.innerHTML='<tr><td colspan="4" style="padding:16px;text-align:center;color:#b91c1c;font-size:12px;">Error loading staff: '+e.message+'</td></tr>';
  }
}
function renderRenoScoreBadge(unitId) {
  var el = document.getElementById('rp_reno_score_badge');
  if(!el) return;
  var result = calcRenoScore(unitId);
  var s = result.score;
  var tier = s >= 40 ? {label:'Critical',  bg:'#fef2f2', c:'#b91c1c'}
           : s >= 25 ? {label:'High',      bg:'#fef9ec', c:'#7a6000'}
           : s >= 12 ? {label:'Medium',    bg:'#eff6ff', c:'#1d4ed8'}
           :           {label:'Low',       bg:'#f0fdf4', c:'#15803d'};
  el.innerHTML = '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">'
    +'<div style="font-size:30px;font-weight:800;color:var(--text);">'+s+'</div>'
    +'<div>'
      +'<span style="display:inline-block;font-size:11px;font-weight:700;padding:3px 10px;border-radius:10px;background:'+tier.bg+';color:'+tier.c+';">'+tier.label+' Priority</span>'
      +'<div style="font-size:11px;color:var(--muted);margin-top:3px;">Renovation Priority Score</div>'
    +'</div>'
    +'<div style="flex:1;min-width:120px;margin-left:8px;">'
      +'<div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;">'
        +'<div style="height:100%;width:'+Math.min(100,Math.round((s/60)*100))+'%;background:'+tier.c+';border-radius:3px;transition:width .4s;"></div>'
      +'</div>'
    +'</div>'
    +'</div>'
    +'<div style="margin-top:10px;display:flex;flex-direction:column;gap:4px;">'
    +result.breakdown.map(function(b){
      return '<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;border-bottom:1px solid var(--border);">'
        +'<span style="color:var(--muted);">'+b.label+'</span>'
        +'<span style="font-weight:700;color:#15803d;">+'+b.pts+'</span>'
        +'</div>';
    }).join('')
    +'</div>';
}
function renderRenoScoreTable() {
  var tbody = document.getElementById('reno_score_tbody');
  if(!tbody) return;
  var model = getRenoScoreModel();
  var prevFactor = '';
  tbody.innerHTML = model.map(function(row) {
    var isNew = row.factor !== prevFactor;
    prevFactor = row.factor;
    var ptsColor = row.pts > 0 ? '#15803d' : row.pts < 0 ? '#b91c1c' : '#888';
    return '<tr style="border-bottom:1px solid var(--border);">'
      +'<td style="padding:9px 12px;font-size:13px;font-weight:600;color:var(--text);">'+(isNew?row.factor:'')+'</td>'
      +'<td style="padding:9px 12px;font-size:13px;color:var(--muted);">'+row.condition+'</td>'
      +'<td style="padding:9px 12px;text-align:center;">'
        +(row.editable
          ?'<input type="number" data-rsm-id="'+row.id+'" value="'+row.pts+'" step="1" min="-50" max="50"'
            +' style="width:60px;text-align:center;padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-weight:700;color:'+ptsColor+';background:var(--surface);"'
            +' onchange="this.style.color=+this.value>0?\'#15803d\':\'#888\'"/>'
          :'<span style="font-size:13px;font-weight:700;color:'+ptsColor+';">'+row.pts+'</span>')
      +'</td>'
      +'<td style="padding:9px 12px;font-size:11px;color:var(--muted);">'+row.notes+'</td>'
      +'</tr>';
  }).join('');
}
function renderRenosView(){
  /* getSowData defined globally below */
  function getRenoProgress(uid){ return window._renoProgress && window._renoProgress[uid] ? window._renoProgress[uid] : {}; }
  var units=(typeof housingUnits!=='undefined'&&housingUnits.length)?housingUnits:(window.HOUSING_UNITS_DATA||[]);

  // Combine under_repair and condemned into one list
  var allReno = units.filter(function(u){
    return (u.status==='under_repair' || u.status==='condemned') && !u.archived;
  });

  function byScore(a,b){ return calcRenoScore(b.id).score - calcRenoScore(a.id).score; }
  allReno.sort(byScore);

  // Active filter — stored on window so pill clicks re-render
  var activeFilter = window._renoViewFilter || 'all';

  var filtered = activeFilter === 'repair'    ? allReno.filter(function(u){ return u.status==='under_repair'; })
               : activeFilter === 'condemned' ? allReno.filter(function(u){ return u.status==='condemned'; })
               : allReno;

  // ── Pill chips ────────────────────────────────────────────────────────────
  var repairCount    = allReno.filter(function(u){ return u.status==='under_repair'; }).length;
  var condemnedCount = allReno.filter(function(u){ return u.status==='condemned'; }).length;

  var chipDefs = [
    { key:'all',       label:'All',             count: allReno.length },
    { key:'repair',    label:'🔨 Under Repair',  count: repairCount },
    { key:'condemned', label:'🚫 Condemned',     count: condemnedCount },
  ];

  function chip(def) {
    var active = activeFilter === def.key;
    return '<button onclick="window._renoViewFilter=\''+def.key+'\';renderRenosView();" style="'
      +'display:inline-flex;align-items:center;gap:5px;padding:5px 14px;border-radius:20px;border:1.5px solid '
      +(active ? 'var(--yellow);background:var(--yellow);color:#111;font-weight:700;' : 'var(--border);background:none;color:var(--muted);font-weight:600;')
      +'font-size:12px;cursor:pointer;font-family:DM Sans,sans-serif;transition:all .15s;">'
      +def.label
      +' <span style="font-size:11px;font-weight:800;padding:1px 7px;border-radius:10px;background:'+(active?'rgba(0,0,0,.15)':'var(--surface)')+';">'+def.count+'</span>'
      +'</button>';
  }

  function scoreBadge(uid){
    var r=calcRenoScore(uid); var s=r.score;
    var tier=s>=40?{label:'Critical',c:'#b91c1c',bg:'#fef2f2'}:s>=25?{label:'High',c:'#7a6000',bg:'#fef9ec'}:s>=12?{label:'Medium',c:'#1d4ed8',bg:'#eff6ff'}:{label:'Low',c:'#15803d',bg:'#f0fdf4'};
    return '<span style="font-size:15px;font-weight:800;color:var(--text);">'+s+'</span>'
      +' <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;background:'+tier.bg+';color:'+tier.c+';">'+tier.label+'</span>';
  }

  var cols = '<colgroup>'
    +'<col style="width:30%"/><col style="width:8%"/><col style="width:12%"/>'
    +'<col style="width:22%"/><col style="width:12%"/><col style="width:10%"/><col style="width:6%"/>'
    +'</colgroup>';

  var thead = '<thead><tr style="background:var(--dark2);border-bottom:2px solid var(--yellow);">'
    +'<th style="text-align:left;padding:9px 14px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#888;">Address</th>'
    +'<th style="text-align:center;padding:9px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#888;">Beds</th>'
    +'<th style="text-align:left;padding:9px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#888;">Status</th>'
    +'<th style="text-align:left;padding:9px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#888;">Progress</th>'
    +'<th style="text-align:left;padding:9px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#888;">Contractor</th>'
    +'<th style="text-align:left;padding:9px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#888;">Priority</th>'
    +'<th style="padding:9px 14px;"></th>'
    +'</tr></thead>';

  var rows = filtered.length ? filtered.map(function(u){
    var isCondemned = u.status === 'condemned';
    var statusPill = isCondemned
      ? '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:8px;background:#fef2f2;color:#b91c1c;">🚫 Condemned</span>'
      : '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:8px;background:#fffbeb;color:#92400e;">🔨 Under Repair</span>';
    var sow=getSowData(u.id);
    var prog=getRenoProgress(u.id);
    var pct=prog.overallPct||0;
    var progressCell=sow
      ?'<div style="font-size:12px;font-weight:600;margin-bottom:3px;">'+(prog.status||'No updates yet')+(pct?' — '+pct+'%':'')+'</div>'
        +'<div style="height:4px;width:100px;background:var(--border);border-radius:2px;overflow:hidden;"><div style="height:100%;width:'+pct+'%;background:'+(pct>=100?'#15803d':'var(--yellow)')+';border-radius:2px;"></div></div>'
      :'<span style="font-size:11px;color:var(--muted);">No SOW filed</span>';
    var ctName=sow&&sow.contractor?sow.contractor:'—';
    return '<tr style="border-bottom:1px solid var(--border);cursor:pointer;" data-rpid="'+u.id+'">'
      +'<td style="padding:10px 14px;font-weight:600;font-size:13px;'+(isCondemned?'color:#b91c1c;':'')+'">'+u.num+' '+u.street+'</td>'
      +'<td style="padding:10px 10px;text-align:center;font-weight:700;">'+u.bedrooms+'</td>'
      +'<td style="padding:10px 10px;">'+statusPill+'</td>'
      +'<td style="padding:10px 10px;">'+progressCell+'</td>'
      +'<td style="padding:10px 10px;font-size:12px;color:var(--muted);">'+ctName+'</td>'
      +'<td style="padding:10px 10px;">'+scoreBadge(u.id)+'</td>'
      +'<td style="padding:10px 14px;text-align:right;white-space:nowrap;">'
        +'<div style="display:flex;gap:5px;justify-content:flex-end;">'
        +'<button type="button" data-sow-rpid="'+u.id+'" style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 10px;cursor:pointer;font-size:11px;font-weight:600;font-family:DM Sans,sans-serif;white-space:nowrap;color:var(--muted);">🔨 SOW</button>'
        +'<button type="button" data-rp-rpid="'+u.id+'" style="background:var(--yellow);border:1px solid var(--yellow);border-radius:6px;padding:4px 10px;cursor:pointer;font-size:11px;font-weight:600;font-family:DM Sans,sans-serif;white-space:nowrap;color:#111;">📊 Progress</button>'
        +'</div>'
      +'</td></tr>';
  }).join('')
  : '<tr><td colspan="7" style="padding:40px;text-align:center;color:var(--muted);">No units match this filter.</td></tr>';

  var container = document.getElementById('renos_unified');
  if(!container) return;

  container.innerHTML = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;">'
    + chipDefs.map(chip).join('') + '</div>'
    + '<div class="card" style="padding:0;overflow:hidden;">'
    + '<table style="width:100%;border-collapse:collapse;">'+cols+thead+'<tbody id="renos_unified_tbody">'+rows+'</tbody></table>'
    + '</div>';

  var tbody2 = document.getElementById('renos_unified_tbody');
  if(tbody2){
    tbody2.querySelectorAll('[data-rpid]').forEach(function(row){
      row.addEventListener('click',function(){ openRenoProgress(row.getAttribute('data-rpid')); });
    });
    tbody2.querySelectorAll('[data-sow-rpid]').forEach(function(btn){
      btn.addEventListener('click',function(e){ e.stopPropagation(); openSowModal(btn.getAttribute('data-sow-rpid')); });
    });
    tbody2.querySelectorAll('[data-rp-rpid]').forEach(function(btn){
      btn.addEventListener('click',function(e){ e.stopPropagation(); openRenoProgress(btn.getAttribute('data-rp-rpid')); });
    });
  }
}

function renderScoresTable() {
  var fTier    = document.getElementById('scFilterTier')    ? document.getElementById('scFilterTier').value    : '';
  var fReserve = document.getElementById('scFilterReserve') ? document.getElementById('scFilterReserve').value : '';
  var list = applications.filter(function(a) {
    return (!fTier||a.tier===fTier) && (!fReserve||a.reserve===fReserve);
  });
  var sk=_scoresSortKey, sd=_scoresSortDir;
  list.sort(function(a,b) {
    var av = sk==='score' ? (a.score||0) : (a.tier||'');
    var bv = sk==='score' ? (b.score||0) : (b.tier||'');
    return av<bv ? sd : av>bv ? -sd : 0;
  });

  var CATS=['waitlist','reserve','band','income','relation','ages','access','moveIn','homeCond','renos','arrears','payment'];

  
  function tierBadge(tier) {
    if(!tier) return '—';
    var map = {
      'Critical Priority': {bg:'#f0fdf4',c:'#15803d'},
      'High Priority':   {bg:'#e8eef5',c:'#1e3a5f'},
      'Medium Priority': {bg:'#fef9ec',c:'#7a6000'},
      'Low Priority':    {bg:'#fef2f2',c:'#b91c1c'}
    };
    var tc = map[tier] || {bg:'#f0f0ec',c:'#888'};
    return '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:8px;background:'+tc.bg+';color:'+tc.c+';">'+tier.replace(' Priority','')+'</span>';
  }
  

  var tbody = document.getElementById('scoresTableBody');
  if(!tbody) return;
  if(!list.length) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--muted);">No applications match.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(function(a) {
    var bd  = a.scoreBreakdown || {};
    var barW = Math.min(100, Math.round(((a.score||0)/25)*100));
    var barC = !a.score ? '#ccc' : a.score<=5 ? '#b91c1c' : a.score<=10 ? '#d97706' : a.score<=15 ? '#3b82f6' : '#15803d';
    return '<tr class="sc-tr" style="cursor:pointer;" data-sc-id="'+a.id+'">'
      + '<td class="sc-td" style="padding:10px 16px;">'
      +   '<div style="font-weight:600;font-size:13px;">'+((a.fn||'')+' '+(a.ln||'')).trim()+'</div>'
      +   '<div style="font-size:11px;color:var(--muted);">'+a.id+'</div>'
      + '</td>'
      + '<td class="sc-td" style="text-align:center;padding:10px 16px;">'
      +   '<div style="font-size:20px;font-weight:700;color:var(--text);line-height:1;">'+(a.score!==null&&a.score!==undefined?a.score:'—')+'</div>'
      +   '<div style="height:3px;background:var(--border);border-radius:2px;margin-top:4px;width:40px;margin-inline:auto;">'
      +     '<div style="height:100%;width:'+barW+'%;background:'+barC+';border-radius:2px;"></div>'
      +   '</div>'
      + '</td>'
      + '<td class="sc-td" style="padding:10px 16px;">'+tierBadge(a.tier)+'</td>'
      + CATS.map(function(c){ return '<td class="sc-td" style="text-align:center;padding:10px 12px;">'+pts(bd[c])+'</td>'; }).join('')
      + '<td class="sc-td" style="padding:10px 16px;">'+statusPill(a.status)+'</td>'
      + '</tr>';
  }).join('');

  // Wire row clicks via delegation (avoids stale indexOf references)
  tbody.querySelectorAll('.sc-tr').forEach(function(tr) {
    tr.addEventListener('click', function() {
      var app = (typeof applications!=='undefined'?applications:[]).find(function(a){ return a.id===tr.getAttribute('data-sc-id'); });
      if(app) showScorecard(app);
    });
  });
}
function renderSowAuditLog(unitId) {
  var tbody = document.getElementById('sow_audit_tbody');
  if(!tbody) return;
  var log = [];
  // audit log loaded from Supabase

  // Filter to entries for this unit's SOW
  var prefix = 'SOW:' + (unitId || '');
  var sowLog = log.filter(function(e) { return e.appId === prefix; });

  // Action labels with icons
  var actionLabels = {
    'sow_created':       '🆕 Created',
    'sow_updated':       '✏️ Updated',
    'sow_tenant_signed': '✍️ Tenant Signed',
    'sow_staff_signed':  '✍️ Staff Signed',
    'sow_hm_approval':   '✅ HM Approval',
    'sow_ed_approval':   '✅ ED Approval',
    'sow_accountability':'⚠️ Accountability'
  };

  if(!sowLog.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="padding:16px 14px;color:var(--muted);font-style:italic;font-size:12px;">No audit entries yet — save the SOW to begin tracking.</td></tr>';
    return;
  }

  tbody.innerHTML = sowLog.map(function(e) {
    var d   = new Date(e.ts);
    var ds  = d.toLocaleDateString('en-CA') + ' ' + d.toLocaleTimeString('en-CA',{hour:'2-digit',minute:'2-digit'});
    var lbl = actionLabels[e.action] || e.action;
    return '<tr style="border-bottom:1px solid var(--border);">'
      + '<td style="padding:8px 14px;font-size:11px;color:var(--muted);white-space:nowrap;">' + ds + '</td>'
      + '<td style="padding:8px 14px;font-size:12px;font-weight:600;white-space:nowrap;">' + lbl + '</td>'
      + '<td style="padding:8px 14px;font-size:12px;color:var(--text);">' + (e.detail||'—') + '</td>'
      + '<td style="padding:8px 14px;font-size:11px;color:var(--muted);white-space:nowrap;">' + (e.user||'—') + '</td>'
      + '</tr>';
  }).join('');
}
function renderUnitScoreTable(){
  var tbody=document.getElementById('unit_score_tbody');
  if(!tbody)return;
  var model=getUnitScoreModel();
  var maxScore=0;
  ['bed','acc','eld'].forEach(function(g){
    var maxInGroup=Math.max.apply(null,model.filter(function(r){return r.group===g;}).map(function(r){return r.pts;}));
    if(maxInGroup>0)maxScore+=maxInGroup;
  });
  var maxEl=document.getElementById('unit_score_max');
  if(maxEl)maxEl.textContent=maxScore;
  var prevFactor='';
  tbody.innerHTML=model.map(function(row){
    var isNew=row.factor!==prevFactor;
    prevFactor=row.factor;
    var rowStyle='border-bottom:1px solid var(--border);'+(isNew&&prevFactor!==model[0].factor?'border-top:2px solid var(--border);':'');
    var ptsColor=row.pts>0?'#15803d':row.pts<0?'#b91c1c':'#888';
    var ptsDisplay=(row.pts>0?'+':'')+row.pts;
    return '<tr style="'+rowStyle+'">'
      +'<td style="padding:9px 12px;font-size:13px;font-weight:600;color:var(--text);">'+(isNew?row.factor:'')+'</td>'
      +'<td style="padding:9px 12px;font-size:13px;color:var(--muted);">'+row.condition+'</td>'
      +'<td style="padding:9px 12px;text-align:center;">'
        +(row.editable
          ?'<input type="number" data-usm-id="'+row.id+'" value="'+row.pts+'" step="1" min="-20" max="30"'
            +' style="width:60px;text-align:center;padding:4px 6px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-weight:700;color:'+ptsColor+';background:var(--surface);"'
            +' data-usm-onchange="1"/>'
          :'<span style="font-size:13px;font-weight:700;color:'+ptsColor+';">'+ptsDisplay+'</span>')
      +'</td>'
      +'<td style="padding:9px 12px;font-size:11px;color:var(--muted);">'+row.notes+'</td>'
      +'</tr>';
  }).join('');
  tbody.querySelectorAll('[data-usm-onchange]').forEach(function(inp){
    inp.addEventListener('change',function(){
      updateUnitScorePts(inp.getAttribute('data-usm-id'),inp.value);
    });
  });
}
function renderWorklist() {
  var realRole = window._realRole || window.currentRole || 'housing_employee_l1';
  var role = window._viewAsRole || realRole;
  var body = document.getElementById('worklist_body');
  var sub  = document.getElementById('worklist_subtitle');
  if(!body) return;

  var apps = (typeof applications !== 'undefined') ? applications : [];

  // If no data loaded yet, show loading and try fetching
  if(!apps.length) {
    body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted);font-size:13px;">Loading applications…</div>';
    if(typeof loadAppDataFromSupabase === 'function') {
      loadAppDataFromSupabase().then(function(){ renderWorklist(); });
    }
    return;
  }

  // ── Status map ────────────────────────────────────────────────────────────
  var SM = {
    draft:        {label:'Draft',                   c:'#888',    bg:'#f4f4f0'},
    submitted:    {label:'Awaiting HM Review',      c:'#1d4ed8', bg:'#eff6ff'},
    file_update:  {label:'File Update',             c:'#1d4ed8', bg:'#eff6ff'},
    mgr_approved: {label:'Awaiting ED Approval',    c:'#7c3aed', bg:'#faf5ff'},
    hm_approved:  {label:'File Update Approved',    c:'#15803d', bg:'#f0fdf4'},
    ed_approved:  {label:'ED Approved',             c:'#15803d', bg:'#f0fdf4'},
    returned:     {label:'Returned — Action Needed',c:'#b91c1c', bg:'#fef2f2'},
    declined:     {label:'Declined',                c:'#b91c1c', bg:'#fef2f2'},
    assigned:     {label:'Assigned',                c:'#15803d', bg:'#f0fdf4'}
  };

  // ── Subtitle ──────────────────────────────────────────────────────────────
  var subtitles = {
    employee:        'Track applications you have submitted. Scores are managed by the Housing Manager.',
    housing_manager: 'Review and action applications across the queue.',
    ed:              'Final approvals, recommendations, and recently actioned applications.'
  };
  if(sub) sub.textContent = subtitles[role] || '';

  // ── Chip filter definitions ───────────────────────────────────────────────
  var chipDefs;
  if(role === ROLE.HE_L1) {
    chipDefs = [
      {key:'',          label:'All',            filter: function(a){ return !a.archived; }},
      {key:'action',    label:'Action Needed',  filter: function(a){ return a.status==='returned'; }, alert:true},
      {key:'submitted', label:'In Review',      filter: function(a){ return ['submitted','file_update','mgr_approved'].indexOf(a.status)!==-1; }},
      {key:'approved',  label:'Approved',       filter: function(a){ return ['ed_approved','assigned'].indexOf(a.status)!==-1; }},
      {key:'draft',     label:'Draft',          filter: function(a){ return a.status===APP_STATUS.DRAFT; }},
      {key:'declined',  label:'Declined',       filter: function(a){ return a.status==='declined'; }}
    ];
  } else if(role === ROLE.HOUSING_MANAGER) {
    chipDefs = [
      {key:'',          label:'All Active',     filter: function(a){ return !a.archived; }},
      {key:'action',    label:'Needs Review',   filter: function(a){ return ['submitted','file_update'].indexOf(a.status)!==-1; }, alert:true},
      {key:'returned',  label:'Returned',       filter: function(a){ return a.status==='returned'; }, alert:true},
      {key:'pending',   label:'Awaiting ED',    filter: function(a){ return a.status===APP_STATUS.MGR_APPROVED; }},
      {key:'approved',  label:'ED Approved',    filter: function(a){ return a.status===APP_STATUS.ED_APPROVED; }},
      {key:'assigned',  label:'Assigned',       filter: function(a){ return a.status==='assigned'; }}
    ];
  } else {
    chipDefs = [
      {key:'',          label:'All Active',     filter: function(a){ return !a.archived; }},
      {key:'action',    label:'Needs Approval', filter: function(a){ return a.status===APP_STATUS.MGR_APPROVED; }, alert:true},
      {key:'submitted', label:'Awaiting HM',    filter: function(a){ return a.status===APP_STATUS.SUBMITTED; }},
      {key:'approved',  label:'Approved',       filter: function(a){ return a.status===APP_STATUS.ED_APPROVED; }},
      {key:'assigned',  label:'Assigned',       filter: function(a){ return a.status==='assigned'; }},
      {key:'declined',  label:'Declined',       filter: function(a){ return a.status==='declined'; }}
    ];
  }

  // ── Active chip + search state ────────────────────────────────────────────
  if(!window._wlActiveChip) window._wlActiveChip = '';
  if(!window._wlSearch) window._wlSearch = '';

  var activeChipDef = chipDefs.find(function(c){ return c.key === window._wlActiveChip; }) || chipDefs[0];

  // ── Filter apps ───────────────────────────────────────────────────────────
  var filtered = apps.filter(activeChipDef.filter);
  var search = (window._wlSearch||'').toLowerCase().trim();
  if(search) {
    filtered = filtered.filter(function(a){
      var name = ((a.fn||'')+' '+(a.ln||'')).toLowerCase();
      return name.includes(search) || (a.id||'').toLowerCase().includes(search);
    });
  }
  var showScore = (role !== ROLE.HE_L1);

  // ── Chip counts ───────────────────────────────────────────────────────────
  var chipsHtml = chipDefs.map(function(c){
    var count = apps.filter(c.filter).length;
    var isActive = c.key === (window._wlActiveChip||'');
    var base = isActive
      ? 'background:var(--dark);border:2px solid var(--yellow);color:#fff;'
      : (c.alert && count>0 ? 'background:#fef2f2;border:1.5px solid #fecaca;color:#b91c1c;' : 'background:var(--surface);border:1.5px solid var(--border);color:var(--muted);');
    return '<button data-wlchip="'+c.key+'" onclick="wlSetChip(this)" '
      + 'style="'+base+'padding:5px 14px;border-radius:20px;font-size:12px;font-weight:700;font-family:DM Sans,sans-serif;cursor:pointer;white-space:nowrap;transition:all .12s;">'
      + c.label + (count ? ' <span style="font-size:11px;opacity:.7;">'+count+'</span>' : '')
      + '</button>';
  }).join('');

  // ── Build rows ────────────────────────────────────────────────────────────
  var sorted = filtered.slice().sort(function(a,b){
    if(showScore) return (b.score||0)-(a.score||0);
    return (b.appDate||'').localeCompare(a.appDate||'');
  });

  var rows = sorted.map(function(a){
    var sm = SM[a.status] || {label:a.status, c:'#888', bg:'#f4f4f0'};
    var name = ((a.fn||'')+' '+(a.ln||'')).trim()||'—';
    var tier = a.tier||'';
    var tc = tier==='Critical Priority'?'#b91c1c':tier==='High Priority'?'#1d4ed8':tier==='Medium Priority'?'#7a6000':'#888';
    // Branch: what action button to show per status per role
    var actionBtn = '';
    if(a.status==='returned') {
      actionBtn = '<button data-wl-edit="'+a.id+'" onclick="event.stopPropagation();wlEditApp(this)" style="background:var(--yellow);border:none;color:#111;padding:4px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;white-space:nowrap;">Update →</button>';
    } else if((role=== ROLE.HOUSING_MANAGER&&(a.status===APP_STATUS.SUBMITTED||a.status===APP_STATUS.FILE_UPDATE)) || (role=== ROLE.ED&&a.status===APP_STATUS.MGR_APPROVED)) {
      actionBtn = '<button data-wl-id="'+a.id+'" onclick="event.stopPropagation();wlOpenApp(this)" style="background:#1d4ed8;border:none;color:#fff;padding:4px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;white-space:nowrap;">Review →</button>';
    } else if((ROLE.isManagement(role))&&(a.status===APP_STATUS.ED_APPROVED||a.status===APP_STATUS.MGR_APPROVED)&&!a.assignedUnit) {
      actionBtn = '<button data-wl-id="'+a.id+'" onclick="event.stopPropagation();wlOpenApp(this)" style="background:#15803d;border:none;color:#fff;padding:4px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;white-space:nowrap;">Assign →</button>';
    }
    return '<tr style="border-bottom:1px solid var(--border);cursor:pointer;" data-wl-id="'+a.id+'" onclick="wlOpenApp(this)">'
      + '<td style="padding:11px 14px;font-weight:600;font-size:13px;">'+name+'</td>'
      + '<td style="padding:11px 14px;font-size:12px;color:var(--muted);">'+a.id+'</td>'
      + '<td style="padding:11px 14px;font-size:12px;color:var(--muted);">'+(a.appDate||'—')+'</td>'
      + '<td style="padding:11px 14px;"><span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:8px;background:'+sm.bg+';color:'+sm.c+';">'+sm.label+'</span></td>'
      + (showScore ? '<td style="padding:11px 14px;text-align:center;"><span style="font-size:16px;font-weight:800;color:var(--text);">'+(typeof a.score==='number'?a.score:'—')+'</span>'+(tier?'<div style="font-size:9px;color:'+tc+';font-weight:700;margin-top:1px;">'+tier.replace(' Priority','')+'</div>':'')+'</td>' : '')
      + '<td style="padding:11px 14px;text-align:right;white-space:nowrap;">'+actionBtn+'</td>'
      + '</tr>';
  }).join('');

  var emptyMsg = search ? 'No results for "'+search+'"' : 'No applications in this category.';

  body.innerHTML =
    // Search + chips bar
    '<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px;">'
    + '<input id="wl_search_input" type="text" placeholder="🔍  Search by name or ID…" value="'+(window._wlSearch||'')+'" '
    + 'oninput="window._wlSearch=this.value;clearTimeout(window._wlST);window._wlST=setTimeout(renderWorklist,200)" '
    + 'style="width:100%;padding:9px 14px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:DM Sans,sans-serif;background:var(--surface);color:var(--text);box-sizing:border-box;" />'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;">'+chipsHtml+'</div>'
    + '</div>'
    // Table
    + '<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;">'
    + (sorted.length === 0
        ? '<div style="padding:32px;text-align:center;color:var(--muted);font-size:13px;">'+emptyMsg+'</div>'
        : '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">'
          + '<thead><tr style="background:var(--dark);">'
          + '<th style="padding:10px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#888;">Applicant</th>'
          + '<th style="padding:10px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#888;">ID</th>'
          + '<th style="padding:10px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#888;">Date</th>'
          + '<th style="padding:10px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#888;">Status</th>'
          + (showScore ? '<th style="padding:10px 14px;text-align:center;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#888;">Score</th>' : '')
          + '<th></th>'
          + '</tr></thead><tbody>'+rows+'</tbody></table></div>')
    + '</div>';

  // Re-focus search if it was active
  if(search) { var si=document.getElementById('wl_search_input'); if(si){ var l=si.value.length; si.focus(); si.setSelectionRange(l,l); } }
}
function resetRenoScoreModel() {
  if(confirm('Reset renovation scoring to defaults?')) {
    if(window._appSettings) delete window._appSettings['reno_score_model'];
    renderRenoScoreTable();
    showToast('Renovation scoring reset');
  }
}
function resetSow(){
  ['sow_address','sow_tenant_name','sow_prepared_by','sow_contractor','sow_total_cost',
   'sow_notes','sow_hm_name','sow_ed_name',
   'sow_sig_tenant_name','sow_sig_staff_name'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.value='';
  });
  ['sow_condition','sow_start_date','sow_end_date','sow_hm_date','sow_ed_date',
   'sow_sig_tenant_date','sow_sig_staff_date'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.value='';
  });
  // Clear signature canvases
  if(typeof clearSig === 'function') {
    clearSig('sow_sig_canvas_tenant');
    clearSig('sow_sig_canvas_staff');
  }
  ['sow_mold','sow_asbestos','sow_electrical','sow_structural','sow_plumbing','sow_fire',
   'sow_rent_arrears','sow_tenant_damage','sow_negligence','sow_vandalism','sow_police_report'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.checked=false;
  });
  var items=document.getElementById('sow_items'); if(items) items.innerHTML='';
  _sowItemIdx=0;
  addSowItem();
}
function rpAddNewContractor() {
  var dd = document.getElementById('rp_ct_dropdown');
  if(dd) dd.style.display = 'none';
  // Pre-fill the name if the user typed something
  var typed = (document.getElementById('rp_contractor')||{}).value||'';
  var nameField = document.getElementById('ct_name');
  if(nameField && typed) nameField.value = typed;
  // Close progress modal first
  var prog = document.getElementById('renoProgressModal');
  if(prog) prog.style.display = 'none';
  // Open the add contractor modal
  var m = document.getElementById('addContractorModal');
  if(m) m.style.display = 'flex';
  // Flag so saveContractor knows to reopen progress modal after
  window._rpAfterContractorSave = true;
}
function rpSelectContractor(el) {
  var name = el.getAttribute('data-ct-name');
  var id   = el.getAttribute('data-ct-id');
  var inp  = document.getElementById('rp_contractor');
  var hid  = document.getElementById('rp_contractor_id');
  if(inp) inp.value = name;
  if(hid) hid.value = id;
  var dd = document.getElementById('rp_ct_dropdown');
  if(dd) dd.style.display = 'none';
}
function saveContractor(){
  var get=function(id){var el=document.getElementById(id);return el?el.value.trim():'';};
  var name=get('ct_name');
  if(!name){showToast('Contractor name is required.');return;}
  var contractors = window._contractors || [];
  var editIdx = (window._ctEditIdx !== undefined) ? window._ctEditIdx : -1;
  var isEdit = editIdx >= 0 && editIdx < contractors.length;
  var id = isEdit ? (contractors[editIdx].id || ('CT-'+editIdx)) : ('CT-'+Date.now());
  var classRadio = document.querySelector('input[name="ct_classification"]:checked');
  var torEl = document.getElementById('ct_tor_agreed');
  var data = {
    id:id,name:name,trade:get('ct_trade'),phone:get('ct_phone'),email:get('ct_email'),
    address:get('ct_address'),hst:get('ct_hst'),
    wsibNum:get('ct_wsib_num'),wsibExpiry:get('ct_wsib_expiry'),
    insProvider:get('ct_ins_provider'),insPolicy:get('ct_ins_policy'),
    insAmount:get('ct_ins_amount'),insExpiry:get('ct_ins_expiry'),
    notes:get('ct_notes'), people:ctGetPeople(),
    classification: classRadio ? classRadio.value : '',
    classProof: get('ct_class_proof'),
    torAgreed: torEl ? torEl.checked : false,
    torAgreedAt: (torEl && torEl.checked) ? new Date().toISOString().split('T')[0] : '',
    sigStaff: { name:get('ct_sig_staff_name'), date:get('ct_sig_staff_date'), image:(typeof getSigDataURL==='function'?getSigDataURL('ct_sig_canvas_staff'):'') },
    sigCt:    { name:get('ct_sig_ct_name'),    title:get('ct_sig_ct_title'), date:get('ct_sig_ct_date'), image:(typeof getSigDataURL==='function'?getSigDataURL('ct_sig_canvas_ct'):'') },
    addedAt: isEdit ? (contractors[editIdx].addedAt||new Date().toISOString().slice(0,10)) : new Date().toISOString().slice(0,10)
  };
  // Set workflow status
  if(isEdit) {
    data.status = contractors[editIdx].status || 'pending_review';
    data.submittedAt = contractors[editIdx].submittedAt || new Date().toISOString().split('T')[0];
    contractors[editIdx] = data;
    auditEntry('CT:'+id, 'ct_updated', 'Contractor record updated: ' + name, window.currentRole||'staff');
  } else {
    data.status = 'pending_review';
    data.submittedAt = new Date().toISOString().split('T')[0];
    contractors.push(data);
    auditEntry('CT:'+id, 'ct_submitted', 'Contractor application submitted: ' + name, window.currentRole||'staff');
  }
  window._contractors = contractors;
  // Persist to Supabase
  sbSaveContractor(ct).catch(function(e){ console.warn('saveContractor SB failed:',e); });
  // Upload contractor files to Supabase Storage
  var ctf = window._ctFiles||{wsib:[],insurance:[],other:[]};
  ['wsib','insurance','other'].forEach(function(bucket){
    (ctf[bucket]||[]).forEach(function(fileRecord){
      // fileRecord has .name .type .size .data (base64) — convert back to blob and upload
      try {
        var byteStr = atob(fileRecord.data.split(',')[1]||fileRecord.data);
        var arr = new Uint8Array(byteStr.length);
        for(var i=0;i<byteStr.length;i++) arr[i]=byteStr.charCodeAt(i);
        var blob = new Blob([arr],{type:fileRecord.type||'application/octet-stream'});
        var file = new File([blob], fileRecord.name, {type:fileRecord.type||'application/octet-stream'});
        sbUploadAndSave('contractor', id, file, 'contractors/'+id+'/'+bucket).catch(function(e){ console.warn('Contractor file upload failed:',e); });
      } catch(e){ console.warn('Could not upload contractor file:',e); }
    });
  });
  closeAddContractorModal();
  if(!isEdit && window._rpAfterContractorSave) {
    window._rpAfterContractorSave = false;
    var inp = document.getElementById('rp_contractor');
    var hid = document.getElementById('rp_contractor_id');
    if(inp) inp.value = name;
    if(hid) hid.value = id;
    var prog = document.getElementById('renoProgressModal');
    if(prog) prog.style.setProperty('display','flex','important');
  } else if(window._sowAfterContractorSave) {
    window._sowAfterContractorSave = false;
    var sowInp = document.getElementById('sow_contractor');
    var sowHid = document.getElementById('sow_contractor_id');
    if(sowInp) sowInp.value = name;
    if(sowHid) sowHid.value = id;
  } else {
    // If the search modal is open (employee flow), refresh it; otherwise refresh management view
    var searchModal = document.getElementById('contractorSearchModal');
    var isSearchOpen = searchModal && searchModal.style.display !== 'none' && getComputedStyle(searchModal).display !== 'none';
    if(isSearchOpen) {
      contractorSearchFilter(document.getElementById('ct_search_input') ? document.getElementById('ct_search_input').value : '');
    } else {
      // Re-open search modal in employee mode, otherwise re-render management view
      var role = window.currentRole || 'housing_employee_l1';
      if(ROLE.isManagement(role)) {
        renderContractorsView();
      } else {
        openContractorSearch();
      }
    }
  }
  showToast((isEdit ? 'Updated: ' : 'Added: ') + name);
}
function saveContractorAndFinalize() {
  // Save first (reuses existing saveContractor logic)
  saveContractor();
  // After save, grab the record back and show print/email buttons
  try {
    var contractors = (window._contractors || []).slice();
    if(contractors.length) {
      window._ctLastSaved = contractors[contractors.length - 1];
      // If editing, find by id
      if(window._ctEditIdx >= 0 && window._ctEditIdx < contractors.length) {
        window._ctLastSaved = contractors[window._ctEditIdx];
      }
      var printBtn = document.getElementById('ct_print_btn');
      var emailBtn = document.getElementById('ct_email_btn');
      if(printBtn) printBtn.style.display = 'flex';
      if(emailBtn && window._ctLastSaved.email) emailBtn.style.display = 'flex';
    }
  } catch(e) {}
}
function saveRenoScoreModel() {
  var model = getRenoScoreModel();
  document.querySelectorAll('[data-rsm-id]').forEach(function(inp) {
    var row = model.find(function(r){ return r.id === inp.getAttribute('data-rsm-id'); });
    if(row) row.pts = parseInt(inp.value)||0;
  });
  if(!window._appSettings) window._appSettings={};
  window._appSettings['reno_score_model']=model;
  sbSaveSetting('reno_score_model', model).then(function(ok){
    if(!ok){ showToast('Renovation scoring did NOT save to server — please retry.'); return; }
    auditEntry('SETTINGS','settings_reno_score_save','Renovation priority scoring model saved',window.currentRole||'staff');
    showToast('Renovation scoring saved');
    renderRenoScoreTable();
  });
}
function saveUnitScoreModel(){
  var model=getUnitScoreModel();
  document.querySelectorAll('[data-usm-id]').forEach(function(inp){
    var row=model.find(function(r){return r.id===inp.getAttribute('data-usm-id');});
    if(row)row.pts=parseInt(inp.value)||0;
  });
  if(!window._appSettings) window._appSettings={};
  window._appSettings['unit_score_model']=model;
  sbSaveSetting('unit_score_model', model).then(function(ok){
    if(!ok){ showToast('Unit match scoring did NOT save to server — please retry.'); return; }
    auditEntry('SETTINGS','settings_unit_score_save','Unit matching scoring model saved',window.currentRole||'staff');
    showToast('Unit match scoring saved');
    renderUnitScoreTable();
  });
}
function saveUnitScoreModelED() {
  edGuard('Unit Matching Scoring updated', function() {
    saveUnitScoreModel();
  });
}
async function scSaveAssignedDocs(app, previouslyAssigned) {
  var checkboxes = document.querySelectorAll('#assignDocsList input[type=checkbox]');
  var appId = app.id || '';
  var prevPaths = previouslyAssigned.map(function(a){ return a.file_path; });
  for(var i=0; i<checkboxes.length; i++) {
    var cb = checkboxes[i];
    var fpath = cb.dataset.path;
    var isChecked = cb.checked;
    var wasAssigned = prevPaths.includes(fpath);
    if(isChecked && !wasAssigned) {
      await fetch(SUPABASE_URL+'/rest/v1/app_documents', {
        method: 'POST',
        headers: Object.assign({}, HOUSING_HEADERS, { 'Prefer': 'return=minimal' }),
        body: JSON.stringify({ app_id: appId, file_path: fpath, file_name: cb.dataset.name,
          file_size: parseInt(cb.dataset.size)||0, file_type: cb.dataset.type, added_by: window.currentUser||'admin' })
      });
    } else if(!isChecked && wasAssigned) {
      var row = previouslyAssigned.find(function(a){ return a.file_path === fpath; });
      if(row) await fetch(SUPABASE_URL+'/rest/v1/app_documents?id=eq.'+row.id, { method:'DELETE', headers:HOUSING_HEADERS });
    }
  }
  var modal = document.getElementById('assignDocsModal');
  if(modal) modal.remove();
  showToast('✓ File assignments saved');
  scLoadDocs(app);
}
async function scShowAssignDocs(app) {
  var modal = document.getElementById('assignDocsModal');
  if(modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'assignDocsModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  document.body.appendChild(modal);

  modal.innerHTML = '<div style="background:var(--surface);border-radius:12px;padding:24px;max-width:560px;width:100%;max-height:80vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.2);">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">'
    + '<div style="font-size:14px;font-weight:700;">Assign Files — ' + ((app.fn||'')+' '+(app.ln||'')).trim() + '</div>'
    + '<button id="assignDocsClose" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--muted);">&times;</button>'
    + '</div>'
    + '<div id="assignDocsList" style="font-size:12px;color:var(--muted);">Loading available files…</div>'
    + '</div>';
  document.getElementById('assignDocsClose').addEventListener('click', function(){ modal.remove(); });

  var available = [];
  try {
    var files = await sbListFiles('applications/APP-/');
    available = (files||[]).filter(function(f){ return f.name && f.name !== '.emptyFolderPlaceholder'; });
  } catch(e) {}

  var assigned = [];
  try {
    var r = await fetch(SUPABASE_URL+'/rest/v1/app_documents?app_id=eq.'+encodeURIComponent(app.id||''), { headers: HOUSING_HEADERS });
    if(r.ok) assigned = await r.json();
  } catch(e) {}
  var assignedPaths = assigned.map(function(a){ return a.file_path; });

  var listEl = document.getElementById('assignDocsList');
  if(!available.length) { listEl.textContent = 'No files found in migrated folder.'; return; }

  listEl.innerHTML = '<div style="margin-bottom:10px;color:var(--text);">Check the files that belong to this applicant:</div>';
  available.forEach(function(f) {
    var fpath = 'applications/APP-/'+f.name;
    var row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px;border-bottom:1px solid var(--border);cursor:pointer;';
    var cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = assignedPaths.includes(fpath);
    cb.dataset.path = fpath; cb.dataset.name = f.name;
    cb.dataset.size = f.metadata ? (f.metadata.size||0) : 0;
    cb.dataset.type = f.metadata ? (f.metadata.mimetype||'') : '';
    row.appendChild(cb);
    var txt = document.createElement('span');
    txt.style.fontSize = '12px';
    txt.textContent = f.name;
    row.appendChild(txt);
    listEl.appendChild(row);
  });

  var saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save Assignments';
  saveBtn.style.cssText = 'margin-top:16px;background:var(--yellow);border:none;color:#111;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;width:100%;';
  saveBtn.addEventListener('click', function(){ scSaveAssignedDocs(app, assigned); });
  listEl.appendChild(saveBtn);
}
function setExportView(viewName) {
  window._currentExportView = viewName;
  var wrap = document.getElementById('header_export_wrap');
  var exportableViews = ['inventory','match','renos','contractors'];
  if(wrap) wrap.style.display = exportableViews.indexOf(viewName) >= 0 ? 'flex' : 'none';
}
function showContractorsForRole() {
  var role = window.currentRole || 'housing_employee_l1';
  if(ROLE.isManagement(role)) {
    showContractors();
  } else {
    openContractorSearch();
  }
}
function showInventory(){
  if(!window._navSkipPush) pushNav('inventory');
  setExportView('inventory');
  setNavActive('tab_inventory');
  _showView('inventoryView', renderInventoryView);
}
function showTenants(){
  if(!window._navSkipPush) pushNav('tenants');
  setExportView(null);
  setNavActive('tab_tenants');
  _showView('tenantsView', renderTenantsView);
}
function showWorklist() {
  if(!window._navSkipPush) pushNav('worklist');
  hideAllViews('worklistView');
  setNavActive('tab_worklist');
  var view = document.getElementById('worklistView');
  if(view){ view.style.display='flex'; view.style.flexDirection='column'; }
  // Date/time stamp — matches landing page pattern
  var dtEl = document.getElementById('worklist_datetime');
  if(dtEl) {
    var now = new Date();
    var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    var h = now.getHours(), m = now.getMinutes();
    var ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    dtEl.textContent = days[now.getDay()] + ' · ' + months[now.getMonth()] + ' ' + now.getDate() + ', ' + now.getFullYear() + ' · ' + h + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
  }
  renderWorklist();
}
function sowAddNewContractor() {
  var dd = document.getElementById('sow_ct_dropdown');
  if(dd) dd.style.display = 'none';
  var typed = (document.getElementById('sow_contractor')||{}).value||'';
  var nameField = document.getElementById('ct_name');
  if(nameField && typed) nameField.value = typed;
  // Flag to return to SOW after saving
  window._sowAfterContractorSave = true;
  var m = document.getElementById('addContractorModal');
  if(m) m.style.display = 'flex';
}
function sowContractorSearch(q) {
  var dd = document.getElementById('sow_ct_dropdown');
  if(!dd) return;
  var contractors = [];
  var contractors = window._contractors || [];
  var term = (q||'').toLowerCase().trim();
  var matches = term
    ? contractors.filter(function(c){ return (c.name||'').toLowerCase().includes(term)||(c.trade||'').toLowerCase().includes(term); })
    : contractors;

  var rows = matches.map(function(c){
    return '<div data-ct-name="'+c.name+'" data-ct-id="'+(c.id||'')+'" onmousedown="sowSelectContractor(this)" '
      +'style="padding:9px 14px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border);" '
      +'onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'\'">'
      +'<div style="font-weight:600;">'+c.name+'</div>'
      +(c.trade?'<div style="font-size:11px;color:var(--muted);">'+c.trade+'</div>':'')
      +'</div>';
  });

  if(!matches.length) {
    rows.push('<div style="padding:9px 14px;font-size:12px;color:var(--muted);">'
      +(term?'No contractor matching "'+q+'" found.':'No contractors added yet.')+'</div>');
  }
  rows.push('<div onmousedown="sowAddNewContractor()" style="padding:9px 14px;cursor:pointer;font-size:12px;font-weight:700;color:var(--yellow);border-top:1px solid var(--border);display:flex;align-items:center;gap:6px;" '
    +'onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'\'">'
    +'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
    +(term&&!matches.length?'Add "'+q+'" as new contractor':'Add new contractor')
    +'</div>');

  dd.innerHTML = rows.join('');
  dd.style.display = 'block';
}
function sowSelectContractor(el) {
  var name = el.getAttribute('data-ct-name');
  var id   = el.getAttribute('data-ct-id');
  var inp  = document.getElementById('sow_contractor');
  var hid  = document.getElementById('sow_contractor_id');
  if(inp) inp.value = name;
  if(hid) hid.value = id;
  var dd = document.getElementById('sow_ct_dropdown');
  if(dd) dd.style.display = 'none';
}
function toggleHeaderExportMenu() {
  var m = document.getElementById('header_export_menu');
  if(!m) return;
  var open = m.style.display !== 'none';
  m.style.display = open ? 'none' : 'block';
  if(!open) {
    setTimeout(function(){
      document.addEventListener('click', function closeMenu(e){
        var wrap = document.getElementById('header_export_wrap');
        if(wrap && !wrap.contains(e.target)){
          m.style.display='none';
          document.removeEventListener('click', closeMenu);
        }
      });
    }, 10);
  }
}
function toggleInvExportMenu(){}
function triggerPrint() {
  if(!_printPanelDoc) return;
  // Use a hidden iframe — no popup blocker, panel stays visible
  var iframe = document.getElementById('_printFrame');
  if(!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = '_printFrame';
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;';
    document.body.appendChild(iframe);
  }
  iframe.onload = function() {
    setTimeout(function() {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch(e) {
        window.print();
      }
    }, 300);
  };
  iframe.srcdoc = _printPanelDoc;
}
function updateBudgetTotal(){
  var total = 0;
  BUDGET_POOLS.forEach(function(p){
    var el = document.getElementById('budget_alloc_'+p.id);
    total += parseFloat((el&&el.value)||0) || 0;
  });
  var gt = document.getElementById('budget_grand_total');
  if(gt) gt.textContent = '$' + Math.round(total).toLocaleString();
}
function userLookupDebounce(){
  clearTimeout(window._userLookupTimer);
  window._userLookupTimer = setTimeout(lookupUser, 400);
}
function wlEditApp(el) {
  var id = el.getAttribute('data-wl-edit') || (el.closest('[data-wl-edit]') && el.closest('[data-wl-edit]').getAttribute('data-wl-edit'));
  if(!id) return;
  if(typeof window.openEditModal === 'function') window.openEditModal(id);
}
function wlEmpty(msg, sub) {
  return '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px;">'+msg
    +(sub?'<div style="font-size:12px;margin-top:4px;">'+sub+'</div>':'')+'</div>';
}
function wlOpenApp(el) {
  var id = el.getAttribute('data-wl-id') || (el.closest('[data-wl-id]') && el.closest('[data-wl-id]').getAttribute('data-wl-id'));
  if(!id) return;
  var apps = typeof applications !== 'undefined' ? applications : [];
  var app = apps.find(function(x){ return x.id === id; });
  if(!app) return;
  // Branch by status
  if(app.status === APP_STATUS.DRAFT || app.status === 'returned') {
    // Open the edit form so they can complete/update it
    if(typeof window.openEditModal === 'function') window.openEditModal(id);
  } else {
    // All other statuses — open read-only scorecard
    if(true) showScorecard(app);
  }
}
function wlSection(title, count, content) {
  var badge = count !== null ? ' <span style="font-size:12px;font-weight:700;background:var(--yellow);color:#111;padding:1px 8px;border-radius:10px;margin-left:6px;">'+(count||0)+'</span>' : '';
  return '<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:16px;">'
    + '<div style="padding:14px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;">'
    + '<span style="font-size:13px;font-weight:700;">'+title+'</span>'+badge
    + '</div>'
    + '<div>'+(content||wlEmpty('None', ''))+'</div>'
    + '</div>';
}
function wlSetChip(el) {
  window._wlActiveChip = el.getAttribute('data-wlchip') || '';
  renderWorklist();
}

/* ════════════════════════════════════════════════════════════════════════════
 * SHARED DOMAIN FUNCTIONS — BATCH 2
 * Diverged-but-equivalent (housing.html version used — most complete).
 * ════════════════════════════════════════════════════════════════════════════ */

function _migrateLegacySow(rawData){
  // Returns { sows: [...] } regardless of input shape.
  if(!rawData) return { sows: [] };
  if(Array.isArray(rawData.sows)) return rawData;  // already new format
  // Legacy flat SOW — wrap as single-item list.
  // Synthesize project_number from address if missing; preserve all fields.
  var legacy = Object.assign({}, rawData);
  if(!legacy.project_number) legacy.project_number = (legacy.address || 'UNIT') + '-SOW-001';
  if(!legacy.created_at) legacy.created_at = legacy.date || new Date().toISOString().slice(0,10);
  if(!legacy.approval_status){
    // Derive from existing approval fields if present.
    if(legacy.ed_approved) legacy.approval_status = 'ed_approved';
    else if(legacy.hm_approved) legacy.approval_status = 'hm_approved';
    else if(legacy.tenant_signed_at || legacy.staff_signed_at) legacy.approval_status = 'signed';
    else legacy.approval_status = 'draft';
  }
  if(legacy.amount == null){
    // Try common fields where the amount might live.
    var amt = legacy.estimated_total || legacy.total_cost || legacy.budget || 0;
    legacy.amount = typeof amt === 'number' ? amt : (parseFloat(String(amt).replace(/[^0-9.\-]/g,''))||0);
  }
  return { sows: [legacy] };
}

function _realRoleForPermissions(){
  // For override authority we check the REAL role, not view-as.
  // This way an ED previewing "as HM" still has edit power on completed SOWs.
  return window._realRole || window.currentRole || '';
}

function calcRenoScore(unitId) {
  var model = getRenoScoreModel();
  var score = 0;
  var breakdown = [];

  var allUnits = (typeof housingUnits !== 'undefined' && housingUnits.length) ? housingUnits : (window.HOUSING_UNITS_DATA||[]);
  var u = allUnits.find(function(x){ return x.id === unitId; });
  if(!u) return {score:0, breakdown:[]};

  var sow = null;
  sow = getSowData(unitId);

  function addPts(id, label, pts) {
    if(pts) { score += pts; breakdown.push({label:label, pts:pts}); }
  }

  // Condition
  var status = u.status||'';
  var cond   = u.homeCondition||'';
  if(status === 'condemned') {
    addPts('rs_cond_critical', 'Condemned / Critical', _rsm(model,'rs_cond_critical'));
  } else if(cond === 'Poor') {
    addPts('rs_cond_poor', 'Poor condition', _rsm(model,'rs_cond_poor'));
  } else if(cond === 'Average') {
    addPts('rs_cond_average', 'Average condition', _rsm(model,'rs_cond_average'));
  } else if(cond === 'Good') {
    addPts('rs_cond_good', 'Good condition', _rsm(model,'rs_cond_good'));
  }

  // Critical Systems — detect from SOW line item categories (additive)
  if(sow && sow.items && sow.items.length) {
    var cats = sow.items.map(function(it){ return (it.category||'').toLowerCase(); });
    var systems = [
      {id:'rs_sys_furnace',    label:'Furnace / Heating',       match:['heating','hvac']},
      {id:'rs_sys_hvac',       label:'HVAC / Ventilation',      match:['hvac','ventil']},
      {id:'rs_sys_electrical', label:'Electrical system',       match:['electrical']},
      {id:'rs_sys_roof',       label:'Roofing',                 match:['roof']},
      {id:'rs_sys_windows',    label:'Windows & Doors',         match:['windows','doors']},
    ];
    systems.forEach(function(sys) {
      var found = cats.some(function(c){ return sys.match.some(function(m){ return c.includes(m); }); });
      if(found) addPts(sys.id, sys.label+' in SOW', _rsm(model, sys.id));
    });
  }

  // SOW cost
  var totalCost = sow ? parseFloat((sow.totalCost||'').replace(/[^0-9.]/g,''))||0 : 0;
  if(totalCost >= 50000)       addPts('rs_cost_5', 'SOW $50k+',          _rsm(model,'rs_cost_5'));
  else if(totalCost >= 25001)  addPts('rs_cost_4', 'SOW $25k–$50k',      _rsm(model,'rs_cost_4'));
  else if(totalCost >= 10001)  addPts('rs_cost_3', 'SOW $10k–$25k',      _rsm(model,'rs_cost_3'));
  else if(totalCost >= 2501)   addPts('rs_cost_2', 'SOW $2.5k–$10k',     _rsm(model,'rs_cost_2'));
  else if(sow)                 addPts('rs_cost_1', 'SOW < $2.5k',         _rsm(model,'rs_cost_1'));

  // Hazards (additive)
  if(sow) {
    var hazards = [
      {key:'mold',       id:'rs_haz_mold',       label:'Mould hazard'},
      {key:'asbestos',   id:'rs_haz_asbestos',    label:'Asbestos risk'},
      {key:'electrical', id:'rs_haz_electrical',  label:'Electrical hazard'},
      {key:'structural', id:'rs_haz_structural',  label:'Structural concern'},
      {key:'plumbing',   id:'rs_haz_plumbing',    label:'Plumbing failure'},
      {key:'fire',       id:'rs_haz_fire',         label:'Fire safety concern'},
    ];
    hazards.forEach(function(h) {
      if(sow[h.key]) addPts(h.id, h.label, _rsm(model, h.id));
    });
  }

  // SOW scope (item count)
  var itemCount = sow && sow.items ? sow.items.length : 0;
  if(itemCount >= 10)      addPts('rs_items_5', itemCount+' SOW items', _rsm(model,'rs_items_5'));
  else if(itemCount >= 6)  addPts('rs_items_4', itemCount+' SOW items', _rsm(model,'rs_items_4'));
  else if(itemCount >= 3)  addPts('rs_items_3', itemCount+' SOW items', _rsm(model,'rs_items_3'));
  else if(itemCount >= 1)  addPts('rs_items_2', itemCount+' SOW item'+(itemCount>1?'s':''), _rsm(model,'rs_items_2'));

  // Tenant Conduct — Damage (additive, increases urgency)
  if(sow) {
    if(sow.tenantDamage)  addPts('rs_ten_damage',    'Tenant-caused damage',   _rsm(model,'rs_ten_damage'));
    if(sow.negligence)    addPts('rs_ten_negligence', 'Negligence',             _rsm(model,'rs_ten_negligence'));
    if(sow.vandalism)     addPts('rs_ten_vandalism',  'Vandalism',              _rsm(model,'rs_ten_vandalism'));
    if(sow.policeReport)  addPts('rs_ten_police',     'Police report on file',  _rsm(model,'rs_ten_police'));
  }

  // Tenant Arrears — look up from linked application (mirrors housing app scoring, negative)
  var arrAmt = 0;
  var payMonths = 0;
  if(u && u.assignedTo) {
    var apps = typeof applications !== 'undefined' ? applications : [];
    var linkedApp = apps.find(function(a){ return a.id === u.assignedTo; });
    if(linkedApp) {
      arrAmt = parseFloat(linkedApp.arrBalAmt)||0;
      payMonths = parseInt(linkedApp.arrPlanMonths)||0;
    }
  }
  // Also check SOW rent arrears flag as fallback
  if(sow && sow.rentArrears && arrAmt === 0) arrAmt = 1; // flag set but no linked app amount — treat as minimal

  if(arrAmt <= 0) {
    addPts('rs_arr_0', 'No arrears', 0);
  } else if(arrAmt <= 500) {
    addPts('rs_arr_1', 'Arrears $1–$500', _rsm(model,'rs_arr_1'));
  } else if(arrAmt <= 1500) {
    addPts('rs_arr_2', 'Arrears $501–$1,500', _rsm(model,'rs_arr_2'));
  } else if(arrAmt <= 3000) {
    addPts('rs_arr_3', 'Arrears $1,501–$3,000', _rsm(model,'rs_arr_3'));
  } else if(arrAmt <= 5000) {
    addPts('rs_arr_4', 'Arrears $3,001–$5,000', _rsm(model,'rs_arr_4'));
  } else {
    addPts('rs_arr_5', 'Arrears $5,001+', _rsm(model,'rs_arr_5'));
  }

  // Payment arrangement bonus — offsets arrears penalty (only if there are arrears)
  if(arrAmt > 0 && payMonths > 0) {
    var payId, payLabel;
    if(payMonths <= 12)       { payId='rs_pay_1'; payLabel='Payment plan 0–12mo'; }
    else if(payMonths <= 36)  { payId='rs_pay_2'; payLabel='Payment plan 13–36mo'; }
    else if(payMonths <= 60)  { payId='rs_pay_3'; payLabel='Payment plan 37–60mo'; }
    else if(payMonths <= 120) { payId='rs_pay_4'; payLabel='Payment plan 61–120mo'; }
    else if(payMonths <= 180) { payId='rs_pay_5'; payLabel='Payment plan 121–180mo'; }
    else                      { payId='rs_pay_6'; payLabel='Payment plan 181mo+'; }
    addPts(payId, payLabel, _rsm(model, payId));
  }

  // Occupancy
  if(status === 'condemned')      addPts('rs_occ_condemned', 'Condemned',        _rsm(model,'rs_occ_condemned'));
  else if(status === 'under_repair') addPts('rs_occ_displaced','Tenant displaced', _rsm(model,'rs_occ_displaced'));
  else if(status === 'vacant')    addPts('rs_occ_vacant',    'Vacant',            _rsm(model,'rs_occ_vacant'));

  return { score:score, breakdown:breakdown };
}

function ctAddPerson() {
  var people = ctGetPeople();
  people.push({name:'', phone:'', email:''});
  ctRenderPeople(people);
  // Focus the new name field
  var inputs = document.querySelectorAll('.ct-person-name');
  if(inputs.length) inputs[inputs.length-1].focus();
}

function deleteContractor(idx){
  var contractors = (window._contractors || []).slice();
  // Capture the contractor BEFORE removing it from the array (bug: original code spliced first and then read the wrong index)
  var delCt = contractors[idx];
  if(!delCt) { showToast('Contractor not found.'); return; }
  contractors.splice(idx,1);
  window._contractors = contractors;
  renderContractorsView();
  // Delete from Supabase, surface failures to the user so they know to retry
  if(delCt.id) {
    fetch(SUPABASE_URL+'/rest/v1/housing_contractors?id=eq.'+encodeURIComponent(delCt.id), { method:'DELETE', headers:HOUSING_HEADERS })
      .then(function(r){
        if(!r.ok) {
          // Roll back the UI change so the user sees the contractor re-appear and can retry
          contractors.splice(idx, 0, delCt);
          window._contractors = contractors;
          renderContractorsView();
          showToast('Could not remove contractor — ' + (r.status===401||r.status===403 ? 'permission denied' : 'server error '+r.status));
          return;
        }
        showToast('Contractor removed.');
      })
      .catch(function(e){
        contractors.splice(idx, 0, delCt);
        window._contractors = contractors;
        renderContractorsView();
        showToast('Could not remove contractor — ' + (e.message||'network error'));
      });
  } else {
    showToast('Contractor removed.');
  }
}

function exportRenos(format) {
  var units=(typeof housingUnits!=='undefined'&&housingUnits.length)?housingUnits:(window.HOUSING_UNITS_DATA||[]);
  var rows=units.filter(function(u){return u.status==='under_repair'||u.status==='condemned';});
  var headers=['Address','Beds','Type','Foundation','Status','Priority Score','Contractor','SOW Filed','Progress %'];
  var data=rows.map(function(u){
    var rs=calcRenoScore(u.id);
    var sow=null;sow = getSowData(u.id);
    var prog=null;prog = (window._renoProgress && window._renoProgress[u.id]) || {};
    return[u.num+' '+u.street,u.bedrooms,(u.type&&u.type!=='0'&&u.type!=='nan')?u.type:'',(u.foundation&&u.foundation!=='0'&&u.foundation!=='nan')?u.foundation:'',u.status,rs.score||0,(prog.contractor||sow&&sow.contractor||''),(sow?'Yes':'No'),(prog.progress||0)+'%'];
  });
  _doExport(format,headers,data,'CLFN_Renovations_'+new Date().toISOString().slice(0,10),[30,8,16,14,14,14,22,10,12],true);
}

function getSowData(unitId){
  // Backwards compat: callers that predate multi-SOW expect a flat SOW object.
  // We return the most recent SOW from the list so "does this unit have a SOW?" and
  // "show summary of its SOW" both keep working.
  // For multi-SOW-aware code, use getUnitSowList() / getSowByProjectNumber() directly.
  var raw = (window._sowCache && window._sowCache[unitId]) || null;
  if(!raw) return null;
  if(Array.isArray(raw.sows)){
    if(!raw.sows.length) return null;
    // Most recent first (same sort as the table).
    var sorted = raw.sows.slice().sort(function(a, b){
      return (b.created_at || '').localeCompare(a.created_at || '');
    });
    return sorted[0];
  }
  return raw;  // legacy flat shape
}

function getUnitSowList(unitId){
  // Returns an array of SOW objects for this unit (migrated if needed).
  // Must read the RAW cache entry (the wrapper {sows:[...]} or legacy flat shape) —
  // NOT getSowData() which already unwraps to the single most-recent SOW.
  var raw = (window._sowCache && window._sowCache[unitId]) || null;
  var migrated = _migrateLegacySow(raw);
  return migrated.sows || [];
}

function isSowCompleted(sow){
  if(!sow) return false;
  return sow.approval_status === 'completed';
}

function saveBudgetData(data){
  if(!window._appSettings) window._appSettings={};
  var prev = window._appSettings['budget_pools'];
  window._appSettings['budget_pools']=data;
  sbSaveSetting('budget_pools', data).then(function(ok){
    if(!ok){
      // Roll back in-memory so UI reflects reality
      if(prev === undefined) delete window._appSettings['budget_pools'];
      else window._appSettings['budget_pools'] = prev;
      showToast('Could not save budget — changes NOT persisted. Please retry.');
    }
  });
}

function saveSowData(unitId, data){
  // Update in-memory cache (writes the RAW wrapper — callers should pass {sows:[...]}).
  if(!window._sowCache) window._sowCache = {};
  window._sowCache[unitId] = data;
  // Save to Supabase
  fetch(SUPABASE_URL+'/rest/v1/housing_sow', {
    method: 'POST',
    headers: Object.assign({}, HOUSING_HEADERS, {'Prefer':'resolution=merge-duplicates,return=minimal'}),
    body: JSON.stringify({ unit_id: unitId, data: data, updated_at: new Date().toISOString() })
  }).catch(function(e){ console.warn('SOW save failed:',e); });
}

function saveSowList(unitId, sowList){
  // Persist the whole list to the housing_sow.data column.
  saveSowData(unitId, { sows: sowList });
}

async function saveStaffEdit(id, original, modal) {
  var name = (document.getElementById('edit_staff_name')||{}).value || '';
  var hrole = (document.getElementById('edit_staff_role')||{}).value || 'housing_employee_l1';
  var saveBtn = document.getElementById('editStaffSave');
  if(saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  // Store canonical CLFN_PERMS role value directly (Phase A0 migrated DB to canonical).
  var patch = { name: name.trim(), role: hrole };
  patch.department = (hrole === ROLE.HOUSING_MANAGER) ? 'Housing' : (original.department || 'Housing');

  try {
    var r = await fetch(SUPABASE_URL+'/rest/v1/staff?id=eq.'+id, {
      method: 'PATCH',
      headers: Object.assign({}, HOUSING_HEADERS, { 'Prefer': 'return=minimal' }),
      body: JSON.stringify(patch)
    });
    if(r.ok) {
      modal.remove();
      showToast('✓ Staff member updated');
      auditEntry('SETTINGS', 'settings_user_edit', 'Staff updated: '+name+' — role set to '+hrole, window.currentRole||'ed');
      renderHousingUserTable();
    } else {
      showToast('Could not save — check permissions');
      if(saveBtn){ saveBtn.disabled=false; saveBtn.textContent='Save Changes'; }
    }
  } catch(e) {
    showToast('Error: '+e.message);
    if(saveBtn){ saveBtn.disabled=false; saveBtn.textContent='Save Changes'; }
  }
}

function setSigMethod(canvasId, method) {
  var methods = ['canvas', 'type', 'wet'];
  methods.forEach(function(m) {
    var panel = document.getElementById(canvasId + '_panel_' + m);
    var tab   = document.getElementById(canvasId + '_tab_' + m);
    if(panel) panel.style.display = (m === method) ? 'block' : 'none';
    if(tab) {
      tab.style.borderBottomColor = (m === method) ? 'var(--yellow)' : 'transparent';
      tab.style.color = (m === method) ? 'var(--text)' : 'var(--muted)';
      tab.style.fontWeight = (m === method) ? '700' : '600';
    }
  });
  // Init canvas pad when switching to draw mode
  if(method === 'canvas') _initSigPad(canvasId);
}

function clearSig(canvasId) {
  var canvas = document.getElementById(canvasId);
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.classList.remove('has-sig');
}


function getSigDataURL(canvasId) {
  // Typed tab takes priority
  var typePanel = document.getElementById(canvasId + '_panel_type');
  if (typePanel && typePanel.style.display !== 'none') {
    var typed = document.getElementById(canvasId + '_typed');
    return (typed && typed.value.trim()) ? 'typed:' + typed.value.trim() : '';
  }
  // Wet/e-sign tab
  var wetPanel = document.getElementById(canvasId + '_panel_wet');
  if (wetPanel && wetPanel.style.display !== 'none') {
    var ref = document.getElementById(canvasId + '_wet_ref');
    return (ref && ref.value.trim()) ? 'wet:' + ref.value.trim() : 'wet:pending';
  }
  // Canvas draw mode
  var canvas = document.getElementById(canvasId);
  if (!canvas) return '';
  var ctx = canvas.getContext('2d');
  var data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (var i = 3; i < data.length; i += 4) {
    if (data[i] > 0) return canvas.toDataURL('image/png');
  }
  return '';
}


function udpRenderFilePreviews(unitId){
  var mount = document.getElementById('udp_files_mount');
  if (!mount) return;
  // Rebuild the library on each panel open so it targets the right tenant
  mount.innerHTML = '';
  if (!window.DocLibrary) {
    mount.innerHTML = '<div style="padding:12px;text-align:center;color:var(--muted);font-size:11px;">Document library unavailable.</div>';
    return;
  }
  _udpFilesLib = window.DocLibrary.create(mount, {
    entityType:    'tenant',
    entityId:      unitId,
    pathPrefix:    'tenants/' + unitId,
    supabaseUrl:   SUPABASE_URL,
    supabaseAnon:  SUPABASE_ANON,
    storageBucket: STORAGE_BUCKET,
    getAuthToken:  function(){ return (window.HOUSING_HEADERS && window.HOUSING_HEADERS['Authorization'] || '').replace('Bearer ',''); },
    auditTable:    'housing_audit_log',
    getActor:      function(){ return window.currentRole || 'staff'; },
    categories:    _HOUSING_TENANT_DOC_CATEGORIES,
    readOnly:      true
  });
}

function updateUnitScorePts(id,val){
  var model=getUnitScoreModel();
  var row=model.find(function(r){return r.id===id;});
  if(row)row.pts=parseInt(val)||0;
  if(!window._appSettings) window._appSettings={};
  window._appSettings['unit_score_model']=model;
  // Fire-and-forget — this runs on every keystroke so we only log, not toast
  sbSaveSetting('unit_score_model', model);
  var maxScore=0;
  ['bed','acc','eld'].forEach(function(g){
    var mx=Math.max.apply(null,model.filter(function(r){return r.group===g;}).map(function(r){return r.pts;}));
    if(mx>0)maxScore+=mx;
  });
  var maxEl=document.getElementById('unit_score_max');
  if(maxEl)maxEl.textContent=maxScore;
}

function showPrintPanel(docHtml, title) {
  try {
  _printPanelDoc = docHtml;
  var panel  = document.getElementById('printPanel');
  var body   = document.getElementById('printPanelBody');
  var ptitle = document.getElementById('printPanelTitle');
  if(!panel || !body) return;
  if(ptitle) ptitle.textContent = title || 'Document Preview';

  // Extract <body> content from the doc string
  var bOpen  = docHtml.indexOf('<body');
  var bClose = docHtml.indexOf('</body>');
  var content = (bOpen >= 0 && bClose >= 0)
    ? docHtml.substring(docHtml.indexOf('>', bOpen) + 1, bClose)
    : docHtml;

  // Remove any fixed footer or page-num divs (simple string split)
  var parts = content.split('<div class="footer"');
  if(parts.length > 1) {
    content = parts[0] + parts.slice(1).map(function(p) {
      var close = p.indexOf('</div>');
      return close >= 0 ? p.substring(close + 6) : '';
    }).join('');
  }

  // Extract <style> and sanitise @page rules
  var sOpen  = docHtml.indexOf('<style');
  var sClose = docHtml.indexOf('</style>');
  var inlineStyle = '';
  if(sOpen >= 0 && sClose >= 0) {
    var css = docHtml.substring(docHtml.indexOf('>', sOpen) + 1, sClose);
    // Remove @page blocks
    while(css.indexOf('@page') >= 0) {
      var ps = css.indexOf('@page');
      var pb = css.indexOf('{', ps);
      var pe = css.indexOf('}', pb);
      css = css.substring(0, ps) + css.substring(pe + 1);
    }
    // Scope body rules to panel
    css = css.replace(/body\s*\{/g, '#printPanelBody {');
    inlineStyle = '<style>' + css + '</style>';
  }

  body.innerHTML = inlineStyle
    + '<div style="background:#fff;border-radius:8px;padding:32px 36px;'
    + 'box-shadow:0 2px 20px rgba(0,0,0,0.08);">'
    + content
    + '</div>';

  panel.style.display = 'block';
  panel.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  } catch(err) { console.error('showPrintPanel error:', err); }
}

function showMatch(){
  if(window.CLFN_MODULES && !window.CLFN_MODULES.isEnabled('match')){
    showToast('Match module is not enabled for this nation.');
    return;
  }
  if(!window._navSkipPush) pushNav('match');
  setExportView('match');
  setNavActive('tab_match');
  window._matchActiveChip = '';
  _showView('matchView', renderMatchView);
}

function showContractors(){
  if(window.CLFN_MODULES && !window.CLFN_MODULES.isEnabled('contractors')){
    showToast('Contractors module is not enabled for this nation.');
    return;
  }
  // contractorsView markup lives in renos.html — navigate cross-page
  window.location.href = 'renos.html?view=contractors';
}

function showRenos(){
  if(window.CLFN_MODULES && !window.CLFN_MODULES.isEnabled('renovations')){
    showToast('Renovations module is not enabled for this nation.');
    return;
  }
  // The renoApprovalsView/renosView markup lives in renos.html, not housing.html —
  // always navigate cross-page so the correct page loads with its own init.
  var role = window.currentRole || 'housing_employee_l1';
  if(ROLE.isManagement(role)) {
    window.location.href = 'renos.html?view=approvals';
  } else {
    window.location.href = 'renos.html?view=renovations';
  }
}

function _getAllRenoUnits() {
  var units = [];
  units = housingUnits.slice();
  if(!units.length) units=(typeof housingUnits!=='undefined'&&housingUnits.length)?housingUnits:(window.HOUSING_UNITS_DATA||[]);
  return units.filter(function(u) {
    if(u.archived) return false;
    var hasSow = !!getSowData(u.id);
    return hasSow || u.status==='under_repair' || u.status==='condemned';
  });
}

function showScorecard(app){
  if(!app)return;
  window._currentScorecardApp=app;
  hideAllViews('scorecardView');
  var _scv=document.getElementById('scorecardView');if(!_scv)return;
  _scv.style.display='block';
  setNavActive('tab_dash');
  setText('sc_back_name',((app.fn||'')+' '+(app.ln||'')).trim());
  setText('sc_back_id',app.id+' · '+(app.appDate||''));
  var s=app.score||0;
  // Use V2 tier thresholds (ED-adjustable, stored in liveV2Tiers) for both color and tier label
  var _t = (typeof liveV2Tiers === 'object' && liveV2Tiers) ? liveV2Tiers : {critical:80, high:60, medium:40};
  var tc = s >= _t.critical ? {bg:'#f0fdf4',c:'#15803d',bar:'#15803d'}
         : s >= _t.high     ? {bg:'#e8eef5',c:'#1e3a5f',bar:'#3b82f6'}
         : s >= _t.medium   ? {bg:'#fef9ec',c:'#7a6000',bar:'#d97706'}
         :                    {bg:'#fef2f2',c:'#b91c1c',bar:'#b91c1c'};
  setText('sc_score_total',s);
  var tierEl=document.getElementById('sc_score_tier');if(tierEl){tierEl.textContent=app.tier||'—';tierEl.style.background=tc.bg;tierEl.style.color=tc.c;}
  // Bar: scale against the critical threshold so Low/Med/High/Critical labels align visually with tier boundaries
  // Max is 100 (sum of all positive V2 criteria); but pegging at critical keeps the bar meaningful
  var barMax = Math.max(100, (_t.critical||80) * 1.25);
  var barEl=document.getElementById('sc_score_bar');if(barEl){barEl.style.width=Math.min(100,Math.max(0,Math.round((s/barMax)*100)))+'%';barEl.style.background=tc.bar;}
  var infoEl=document.getElementById('sc_info_strip');
  if(infoEl){
    var _wfStatus={'draft':'Draft','submitted':'Awaiting HM Review','file_update':'File Update — Awaiting HM','mgr_approved':'Awaiting ED Approval','hm_approved':'File Update Approved','ed_approved':'ED Approved','declined':'Declined','returned':'Returned for Info','housed':'Housed'};
    var fields=[['Reserve Status',app.reserve||'—'],['Classification',(app.classification||'—').replace(' Housing','')],['App Type',app.appType==='existing_tenant'?'File Update':app.appType==='transfer_request'?'Transfer Request':'New Housing'],['Arrears',app.hasArrears?'Yes':'No'],['Status',_wfStatus[app.status]||((app.status||'draft').replace(/_/g,' '))]];
    infoEl.innerHTML=fields.map(function(f){return'<div><div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:2px;">'+f[0]+'</div><div style="font-size:13px;font-weight:500;color:var(--text);">'+f[1]+'</div></div>';}).join('');
  }
  var bd=app.scoreBreakdown||{};
  var rubricData={
    waitlist:bd.waitlist||0,waitlist_label:(bd.waitlist||0)+' year'+((bd.waitlist||0)!==1?'s':'')+' on waitlist',
    reserve:bd.reserve||0,reserve_label:bd.reserve?'Off Reserve':'On Reserve',
    band:bd.band||0,income:bd.income||0,income_label:bd.income===2?'Employment/Self-Employed':bd.income===1?'Pension':'Social/Other',
    relation:bd.relation||0,relation_label:bd.relation===3?'Divorced / Separated':app.marital||'—',
    ages:bd.ages||0,age_people:[],access:bd.access||0,access_label:bd.access?'Has accessibility needs':'None',
    moveIn:bd.moveIn||0,movein_label:bd.moveIn===3?'Within 1 year':bd.moveIn===2?'1–3 years':bd.moveIn===1?'3+ years':'No target date',
    homeCond:bd.homeCond||0,homecond_label:bd.homeCond===2?'Good':bd.homeCond===1?'Average':bd.homeCond===-2?'Poor':'No house',
    renos:bd.renos||0,renos_amt:0,arrears:bd.arrears||0,
    arrears_amt:app.arrBalAmt?parseFloat(app.arrBalAmt)||0:0,payment:bd.payment||0,payment_months:0,
  };
  // Render rubric directly into sc_rubric_rows
  var scRubricEl=document.getElementById('sc_rubric_rows');
  if(scRubricEl){
    // Seed _lastScoreResult from stored breakdown so rubric renders without re-scoring
    if(!window._lastScoreResult && app.scoreBreakdown) {
      window._lastScoreResult = { score: app.score||0, tier: app.tier||'', breakdown: app.scoreBreakdown };
    }
    // If no V2 breakdown, fall back to legacy rubric
    if(window._lastScoreResult && window._lastScoreResult.breakdown && window._lastScoreResult.breakdown.sectionA) {
      renderRubricTableV2(window._lastScoreResult.breakdown, scRubricEl);
    } else {
      renderRubricTable(rubricData, scRubricEl);
    }
  }
  var edAdj=bd.edAdjustment||app.edAdjustment||0;
  var edReason=bd.edAdjustReason||app.edAdjustReason||'';
  var edSec=document.getElementById('sc_ed_section');var edCon=document.getElementById('sc_ed_content');
  if(edSec&&edCon){
    if(edAdj||(app.edNotes)){edSec.style.display='block';edCon.innerHTML=(edAdj?'<div style="font-size:13px;margin-bottom:6px;"><strong>'+(edAdj>0?'+':'')+edAdj+' pts</strong>'+(edReason?' — '+edReason:'')+'</div>':'')+(app.edNotes?'<div style="font-size:13px;color:var(--muted);">'+app.edNotes+'</div>':'');}
    else edSec.style.display='none';
  }
  _scv.scrollTop=0;
  // Load application documents from Supabase Storage
  scLoadDocs(app);
  // Wire Assign Files button
  var assignBtn = document.getElementById('sc_assign_btn');
  if(assignBtn) { assignBtn.onclick = null; assignBtn.addEventListener('click', function(){ scShowAssignDocs(app); }); }

  // Pre-fill ED panel with existing values
  var edAdjEl     = document.getElementById('sc_ed_adj_pts');
  var edReasonEl  = document.getElementById('sc_ed_adj_reason');
  var edNotesEl   = document.getElementById('sc_ed_adj_notes');
  if(edAdjEl)    edAdjEl.value    = app.edAdjustment   || (bd.edAdjustment   || 0);
  if(edReasonEl) edReasonEl.value = app.edAdjustReason || (bd.edAdjustReason || '');
  if(edNotesEl)  edNotesEl.value  = app.edNotes        || '';

  // Render role-appropriate approval action buttons
  if(typeof renderScorecardActions === 'function') renderScorecardActions(app);
}

// ── Panel helpers — used by housing.html and renos.html ─────────────────────

function openTenantFilesPanel(unitId){
  _tenantFilesUnitId = unitId;
  var allUnits = (typeof housingUnits!=='undefined'&&housingUnits.length)?housingUnits:(window.HOUSING_UNITS_DATA||[]);
  var u = allUnits.find(function(x){ return x.id===unitId; });
  var title = document.getElementById('tfp_title');
  if(title) title.textContent = u ? u.num+' '+u.street+(u.assignedName?' — '+u.assignedName:'') : unitId;

  // Mount DocLibrary into #tfp_mount. If a prior instance exists from a
  // different tenant, clear it so the mount re-initializes cleanly.
  var mount = document.getElementById('tfp_mount');
  if (mount) {
    mount.innerHTML = '';
    if (window.DocLibrary) {
      _tenantFilesLib = window.DocLibrary.create(mount, {
        entityType:    'tenant',
        entityId:      unitId,
        pathPrefix:    'tenants/' + unitId,
        supabaseUrl:   SUPABASE_URL,
        supabaseAnon:  SUPABASE_ANON,
        storageBucket: STORAGE_BUCKET,
        getAuthToken:  function(){ return (window.HOUSING_HEADERS && window.HOUSING_HEADERS['Authorization'] || '').replace('Bearer ',''); },
        auditTable:    'housing_audit_log',
        getActor:      function(){ return window.currentRole || 'staff'; },
        categories:    _HOUSING_TENANT_DOC_CATEGORIES,
        // When anything changes, refresh the Unit Detail Panel preview if
        // it's currently rendered for the same unit (shares data source).
        onChange: function(){
          if (typeof _currentDetailUnitId !== 'undefined' &&
              _currentDetailUnitId === unitId) {
            udpRenderFilePreviews(unitId);
          }
        }
      });
    } else {
      mount.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px;">Document library unavailable (shared.js not loaded).</div>';
    }
  }

  var panel = document.getElementById('tenantFilesPanel');
  if(panel){ panel.style.setProperty('display','flex','important'); document.body.classList.add('modal-open'); }
}

function closeTenantFilesPanel(){
  var panel = document.getElementById('tenantFilesPanel');
  if(panel) panel.style.display='none';
  document.body.classList.remove('modal-open');
  _tenantFilesUnitId = null;
  _tenantFilesLib = null;
  // Refresh tenants view so file count badge updates
  if(typeof renderTenantsView === 'function') renderTenantsView();
}

function closeUnitDetail() {
  var p = document.getElementById('unitDetailPanel');
  if (p) p.style.display = 'none';
}
