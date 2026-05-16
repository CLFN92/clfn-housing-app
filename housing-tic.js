/* ============================================================
 * housing-tic.js — Tenant Information Card (TIC)
 *
 * Self-contained IIFE that powers the full-screen tenant dashboard
 * triggered from tenants.html row clicks.
 *
 * Public entry points:
 *   window.openTenantCard(idOrUnitId)
 *   window.closeTenantCard()
 *
 * Loaded after housing-modals.js so the optional handoff to
 * openSowModal() (footer "New Work Order" button) resolves.
 * Depends on globals from:
 *   shared-config.js   — SUPABASE_URL, SUPABASE_ANON, STORAGE_BUCKET, ROLE
 *   shared-auth.js     — HOUSING_HEADERS, HOUSING_SESSION
 *   shared-ui.js       — showToast
 *   shared-data.js     — auditEntry, sbSaveApplication
 *   approval-authority.js — APPROVAL_AUTHORITY (optional)
 *   In-memory caches   — applications[], housingUnits[]
 *   window.DocLibrary  — Documents tab mount
 * ============================================================ */

(function(){
  'use strict';

  // ── Schema constants ──────────────────────────────────────────────────────
  var TIC_T = {
    tenants:      'tenants',
    rent_ledger:  'rent_ledger',
    tenant_notes: 'tenant_notes',
    applications: 'housing_applications'
  };
  // Per-tenant emergency-contact column names on the tenants table.
  var TIC_EC = {
    name:         'emergency_contact_name',
    relationship: 'emergency_contact_relationship',
    phone:        'emergency_contact_phone',
    address:      'emergency_contact_address'
  };

  var TIC_VULN_OPTIONS = [
    'Elder in Household',
    'Household Disability',
    'Single Parent',
    'Medical Condition',
    'Mental Health',
    'Domestic Violence',
    'Veteran',
    'Youth',
    'Other'
  ];
  var TIC_C = {
    tenant_pk:          'id',
    tenant_fk:          'tenant_id',
    full_name:          'full_name',
    unit_number:        'unit_number',
    bedrooms:           'bedrooms',
    housing_stream:     'housing_stream',
    move_in_date:       'move_in_date',
    lease_type:         'lease_type',
    band_membership:    'band_membership',
    scoring_points:     'scoring_points',
    file_number:        'file_number',
    wait_list_date:     'wait_list_date',
    vulnerability:      'vulnerability_flags',
    tenancy_status:     'tenancy_status',
    approved_by:        'approved_by',
    application_id:     'application_id',
    relationship:       'relationship',
    date_of_birth:      'date_of_birth',
    role:               'role',
    mobile_phone:       'mobile_phone',
    home_phone:         'home_phone',
    email:              'email',
    mailing_address:    'mailing_address',
    address:            'address',
    pet_name:           'pet_name',
    species:            'species',
    breed:              'breed',
    sex:                'sex',
    age_years:          'age_years',
    approval_status:    'approval_status',
    notes:              'notes',
    monthly_rent:       'monthly_rent',
    arrears_balance:    'arrears_balance',
    arrangement_status: 'arrangement_status',
    arrangement_payment:'arrangement_payment',
    arrangement_start:  'arrangement_start',
    arrangement_clear:  'arrangement_clear_date',
    note_body:          'note_body',
    created_at:         'created_at',
    author_name:        'author_name',
    phone:              'phone',
    hydro_account:      'hydro_account_number',
    hydro_meter:        'hydro_meter_number'
  };

  var TIC_SCORE_CAP = 100;
  var TIC_PHONE_RE  = /^[0-9 ()\-+]+$/;
  var TIC_EMAIL_RE  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var TIC_UUID_RE   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var TIC_MISSING_TABLES = {};

  // ── Module state ──────────────────────────────────────────────────────────
  // The application is the source of truth for occupants / contact /
  // references / pets. The tenants row holds tenant-specific fields and the
  // emergency-contact columns. The other tables are tenant-only side data.
  var _ticState = {
    tenant: null,        // tenants row
    unit:   null,        // housing_units row
    application: null,   // housing_applications row (rich data lives in .data merged via sbLoadApplications)
    ledger: null,        // rent_ledger row
    notes: [],           // tenant_notes rows
    applicationNotes: [],// housing_application_notes rows — merged into Notes panel
    activeTab: 'overview',
    prevFocus: null,
    keyHandler: null
  };

  // ── DOM helpers ───────────────────────────────────────────────────────────
  function _ticEl(id){ return document.getElementById(id); }
  function _ticEsc(s){
    if(s == null) return '';
    return String(s).replace(/[&<>"']/g, function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }
  function _ticInitials(name){
    if(!name) return '—';
    var parts = String(name).trim().split(/\s+/);
    return ((parts[0]||'').charAt(0) + (parts[parts.length-1]||'').charAt(0)).toUpperCase() || '—';
  }
  function _ticFmtMoney(n){
    if(n == null || n === '' || isNaN(Number(n))) return '—';
    return '$' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function _ticFmtDate(s){
    if(!s) return '—';
    try {
      var d = new Date(s);
      if(isNaN(d.getTime())) return String(s);
      return d.toISOString().slice(0,10);
    } catch(e){ return String(s); }
  }
  function _ticFmtDT(s){
    if(!s) return '—';
    try {
      var d = new Date(s);
      if(isNaN(d.getTime())) return String(s);
      return d.toISOString().replace('T',' ').slice(0,16) + ' UTC';
    } catch(e){ return String(s); }
  }
  function _ticAge(dob){
    if(!dob) return '';
    var d = new Date(dob);
    if(isNaN(d.getTime())) return '';
    var diff = Date.now() - d.getTime();
    var age = new Date(diff).getUTCFullYear() - 1970;
    return age >= 0 ? String(age) + ' yrs' : '';
  }
  function _ticPet(species){
    var s = (species||'').toLowerCase();
    if(s.indexOf('dog')   >= 0) return '🐕';
    if(s.indexOf('cat')   >= 0) return '🐈';
    if(s.indexOf('bird')  >= 0) return '🐦';
    if(s.indexOf('fish')  >= 0) return '🐟';
    if(s.indexOf('rab')   >= 0) return '🐇';
    if(s.indexOf('rep')   >= 0 || s.indexOf('liz') >= 0 || s.indexOf('snake') >= 0) return '🦎';
    return '🐾';
  }

  // ── Supabase wrappers ─────────────────────────────────────────────────────
  function _ticReady(){
    return (typeof SUPABASE_URL !== 'undefined' && typeof HOUSING_HEADERS !== 'undefined');
  }
  function _ticGet(path){
    if(!_ticReady()) return Promise.reject(new Error('supabase config not loaded'));
    var tableKey = (path.split('?')[0] || '').split('/')[0];
    if(TIC_MISSING_TABLES[tableKey]) return Promise.resolve({ _ticMissing: true, _status: 404 });
    return fetch(SUPABASE_URL + '/rest/v1/' + path, { headers: HOUSING_HEADERS })
      .then(function(r){
        if(r.status === 404){ TIC_MISSING_TABLES[tableKey] = true; return { _ticMissing: true, _status: 404 }; }
        if(r.status === 400) return { _ticMissing: true, _status: 400 };
        if(!r.ok) return { _ticError: true, _status: r.status };
        return r.json();
      })
      .catch(function(err){ return { _ticError: true, _err: String(err) }; });
  }
  function _ticWrite(method, path, body){
    if(!_ticReady()) return Promise.reject(new Error('supabase config not loaded'));
    var hdrs = Object.assign({}, HOUSING_HEADERS, { 'Prefer': 'return=representation' });
    return fetch(SUPABASE_URL + '/rest/v1/' + path, {
      method: method,
      headers: hdrs,
      body: JSON.stringify(body)
    }).then(function(r){
      if(!r.ok) return r.text().then(function(t){ throw new Error('HTTP '+r.status+': '+t); });
      return r.json();
    });
  }
  function _ticIsArray(v){ return Array.isArray(v); }
  function _ticIsMissing(v){ return v && v._ticMissing === true; }
  function _ticIsError(v){   return v && v._ticError === true; }

  // ── Resolve tenant + unit ─────────────────────────────────────────────────
  function _ticResolveTenant(idOrUnitId){
    var lookupAsTenantId = TIC_UUID_RE.test(String(idOrUnitId));
    var primary = lookupAsTenantId
      ? _ticGet(TIC_T.tenants + '?' + TIC_C.tenant_pk + '=eq.' + encodeURIComponent(idOrUnitId) + '&select=*')
      : Promise.resolve([]);
    return primary.then(function(rows){
      if(_ticIsArray(rows) && rows.length) return { tenant: rows[0], byUnit: false };
      // Treat as unit id: find unit in housingUnits, then look up tenant by assigned_name.
      var unit = _ticFindUnitById(idOrUnitId);
      if(!unit) return { tenant: null, byUnit: false, unit: null };
      if(!unit.assignedName) return { tenant: null, byUnit: true, unit: unit };
      return _ticGet(TIC_T.tenants + '?' + TIC_C.full_name + '=eq.' + encodeURIComponent(unit.assignedName) + '&select=*')
        .then(function(rows2){
          if(_ticIsArray(rows2) && rows2.length) return { tenant: rows2[0], byUnit: true, unit: unit };
          return { tenant: null, byUnit: true, unit: unit };
        });
    });
  }
  function _ticFindUnitById(id){
    try {
      var src = (typeof housingUnits !== 'undefined' && housingUnits.length)
        ? housingUnits : (window.HOUSING_UNITS_DATA || []);
      for(var i=0;i<src.length;i++){ if(String(src[i].id) === String(id)) return src[i]; }
    } catch(e){}
    return null;
  }

  // ── Per-tab parallel loaders ──────────────────────────────────────────────
  // Only tenant-side rows are fetched here. Occupants / Contact / References /
  // Pets all read from _ticState.application (loaded by _ticLoadApplication).
  function _ticLoadAll(tenantId, unit){
    var fk = encodeURIComponent(tenantId);
    return Promise.all([
      _ticGet(TIC_T.rent_ledger  + '?' + TIC_C.tenant_fk + '=eq.' + fk + '&select=*&limit=1'),
      _ticGet(TIC_T.tenant_notes + '?' + TIC_C.tenant_fk + '=eq.' + fk + '&select=*&order=' + TIC_C.created_at + '.desc')
    ]).then(function(res){
      _ticState.ledger = _ticIsArray(res[0]) ? (res[0][0] || null) : res[0];
      _ticState.notes  = _ticIsArray(res[1]) ? res[1] : (res[1] || []);
      _ticState.unit   = unit || _ticState.unit;
    });
  }
  // Resolves the linked application (full row) and caches it for read-only
  // surfacing across the Overview, Occupants (co-app/habitants), Pets, and
  // References tabs. Uses the same name-fallback chain as the View Application
  // footer button so a tenant without an explicit application_id still wires up.
  function _ticLoadApplication(){
    return _ticFindApplicationForTenant().then(function(appId){
      if(!appId){ _ticState.application = null; return; }
      var local = (typeof applications !== 'undefined' && applications && applications.length)
                ? applications : (window.SP_APPLICATIONS || []);
      var hydrated = null;
      for(var i=0;i<local.length;i++){
        if(local[i] && local[i].id === appId){ hydrated = local[i]; break; }
      }
      var appPromise = hydrated
        ? Promise.resolve().then(function(){ _ticState.application = hydrated; })
        : _ticGet(TIC_T.applications + '?id=eq.' + encodeURIComponent(appId) + '&select=*&limit=1').then(function(rows){
            if(_ticIsArray(rows) && rows.length){
              var raw = rows[0];
              // The applications table stores rich data in a JSONB `data` column.
              // Mirror sbLoadApplications: spread data first so callers see a flat
              // app object with fn/ln/pets/references/etc. directly addressable.
              _ticState.application = Object.assign({}, raw.data || {}, raw, { id: raw.id });
            } else {
              _ticState.application = null;
            }
          });
      // After the application row resolves, also pull any internal notes that
      // were captured during intake. These are merged into the TIC Notes panel
      // alongside tenant_notes so attribution carries over once the applicant
      // becomes a tenant.
      return appPromise.then(function(){
        if(typeof window.sbLoadAppNotes !== 'function') return;
        return window.sbLoadAppNotes(appId).then(function(rows){
          _ticState.applicationNotes = Array.isArray(rows) ? rows : [];
        }).catch(function(){ _ticState.applicationNotes = []; });
      });
    }).catch(function(){ _ticState.application = null; _ticState.applicationNotes = []; });
  }

  // ── Render: hero, strip, tabs ─────────────────────────────────────────────
  function _ticRenderHero(){
    var t = _ticState.tenant || {};
    var u = _ticState.unit   || {};
    var name = t[TIC_C.full_name] || u.assignedName || 'Unknown Tenant';
    _ticEl('tic_avatar').textContent = _ticInitials(name);
    _ticEl('tic_name').textContent   = name;

    var subParts = [];
    if(t[TIC_C.unit_number]) subParts.push('Unit ' + t[TIC_C.unit_number]);
    else if(u.num)           subParts.push('Unit ' + u.num + (u.street?' '+u.street:''));
    if(t[TIC_C.bedrooms] != null)    subParts.push(t[TIC_C.bedrooms] + '-bed');
    else if(u.bedrooms != null)      subParts.push(u.bedrooms + '-bed');
    _ticEl('tic_hero_sub').textContent = subParts.join(' · ');

    var badges = [];
    var stream = t[TIC_C.housing_stream];
    if(stream) badges.push('<span class="std-pill std-pill-info">' + _ticEsc(stream) + '</span>');
    var status = t[TIC_C.tenancy_status] || u.status;
    if(status) badges.push('<span class="std-pill std-pill-info">' + _ticEsc(status) + '</span>');
    var band   = t[TIC_C.band_membership];
    if(band) badges.push('<span class="std-pill std-pill-info">' + _ticEsc(band) + '</span>');
    _ticEl('tic_hero_badges').innerHTML = badges.join('');
  }
  function _ticRenderStrip(){
    var t = _ticState.tenant  || {};
    var l = _ticState.ledger  || {};
    var u = _ticState.unit    || {};
    // Rent prefers the per-tenant ledger row; falls back to the unit's
    // monthlyRent (set on the Inventory > Edit Unit form) so newly added units
    // surface their rate even before a ledger row exists for the tenant.
    var rent = (l[TIC_C.monthly_rent] != null)
             ? l[TIC_C.monthly_rent]
             : (u.monthlyRent != null ? u.monthlyRent : (u.monthly_rent != null ? u.monthly_rent : null));
    var arrears = (l[TIC_C.arrears_balance] != null) ? Number(l[TIC_C.arrears_balance]) : null;
    _ticEl('tic_strip_rent').textContent    = rent != null ? _ticFmtMoney(rent) : '—';

    var arrearsEl = _ticEl('tic_strip_arrears');
    arrearsEl.classList.remove('tic-arrears-bad','tic-arrears-good');
    if(arrears == null){
      arrearsEl.textContent = '—';
    } else if(arrears > 0){
      arrearsEl.textContent = _ticFmtMoney(arrears);
      arrearsEl.classList.add('tic-arrears-bad');
    } else {
      arrearsEl.textContent = _ticFmtMoney(0);
      arrearsEl.classList.add('tic-arrears-good');
    }

    _ticEl('tic_strip_movein').textContent = _ticFmtDate(t[TIC_C.move_in_date] || u.assignedDate);
    _ticEl('tic_strip_lease').textContent  = t[TIC_C.lease_type]    || '—';
    _ticEl('tic_strip_status').textContent = t[TIC_C.tenancy_status] || u.status || '—';
    _ticEl('tic_strip_score').textContent  = (t[TIC_C.scoring_points] != null) ? String(t[TIC_C.scoring_points]) : '—';
  }

  // ── Render: Overview ──────────────────────────────────────────────────────
  // Editable rows write to the `tenants` table via PATCH. Read-only rows are
  // unit-derived (bedrooms, unit_number) or system-set (approved_by) and
  // always render as plain text.
  var TIC_TENANCY_OPTIONS = ['active','vacated','transferred','evicted','suspended','deceased','bankrupt'];
  var TIC_LEASE_TYPE_OPTIONS = ['Rental','Rent-to-Own','Lease-to-Own','Market','Subsidized','Elders','Family Compound','Other'];
  var TIC_INCOME_PERSONS = ['Applicant','Co-Applicant'];
  var TIC_INCOME_TYPES   = ['Employed','Self-Employment','OW','ODSP','CPP','EI','Pension','Other'];
  var TIC_OVERVIEW_FIELDS = [
    { key: TIC_C.wait_list_date,  label: 'Wait List Date',      type: 'date',   readOnly: true },
    { key: TIC_C.lease_type,      label: 'Lease Type',          type: 'select', options: TIC_LEASE_TYPE_OPTIONS },
    { key: TIC_C.band_membership, label: 'Band Membership',     type: 'text' },
    { key: TIC_C.approved_by,     label: 'Approved By',         type: 'text',   readOnly: true },
    // Unit details
    { key: TIC_C.unit_number,     label: 'Unit Number',         type: 'text',   readOnly: true, group: 'unit' },
    { key: TIC_C.bedrooms,        label: 'Bedrooms',            type: 'number', readOnly: true, group: 'unit' },
    { key: TIC_C.move_in_date,    label: 'Move-In Date',        type: 'date',   group: 'unit' },
    { key: TIC_C.tenancy_status,  label: 'Tenancy Status',      type: 'select', options: TIC_TENANCY_OPTIONS, group: 'unit' },
    { key: TIC_C.vulnerability,   label: 'Vulnerability Flags', type: 'multi',  options: TIC_VULN_OPTIONS, group: 'unit' },
    { key: TIC_C.application_id,  label: 'Application Number',  type: 'text',   group: 'meta',      readOnly: true },
    { key: TIC_C.hydro_account,   label: 'Hydro Account #',     type: 'text',   group: 'utilities' },
    { key: TIC_C.hydro_meter,     label: 'Hydro Meter #',       type: 'text',   group: 'utilities' }
  ];

  function _ticOverviewRowVal(field){
    var t = _ticState.tenant || {};
    var u = _ticState.unit   || {};
    var a = _ticState.application;
    var v = t[field.key];
    // Unit-derived fall-throughs (read-only rows)
    if(field.key === TIC_C.unit_number && (v == null || v === '') && u.num){
      return (u.num + (u.street ? ' ' + u.street : ''));
    }
    if(field.key === TIC_C.bedrooms && (v == null || v === '') && u.bedrooms != null){
      return u.bedrooms;
    }
    if(field.key === TIC_C.move_in_date && (v == null || v === '') && u.assignedDate){
      return u.assignedDate;
    }
    if(field.key === TIC_C.tenancy_status && (v == null || v === '') && u.status){
      return u.status;
    }
    // Application Number — prefer the resolved application's id over a
    // potentially stale tenants.application_id column.
    if(field.key === TIC_C.application_id){
      if(a && a.id) return a.id;
      return v || '';
    }
    // Wait List Date — derived from the application's appDate (the canonical
    // source used by scoring). Tenants column override is honoured if present.
    if(field.key === TIC_C.wait_list_date){
      if(v) return v;
      if(a && a.appDate)     return a.appDate;
      if(a && a.submittedAt) return a.submittedAt;
      return '';
    }
    // Vulnerability Flags — only fall back to derived defaults from the
    // application when the stored column is genuinely unset (null/undefined).
    // An explicit empty array means the user unchecked everything; respect it.
    if(field.key === TIC_C.vulnerability){
      if(_ticIsArray(v)) return v;
      if(typeof v === 'string'){
        var trimmed = v.trim();
        if(!trimmed) return [];
        return trimmed.split(',').map(function(s){return s.trim();}).filter(function(s){return s.length;});
      }
      // v is null or undefined → derive from the linked application's flags
      var derived = [];
      if(a && a.elderInHousehold)    derived.push('Elder in Household');
      if(a && a.householdDisability) derived.push('Household Disability');
      return derived;
    }
    return v;
  }
  function _ticOverviewRowDisplay(field){
    var v = _ticOverviewRowVal(field);
    if(field.type === 'date')   return _ticFmtDate(v);
    if(field.type === 'array'){
      if(_ticIsArray(v) && v.length) return v.join(', ');
      if(typeof v === 'string' && v.trim()) return v;
      return '';
    }
    return (v == null) ? '' : String(v);
  }
  function _ticOverviewInputHtml(field){
    var rawVal = _ticOverviewRowVal(field);
    if(rawVal == null) rawVal = '';
    if(field.type === 'multi'){
      var current = _ticIsArray(rawVal) ? rawVal : [];
      return '<div class="tic-vuln-grid">' + (field.options || []).map(function(o){
        var ck = current.indexOf(o) >= 0 ? ' checked' : '';
        return '<label class="tic-chk"><input type="checkbox" data-tic-ov-input="1" data-tic-vuln="' + _ticEsc(o) + '"' + ck + '/> ' + _ticEsc(o) + '</label>';
      }).join('') + '</div>';
    }
    if(field.type === 'select'){
      var opts = (field.options || []).map(function(o){
        var sel = (String(o) === String(rawVal)) ? ' selected' : '';
        return '<option value="' + _ticEsc(o) + '"' + sel + '>' + _ticEsc(o) + '</option>';
      }).join('');
      return '<select class="tic-input" data-tic-ov-input="1"><option value="">—</option>' + opts + '</select>';
    }
    if(field.type === 'array'){
      var asText = _ticIsArray(rawVal) ? rawVal.join(', ') : (rawVal || '');
      return '<input class="tic-input" type="text" data-tic-ov-input="1" placeholder="comma-separated" value="' + _ticEsc(asText) + '"/>';
    }
    if(field.type === 'date'){
      var d = rawVal ? String(rawVal).slice(0,10) : '';
      return '<input class="tic-input" type="date" data-tic-ov-input="1" value="' + _ticEsc(d) + '"/>';
    }
    if(field.type === 'number'){
      return '<input class="tic-input" type="number" data-tic-ov-input="1" value="' + _ticEsc(rawVal) + '"/>';
    }
    return '<input class="tic-input" type="text" data-tic-ov-input="1" value="' + _ticEsc(rawVal) + '"/>';
  }
  function _ticOverviewRowHtml(field){
    if(field.readOnly){
      var disp = _ticOverviewRowDisplay(field);
      var has  = (disp !== '' && disp !== '—');
      return '<div class="tic-row tic-row-readonly">'
           +   '<div class="tic-row-lbl">' + _ticEsc(field.label) + '</div>'
           +   '<div class="tic-row-val">' + (has ? _ticEsc(disp) : '<span class="tic-field-val tic-empty">—</span>') + '</div>'
           + '</div>';
    }
    return '<div class="tic-row tic-row-edit" data-tic-ov-key="' + _ticEsc(field.key) + '" data-tic-ov-type="' + field.type + '">'
         +   '<div class="tic-row-lbl">' + _ticEsc(field.label) + '</div>'
         +   '<div class="tic-row-val">' + _ticOverviewInputHtml(field) + '</div>'
         + '</div>';
  }

  function _ticIncomeRows(){
    var a = _ticState.application;
    if(!a || !_ticIsArray(a.incomes)) return [];
    return a.incomes.filter(function(r){
      return r && (r.incomeType || r.employer || r.primaryAmt != null);
    });
  }
  function _ticRenderOverview(){
    var l = _ticState.ledger  || {};

    function renderGroup(filter){
      return TIC_OVERVIEW_FIELDS.filter(filter).map(_ticOverviewRowHtml).join('');
    }

    var html = ''
      + '<div class="tic-section">'
      +   '<div class="tic-section-h">Application Summary</div>'
      +   '<div class="tic-rows">'
      +     renderGroup(function(f){ return !f.group; })
      +   '</div>'
      + '</div>'
      + '<div class="tic-section">'
      +   '<div class="tic-section-h">Unit Details</div>'
      +   '<div class="tic-rows">'
      +     renderGroup(function(f){ return f.group === 'unit'; })
      +   '</div>'
      + '</div>';

    // Income section — editable list of app.incomes. Amount is intentionally
    // hidden from the TIC; if it's set elsewhere (application form), the value
    // is preserved through edits but never displayed or surfaced for input.
    var app     = _ticState.application;
    var incomes = _ticIsArray(app && app.incomes) ? app.incomes : [];
    html += '<div class="tic-section">'
         +    '<div class="tic-section-h">Employment &amp; Income</div>';
    if(!app){
      html += '<div class="tic-pending-inline">No linked application — income is sourced from the application form.</div>';
    } else {
      var realIncomes = incomes.filter(function(r){ return r && (r.incomeType || r.employer || r.person); });
      if(!realIncomes.length){
        html += '<div class="tic-empty">No income records on the application.</div>';
      } else {
        html += '<table class="tic-table"><thead><tr>'
             +    '<th>Person</th><th>Type</th><th>Employer</th><th></th>'
             +    '</tr></thead><tbody>';
        incomes.forEach(function(r, idx){
          if(!r || (!r.incomeType && !r.employer && !r.person)) return;
          html += '<tr data-tic-inc-idx="' + idx + '">'
               +   '<td>' + _ticEsc(r.person || '—') + '</td>'
               +   '<td>' + _ticEsc(r.incomeType || '—') + '</td>'
               +   '<td>' + _ticEsc(r.employer || '—') + '</td>'
               +   '<td class="tic-row-actions">'
               +     '<button type="button" class="btn btn-ghost" data-tic-action="inc-edit">Edit</button>'
               +     '<button type="button" class="btn btn-ghost" data-tic-action="inc-delete">Delete</button>'
               +   '</td>'
               + '</tr>';
        });
        html += '</tbody></table>';
      }
      html += '<div class="tic-form-actions"><button type="button" class="btn btn-primary" data-tic-action="inc-add">+ Add Income Record</button></div>';
      var personOpts = TIC_INCOME_PERSONS.map(function(p){ return '<option value="' + _ticEsc(p) + '">' + _ticEsc(p) + '</option>'; }).join('');
      var typeOpts   = TIC_INCOME_TYPES.map(function(t){ return '<option value="' + _ticEsc(t) + '">' + _ticEsc(t) + '</option>'; }).join('');
      // Form mirrors the application form's persisted income shape:
      // {person, incomeType, employer, primaryAmt}. Employer field reveals
      // when Income Type is Employed/Self-Employment (matches app form behaviour).
      html += '<div id="tic_inc_form" class="tic-add-form" data-tic-inc-mode="add">'
           +   '<div class="tic-grid-2">'
           +     '<div class="tic-field"><label class="tic-field-lbl">Person *</label>'
           +       '<select class="tic-input" id="tic_inc_person"><option value="">—</option>' + personOpts + '</select></div>'
           +     '<div class="tic-field"><label class="tic-field-lbl">Income Type *</label>'
           +       '<select class="tic-input" id="tic_inc_type"><option value="">—</option>' + typeOpts + '</select></div>'
           +     '<div class="tic-field tic-grid-span-2 tic-inc-employer-row"><label class="tic-field-lbl">Employer</label><input class="tic-input" id="tic_inc_employer" type="text"/></div>'
           +     '<div class="tic-field"><label class="tic-field-lbl">Primary Amount</label><input class="tic-input" id="tic_inc_amount" type="number" min="0" step="0.01" placeholder="0.00"/></div>'
           +     '<div class="tic-field"><label class="tic-field-lbl">Period</label>'
           +       '<select class="tic-input" id="tic_inc_period"><option value="">—</option><option value="month">Per Month</option><option value="annual">Per Year</option></select></div>'
           +   '</div>'
           +   '<div class="tic-form-actions">'
           +     '<button type="button" class="btn btn-ghost"   data-tic-action="inc-cancel">Cancel</button>'
           +     '<button type="button" class="btn btn-primary" data-tic-action="inc-save">Save</button>'
           +   '</div>'
           + '</div>';
    }
    html += '</div>';

    var u_for_rent = _ticState.unit || {};
    var displayRent = (l[TIC_C.monthly_rent] != null)
                    ? l[TIC_C.monthly_rent]
                    : (u_for_rent.monthlyRent != null ? u_for_rent.monthlyRent : (u_for_rent.monthly_rent != null ? u_for_rent.monthly_rent : null));
    html += '<div class="tic-section">'
         +    '<div class="tic-section-h">Application Linkage</div>'
         +    '<div class="tic-rows">'
         +      renderGroup(function(f){ return f.group === 'meta'; })
         +    '</div>'
         + '</div>'
         + '<div class="tic-section">'
         +    '<div class="tic-section-h">Rent Arrangement</div>'
         +    '<div class="tic-grid-3">'
         +      _ticField('Monthly Rent',           _ticFmtMoney(displayRent))
         +      _ticField('Arrears Balance',        _ticFmtMoney(l[TIC_C.arrears_balance]))
         +      _ticField('Arrangement Status',     l[TIC_C.arrangement_status])
         +      _ticField('Arrangement Payment',    _ticFmtMoney(l[TIC_C.arrangement_payment]))
         +      _ticField('Arrangement Start',      _ticFmtDate(l[TIC_C.arrangement_start]))
         +      _ticField('Clear-By Date',          _ticFmtDate(l[TIC_C.arrangement_clear]))
         +    '</div>'
         + '</div>'
         + '<div class="tic-section">'
         +    '<div class="tic-section-h">Utilities</div>'
         +    '<div class="tic-rows">'
         +      renderGroup(function(f){ return f.group === 'utilities'; })
         +    '</div>'
         + '</div>';
    _ticEl('tic_panel_overview').innerHTML = html;
  }
  function _ticField(label, value){
    var has = (value != null && value !== '' && value !== '—');
    return '<div class="tic-field"><div class="tic-field-lbl">' + _ticEsc(label) + '</div>'
         + '<div class="tic-field-val' + (has ? '' : ' tic-empty') + '">' + (has ? _ticEsc(value) : '—') + '</div></div>';
  }

  function _ticOverviewFieldByKey(key){
    for(var i=0;i<TIC_OVERVIEW_FIELDS.length;i++){
      if(TIC_OVERVIEW_FIELDS[i].key === key) return TIC_OVERVIEW_FIELDS[i];
    }
    return null;
  }
  function _ticOverviewSave(rowEl){
    var key   = rowEl.getAttribute('data-tic-ov-key');
    var field = _ticOverviewFieldByKey(key);
    if(!field || field.readOnly) return;
    var body  = {};
    var raw   = '';
    var inp   = null;
    if(field.type === 'multi'){
      var checks = rowEl.querySelectorAll('input[type="checkbox"][data-tic-vuln]');
      var picked = [];
      for(var i=0;i<checks.length;i++){ if(checks[i].checked) picked.push(checks[i].getAttribute('data-tic-vuln')); }
      body[key] = picked.length ? picked : null;
      inp = rowEl;
    } else {
      inp = rowEl.querySelector('[data-tic-ov-input]');
      if(!inp) return;
      raw = inp.value;
      if(field.type === 'array'){
        var arr = String(raw||'').split(',').map(function(s){return s.trim();}).filter(function(s){return s.length;});
        body[key] = arr.length ? arr : null;
      } else if(field.type === 'number'){
        body[key] = (raw === '' || raw == null) ? null : Number(raw);
      } else {
        body[key] = (raw === '') ? null : raw;
      }
    }
    // Skip no-op saves (typing then leaving unchanged)
    var prevRaw = _ticOverviewRowVal(field);
    if(field.type === 'array' || field.type === 'multi'){
      var prevArr = _ticIsArray(prevRaw) ? prevRaw : [];
      var newArr  = _ticIsArray(body[key]) ? body[key] : [];
      if(prevArr.slice().sort().join('|') === newArr.slice().sort().join('|')) return;
    } else {
      var prevNorm = (prevRaw == null) ? null : (field.type === 'number' ? Number(prevRaw) : String(prevRaw));
      var newNorm  = body[key];
      if(prevNorm === newNorm) return;
      if(prevNorm == null && newNorm == null) return;
    }
    var pk = _ticState.tenant && _ticState.tenant[TIC_C.tenant_pk];
    if(!pk){
      if(typeof showToast === 'function') showToast('No tenant record to save.', { type:'error' });
      return;
    }
    inp.classList.add('tic-saving');
    var prevForAudit = prevRaw;
    _ticWrite('PATCH', TIC_T.tenants + '?' + TIC_C.tenant_pk + '=eq.' + encodeURIComponent(pk), body)
      .then(function(rows){
        inp.classList.remove('tic-saving');
        var saved = (rows && rows[0]) || Object.assign({}, _ticState.tenant, body);
        _ticState.tenant = saved;
        // Re-render hero + strip so the avatar / name / status pills reflect the change.
        // Don't re-render overview — the user's still potentially typing in another row.
        _ticRenderHero();
        _ticRenderStrip();
        var beforeStr = _ticIsArray(prevForAudit) ? prevForAudit.join(', ') : (prevForAudit == null ? '' : String(prevForAudit));
        var afterStr  = _ticIsArray(body[key]) ? body[key].join(', ') : (body[key] == null ? '' : String(body[key]));
        _ticAudit('tic_overview_change', _ticDescribe(field.label, beforeStr, afterStr));
        if(typeof showToast === 'function') showToast('Saved.');
      })
      .catch(function(err){
        inp.classList.remove('tic-saving');
        inp.classList.add('tic-input-error');
        if(typeof showToast === 'function') showToast('Save failed: ' + err.message, { type:'error' });
      });
  }
  function _ticOnBodyChange(ev){
    var inp = ev.target;
    if(!inp || !inp.getAttribute) return;
    // Income Type change → toggle Employer field visibility (no save fires).
    if(inp.id === 'tic_inc_type'){ _ticIncApplyDynamic(); return; }
    var row = inp.closest && inp.closest('.tic-row');
    if(!row) return;
    if(inp.getAttribute('data-tic-ov-input')      === '1') { _ticOverviewSave(row);     return; }
    if(inp.getAttribute('data-tic-occ-input')     === '1') { _ticOccInlineSave(row);    return; }
    if(inp.getAttribute('data-tic-contact-input') === '1') { _ticContactInlineSave(row); return; }
  }

  // ── Audit log helper ─────────────────────────────────────────────────────
  // Wraps the existing auditEntry() in shared-data.js so every TIC mutation
  // lands in housing_audit_log + the in-memory auditLog[]. Falls back to the
  // tenant id when no application is linked.
  function _ticAudit(action, detail){
    if(typeof auditEntry !== 'function') return;
    var app = _ticState.application;
    var t   = _ticState.tenant;
    var entityId = (app && app.id) || (t && t[TIC_C.tenant_pk]) || 'TIC';
    var role = window.currentRole || 'staff';
    try { auditEntry(entityId, action, detail, role); } catch(e) {}
  }
  function _ticDescribe(label, before, after){
    var b = (before == null || before === '') ? '∅' : ('"' + String(before) + '"');
    var a = (after  == null || after  === '') ? '∅' : ('"' + String(after)  + '"');
    return label + ': ' + b + ' → ' + a;
  }

  // ── Income (employment) CRUD on app.incomes ──────────────────────────────
  // Income types where an employer field makes sense; for OW/ODSP/CPP/EI/etc.
  // the application form hides the Employer Details group.
  var TIC_INCOME_EMPLOYER_TYPES = ['Employed','Self-Employment'];

  function _ticIncApplyDynamic(){
    var typeEl = _ticEl('tic_inc_type');
    var empRow = document.querySelector('#tic_inc_form .tic-inc-employer-row');
    if(!typeEl || !empRow) return;
    var t = typeEl.value;
    var showEmp = TIC_INCOME_EMPLOYER_TYPES.indexOf(t) >= 0;
    empRow.style.display = showEmp ? '' : 'none';
  }
  function _ticResetIncForm(){
    var f = _ticEl('tic_inc_form'); if(!f) return;
    f.removeAttribute('data-tic-inc-idx');
    f.setAttribute('data-tic-inc-mode','add');
    f.classList.remove('tic-open');
    ['tic_inc_person','tic_inc_type','tic_inc_employer','tic_inc_amount','tic_inc_period'].forEach(function(id){
      var el = _ticEl(id); if(el) el.value = '';
    });
    _ticIncApplyDynamic();
  }
  function _ticIncEditOpen(idx){
    var app = _ticState.application;
    var i = Number(idx);
    var r = (app && app.incomes && app.incomes[i]) || null;
    if(!r) return;
    var form = _ticEl('tic_inc_form');
    form.setAttribute('data-tic-inc-mode','edit');
    form.setAttribute('data-tic-inc-idx', String(i));
    _ticEl('tic_inc_person').value   = r.person     || '';
    _ticEl('tic_inc_type').value     = r.incomeType || '';
    _ticEl('tic_inc_employer').value = r.employer   || '';
    _ticEl('tic_inc_amount').value   = (r.primaryAmt != null ? r.primaryAmt : '');
    _ticEl('tic_inc_period').value   = r.incomePeriod || '';
    form.classList.add('tic-open');
    _ticIncApplyDynamic();
  }
  function _ticSaveIncome(){
    var app = _ticState.application;
    if(!app){ if(typeof showToast === 'function') showToast('No linked application.', { type:'error' }); return; }
    var form   = _ticEl('tic_inc_form');
    var mode   = form.getAttribute('data-tic-inc-mode') || 'add';
    var person = (_ticEl('tic_inc_person').value||'').trim();
    var type   = (_ticEl('tic_inc_type').value||'').trim();
    if(!person || !type){
      if(typeof showToast === 'function') showToast('Person and income type are required.', { type:'error' });
      return;
    }
    var employer = (_ticEl('tic_inc_employer').value||'').trim();
    var hasEmp   = TIC_INCOME_EMPLOYER_TYPES.indexOf(type) >= 0;
    var amtRaw   = (_ticEl('tic_inc_amount').value||'').trim();
    var period   = (_ticEl('tic_inc_period').value||'').trim();
    var amt      = (amtRaw === '') ? null : Number(amtRaw);
    // Match the application form's persisted shape exactly: {person, incomeType,
    // employer, primaryAmt}. incomePeriod is round-tripped through the JSONB
    // since it doesn't conflict with the app's collection logic.
    var entry = {
      person:       person,
      incomeType:   type,
      employer:     hasEmp ? employer : '',
      primaryAmt:   amt
    };
    if(period) entry.incomePeriod = period;
    app.incomes  = _ticIsArray(app.incomes) ? app.incomes : [];
    var auditAction, auditDetail;
    if(mode === 'edit'){
      var i = Number(form.getAttribute('data-tic-inc-idx'));
      if(isNaN(i) || !app.incomes[i]) return;
      var prev = app.incomes[i];
      auditAction = 'tic_income_update';
      auditDetail = 'Updated income: ' + (prev.person||'?') + '/' + (prev.incomeType||'?') + ' → ' + person + '/' + type + (entry.employer ? ' @ ' + entry.employer : '');
      app.incomes[i] = entry;
    } else {
      auditAction = 'tic_income_add';
      auditDetail = 'Added income: ' + person + '/' + type + (entry.employer ? ' @ ' + entry.employer : '');
      app.incomes.push(entry);
    }
    _ticPersistApplication()
      .then(function(){
        _ticRenderOverview();
        _ticAudit(auditAction, auditDetail);
        if(typeof showToast === 'function') showToast(mode === 'edit' ? 'Income record updated.' : 'Income record added.');
      })
      .catch(function(err){
        if(typeof showToast === 'function') showToast('Save failed: ' + err.message, { type:'error' });
      });
  }
  function _ticIncDelete(idx){
    var app = _ticState.application;
    var i = Number(idx);
    if(!app || isNaN(i) || !app.incomes || !app.incomes[i]) return;
    var r = app.incomes[i];
    if(!confirm('Delete income record for ' + (r.person||'?') + ' (' + (r.incomeType||'?') + ')?')) return;
    var detail = 'Removed income: ' + (r.person||'?') + '/' + (r.incomeType||'?') + (r.employer ? ' @ ' + r.employer : '');
    app.incomes.splice(i, 1);
    _ticPersistApplication()
      .then(function(){
        _ticRenderOverview();
        _ticAudit('tic_income_delete', detail);
        if(typeof showToast === 'function') showToast('Income record removed.');
      })
      .catch(function(err){
        if(typeof showToast === 'function') showToast('Delete failed: ' + err.message, { type:'error' });
      });
  }

  // ── Application-side persistence helper ──────────────────────────────────
  // Mutates _ticState.application in place, then round-trips via the existing
  // sbSaveApplication so the housing_applications row stays the source of truth.
  // Also mirrors the change into the in-memory `applications` cache so other
  // pages see it without a reload.
  function _ticPersistApplication(){
    var app = _ticState.application;
    if(!app || !app.id){
      return Promise.reject(new Error('No application linked to this tenant.'));
    }
    if(typeof saveApplicationWithDraftFallback !== 'function' && typeof sbSaveApplication !== 'function'){
      return Promise.reject(new Error('Application save helper is not available on this page.'));
    }
    var _save = (typeof saveApplicationWithDraftFallback === 'function')
      ? saveApplicationWithDraftFallback(app)
      : sbSaveApplication(app);
    return Promise.resolve(_save).then(function(ok){
      // saveApplicationWithDraftFallback resolves true (synced) or false
      // (queued locally — will sync later). Either way the local draft is
      // safe, so we treat both as success here. The legacy sbSaveApplication
      // path resolves true or throws; the throw is handled by .catch below.
      if(ok === false){
        if(typeof showToast === 'function') showToast('Saved locally — will sync when network is available.', { type:'info', duration:3500 });
      }
      var arr = (typeof applications !== 'undefined' && applications) || null;
      if(arr && arr.length){
        for(var i=0;i<arr.length;i++){
          if(arr[i] && arr[i].id === app.id){ arr[i] = app; break; }
        }
      }
      return app;
    });
  }
  function _ticAppFullName(p){
    if(!p) return '';
    var n = ((p.fn||'') + ' ' + (p.ln||'')).trim();
    return n || (p.full_name || '');
  }

  // ── Render: Occupants (from app.coApp + app.habitants) ────────────────────
  function _ticRenderOccupants(){
    var app = _ticState.application;
    var html = '';

    if(!app){
      html = '<div class="tic-pending-inline">No linked application — household members are sourced from the application form.</div>';
      _ticEl('tic_panel_occupants').innerHTML = html;
      return;
    }

    // Co-applicant block
    html += '<div class="tic-section">';
    html +=   '<div class="tic-section-h">Co-Applicant</div>';
    var hasCo = !!app.hasCoApp;
    html +=   '<div class="tic-row tic-row-edit" data-tic-occ-key="hasCoApp">'
         +     '<div class="tic-row-lbl">Has Co-Applicant</div>'
         +     '<div class="tic-row-val">'
         +       '<select class="tic-input" data-tic-occ-input="1">'
         +         '<option value="no"' + (hasCo ? '' : ' selected') + '>No</option>'
         +         '<option value="yes"' + (hasCo ? ' selected' : '') + '>Yes</option>'
         +       '</select>'
         +     '</div>'
         +   '</div>';
    if(hasCo){
      var co = app.coApp || {};
      html +=   _ticOccCoRow('First Name',     'fn',      co.fn)
            +   _ticOccCoRow('Last Name',      'ln',      co.ln)
            +   _ticOccCoRow('Date of Birth',  'dob',     co.dob,     'date')
            +   _ticOccCoRow('Band Number',    'band',    co.band)
            +   _ticOccCoRow('Cell Phone',     'cell',    co.cell,    'tel')
            +   _ticOccCoRow('Email',          'email',   co.email,   'email');
    }
    html += '</div>';

    // Habitants
    html += '<div class="tic-section tic-section-spaced">';
    html +=   '<div class="tic-section-h">Other Household Members</div>';
    var hab = _ticIsArray(app.habitants) ? app.habitants : [];
    var realHab = hab.filter(function(h){ return h && (h.fn || h.ln); });
    if(!realHab.length){
      html += '<div class="tic-empty">No additional household members on the application.</div>';
    } else {
      html += '<table class="tic-table"><thead><tr>'
           + '<th>Name</th><th>Relationship</th><th>DOB</th><th>Age</th><th></th>'
           + '</tr></thead><tbody>';
      hab.forEach(function(h, idx){
        if(!h || (!h.fn && !h.ln)) return;
        html += '<tr data-tic-hab-idx="' + idx + '">'
             +   '<td>' + _ticEsc(_ticAppFullName(h) || '—') + '</td>'
             +   '<td>' + _ticEsc(h.relationship || '—') + '</td>'
             +   '<td>' + _ticEsc(_ticFmtDate(h.dob)) + '</td>'
             +   '<td>' + _ticEsc(_ticAge(h.dob)) + '</td>'
             +   '<td class="tic-row-actions">'
             +     '<button type="button" class="btn btn-ghost" data-tic-action="hab-edit">Edit</button>'
             +     '<button type="button" class="btn btn-ghost" data-tic-action="hab-delete">Delete</button>'
             +   '</td>'
             + '</tr>';
      });
      html += '</tbody></table>';
    }
    html += '<div class="tic-form-actions"><button type="button" class="btn btn-primary" data-tic-action="hab-add">+ Add Household Member</button></div>';
    html += '<div id="tic_hab_form" class="tic-add-form" data-tic-hab-mode="add">'
         +   '<div class="tic-grid-2">'
         +     '<div class="tic-field"><label class="tic-field-lbl">First Name *</label><input class="tic-input" id="tic_hab_fn" type="text"/></div>'
         +     '<div class="tic-field"><label class="tic-field-lbl">Last Name *</label><input class="tic-input" id="tic_hab_ln" type="text"/></div>'
         +     '<div class="tic-field"><label class="tic-field-lbl">Date of Birth</label><input class="tic-input" id="tic_hab_dob" type="date"/></div>'
         +     '<div class="tic-field"><label class="tic-field-lbl">Relationship</label><select class="tic-input" id="tic_hab_rel"><option value="">Select</option><option>Spouse</option><option>Child</option><option>Parent</option><option>Sibling</option><option>Other</option></select></div>'
         +   '</div>'
         +   '<div class="tic-form-actions">'
         +     '<button type="button" class="btn btn-ghost"   data-tic-action="hab-cancel">Cancel</button>'
         +     '<button type="button" class="btn btn-primary" data-tic-action="hab-save">Save</button>'
         +   '</div>'
         + '</div>';
    html += '</div>';

    _ticEl('tic_panel_occupants').innerHTML = html;
  }
  function _ticOccCoRow(label, key, val, type){
    var t = type || 'text';
    var v = (val == null) ? '' : String(val);
    if(t === 'date' && v) v = v.slice(0,10);
    return '<div class="tic-row tic-row-edit" data-tic-occ-key="coApp.' + _ticEsc(key) + '">'
         +   '<div class="tic-row-lbl">' + _ticEsc(label) + '</div>'
         +   '<div class="tic-row-val"><input class="tic-input" type="' + t + '" data-tic-occ-input="1" value="' + _ticEsc(v) + '"/></div>'
         + '</div>';
  }
  // Save handler for inline-edit rows on the Occupants tab. Triggered by the
  // body-level change listener; key looks like "hasCoApp" or "coApp.fn".
  function _ticOccInlineSave(rowEl){
    var app = _ticState.application;
    if(!app) return;
    var key = rowEl.getAttribute('data-tic-occ-key');
    var inp = rowEl.querySelector('[data-tic-occ-input]');
    if(!key || !inp) return;
    var v   = inp.value;
    var auditDetail = '';
    if(key === 'hasCoApp'){
      var prevHas = !!app.hasCoApp;
      app.hasCoApp = (v === 'yes');
      if(app.hasCoApp && !app.coApp) app.coApp = {};
      if(!app.hasCoApp) app.coApp = null;
      auditDetail = _ticDescribe('hasCoApp', prevHas ? 'yes' : 'no', app.hasCoApp ? 'yes' : 'no');
    } else if(key.indexOf('coApp.') === 0){
      var prop = key.slice(6);
      app.coApp = app.coApp || {};
      var prevVal = app.coApp[prop];
      app.coApp[prop] = v || null;
      auditDetail = _ticDescribe('coApp.' + prop, prevVal, app.coApp[prop]);
    } else { return; }
    inp.classList.add('tic-saving');
    _ticPersistApplication()
      .then(function(){
        inp.classList.remove('tic-saving');
        _ticRenderHero(); _ticRenderStrip(); _ticRenderOccupants();
        _ticAudit('tic_coapp_change', auditDetail);
        if(typeof showToast === 'function') showToast('Saved.');
      })
      .catch(function(err){
        inp.classList.remove('tic-saving');
        inp.classList.add('tic-input-error');
        if(typeof showToast === 'function') showToast('Save failed: ' + err.message, { type:'error' });
      });
  }
  function _ticHabFindIdx(idx){ return Number(idx); }
  function _ticHabEditOpen(idx){
    var app = _ticState.application;
    var i = _ticHabFindIdx(idx);
    var h = (app && app.habitants && app.habitants[i]) || null;
    if(!h) return;
    var form = _ticEl('tic_hab_form');
    form.setAttribute('data-tic-hab-mode','edit');
    form.setAttribute('data-tic-hab-idx', String(i));
    _ticEl('tic_hab_fn').value  = h.fn  || '';
    _ticEl('tic_hab_ln').value  = h.ln  || '';
    _ticEl('tic_hab_dob').value = h.dob ? String(h.dob).slice(0,10) : '';
    _ticEl('tic_hab_rel').value = h.relationship || '';
    form.classList.add('tic-open');
  }
  function _ticResetHabForm(){
    var f = _ticEl('tic_hab_form'); if(!f) return;
    f.removeAttribute('data-tic-hab-idx');
    f.setAttribute('data-tic-hab-mode','add');
    f.classList.remove('tic-open');
    ['tic_hab_fn','tic_hab_ln','tic_hab_dob','tic_hab_rel'].forEach(function(id){
      var el = _ticEl(id); if(el) el.value='';
    });
  }
  function _ticSaveHabitant(){
    var app = _ticState.application;
    if(!app){ if(typeof showToast === 'function') showToast('No linked application.', { type:'error' }); return; }
    var form = _ticEl('tic_hab_form');
    var mode = form.getAttribute('data-tic-hab-mode') || 'add';
    var fn = (_ticEl('tic_hab_fn').value||'').trim();
    var ln = (_ticEl('tic_hab_ln').value||'').trim();
    if(!fn || !ln){
      if(typeof showToast === 'function') showToast('First and last name are required.', { type:'error' });
      return;
    }
    var entry = {
      fn:           fn,
      ln:           ln,
      dob:          (_ticEl('tic_hab_dob').value||'').trim() || '',
      relationship: (_ticEl('tic_hab_rel').value||'').trim() || ''
    };
    app.habitants = _ticIsArray(app.habitants) ? app.habitants : [];
    var auditAction, auditDetail;
    if(mode === 'edit'){
      var idx = Number(form.getAttribute('data-tic-hab-idx'));
      if(isNaN(idx) || !app.habitants[idx]) return;
      var prev = app.habitants[idx];
      auditAction = 'tic_habitant_update';
      auditDetail = 'Updated household member: ' + (_ticAppFullName(prev) || '?') + ' → ' + _ticAppFullName(entry) + ' (' + (entry.relationship||'—') + ')';
      app.habitants[idx] = entry;
    } else {
      auditAction = 'tic_habitant_add';
      auditDetail = 'Added household member: ' + _ticAppFullName(entry) + ' (' + (entry.relationship||'—') + ')';
      app.habitants.push(entry);
    }
    _ticPersistApplication()
      .then(function(){
        _ticRenderOccupants();
        _ticAudit(auditAction, auditDetail);
        if(typeof showToast === 'function') showToast(mode === 'edit' ? 'Household member updated.' : 'Household member added.');
      })
      .catch(function(err){
        if(typeof showToast === 'function') showToast('Save failed: ' + err.message, { type:'error' });
      });
  }
  function _ticHabDelete(idx){
    var app = _ticState.application;
    var i = Number(idx);
    if(!app || isNaN(i) || !app.habitants || !app.habitants[i]) return;
    var h = app.habitants[i];
    if(!confirm('Remove "' + (_ticAppFullName(h) || 'this household member') + '" from the application?')) return;
    var detail = 'Removed household member: ' + (_ticAppFullName(h) || '?') + ' (' + (h.relationship||'—') + ')';
    app.habitants.splice(i, 1);
    _ticPersistApplication()
      .then(function(){
        _ticRenderOccupants();
        _ticAudit('tic_habitant_delete', detail);
        if(typeof showToast === 'function') showToast('Household member removed.');
      })
      .catch(function(err){
        if(typeof showToast === 'function') showToast('Delete failed: ' + err.message, { type:'error' });
      });
  }

  // ── Render: Contact (from application primary applicant) ─────────────────
  function _ticRenderContact(){
    var app = _ticState.application;
    if(!app){
      _ticEl('tic_panel_contact').innerHTML =
        '<div class="tic-pending-inline">No linked application — contact info is sourced from the application form.</div>';
      return;
    }
    var rows = [
      { key:'phone',    label:'Phone',           type:'tel'   },
      { key:'email',    label:'Email',           type:'email' },
      { key:'street',   label:'Street Address',  type:'text'  },
      { key:'city',     label:'City',            type:'text'  },
      { key:'province', label:'Province',        type:'text'  },
      { key:'postal',   label:'Postal Code',     type:'text'  }
    ];
    var html = '<div class="tic-section"><div class="tic-section-h">Contact Information</div><div class="tic-rows">';
    rows.forEach(function(r){
      var v = (app[r.key] == null) ? '' : String(app[r.key]);
      html += '<div class="tic-row tic-row-edit" data-tic-contact-key="' + _ticEsc(r.key) + '" data-tic-input-type="' + r.type + '">'
           +   '<div class="tic-row-lbl">' + _ticEsc(r.label) + '</div>'
           +   '<div class="tic-row-val"><input class="tic-input" type="' + r.type + '" data-tic-contact-input="1" value="' + _ticEsc(v) + '"/></div>'
           + '</div>';
    });
    html += '</div></div>';
    _ticEl('tic_panel_contact').innerHTML = html;
  }
  function _ticContactInlineSave(rowEl){
    var app = _ticState.application;
    if(!app) return;
    var key  = rowEl.getAttribute('data-tic-contact-key');
    var type = rowEl.getAttribute('data-tic-input-type') || 'text';
    var inp  = rowEl.querySelector('[data-tic-contact-input]');
    if(!key || !inp) return;
    var v = (inp.value||'').trim();
    inp.classList.remove('tic-input-error');
    if(type === 'tel'   && v && !TIC_PHONE_RE.test(v)){ inp.classList.add('tic-input-error'); if(typeof showToast === 'function') showToast('Phone format is invalid.', { type:'error' }); return; }
    if(type === 'email' && v && !TIC_EMAIL_RE.test(v)){ inp.classList.add('tic-input-error'); if(typeof showToast === 'function') showToast('Email format is invalid.', { type:'error' }); return; }
    if(String(app[key] || '') === v) return;
    var prev = app[key];
    app[key] = v || null;
    inp.classList.add('tic-saving');
    _ticPersistApplication()
      .then(function(){
        inp.classList.remove('tic-saving');
        _ticAudit('tic_contact_change', _ticDescribe(key, prev, app[key]));
        if(typeof showToast === 'function') showToast('Saved.');
      })
      .catch(function(err){
        inp.classList.remove('tic-saving');
        inp.classList.add('tic-input-error');
        if(typeof showToast === 'function') showToast('Save failed: ' + err.message, { type:'error' });
      });
  }

  // ── Render: Emergency Contacts (sourced from app.references) ─────────────
  // The application form's "References" step is now relabelled as Emergency
  // Contacts. The TIC mirrors that: this tab reads/writes app.references[]
  // with full CRUD. Form ids and ref-* action prefixes remain internal so the
  // existing handlers work unchanged.
  function _ticRenderEmergency(){
    var app = _ticState.application;
    if(!app){
      _ticEl('tic_panel_emergency').innerHTML =
        '<div class="tic-pending-inline">No linked application — emergency contacts are sourced from the application form.</div>';
      return;
    }
    var refs = _ticAppReferences();
    var realRefs = refs.filter(function(r){ return r && (r.fn || r.ln || r.phone || r.email); });
    var html = '<div class="tic-section"><div class="tic-section-h">Emergency Contacts</div>';
    if(!realRefs.length){
      html += '<div class="tic-empty">No emergency contacts on the application.</div>';
    } else {
      html += '<table class="tic-table"><thead><tr>'
           + '<th>Name</th><th>Relationship</th><th>Phone</th><th>Email</th><th></th>'
           + '</tr></thead><tbody>';
      refs.forEach(function(r, idx){
        if(!r || (!r.fn && !r.ln && !r.phone && !r.email)) return;
        html += '<tr data-tic-ref-idx="' + idx + '">'
             +   '<td>' + _ticEsc(_ticAppFullName(r) || '—') + '</td>'
             +   '<td>' + _ticEsc(r.relationship || '—') + '</td>'
             +   '<td>' + _ticEsc(r.phone ? formatPhone(r.phone) : '—') + '</td>'
             +   '<td>' + _ticEsc(r.email || '—') + '</td>'
             +   '<td class="tic-row-actions">'
             +     '<button type="button" class="btn btn-ghost" data-tic-action="ref-edit">Edit</button>'
             +     '<button type="button" class="btn btn-ghost" data-tic-action="ref-delete">Delete</button>'
             +   '</td>'
             + '</tr>';
      });
      html += '</tbody></table>';
    }
    html += '<div class="tic-form-actions"><button type="button" class="btn btn-primary" data-tic-action="ref-add">+ Add Emergency Contact</button></div>';
    html += '<div id="tic_ref_form" class="tic-add-form" data-tic-ref-mode="add">'
         +   '<div class="tic-grid-2">'
         +     '<div class="tic-field"><label class="tic-field-lbl">First Name *</label><input class="tic-input" id="tic_ref_fn" type="text"/></div>'
         +     '<div class="tic-field"><label class="tic-field-lbl">Last Name</label><input class="tic-input" id="tic_ref_ln" type="text"/></div>'
         +     '<div class="tic-field"><label class="tic-field-lbl">Relationship</label><input class="tic-input" id="tic_ref_rel" type="text"/></div>'
         +     '<div class="tic-field"><label class="tic-field-lbl">Phone</label><input class="tic-input" id="tic_ref_phone" type="tel" placeholder="(705)-000-0000" oninput="fmtPhone(this)"/></div>'
         +     '<div class="tic-field"><label class="tic-field-lbl">Email</label><input class="tic-input" id="tic_ref_email" type="email"/></div>'
         +   '</div>'
         +   '<div class="tic-form-actions">'
         +     '<button type="button" class="btn btn-ghost"   data-tic-action="ref-cancel">Cancel</button>'
         +     '<button type="button" class="btn btn-primary" data-tic-action="ref-save">Save</button>'
         +   '</div>'
         + '</div>';
    html += '</div>';
    _ticEl('tic_panel_emergency').innerHTML = html;
  }

  // ── Render: References (from app.references) ─────────────────────────────
  function _ticAppReferences(){
    var a = _ticState.application;
    if(!a || !_ticIsArray(a.references)) return [];
    return a.references;
  }
  // Old References tab was consolidated into Emergency Contacts. The function
  // is kept as an alias so existing save-handler refresh calls continue to work.
  function _ticRenderReferences(){ _ticRenderEmergency(); }
  function _ticResetRefForm(){
    var f = _ticEl('tic_ref_form'); if(!f) return;
    f.removeAttribute('data-tic-ref-idx');
    f.setAttribute('data-tic-ref-mode','add');
    f.classList.remove('tic-open');
    ['tic_ref_fn','tic_ref_ln','tic_ref_rel','tic_ref_phone','tic_ref_email'].forEach(function(id){
      var el = _ticEl(id); if(el) el.value='';
    });
  }
  function _ticRefEditOpen(idx){
    var i = Number(idx);
    var r = _ticAppReferences()[i];
    if(!r) return;
    var form = _ticEl('tic_ref_form');
    form.setAttribute('data-tic-ref-mode','edit');
    form.setAttribute('data-tic-ref-idx', String(i));
    _ticEl('tic_ref_fn').value    = r.fn    || '';
    _ticEl('tic_ref_ln').value    = r.ln    || '';
    _ticEl('tic_ref_rel').value   = r.relationship || '';
    _ticEl('tic_ref_phone').value = r.phone ? formatPhone(r.phone) : '';
    _ticEl('tic_ref_email').value = r.email || '';
    form.classList.add('tic-open');
  }
  function _ticSaveReference(){
    var app = _ticState.application;
    if(!app){ if(typeof showToast === 'function') showToast('No linked application.', { type:'error' }); return; }
    var form = _ticEl('tic_ref_form');
    var mode = form.getAttribute('data-tic-ref-mode') || 'add';
    var fn = (_ticEl('tic_ref_fn').value||'').trim();
    if(!fn){ if(typeof showToast === 'function') showToast('Emergency contact first name is required.', { type:'error' }); return; }
    var phone = (_ticEl('tic_ref_phone').value||'').trim();
    var email = (_ticEl('tic_ref_email').value||'').trim();
    if(phone && !TIC_PHONE_RE.test(phone)){ if(typeof showToast === 'function') showToast('Phone format is invalid.', { type:'error' }); return; }
    if(email && !TIC_EMAIL_RE.test(email)){ if(typeof showToast === 'function') showToast('Email format is invalid.', { type:'error' }); return; }
    var entry = {
      fn:           fn,
      ln:           (_ticEl('tic_ref_ln').value||'').trim(),
      relationship: (_ticEl('tic_ref_rel').value||'').trim(),
      phone:        phone,
      email:        email
    };
    app.references = _ticIsArray(app.references) ? app.references : [];
    var auditAction, auditDetail;
    if(mode === 'edit'){
      var i = Number(form.getAttribute('data-tic-ref-idx'));
      if(isNaN(i) || !app.references[i]) return;
      var prev = app.references[i];
      auditAction = 'tic_reference_update';
      auditDetail = 'Updated emergency contact: ' + (_ticAppFullName(prev) || '?') + ' → ' + _ticAppFullName(entry);
      app.references[i] = entry;
    } else {
      auditAction = 'tic_reference_add';
      auditDetail = 'Added emergency contact: ' + _ticAppFullName(entry) + (entry.relationship ? ' (' + entry.relationship + ')' : '');
      app.references.push(entry);
    }
    _ticPersistApplication()
      .then(function(){
        _ticRenderReferences();
        _ticAudit(auditAction, auditDetail);
        if(typeof showToast === 'function') showToast(mode === 'edit' ? 'Emergency contact updated.' : 'Emergency contact added.');
      })
      .catch(function(err){
        if(typeof showToast === 'function') showToast('Save failed: ' + err.message, { type:'error' });
      });
  }
  function _ticRefDelete(idx){
    var app = _ticState.application;
    var i = Number(idx);
    if(!app || isNaN(i) || !app.references || !app.references[i]) return;
    var r = app.references[i];
    if(!confirm('Delete emergency contact "' + (_ticAppFullName(r) || 'this contact') + '"?')) return;
    var detail = 'Removed emergency contact: ' + (_ticAppFullName(r) || '?');
    app.references.splice(i, 1);
    _ticPersistApplication()
      .then(function(){
        _ticRenderReferences();
        _ticAudit('tic_reference_delete', detail);
        if(typeof showToast === 'function') showToast('Emergency contact removed.');
      })
      .catch(function(err){
        if(typeof showToast === 'function') showToast('Delete failed: ' + err.message, { type:'error' });
      });
  }

  // ── Render: Pets (from app.pets) ──────────────────────────────────────────
  function _ticAppPets(){
    var a = _ticState.application;
    if(!a || !_ticIsArray(a.pets)) return [];
    return a.pets;
  }
  function _ticRenderPets(){
    var app = _ticState.application;
    if(!app){
      _ticEl('tic_panel_pets').innerHTML =
        '<div class="tic-pending-inline">No linked application — pets are sourced from the application form.</div>';
      return;
    }
    var pets = _ticAppPets();
    var realPets = pets.filter(function(p){ return p && (p.name || p.type); });
    var html = '<div class="tic-section"><div class="tic-section-h">Pets</div>';
    if(!realPets.length){
      html += '<div class="tic-empty">No pets on the application.</div>';
    } else {
      html += '<div class="tic-pet-grid">';
      pets.forEach(function(p, idx){
        if(!p || (!p.name && !p.type)) return;
        html += '<div class="tic-pet-card" data-tic-pet-idx="' + idx + '">'
             +   '<div class="tic-pet-icon">' + _ticPet(p.type) + '</div>'
             +   '<div class="tic-pet-body">'
             +     '<div class="tic-pet-name">' + _ticEsc(p.name || 'Unnamed') + '</div>'
             +     '<div class="tic-pet-meta">' + _ticEsc(p.type || '—')
             +       (p.size ? ' · ' + _ticEsc(p.size) : '')
             +     '</div>'
             +     (p.desc ? '<div class="tic-pet-meta">' + _ticEsc(p.desc) + '</div>' : '')
             +     '<div class="tic-pet-actions">'
             +       '<button type="button" class="btn btn-ghost" data-tic-action="pet-edit">Edit</button>'
             +       '<button type="button" class="btn btn-ghost" data-tic-action="pet-delete">Delete</button>'
             +     '</div>'
             +   '</div>'
             + '</div>';
      });
      html += '</div>';
    }
    html += '<div class="tic-form-actions"><button type="button" class="btn btn-primary" data-tic-action="pet-add">+ Add Pet</button></div>';
    html += '<div id="tic_pet_form" class="tic-add-form" data-tic-pet-mode="add">'
         +   '<div class="tic-grid-2">'
         +     '<div class="tic-field"><label class="tic-field-lbl">Pet Name *</label><input class="tic-input" id="tic_pet_name" type="text"/></div>'
         +     '<div class="tic-field"><label class="tic-field-lbl">Type *</label><input class="tic-input" id="tic_pet_type" type="text" placeholder="dog, cat, bird…"/></div>'
         +     '<div class="tic-field"><label class="tic-field-lbl">Size</label><input class="tic-input" id="tic_pet_size" type="text" placeholder="small, medium, large"/></div>'
         +     '<div class="tic-field tic-grid-span-2"><label class="tic-field-lbl">Description</label><input class="tic-input" id="tic_pet_desc" type="text"/></div>'
         +   '</div>'
         +   '<div class="tic-form-actions">'
         +     '<button type="button" class="btn btn-ghost"   data-tic-action="pet-cancel">Cancel</button>'
         +     '<button type="button" class="btn btn-primary" data-tic-action="pet-save">Save</button>'
         +   '</div>'
         + '</div>';
    html += '</div>';
    _ticEl('tic_panel_pets').innerHTML = html;
  }
  function _ticPetEditOpen(idx){
    var i = Number(idx);
    var p = _ticAppPets()[i];
    if(!p) return;
    var form = _ticEl('tic_pet_form');
    form.setAttribute('data-tic-pet-mode','edit');
    form.setAttribute('data-tic-pet-idx', String(i));
    _ticEl('tic_pet_name').value = p.name || '';
    _ticEl('tic_pet_type').value = p.type || '';
    _ticEl('tic_pet_size').value = p.size || '';
    _ticEl('tic_pet_desc').value = p.desc || '';
    form.classList.add('tic-open');
  }
  function _ticPetDelete(idx){
    var app = _ticState.application;
    var i = Number(idx);
    if(!app || isNaN(i) || !app.pets || !app.pets[i]) return;
    var p = app.pets[i];
    if(!confirm('Delete pet "' + (p.name || 'this pet') + '"?')) return;
    var detail = 'Removed pet: ' + (p.name||'?') + ' (' + (p.type||'?') + ')';
    app.pets.splice(i, 1);
    _ticPersistApplication()
      .then(function(){
        _ticRenderPets();
        _ticAudit('tic_pet_delete', detail);
        if(typeof showToast === 'function') showToast('Pet removed.');
      })
      .catch(function(err){
        if(typeof showToast === 'function') showToast('Delete failed: ' + err.message, { type:'error' });
      });
  }

  // ── Render: Documents (DocLibrary mount) ──────────────────────────────────
  // Mirrors the standalone tenantFilesPanel pattern in shared-data.js — same
  // entityType, pathPrefix, storage bucket. Uses unit id since that's how the
  // existing file system keys tenant docs.
  var _ticDocLib = null;
  var _ticDocLibKey = null;
  function _ticRenderDocuments(){
    var p = _ticEl('tic_panel_documents');
    if(!p) return;
    var unit = _ticState.unit;
    if(!unit || !unit.id){
      p.innerHTML = '<div class="tic-empty">No unit linked — document library unavailable.</div>';
      return;
    }
    var key = String(unit.id);
    if(_ticDocLibKey === key && _ticDocLib){ return; } // already mounted for this tenant
    p.innerHTML = '<div style="padding:10px 14px;border-bottom:1px solid var(--border);display:flex;justify-content:flex-end;">'
      + '<div class="export-dropdown">'
      +   '<button type="button" onclick="toggleExportMenu(this)" class="btn btn-primary">&#128196; Generate Forms &#9660;</button>'
      +   '<div class="header-export-menu">'
      +     '<button type="button" onclick="window._ticOpenHydroOneConsentModal && window._ticOpenHydroOneConsentModal()" class="header-export-item">Hydro One &mdash; Consent for Disclosure</button>'
      +   '</div>'
      + '</div>'
      + '</div>'
      + '<div id="tic_doclib_mount"></div>';
    var mount = _ticEl('tic_doclib_mount');
    if(!window.DocLibrary){
      p.innerHTML = '<div class="tic-pending-inline">Document library is not loaded on this page.</div>';
      return;
    }
    try {
      _ticDocLib = window.DocLibrary.create(mount, {
        entityType:    'tenant',
        entityId:      unit.id,
        pathPrefix:    'tenants/' + unit.id,
        supabaseUrl:   SUPABASE_URL,
        supabaseAnon:  (typeof SUPABASE_ANON !== 'undefined') ? SUPABASE_ANON : '',
        storageBucket: (typeof STORAGE_BUCKET !== 'undefined') ? STORAGE_BUCKET : 'housing-files',
        getAuthToken:  function(){
          return (window.HOUSING_HEADERS && window.HOUSING_HEADERS['Authorization'] || '').replace('Bearer ','');
        }
      });
      _ticDocLibKey = key;
    } catch(err){
      p.innerHTML = '<div class="tic-error-inline">Failed to mount document library: ' + _ticEsc(err && err.message || err) + '</div>';
    }
  }

  // ── Render: Notes ─────────────────────────────────────────────────────────
  function _ticRenderNotes(){
    var tenantNotes = _ticIsArray(_ticState.notes) ? _ticState.notes : [];
    var appNotes    = _ticIsArray(_ticState.applicationNotes) ? _ticState.applicationNotes : [];
    var tenantNotesErrored = _ticIsError(_ticState.notes);

    // Normalize application-note rows into the tenant-note shape so a single
    // render path covers both. App notes carry over from intake so they show
    // up identically alongside notes added in the TIC.
    var normalizedAppNotes = appNotes.map(function(n){
      var row = {};
      row[TIC_C.author_name] = n.author_name || n.author_email || 'Unknown';
      row[TIC_C.note_body]   = n.body || '';
      row[TIC_C.created_at]  = n.created_at || null;
      return row;
    });

    var merged = tenantNotes.concat(normalizedAppNotes);
    merged.sort(function(a, b){
      var aT = a[TIC_C.created_at] || '';
      var bT = b[TIC_C.created_at] || '';
      if(aT === bT) return 0;
      return aT < bT ? 1 : -1; // newest first
    });

    var html = '<div class="tic-section">'
             +   '<div class="tic-section-h">Add a Note</div>'
             +   '<textarea id="tic_note_input" class="tic-textarea" placeholder="Type your note…"></textarea>'
             +   '<div class="tic-form-actions">'
             +     '<button type="button" class="btn btn-primary" data-tic-action="note-save">Add Note</button>'
             +   '</div>'
             + '</div>';
    html += '<div class="tic-section tic-section-spaced"><div class="tic-section-h">Notes &amp; History</div>';
    html += '<div id="tic_notes_list">';
    if(tenantNotesErrored && !merged.length){
      html += '<div class="tic-error-inline">Unable to load notes.</div>';
    } else if(!merged.length){
      html += '<div class="tic-empty">No notes yet.</div>';
    } else {
      merged.forEach(function(n){
        html += _ticNoteHtml(n);
      });
    }
    html += '</div>';
    html += '</div>';
    _ticEl('tic_panel_notes').innerHTML = html;
  }
  function _ticNoteHtml(n){
    return '<div class="tic-note">'
         +   '<div class="tic-note-meta"><span class="tic-note-author">' + _ticEsc(n[TIC_C.author_name]||'Unknown') + '</span> · ' + _ticEsc(_ticFmtDT(n[TIC_C.created_at])) + '</div>'
         +   '<div class="tic-note-body">' + _ticEsc(n[TIC_C.note_body]||'') + '</div>'
         + '</div>';
  }

  // ── Tab switching ─────────────────────────────────────────────────────────
  function _ticSwitchTab(name){
    _ticState.activeTab = name;
    var tabs = document.querySelectorAll('#ticModal .tic-tab');
    for(var i=0;i<tabs.length;i++){
      tabs[i].classList.toggle('tic-active', tabs[i].getAttribute('data-tic-tab') === name);
    }
    var panels = document.querySelectorAll('#ticModal .tic-panel');
    for(var j=0;j<panels.length;j++){
      panels[j].classList.remove('tic-active');
    }
    var p = _ticEl('tic_panel_' + name);
    if(p) p.classList.add('tic-active');
    if(name === 'documents') _ticRenderDocuments();
  }

  // ── Save handlers ─────────────────────────────────────────────────────────
  function _ticSavePet(){
    var app = _ticState.application;
    if(!app){ if(typeof showToast === 'function') showToast('No linked application.', { type:'error' }); return; }
    var form = _ticEl('tic_pet_form');
    var mode = form.getAttribute('data-tic-pet-mode') || 'add';
    var name = (_ticEl('tic_pet_name').value||'').trim();
    var type = (_ticEl('tic_pet_type').value||'').trim();
    if(!name || !type){
      if(typeof showToast === 'function') showToast('Pet name and type are required.', { type:'error' });
      return;
    }
    var entry = {
      name: name,
      type: type,
      size: (_ticEl('tic_pet_size').value||'').trim(),
      desc: (_ticEl('tic_pet_desc').value||'').trim()
    };
    app.pets = _ticIsArray(app.pets) ? app.pets : [];
    var auditAction, auditDetail;
    if(mode === 'edit'){
      var i = Number(form.getAttribute('data-tic-pet-idx'));
      if(isNaN(i) || !app.pets[i]) return;
      var prev = app.pets[i];
      auditAction = 'tic_pet_update';
      auditDetail = 'Updated pet: ' + (prev.name || '?') + ' (' + (prev.type||'?') + ') → ' + entry.name + ' (' + entry.type + ')';
      app.pets[i] = entry;
    } else {
      auditAction = 'tic_pet_add';
      auditDetail = 'Added pet: ' + entry.name + ' (' + entry.type + ')';
      app.pets.push(entry);
    }
    _ticPersistApplication()
      .then(function(){
        _ticRenderPets();
        _ticAudit(auditAction, auditDetail);
        if(typeof showToast === 'function') showToast(mode === 'edit' ? 'Pet updated.' : 'Pet added.');
      })
      .catch(function(err){
        if(typeof showToast === 'function') showToast('Save failed: ' + err.message, { type:'error' });
      });
  }
  function _ticSaveNote(){
    var inp = _ticEl('tic_note_input');
    var body = (inp && inp.value || '').trim();
    if(!body){
      if(typeof showToast === 'function') showToast('Note cannot be empty.', { type:'error' });
      return;
    }
    var author = (typeof HOUSING_SESSION !== 'undefined' && HOUSING_SESSION.name)
               ? HOUSING_SESSION.name
               : (sessionStorage.getItem('clfn_housing_name') || 'Unknown');
    var payload = {};
    payload[TIC_C.tenant_fk]   = _ticState.tenant[TIC_C.tenant_pk];
    payload[TIC_C.note_body]   = body;
    payload[TIC_C.author_name] = author;
    payload[TIC_C.created_at]  = new Date().toISOString();
    _ticWrite('POST', TIC_T.tenant_notes, payload)
      .then(function(rows){
        var added = (rows && rows[0]) || payload;
        _ticState.notes.unshift(added);
        var list = _ticEl('tic_notes_list');
        if(list){
          if(list.querySelector('.tic-empty')) list.innerHTML = '';
          list.insertAdjacentHTML('afterbegin', _ticNoteHtml(added));
        }
        if(inp) inp.value = '';
        _ticAudit('tic_note_add', 'Added note (' + body.length + ' chars)');
        if(typeof showToast === 'function') showToast('Note added.');
      })
      .catch(function(err){
        if(typeof showToast === 'function') showToast('Save failed: ' + err.message, { type:'error' });
      });
  }

  // ── Inline-edit for Contact rows ──────────────────────────────────────────

  // ── Action delegate ───────────────────────────────────────────────────────
  function _ticResetPetForm(){
    var f = _ticEl('tic_pet_form'); if(!f) return;
    f.removeAttribute('data-tic-pet-idx');
    f.setAttribute('data-tic-pet-mode','add');
    f.classList.remove('tic-open');
    ['tic_pet_name','tic_pet_type','tic_pet_size','tic_pet_desc'].forEach(function(id){
      var el = _ticEl(id); if(el) el.value='';
    });
  }
  function _ticOnBodyClick(ev){
    var btn = ev.target;
    var act = btn && btn.getAttribute && btn.getAttribute('data-tic-action');
    if(!act) return;
    // Income (employment)
    if(act === 'inc-add')      { _ticResetIncForm(); _ticEl('tic_inc_form').classList.add('tic-open'); return; }
    if(act === 'inc-cancel')   { _ticResetIncForm(); return; }
    if(act === 'inc-save')     { _ticSaveIncome(); return; }
    if(act === 'inc-edit')     {
      var irow = btn.closest('[data-tic-inc-idx]');
      if(irow) _ticIncEditOpen(irow.getAttribute('data-tic-inc-idx'));
      return;
    }
    if(act === 'inc-delete')   {
      var irow2 = btn.closest('[data-tic-inc-idx]');
      if(irow2) _ticIncDelete(irow2.getAttribute('data-tic-inc-idx'));
      return;
    }
    // Habitants (household members on application)
    if(act === 'hab-add')      { _ticResetHabForm(); _ticEl('tic_hab_form').classList.add('tic-open'); return; }
    if(act === 'hab-cancel')   { _ticResetHabForm(); return; }
    if(act === 'hab-save')     { _ticSaveHabitant(); return; }
    if(act === 'hab-edit')     {
      var hrow = btn.closest('[data-tic-hab-idx]');
      if(hrow) _ticHabEditOpen(hrow.getAttribute('data-tic-hab-idx'));
      return;
    }
    if(act === 'hab-delete')   {
      var hrow2 = btn.closest('[data-tic-hab-idx]');
      if(hrow2) _ticHabDelete(hrow2.getAttribute('data-tic-hab-idx'));
      return;
    }
    // Pets
    if(act === 'pet-add')      { _ticResetPetForm(); _ticEl('tic_pet_form').classList.add('tic-open'); return; }
    if(act === 'pet-cancel')   { _ticResetPetForm(); return; }
    if(act === 'pet-save')     { _ticSavePet(); return; }
    if(act === 'pet-edit')     {
      var pcard = btn.closest('[data-tic-pet-idx]');
      if(pcard) _ticPetEditOpen(pcard.getAttribute('data-tic-pet-idx'));
      return;
    }
    if(act === 'pet-delete')   {
      var pcard2 = btn.closest('[data-tic-pet-idx]');
      if(pcard2) _ticPetDelete(pcard2.getAttribute('data-tic-pet-idx'));
      return;
    }
    // References
    if(act === 'ref-add')      { _ticResetRefForm(); _ticEl('tic_ref_form').classList.add('tic-open'); return; }
    if(act === 'ref-cancel')   { _ticResetRefForm(); return; }
    if(act === 'ref-save')     { _ticSaveReference(); return; }
    if(act === 'ref-edit')     {
      var rrow = btn.closest('[data-tic-ref-idx]');
      if(rrow) _ticRefEditOpen(rrow.getAttribute('data-tic-ref-idx'));
      return;
    }
    if(act === 'ref-delete')   {
      var rrow2 = btn.closest('[data-tic-ref-idx]');
      if(rrow2) _ticRefDelete(rrow2.getAttribute('data-tic-ref-idx'));
      return;
    }
    // Notes
    if(act === 'note-save')    { _ticSaveNote(); return; }
  }

  // ── Quick-actions footer ──────────────────────────────────────────────────
  function _ticGoToApplication(appId){
    window.location.href = 'housing.html?openApp=' + encodeURIComponent(appId);
  }
  function _ticFindApplicationForTenant(){
    // 1) explicit linkage
    var appId = (_ticState.tenant && _ticState.tenant[TIC_C.application_id]) || '';
    if(appId) return Promise.resolve(appId);
    // 2) fall back to local cache by name (avoids a network round-trip when possible)
    var name = (_ticState.tenant && _ticState.tenant[TIC_C.full_name])
            || (_ticState.unit && _ticState.unit.assignedName)
            || '';
    if(!name) return Promise.resolve('');
    var parts = String(name).trim().split(/\s+/);
    var fn = parts[0] || '';
    var ln = parts.slice(1).join(' ');
    var local = (typeof applications !== 'undefined' && applications && applications.length)
              ? applications : (window.SP_APPLICATIONS || []);
    var cached = local.filter(function(a){
      return ((a.fn||'').toLowerCase() === fn.toLowerCase())
          && ((a.ln||'').toLowerCase() === ln.toLowerCase());
    }).sort(function(a,b){
      return String(b.created_at||b.createdAt||'').localeCompare(String(a.created_at||a.createdAt||''));
    });
    if(cached.length && cached[0].id) return Promise.resolve(cached[0].id);
    // 3) live search Supabase as last resort. fn/ln live in the JSONB `data`
    // column on housing_applications, so use PostgREST's `data->>field` syntax.
    var qs = 'data->>fn=eq.' + encodeURIComponent(fn)
           + (ln ? '&data->>ln=eq.' + encodeURIComponent(ln) : '')
           + '&select=id&order=submitted_at.desc.nullslast&limit=1';
    return _ticGet(TIC_T.applications + '?' + qs).then(function(rows){
      if(_ticIsArray(rows) && rows.length && rows[0].id) return rows[0].id;
      return '';
    }).catch(function(){ return ''; });
  }
  function _ticOnFooterClick(ev){
    var t = ev.target;
    if(!t || !t.id) return;
    if(t.id === 'tic_act_view_app'){
      _ticFindApplicationForTenant().then(function(appId){
        if(!appId){
          if(typeof showToast === 'function') showToast('No application found for this tenant.');
          return;
        }
        _ticGoToApplication(appId);
      });
      return;
    }
    if(t.id === 'tic_act_new_wo'){
      var unitId = (_ticState.tenant && _ticState.tenant.unit_id) || (_ticState.unit && _ticState.unit.id);
      if(!unitId){
        if(typeof showToast === 'function') showToast('No unit linked to this tenant.');
        return;
      }
      _ticClose();
      if(typeof openSowModal === 'function'){
        openSowModal(unitId);
      } else {
        if(typeof showToast === 'function') showToast('Work order module not loaded on this page.');
      }
      return;
    }
    if(t.id === 'tic_act_ledger'){
      if(typeof showToast === 'function') showToast('Rent ledger — coming soon.');
      return;
    }
    if(t.id === 'tic_act_letter'){
      if(typeof showToast === 'function') showToast('Generate letter — coming soon.');
      return;
    }
    if(t.id === 'tic_act_flag'){
      if(typeof showToast === 'function') showToast('Flag for review — coming soon.');
      return;
    }
  }

  // ── Tab click delegate ────────────────────────────────────────────────────
  function _ticOnTabClick(ev){
    var name = ev.target && ev.target.getAttribute && ev.target.getAttribute('data-tic-tab');
    if(name) _ticSwitchTab(name);
  }

  // ── Focus trap + ESC ──────────────────────────────────────────────────────
  function _ticTrapFocus(modal){
    function handler(e){
      if(e.key === 'Escape'){
        e.preventDefault();
        _ticClose();
        return;
      }
      if(e.key !== 'Tab') return;
      var nodes = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      var focusable = [];
      for(var i=0;i<nodes.length;i++){
        var n = nodes[i];
        if(!n.hasAttribute('disabled') && n.offsetParent !== null) focusable.push(n);
      }
      if(!focusable.length) return;
      var first = focusable[0], last = focusable[focusable.length-1];
      if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
      else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
    }
    return handler;
  }

  // ── Open / Close ──────────────────────────────────────────────────────────
  function _ticOpen(){
    var modal = _ticEl('ticModal');
    if(!modal) return false;
    modal.classList.add('tic-open');
    document.body.classList.add('tic-modal-open');
    _ticState.prevFocus = document.activeElement;
    var closeBtn = _ticEl('tic_close_btn');
    if(closeBtn) setTimeout(function(){ closeBtn.focus(); }, 0);
    _ticState.keyHandler = _ticTrapFocus(modal);
    document.addEventListener('keydown', _ticState.keyHandler);
    return true;
  }
  function _ticClose(){
    var modal = _ticEl('ticModal');
    if(modal) modal.classList.remove('tic-open');
    document.body.classList.remove('tic-modal-open');
    if(_ticState.keyHandler){
      document.removeEventListener('keydown', _ticState.keyHandler);
      _ticState.keyHandler = null;
    }
    if(_ticState.prevFocus && _ticState.prevFocus.focus){
      try { _ticState.prevFocus.focus(); } catch(e){}
    }
    _ticState.prevFocus = null;
  }

  // ── Wiring (idempotent) ───────────────────────────────────────────────────
  var _ticWired = false;
  function _ticWire(){
    if(_ticWired) return;
    var modal = _ticEl('ticModal');
    if(!modal) return;

    var closeBtn = _ticEl('tic_close_btn');
    if(closeBtn) closeBtn.addEventListener('click', _ticClose);

    modal.addEventListener('click', function(e){ if(e.target === modal) _ticClose(); });

    var tabBar = modal.querySelector('.tic-tabs');
    if(tabBar) tabBar.addEventListener('click', _ticOnTabClick);

    var body = modal.querySelector('.tic-body');
    if(body){
      body.addEventListener('click',  _ticOnBodyClick);
      body.addEventListener('change', _ticOnBodyChange);
    }

    var footer = modal.querySelector('.tic-footer');
    if(footer) footer.addEventListener('click', _ticOnFooterClick);

    _ticWired = true;
  }

  // ── Public entry point ────────────────────────────────────────────────────
  function openTenantCard(idOrUnitId){
    var modal = _ticEl('ticModal');
    if(!modal){
      if(typeof showToast === 'function') showToast('Tenant card not available on this page.', { type:'error' });
      return;
    }
    _ticWire();

    // Reset state + UI
    _ticState.tenant = null; _ticState.unit = null; _ticState.application = null;
    _ticState.ledger = null; _ticState.notes = []; _ticState.applicationNotes = [];
    _ticDocLib = null; _ticDocLibKey = null;
    ['overview','occupants','contact','emergency','references','pets','documents','notes'].forEach(function(n){
      var p = _ticEl('tic_panel_' + n); if(p) p.innerHTML = '';
    });
    _ticEl('tic_loading').style.display = '';
    _ticSwitchTab('overview');
    _ticOpen();

    _ticResolveTenant(idOrUnitId).then(function(resolved){
      _ticState.tenant = resolved.tenant;
      _ticState.unit   = resolved.unit || _ticFindUnitById(idOrUnitId);

      if(!_ticState.tenant && !_ticState.unit){
        _ticEl('tic_loading').style.display = 'none';
        _ticEl('tic_panel_overview').innerHTML = '<div class="tic-error-inline">Tenant not found.</div>';
        return;
      }

      _ticRenderHero();
      _ticRenderStrip();

      var pkValue = _ticState.tenant ? _ticState.tenant[TIC_C.tenant_pk] : null;
      var loadAll = pkValue ? _ticLoadAll(pkValue, _ticState.unit) : Promise.resolve();
      var loadApp = _ticLoadApplication();
      Promise.all([loadAll, loadApp]).then(function(){
        _ticEl('tic_loading').style.display = 'none';
        _ticRenderHero();
        _ticRenderStrip();
        _ticRenderOverview();
        _ticRenderOccupants();
        _ticRenderContact();
        _ticRenderEmergency();
        _ticRenderReferences();
        _ticRenderPets();
        _ticRenderNotes();
      }).catch(function(err){
        _ticEl('tic_loading').style.display = 'none';
        if(typeof showToast === 'function') showToast('Some tenant data could not be loaded.', { type:'error' });
        _ticRenderOverview();
        _ticRenderOccupants();
        _ticRenderContact();
        _ticRenderEmergency();
        _ticRenderReferences();
        _ticRenderPets();
        _ticRenderNotes();
      });
    }).catch(function(){
      _ticEl('tic_loading').style.display = 'none';
      _ticEl('tic_panel_overview').innerHTML = '<div class="tic-error-inline">Unable to load tenant.</div>';
    });
  }

  // ── Hydro One Consent for Disclosure — pre-generation modal ───────────────
  function _ticOpenHydroOneConsentModal() {
    var t   = _ticState.tenant      || {};
    var u   = _ticState.unit        || {};
    var app = _ticState.application || {};
    var today = new Date().toISOString().split('T')[0];

    var custName   = t[TIC_C.full_name]      || ((app.fn||'') + ' ' + (app.ln||'')).trim();
    var custPhone  = app.phone               || '';
    var custAddr   = u.num ? ((u.num||'') + ' ' + (u.street||'')).trim() : (app.street||'');
    var custCity   = app.city                || '';
    var custPostal = app.postal              || '';
    var hydroAcct  = t[TIC_C.hydro_account]  || '';
    var hydroMeter = t[TIC_C.hydro_meter]    || '';
    var tpName     = ((window.NATION_CONFIG && (NATION_CONFIG.display_name||NATION_CONFIG.name))||'CLFN') + ' Housing';
    var tpPhone    = (window.NATION_CONFIG && NATION_CONFIG.phone) || '';

    var existing = document.getElementById('tic_hydroone_modal');
    if (existing) existing.remove();

    function inp(id, val, ph) {
      return '<input id="' + id + '" type="text" value="' + _ticEsc(val||'') + '" placeholder="' + _ticEsc(ph||'') + '" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:DM Sans,sans-serif;background:var(--surface);color:var(--text);box-sizing:border-box;"/>';
    }
    function fld(label, inputHtml) {
      return '<div class="tic-field"><label class="tic-field-lbl">' + label + '</label>' + inputHtml + '</div>';
    }

    var modal = document.createElement('div');
    modal.id = 'tic_hydroone_modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;';
    modal.innerHTML =
        '<div style="background:var(--surface);border-radius:12px;width:100%;max-width:680px;max-height:95vh;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,.35);">'
      + '<div class="modal-hdr"><div>'
      +   '<div class="lbl-yellow">&#128196; Hydro One &mdash; Consent for Disclosure</div>'
      +   '<div class="txt-sm-meta">Complete the details below, collect the tenant signature, then generate the PDF.</div>'
      + '</div><button type="button" onclick="document.getElementById(\'tic_hydroone_modal\').remove()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted);">&times;</button></div>'

      + '<div style="overflow-y:auto;padding:20px 24px;flex:1;">'

      // Part A
      + '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--yellow);margin-bottom:12px;padding-bottom:5px;border-bottom:1px solid var(--border);">Part A &mdash; Customer Information</div>'
      + '<div class="tic-grid-2" style="margin-bottom:16px;">'
      +   fld('Name',            inp('ho_name',   custName,   'Full legal name'))
      +   fld('Phone #',         inp('ho_phone',  custPhone,  '(___) ___-____'))
      +   fld('Service Address', inp('ho_addr',   custAddr,   'Street address'))
      +   fld('City / Town',     inp('ho_city',   custCity,   'City or town'))
      +   fld('Postal Code',     inp('ho_postal', custPostal, 'A1A 1A1'))
      +   fld('Bill Account #',  inp('ho_acct',   hydroAcct,  'Hydro One account number'))
      +   fld('Meter #',         inp('ho_meter',  hydroMeter, 'Meter number'))
      + '</div>'

      // Third Party (read-only display)
      + '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--yellow);margin-bottom:10px;padding-bottom:5px;border-bottom:1px solid var(--border);">Third Party (pre-filled)</div>'
      + '<div style="padding:10px 14px;background:var(--bg);border-radius:6px;font-size:12px;margin-bottom:16px;color:var(--text);">'
      +   '<strong>' + _ticEsc(tpName) + '</strong>'
      +   (tpPhone ? '<div style="color:var(--muted);margin-top:2px;">Phone: ' + _ticEsc(tpPhone) + '</div>' : '')
      + '</div>'

      // Part B — Checkboxes
      + '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--yellow);margin-bottom:10px;padding-bottom:5px;border-bottom:1px solid var(--border);">Part B &mdash; Information to Disclose</div>'
      + '<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px;font-size:12px;">'
      + '<label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;"><input type="checkbox" id="ho_chk_usage" checked style="margin-top:3px;accent-color:var(--yellow);width:15px;height:15px;"/> <span><strong>Electricity Usage</strong> — historical and ongoing meter readings, dates, interval data, and energy charges (up to 24 months)</span></label>'
      + '<label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;"><input type="checkbox" id="ho_chk_acct" checked style="margin-top:3px;accent-color:var(--yellow);width:15px;height:15px;"/> <span><strong>Account Information</strong> — name, contact info, service address, account number, meter number, customer rate class</span></label>'
      + '<label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;"><input type="checkbox" id="ho_chk_billing" checked style="margin-top:3px;accent-color:var(--yellow);width:15px;height:15px;"/> <span><strong>Billing Information</strong> — billing period details, current and last read dates, days per period, current charges (up to 24 months, excluding payment info)</span></label>'
      + '<div style="display:flex;align-items:center;gap:8px;">'
      +   '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap;"><input type="checkbox" id="ho_chk_other" style="accent-color:var(--yellow);width:15px;height:15px;"/> <strong>Other (specify):</strong></label>'
      +   '<input type="text" id="ho_other_text" placeholder="Specify other information…" style="flex:1;padding:5px 8px;border:1px solid var(--border);border-radius:5px;font-size:12px;font-family:DM Sans,sans-serif;background:var(--surface);color:var(--text);"/>'
      + '</div>'
      + '</div>'

      // Signature
      + '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--yellow);margin-bottom:10px;padding-bottom:5px;border-bottom:1px solid var(--border);">Customer Signature</div>'
      + '<div class="sig-canvas-wrap" style="margin-bottom:16px;">'
      +   '<div class="tab-bar">'
      +     '<button type="button" onclick="setSigMethod(\'tic_hydro_sig\',\'canvas\')" id="tic_hydro_sig_tab_canvas" class="tab-item active">&#9999;&#65039; Draw</button>'
      +     '<button type="button" onclick="setSigMethod(\'tic_hydro_sig\',\'type\')"   id="tic_hydro_sig_tab_type"   class="tab-item">&#9000;&#65039; Type</button>'
      +     '<button type="button" onclick="setSigMethod(\'tic_hydro_sig\',\'wet\')"    id="tic_hydro_sig_tab_wet"    class="tab-item">&#128396; Wet / E-Sign</button>'
      +   '</div>'
      +   '<div id="tic_hydro_sig_panel_canvas" class="bg-paper">'
      +     '<canvas id="tic_hydro_sig" width="700" height="110" style="width:100%;height:110px;display:block;touch-action:none;cursor:crosshair;"></canvas>'
      +     '<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 10px;border-top:1px solid var(--border);">'
      +       '<span class="txt-xs-muted">Sign with finger or mouse</span>'
      +       '<button type="button" onclick="clearSig(\'tic_hydro_sig\')" style="background:none;border:1px solid var(--border);border-radius:5px;padding:2px 8px;font-size:10px;color:var(--muted);cursor:pointer;font-family:DM Sans,sans-serif;">Clear</button>'
      +     '</div>'
      +   '</div>'
      +   '<div id="tic_hydro_sig_panel_type" class="sec-hidden">'
      +     '<input type="text" id="tic_hydro_sig_typed" placeholder="Type full legal name" style="width:100%;border:none;border-bottom:2px solid var(--dark);background:transparent;font-size:18px;font-family:Georgia,serif;font-style:italic;color:var(--text);outline:none;padding:4px 0;box-sizing:border-box;"/>'
      +     '<div style="font-size:10px;color:var(--muted);margin-top:8px;">Typing your name constitutes a legal electronic signature</div>'
      +   '</div>'
      +   '<div id="tic_hydro_sig_panel_wet" class="sec-hidden">'
      +     '<div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:8px;">Print or email for signature</div>'
      +     '<div style="font-size:11px;color:var(--muted);line-height:1.6;margin-bottom:10px;">Print this form and collect a wet signature, or use an e-signature service and attach the signed copy to this tenant\'s file.</div>'
      +     '<input type="text" id="tic_hydro_sig_wet_ref" placeholder="Reference # or e-sign envelope ID (optional)" style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:DM Sans,sans-serif;background:var(--surface);color:var(--text);box-sizing:border-box;"/>'
      +   '</div>'
      + '</div>'

      // Date
      + '<div class="tic-field"><label class="tic-field-lbl">Date of Authorization</label>'
      + '<input id="ho_date" type="date" value="' + today + '" style="padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:DM Sans,sans-serif;background:var(--surface);color:var(--text);"/></div>'
      + '</div>'

      // Footer
      + '<div style="padding:14px 24px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px;flex-shrink:0;">'
      +   '<button type="button" onclick="document.getElementById(\'tic_hydroone_modal\').remove()" class="btn btn-ghost">Cancel</button>'
      +   '<button type="button" onclick="window._ticGenerateHydroOneConsentPdf && window._ticGenerateHydroOneConsentPdf()" class="btn btn-primary">Generate PDF</button>'
      + '</div>'
      + '</div>';

    document.body.appendChild(modal);
    setTimeout(function() {
      if (typeof _initSigPad === 'function') _initSigPad('tic_hydro_sig');
    }, 80);
  }

  // ── Hydro One Consent for Disclosure — PDF generator ──────────────────────
  // Replicates the official Hydro One form layout exactly so it is accepted.
  // Part C (Termination) is rendered blank for later use.
  //
  // Fixes applied vs v1:
  //   • Checkboxes: drawn tick lines (✓ glyph is absent in jsPDF Helvetica)
  //   • Part B sigs: single clean two-column block — no duplicate Name rows
  //   • Part C: clean two-column blocks — no stray "Hydro"/"One" inline text
  async function _ticGenerateHydroOneConsentPdf() {
    if (typeof _loadJsPdf === 'function') await _loadJsPdf();
    if (!window.jspdf || !window.jspdf.jsPDF) { if (typeof showToast === 'function') showToast('PDF library unavailable'); return; }

    var fv = function(id) { var e = document.getElementById(id); return e ? (e.value || '').trim() : ''; };
    var fc = function(id) { var e = document.getElementById(id); return e ? e.checked : false; };
    function markRequired(id) {
      var e = document.getElementById(id);
      if (e) { e.style.borderColor = 'var(--danger)'; e.focus(); }
    }
    function clearRequired(id) {
      var e = document.getElementById(id);
      if (e) e.style.borderColor = '';
    }

    var hydroAcct  = fv('ho_acct');
    var hydroMeter = fv('ho_meter');

    // Meter # and Bill Account # are required by Hydro One
    var missing = [];
    if (!hydroAcct)  missing.push('ho_acct');
    if (!hydroMeter) missing.push('ho_meter');
    ['ho_acct', 'ho_meter'].forEach(clearRequired);
    if (missing.length) {
      missing.forEach(markRequired);
      if (typeof showToast === 'function') showToast('Bill Account # and Meter # are required');
      return;
    }

    var custName   = fv('ho_name');
    var custPhone  = fv('ho_phone');
    var custAddr   = fv('ho_addr');
    var custCity   = fv('ho_city');
    var custPostal = fv('ho_postal');
    var dateRaw    = fv('ho_date');
    var chkUsage   = fc('ho_chk_usage');
    var chkAcct    = fc('ho_chk_acct');
    var chkBilling = fc('ho_chk_billing');
    var chkOther   = fc('ho_chk_other');
    var otherText  = fv('ho_other_text');
    var sigData    = (typeof getSigDataURL === 'function') ? getSigDataURL('tic_hydro_sig') : '';

    var tpName  = ((window.NATION_CONFIG && (NATION_CONFIG.display_name||NATION_CONFIG.name))||'CLFN') + ' Housing';
    var tpPhone = (window.NATION_CONFIG && NATION_CONFIG.phone) || '';
    var dateDisp = dateRaw ? (function(){ var d = new Date(dateRaw + 'T12:00:00'); return isNaN(d) ? dateRaw : d.toLocaleDateString('en-CA'); })() : '';

    var pdf  = new window.jspdf.jsPDF({ unit:'mm', format:'letter', orientation:'portrait', compress:true });
    var W    = pdf.internal.pageSize.getWidth();   // 215.9
    var L    = 12, R = 12;
    var CW   = W - L - R;                          // 191.9
    var y    = 10;
    var lh   = 3.8; // standard line height for body text

    // Helpers
    function hline(yy, lw) { pdf.setDrawColor(0); pdf.setLineWidth(lw||0.2); pdf.line(L, yy, W-R, yy); }
    function uline(x1, x2, yy) { pdf.setDrawColor(0); pdf.setLineWidth(0.15); pdf.line(x1, yy, x2, yy); }
    function fline(label, val, x, w, yy) {
      pdf.setFont('helvetica','normal'); pdf.setFontSize(6.5); pdf.setTextColor(90);
      pdf.text(label, x, yy - 2.8);
      pdf.setTextColor(0); pdf.setFontSize(8.5);
      if (val) pdf.text(String(val).substring(0, Math.floor(w / 1.8)), x, yy);
      uline(x, x + w, yy + 0.8);
    }
    // Draw checkbox square + tick mark via lines (✓ glyph missing in jsPDF Helvetica)
    function chkBox(x, yy, checked) {
      pdf.setDrawColor(0); pdf.setLineWidth(0.35); pdf.setFillColor(255,255,255);
      pdf.rect(x, yy - 3.2, 3.8, 3.8, 'FD');
      if (checked) {
        pdf.setDrawColor(0); pdf.setLineWidth(0.6);
        pdf.line(x + 0.5, yy - 1.4, x + 1.5, yy - 0.2);
        pdf.line(x + 1.5, yy - 0.2, x + 3.3, yy - 2.8);
      }
    }
    function chkRow(x, yy, checked, boldLabel, description) {
      chkBox(x, yy, checked);
      var tx = x + 5.5;
      pdf.setFont('helvetica','bold'); pdf.setFontSize(7.5); pdf.setTextColor(0);
      pdf.text(boldLabel + ':', tx, yy);
      var descLines = pdf.splitTextToSize(description, CW - 5.5 - 3);
      pdf.setFont('helvetica','normal'); pdf.setFontSize(7.5);
      pdf.text(descLines, tx, yy + lh);
      return yy + lh + descLines.length * lh + 1.5;
    }
    // Render a signature into an existing signature line area.
    // Does NOT write "Name (Print)" or "Signature:" labels — caller owns those.
    function renderSig(sigImg, x, lineY, w) {
      var sigH = 15;
      if (sigImg && sigImg.indexOf('data:image') === 0) {
        try { pdf.addImage(sigImg, 'PNG', x, lineY - sigH, w, sigH); } catch(e) {}
      } else if (sigImg && sigImg.indexOf('typed:') === 0) {
        pdf.setFont('helvetica','italic'); pdf.setFontSize(12); pdf.setTextColor(0);
        pdf.text(sigImg.replace('typed:',''), x + 1, lineY - 3);
        pdf.setFont('helvetica','normal'); pdf.setFontSize(7.5);
      } else if (sigImg && sigImg.indexOf('wet:') === 0) {
        var ref = sigImg.replace('wet:','');
        pdf.setFont('helvetica','normal'); pdf.setFontSize(7); pdf.setTextColor(100);
        pdf.text(ref === 'pending' ? 'Physical signature on file' : 'E-sign ref: ' + ref, x + 1, lineY - 5);
        pdf.setTextColor(0); pdf.setFontSize(7.5);
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // HEADER
    // ═══════════════════════════════════════════════════════════════════
    pdf.setFillColor(0, 0, 0);
    pdf.rect(L, y, CW, 19, 'F');

    // Title text (centered, offset left to make room for logo)
    pdf.setFont('helvetica','bold'); pdf.setFontSize(11); pdf.setTextColor(255,255,255);
    pdf.text('DISCLOSURE OF INFORMATION TO A THIRD PARTY', L + CW * 0.44, y + 7, { align:'center' });
    pdf.text('CONSENT AND TERMINATION OF CONSENT FORM',   L + CW * 0.44, y + 13, { align:'center' });

    // Hydro One text badge (top-right of header)
    var hX = W - R - 32;
    pdf.setFont('helvetica','bold'); pdf.setFontSize(9.5); pdf.setTextColor(100,200,100);
    pdf.text('hydro', hX, y + 7);
    pdf.setFont('helvetica','bold'); pdf.setFontSize(14); pdf.setTextColor(100,200,100);
    pdf.text('G', hX + 13, y + 8);
    pdf.setFont('helvetica','bold'); pdf.setFontSize(9.5);
    pdf.text('one', hX + 19, y + 12);

    y += 21;
    pdf.setFont('helvetica','normal'); pdf.setFontSize(7.5); pdf.setTextColor(0);
    pdf.text('Commercial & Industrial Customer Relations    Phone: 1-866-922-2466', W/2, y, {align:'center'});
    y += 2; hline(y, 0.4); y += 4;

    // ═══════════════════════════════════════════════════════════════════
    // PART A: Customer Information
    // ═══════════════════════════════════════════════════════════════════
    pdf.setFont('helvetica','bold'); pdf.setFontSize(8); pdf.setTextColor(0);
    pdf.text('PART A: Customer Information (complete ', L, y);
    var uStart = L + pdf.getStringUnitWidth('PART A: Customer Information (complete ') * 8 / pdf.internal.scaleFactor;
    pdf.setFont('helvetica','bolditalic');
    pdf.text('all', uStart, y);
    var uEnd = uStart + pdf.getStringUnitWidth('all') * 8 / pdf.internal.scaleFactor;
    uline(uStart, uEnd, y + 0.5);
    pdf.setFont('helvetica','bold');
    pdf.text(' applicable customer information)', uEnd, y);
    y += 6;

    var c1 = CW * 0.42, c2 = CW * 0.31, c3 = CW - c1 - c2;
    fline('Name',            custName,  L,         c1 - 2,  y);
    fline('Premises Phone #',custPhone, L + c1,    c2 - 2,  y);
    fline('Alt/Bus #',       '',        L + c1+c2, c3,      y);
    y += 7;

    fline('Meter #',         hydroMeter,L,         CW * 0.42 - 2, y);
    fline('Bill Account #',  hydroAcct, L + CW*0.42, CW * 0.58 - 2, y);
    y += 7;

    var aW = CW * 0.40, cW2 = CW * 0.38, pW = CW - aW - cW2;
    fline('Address',    custAddr,   L,          aW - 2,  y);
    fline('City/Town',  custCity,   L + aW,     cW2 - 2, y);
    fline('Postal Code',custPostal, L + aW+cW2, pW,      y);
    y += 7;

    pdf.setFont('helvetica','bold'); pdf.setFontSize(8); pdf.setTextColor(0);
    pdf.text('Service Location', L, y);
    var slX = L + 28;
    fline('Lot #',      '', slX,       44,          y);
    fline('Concession', '', slX + 46,  60,          y);
    fline('Township',   '', slX + 108, CW - 28 - 46 - 62, y);
    y += 7;

    pdf.setFont('helvetica','normal'); pdf.setFontSize(8);
    pdf.text('Reg. Plan #', L, y);      uline(L + 19, L + 50, y + 0.8);
    pdf.text('RP Lot #', L + 53, y);    uline(L + 65, L + 88, y + 0.8);
    pdf.text('911 # address', L + 91, y); uline(L + 109, W - R, y + 0.8);
    y += 7;

    pdf.setFont('helvetica','bold'); pdf.setFontSize(7.5);
    pdf.text('Mailing address for billing (if different from above):', L, y);
    fline('Name', '', L + 86, CW - 86, y);
    y += 6;
    fline('Address',    '', L,          aW - 2,  y);
    fline('City/Town',  '', L + aW,     cW2 - 2, y);
    fline('Postal Code','', L + aW+cW2, pW,      y);
    y += 7;

    // Third Party
    pdf.setFont('helvetica','bold'); pdf.setFontSize(8.5); pdf.setTextColor(0);
    pdf.text('Third Party Information', L, y);
    y += 5;
    fline('Name', tpName, L, CW, y);
    y += 7;
    var phW = CW * 0.33 - 2;
    fline('Phone #', tpPhone, L,              phW,          y);
    fline('Cell #',  '',       L + CW * 0.33, phW,          y);
    fline('Fax #',   '',       L + CW * 0.66, CW * 0.34-2, y);
    y += 5;

    hline(y, 0.5); y += 4;

    // ═══════════════════════════════════════════════════════════════════
    // PART B: Consent
    // ═══════════════════════════════════════════════════════════════════
    pdf.setFont('helvetica','bold'); pdf.setFontSize(8); pdf.setTextColor(0);
    pdf.text('PART B: Consent for Disclosure of Information to Above-Named Third-Party', L, y);
    y += 4.5;

    pdf.setFont('helvetica','normal'); pdf.setFontSize(7.5);
    var preamble1 = pdf.splitTextToSize(
      'The above-noted customer hereby consents to the disclosure by Hydro One Networks Inc. the following account related information to the Third-Party named above.',
      CW);
    pdf.text(preamble1, L, y); y += preamble1.length * lh + 1.5;
    pdf.text('The relevant account-related information that can be disclosed is as follows:', L, y);
    y += 5;

    y = chkRow(L + 2, y, chkUsage,
      'Electricity Usage',
      'Your electricity usage data for up to the last 24 months (if applicable) includes a historical and ongoing meter readings and dates, interval data, and energy charges.');
    y = chkRow(L + 2, y, chkAcct,
      'Account Information',
      'Your account information comprises personal details (like your name and contact information) as well as your service address, account number, meter number, and customer rate class.');
    y = chkRow(L + 2, y, chkBilling,
      'Billing Information',
      'Your billing information for up to the last 24 months (if applicable) includes billing period details, current and last read dates, number of days in each billing period, current charges for each bill period excluding payment information (i.e. past due balance, due dates).');
    // Other
    chkBox(L + 2, y, chkOther);
    pdf.setFont('helvetica','normal'); pdf.setFontSize(7.5); pdf.setTextColor(0);
    pdf.text('Other (please specify): ' + (chkOther && otherText ? otherText : ''), L + 7.5, y);
    uline(L + 49, W - R, y + 0.8);
    y += 5;

    var durLines = pdf.splitTextToSize(
      'The above consent remains in effect from the date of authorization to the date that written termination of the consent is received by Hydro One Networks Inc., or the account is no longer in the account holder\'s name, whichever happens first.',
      CW);
    pdf.setFont('helvetica','normal'); pdf.setFontSize(7.5);
    pdf.text(durLines, L, y); y += durLines.length * lh + 3;

    // Date
    pdf.setFont('helvetica','normal'); pdf.setFontSize(7.5);
    pdf.text('Date: ' + dateDisp, L, y);
    uline(L + 10, L + 70, y + 0.8);
    y += 7;

    // Part B — Name (Print) row
    var halfW = (CW - 4) / 2;
    var col2X = L + halfW + 4;
    pdf.setFont('helvetica','normal'); pdf.setFontSize(7.5); pdf.setTextColor(0);
    pdf.text('Name (Print): ' + custName, L, y);
    uline(L + 26, L + halfW, y + 0.8);
    pdf.text('Name (Print):', col2X, y);
    uline(col2X + 26, W - R, y + 0.8);
    y += 7;

    // Part B — Signature row (left = customer, right = Hydro One blank)
    pdf.text('Signature:', L, y);
    pdf.text('Signature:', col2X, y);
    var sigLineY = y + 16;
    renderSig(sigData, L + 18, sigLineY, halfW - 18);
    uline(L + 18, L + halfW, sigLineY);
    uline(col2X + 18, W - R, sigLineY);
    y = sigLineY + 4;

    // Note box
    pdf.setDrawColor(0); pdf.setLineWidth(0.3); pdf.setFillColor(245,245,245);
    var noteText = 'Note:  For Hydro One accounts where two parties are responsible, both account holders must sign the above consent before account information will be disclosed.';
    var noteLines = pdf.splitTextToSize(noteText, CW - 6);
    var noteH = noteLines.length * lh + 5;
    pdf.rect(L, y, CW, noteH, 'FD');
    pdf.setFont('helvetica','normal'); pdf.setFontSize(7); pdf.setTextColor(0);
    pdf.text(noteLines, L + 3, y + 4);
    y += noteH + 4;

    hline(y, 0.5); y += 4;

    // ═══════════════════════════════════════════════════════════════════
    // PART C: Termination (blank — completed only when terminating)
    // ═══════════════════════════════════════════════════════════════════
    pdf.setFont('helvetica','bold'); pdf.setFontSize(8); pdf.setTextColor(0);
    pdf.text('PART C: Termination of Consent for Disclosure of Information to Above-Named Third-Party', L, y);
    y += 4.5;

    pdf.setFont('helvetica','normal'); pdf.setFontSize(7.5);
    var termLines = pdf.splitTextToSize(
      'The above-noted customer terminates consent to the disclosure of account-related information to the Third-Party above-named effective as of the date signed below.',
      CW);
    pdf.text(termLines, L, y); y += termLines.length * lh + 5;

    // Part C — two clean signature columns (both blank)
    function blankSigCol(x, w) {
      pdf.setFont('helvetica','normal'); pdf.setFontSize(7.5); pdf.setTextColor(0);
      pdf.text('Date:', x, y); uline(x + 10, x + w, y + 0.8);
    }
    blankSigCol(L,     halfW); blankSigCol(col2X, halfW);
    y += 7;
    pdf.text('Name (Print):', L,     y); uline(L + 26,     L + halfW,  y + 0.8);
    pdf.text('Name (Print):', col2X, y); uline(col2X + 26, W - R,      y + 0.8);
    y += 7;
    pdf.text('Signature:',    L,     y); uline(L + 18,     L + halfW,  y + 0.8);
    pdf.text('Signature:',    col2X, y); uline(col2X + 18, W - R,      y + 0.8);
    y += 10;
    pdf.text('Name (Print):', L,     y); uline(L + 26,     L + halfW,  y + 0.8);
    pdf.text('Name (Print):', col2X, y); uline(col2X + 26, W - R,      y + 0.8);
    y += 7;
    pdf.text('Signature:',    L,     y); uline(L + 18,     L + halfW,  y + 0.8);
    pdf.text('Signature:',    col2X, y); uline(col2X + 18, W - R,      y + 0.8);

    // Rotated watermark (left margin, matching the original)
    pdf.setFontSize(6.5); pdf.setTextColor(120);
    pdf.text('Hydro One Networks Inc.  04/12', 6, 262, { angle: 90 });
    pdf.setTextColor(0);

    // ── Output ────────────────────────────────────────────────────────────────
    var filename = 'HydroOne_Consent_' + (custName || 'Tenant').replace(/\s+/g, '_') + '.pdf';

    // Download to browser
    pdf.save(filename);

    // Save to tenant document library
    var unit = _ticState.unit || {};
    if (unit.id) {
      try {
        var blob      = pdf.output('blob');
        var storePath = 'tenants/' + unit.id + '/' + Date.now() + '_' + filename;
        await window.sbUploadFile(storePath, blob);
        if (typeof window.sbSaveFileMeta === 'function') {
          await window.sbSaveFileMeta('tenant', String(unit.id), storePath, filename, blob.size, 'application/pdf');
        }
        // Force doc-lib remount so the new file appears immediately
        _ticDocLibKey = null;
        _ticDocLib    = null;
        // Close the modal now that the PDF is done
        var mo = document.getElementById('tic_hydroone_modal');
        if (mo) mo.remove();
        if (typeof showToast === 'function') showToast('✓ PDF saved to document library');
      } catch (e) {
        console.warn('[tic] PDF upload to doc library failed:', e);
        var mo2 = document.getElementById('tic_hydroone_modal');
        if (mo2) mo2.remove();
        if (typeof showToast === 'function') showToast('✓ PDF downloaded (document library save failed — see console)');
      }
    } else {
      var mo3 = document.getElementById('tic_hydroone_modal');
      if (mo3) mo3.remove();
      if (typeof showToast === 'function') showToast('✓ PDF generated');
    }
  }

  window.openTenantCard = openTenantCard;
  window.closeTenantCard = _ticClose;
  window._ticOpenHydroOneConsentModal  = _ticOpenHydroOneConsentModal;
  window._ticGenerateHydroOneConsentPdf = _ticGenerateHydroOneConsentPdf;
})();
