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
        created_by_email:    row.created_by_email     || null
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
async function sbSaveApplication(app) {
  var row = {
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
    // V2 scoring inputs
    urgent_need:           app.urgentNeed           || app.urgent_need           || 'none',
    health_risk:           app.healthRisk           || app.health_risk           || 'none',
    persons_over_standard: parseInt(app.personsOverStandard || app.persons_over_standard || 0) || 0,
    lone_parent:           !!(app.loneParent        || app.lone_parent),
    elder_in_household:    !!(app.elderInHousehold  || app.elder_in_household),
    household_disability:  !!(app.householdDisability || app.household_disability),
    no_prior_tenancy:      (app.noPriorTenancy !== undefined ? !!app.noPriorTenancy : !!(app.no_prior_tenancy !== false)),
    rent_payment_history:  app.rentPaymentHistory   || app.rent_payment_history  || 'no_history',
    unit_condition:        app.unitCondition        || app.unit_condition        || 'no_history',
    tenancy_conduct:       app.tenancyConduct       || app.tenancy_conduct       || 'no_history',
    income_stability:      app.incomeStability      || app.income_stability      || 'stable',
    arrears_status:        app.arrearsStatus        || app.arrears_status        || 'none',
    // V2 scoring outputs
    score_v2:           typeof app.score_v2 === 'number' ? app.score_v2 : (typeof app.score === 'number' ? app.score : null),
    tier_v2:            app.tier_v2 || app.tier || null,
    score_breakdown_v2: app.scoreBreakdown || null,
    // Application type
    app_type:           app.appType || app.app_type || 'new_housing',
    transfer_pending:   !!(app.transferPending || app.transfer_pending),
    // Ownership — enforces HE-L1 own-draft rule via RLS
    created_by_email:   app.created_by_email || HOUSING_SESSION.email || null
  };
  try {
    var r = await fetch(SUPABASE_URL + '/rest/v1/housing_applications', {
      method:  'POST',
      headers: Object.assign({}, HOUSING_HEADERS, { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
      body:    JSON.stringify(row)
    });
    if (!r.ok) { var e = await r.text(); console.warn('[SB] save application failed:', e); return false; }
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
