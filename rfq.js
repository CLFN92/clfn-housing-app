'use strict';

var _rfqCurrentId       = null;
var _rfqSowUnitId       = null;
var _rfqSowPn           = null;
var _rfqSowData         = null;
var _rfqUnitData        = null;
var _rfqScopeItems      = [];
var _rfqSelectedCts     = {};
var _rfqActiveTab       = 'details';
var _rfqAwardingId      = null;
var _rfqScopeDetailRows  = [];
var _rfqMilestoneRows    = [];
var _rfqMaterialsRows    = [];
var _rfqExclusionsRows   = [];
var _rfqClfnSuppliedRows = [];
var _rfqDocFiles         = [];   // cached list from audit log
var _rfqAttachedPaths    = [];   // paths selected to attach to email
var _rfqDocLib           = null; // DocLibrary instance for this RFQ

// ── Page init (mirrors renos.html IIFE pattern — never loads housing-init.js) ─
(async function initRfq() {
  // Restore session from sessionStorage (same keys as renos.html)
  var token = null, savedRole = null, savedName = null, savedEmail = null;
  try {
    token      = sessionStorage.getItem('clfn_housing_token');
    savedRole  = sessionStorage.getItem('clfn_housing_role')          || 'housing_employee_l1';
    savedName  = sessionStorage.getItem('clfn_housing_name')          || '';
    savedEmail = sessionStorage.getItem('clfn_housing_email_session') || '';
  } catch(e) {}
  if (!token) { window.location.href = 'index.html'; return; }

  HOUSING_HEADERS['Authorization'] = 'Bearer ' + token;
  HOUSING_SESSION.accessToken = token;
  HOUSING_SESSION.role  = savedRole;
  HOUSING_SESSION.name  = savedName;
  HOUSING_SESSION.email = savedEmail;
  window.currentRole    = savedRole;
  if (!window._realRole) window._realRole = savedRole;

  // Header is rendered by renderAppHeader() in housing-init.js (standard pattern)

  try { await loadRfqPageData(); } catch(e) { console.error('[RFQ] data load failed:', e); }

  if (typeof _applyTheme          === 'function') _applyTheme((window._appSettings||{}).theme || {});
  if (typeof applyNationOverrides  === 'function') applyNationOverrides();
  // Mark RFQ as the active nav item (housing-init.js renders the nav)
  if (typeof setHeaderNavActive === 'function') setHeaderNavActive('rfq');

  var params = new URLSearchParams(window.location.search);
  var rfqId  = params.get('rfq');
  var unitId = params.get('unit');
  var sowPn  = params.get('sow');

  if (rfqId) {
    showRfqForm(rfqId, null, null);
  } else if (unitId && sowPn) {
    // New RFQ from SOW — show form immediately then fetch SOW data from Supabase
    showRfqForm(null, unitId, sowPn);
    _fetchAndPopulateSow(unitId, sowPn);
  } else {
    renderRfqList();
  }
}());

async function loadRfqPageData() {
  var results = await Promise.all([
    fetch(SUPABASE_URL + '/rest/v1/housing_units?select=*&order=street,num&limit=9999', { headers: HOUSING_HEADERS }),
    fetch(SUPABASE_URL + '/rest/v1/housing_sow?select=unit_id,data',                   { headers: HOUSING_HEADERS }),
    fetch(SUPABASE_URL + '/rest/v1/housing_settings?select=key,value',                 { headers: HOUSING_HEADERS }),
    fetch(SUPABASE_URL + '/rest/v1/housing_rfq?select=*&order=created_at.desc',        { headers: HOUSING_HEADERS }),
    fetch(SUPABASE_URL + '/rest/v1/housing_contractors?select=*&order=name',           { headers: HOUSING_HEADERS })
  ]);
  var uR = results[0], sowR = results[1], stR = results[2], rfqR = results[3], ctR = results[4];
  if (uR && uR.ok) {
    window.housingUnits = (await uR.json()).map(function(row) {
      return Object.assign({}, row.data || {}, {
        id: row.id, num: row.num, street: row.street,
        bedrooms: row.bedrooms, status: row.status || 'vacant',
        assignedTo: row.assigned_to, assignedName: row.assigned_name
      });
    });
  }
  if (sowR && sowR.ok) {
    var sd = await sowR.json();
    window._sowCache = {};
    sd.forEach(function(r) { window._sowCache[r.unit_id] = r.data; });
  }
  if (stR && stR.ok) {
    var settings = await stR.json();
    window._appSettings = {};
    settings.forEach(function(r) { window._appSettings[r.key] = r.value; });
  }
  if (rfqR && rfqR.ok) {
    window._rfqCache = {};
    (await rfqR.json()).forEach(function(r) { window._rfqCache[r.id] = r; });
  }
  if (ctR && ctR.ok) {
    // Matches housing-init.js pattern: spread r.data first so email/phone/etc.
    // from the JSONB data column are preserved; override only the top-level cols.
    window._contractors = (await ctR.json()).map(function(r) {
      return Object.assign({}, r.data || {}, {
        id: r.id, name: r.name, trade: r.trade, status: r.status
      });
    });
  }
}

// ── List view ─────────────────────────────────────────────────────────────────
function showRfqList() {
  document.getElementById('rfqListView').style.display = '';
  document.getElementById('rfqFormView').style.display = 'none';
  renderRfqList();
}

// Mirrors renderWorklist() exactly: builds search + table as innerHTML string
// into #rfqListBody so layout, spacing and column-menu are identical.
function renderRfqList() {
  var body  = document.getElementById('rfqListBody');
  if (!body) return;

  var cache  = window._rfqCache || {};
  var units  = (typeof housingUnits !== 'undefined' ? housingUnits : []);
  // Preserve search value across re-renders
  var prevSearch = ((document.getElementById('rfq_search_input')||{}).value || '');

  // Enrich rows
  var allRows = Object.values(cache).map(function(rfq) {
    var unit    = units.find(function(u){ return u && u.id === rfq.sow_unit_id; }) || {};
    var addr    = ((unit.num||'') + ' ' + (unit.street||'')).trim() || rfq.sow_unit_id || '';
    var awardCt = rfq.awarded_contractor_id
      ? ((window._contractors||[]).find(function(c){ return c && c.id === rfq.awarded_contractor_id; }) || {}).name || rfq.awarded_contractor_id
      : '';
    return { rfq: rfq, addr: addr, awardCt: awardCt };
  });

  // Search
  var search = prevSearch.toLowerCase().trim();
  if (search) {
    allRows = allRows.filter(function(r) {
      return [r.rfq.id, r.addr, r.rfq.sow_project_number, r.rfq.status, r.awardCt]
        .filter(Boolean).join(' ').toLowerCase().indexOf(search) !== -1;
    });
  }

  // Default sort: newest first
  allRows.sort(function(a,b){ return (b.rfq.created_at||'').localeCompare(a.rfq.created_at||''); });

  // Column definitions — same shape as worklist / contractors
  var _cols = {
    id:      { label: 'RFQ #',      accessor: function(r){ return r.rfq.id || ''; } },
    unit:    { label: 'Unit / SOW', accessor: function(r){ return r.addr; } },
    status:  { label: 'Status',     accessor: function(r){ return r.rfq.status || 'draft'; } },
    issued:  { label: 'Issued',     accessor: function(r){ return r.rfq.issued_at || ''; } },
    closes:  { label: 'Closes',     accessor: function(r){ return r.rfq.closes_at || ''; } },
    awarded: { label: 'Awarded To', accessor: function(r){ return r.awardCt; } },
    amount:  { label: 'Award $',    accessor: function(r){ return Number(r.rfq.award_amount) || 0; } }
  };
  var _acc = {};
  Object.keys(_cols).forEach(function(k){ _acc[k] = _cols[k].accessor; });
  var _state = (typeof tableStateGet === 'function') ? tableStateGet('rfq') : { sort:{key:'',dir:1}, filters:{} };
  if (typeof tableRegisterColumns === 'function') {
    tableRegisterColumns('rfq', { columns: _cols, getRows: function(){ return allRows; }, onChange: renderRfqList });
  }
  var sorted = (typeof tableApplyFilterSort === 'function') ? tableApplyFilterSort(allRows, _acc, _state) : allRows;

  // Build row HTML
  var emptyMsg = search
    ? 'No results for &ldquo;' + escapeHtml(search) + '&rdquo;. Click a column header to adjust filters.'
    : 'No RFQs yet. Click &ldquo;+ New RFQ&rdquo; to get started.';
  var rowsHtml = sorted.length ? sorted.map(function(r) {
    var rfq   = r.rfq;
    var clos  = rfq.closes_at ? new Date(rfq.closes_at).toLocaleDateString('en-CA') : '--';
    var iss   = rfq.issued_at ? new Date(rfq.issued_at).toLocaleDateString('en-CA')  : '--';
    var rcp   = (rfq.recipient_contractor_ids || []).length;
    var amt   = rfq.award_amount ? '$' + Number(rfq.award_amount).toLocaleString('en-CA',{minimumFractionDigits:2}) : '--';
    var stCls = 'rfq-status-' + (rfq.status || 'draft');
    return '<tr style="border-bottom:1px solid var(--border);" class="clickable" onclick="showRfqForm(\'' + escapeHtml(rfq.id) + '\',null,null)">'
      + '<td style="padding:11px 14px;font-weight:600;font-size:13px;">' + escapeHtml(rfq.id) + '</td>'
      + '<td style="padding:11px 14px;font-size:12px;">' + escapeHtml(r.addr) + (rfq.sow_project_number ? '<div class="txt-xs-muted">' + escapeHtml(rfq.sow_project_number) + '</div>' : '') + '</td>'
      + '<td style="padding:11px 14px;"><span class="rfq-status-pill ' + stCls + '">' + escapeHtml(rfq.status||'draft') + '</span></td>'
      + '<td style="padding:11px 14px;font-size:12px;color:var(--muted);">' + iss + '</td>'
      + '<td style="padding:11px 14px;font-size:12px;color:var(--muted);">' + clos + '</td>'
      + '<td style="padding:11px 14px;font-size:12px;text-align:center;">' + rcp + '</td>'
      + '<td style="padding:11px 14px;font-size:12px;">' + escapeHtml(r.awardCt || '--') + '</td>'
      + '<td style="padding:11px 14px;font-size:12px;">' + amt + '</td>'
      + '<td style="padding:11px 14px;text-align:right;white-space:nowrap;" onclick="event.stopPropagation();">'
      +   '<div style="display:inline-flex;gap:4px;align-items:center;">'
      +     (rfq.status === 'draft'  ? '<button class="btn btn-ghost btn-sm" onclick="showRfqForm(\'' + escapeHtml(rfq.id) + '\',null,null)">Edit</button>' : '')
      +     (rfq.status === 'issued' ? '<button class="btn btn-ghost btn-sm" onclick="showAwardModal(\'' + escapeHtml(rfq.id) + '\')">Award</button>' : '')
      +     (rfq.status !== 'cancelled' && rfq.status !== 'awarded' ? '<button class="btn btn-ghost btn-sm" style="color:var(--danger);" onclick="cancelRfq(\'' + escapeHtml(rfq.id) + '\')">Cancel</button>' : '')
      +   '</div>'
      + '</td>'
      + '</tr>';
  }).join('')
  : '<tr><td colspan="9" style="padding:32px;text-align:center;color:var(--muted);font-size:13px;font-style:italic;">' + emptyMsg + '</td></tr>';

  // Inject full HTML into the body container — mirrors worklist body.innerHTML pattern
  body.innerHTML =
      '<div class="std-search-row std-search-row-wide">'
    +   '<input id="rfq_search_input" class="std-search" type="text"'
    +   ' placeholder="&#128269; Search RFQ #, unit, status, contractor…"'
    +   ' value="' + escapeHtml(prevSearch) + '"'
    +   ' oninput="window._rfqSearch=this.value;clearTimeout(window._rfqST);window._rfqST=setTimeout(renderRfqList,200)"/>'
    + '</div>'
    + '<div class="std-table-card">'
    +   '<div class="doclib-table-wrap"><table class="std-table">'
    +     '<thead id="rfq_thead"><tr>'
    +       '<th class="std-th-sortable" data-sort-key="id">RFQ #</th>'
    +       '<th class="std-th-sortable" data-sort-key="unit">Unit / SOW</th>'
    +       '<th class="std-th-sortable" data-sort-key="status">Status</th>'
    +       '<th class="std-th-sortable" data-sort-key="issued">Issued</th>'
    +       '<th class="std-th-sortable" data-sort-key="closes">Closes</th>'
    +       '<th>Recipients</th>'
    +       '<th class="std-th-sortable" data-sort-key="awarded">Awarded To</th>'
    +       '<th class="std-th-sortable" data-sort-key="amount">Award $</th>'
    +       '<th></th>'
    +     '</tr></thead>'
    +     '<tbody id="rfqTableBody">' + rowsHtml + '</tbody>'
    +   '</table></div>'
    + '</div>';

  var thead = document.getElementById('rfq_thead');
  if (typeof tableBindColumnMenuClicks  === 'function' && thead) tableBindColumnMenuClicks(thead, 'rfq');
  if (typeof tableRefreshSortIndicators === 'function' && thead) tableRefreshSortIndicators(thead, 'rfq');
}

// ── Form view ─────────────────────────────────────────────────────────────────
// Fetch the SOW record from Supabase and populate form fields.
// Called after showRfqForm() so the form is already visible.
async function _fetchAndPopulateSow(unitId, sowPn) {
  try {
    var rows;
    var _handoffStr = sessionStorage.getItem('_rfq_sow_handoff');
    if (_handoffStr) {
      sessionStorage.removeItem('_rfq_sow_handoff');
      try {
        var _ho = JSON.parse(_handoffStr);
        if (_ho && _ho.project_number === sowPn) {
          rows = [{ data: { sows: [_ho] } }];
        }
      } catch(e) {}
    }
    if (!rows) {
      var r = await fetch(
        SUPABASE_URL + '/rest/v1/housing_sow?unit_id=eq.' + encodeURIComponent(unitId) + '&select=data',
        { headers: HOUSING_HEADERS }
      );
      if (!r.ok) return;
      rows = await r.json();
    }
    if (!rows || !rows.length) return;

    var data = rows[0].data || {};
    var sowsArr = Array.isArray(data.sows) ? data.sows : (Array.isArray(data) ? data : []);
    var sow = sowsArr.find(function(s){ return s && s.project_number === sowPn; })
           || sowsArr[0]
           || null;
    if (!sow) return;

    // Unit address from cached housingUnits (already loaded)
    var unit = (window.housingUnits || []).find(function(u){ return u && u.id === unitId; }) || {};
    var addr = ((unit.num||'') + ' ' + (unit.street||'')).trim()
            || sow.address || unitId;

    // Estimated budget
    var amount = parseFloat(sow.amount || sow.totalCost || sow.total_cost || 0) || 0;
    var amtStr = amount ? '$' + amount.toLocaleString('en-CA', {minimumFractionDigits:2}) : '--';

    // Populate the read-only display fields
    var sowDisp  = document.getElementById('rfq_sow_display');
    var budgDisp = document.getElementById('rfq_budget_display');
    var subLbl   = document.getElementById('rfqFormSub');
    if (sowDisp)  sowDisp.value  = sowPn + (addr ? '  —  ' + addr : '');
    if (budgDisp) budgDisp.value = amtStr;
    if (subLbl)   subLbl.textContent = addr;

    // Populate target dates from SOW
    var tsEl2 = document.getElementById('rfq_target_start');
    var teEl2 = document.getElementById('rfq_target_end');
    if (tsEl2 && sow.startDate) tsEl2.value = sow.startDate;
    if (teEl2 && sow.endDate)   teEl2.value = sow.endDate;

    // Update module-level state so scope tab and context are correct
    _rfqSowData   = sow;
    _rfqUnitData  = unit;

    // Pre-populate scope items if not already set
    if (!_rfqScopeItems.length && sow) {
      var items = sow.items || sow.lineItems || [];
      _rfqScopeItems = items.map(function(it){ return Object.assign({}, it, {_hidden:false}); });
    }
  } catch(e) {
    console.warn('[rfq] SOW fetch failed:', e);
  }
}

function showRfqForm(rfqId, unitId, sowPn) {
  document.getElementById('rfqListView').style.display  = 'none';
  document.getElementById('rfqFormView').style.display  = '';
  switchRfqTab('details');

  _rfqCurrentId            = rfqId || null;
  _rfqSelectedCts          = {};
  _rfqScopeItems           = [];
  _rfqScopeDetailRows      = [];
  _rfqMilestoneRows        = [];
  _rfqMaterialsRows        = [];
  _rfqExclusionsRows       = [];
  _rfqClfnSuppliedRows     = [];
  _rfqContractingTabInited = false;
  _rfqDocFiles         = [];
  _rfqAttachedPaths    = [];
  _rfqDocLib           = null;

  if (rfqId) {
    // Editing existing
    var rfq = (window._rfqCache || {})[rfqId];
    if (!rfq) { showToast('RFQ not found'); showRfqList(); return; }
    _rfqSowUnitId = rfq.sow_unit_id;
    _rfqSowPn     = rfq.sow_project_number;
    (rfq.recipient_contractor_ids || []).forEach(function(id){ _rfqSelectedCts[id] = true; });
    _rfqScopeItems = (rfq.data && rfq.data.scope_snapshot) ? JSON.parse(JSON.stringify(rfq.data.scope_snapshot)) : [];
    _populateFormFields(rfq);
    document.getElementById('rfqFormHeading').textContent = rfqId;
    document.getElementById('rfqIssueBtn').disabled = rfq.status !== 'draft';
  } else {
    // New RFQ
    _rfqSowUnitId = unitId || null;
    _rfqSowPn     = sowPn  || null;
    var newId = (typeof generateRfqNumber === 'function') ? generateRfqNumber() : ('RFQ-' + new Date().getFullYear() + '-0001');
    document.getElementById('rfq_number').value = newId;
    document.getElementById('rfq_status_display').value = 'draft';
    // Default issue date = today
    document.getElementById('rfq_issue_date').value = new Date().toISOString().slice(0,10);
    // Default closing: 14 days from now
    var closing = new Date(Date.now() + 14*24*60*60*1000);
    document.getElementById('rfq_closes_at').value = closing.toISOString().slice(0,16);
    // Default contact = current user
    var session = window.HOUSING_SESSION || {};
    document.getElementById('rfq_contact').value = session.name || '';
    document.getElementById('rfq_contact_email').value = session.email || '';
    document.getElementById('rfqFormHeading').textContent = 'New Request for Quotes';
    document.getElementById('rfqIssueBtn').disabled = false;
    // Contract defaults
    var cnEl = document.getElementById('rfq_contract_number');
    if (cnEl) cnEl.value = generateContractNumber();
    var cdEl = document.getElementById('rfq_contract_date');
    if (cdEl) cdEl.value = new Date().toISOString().slice(0,10);
    var apEl = document.getElementById('rfq_ap_email');
    if (apEl) apEl.value = 'housing@clfn.on.ca';
    renderMilestoneRows();
  }

  // Load SOW data and unit
  _loadRfqSowContext();
  updateRecipientBadge();
  _renderAwardedToDropdown();
  setTimeout(function(){
    if (typeof _initSigPad === 'function') {
      _initSigPad('rfq_sig');
      _initSigPad('rfq_ct_sig');
      _initSigPad('rfq_ct_initial');
    }
  }, 80);
}

function _populateFormFields(rfq) {
  var d = rfq.data || {};
  function set(id, val) { var el = document.getElementById(id); if (el) el.value = val || ''; }

  set('rfq_number',         rfq.id);
  set('rfq_status_display', rfq.status || 'draft');
  set('rfq_closes_at',      rfq.closes_at ? rfq.closes_at.slice(0,16) : '');
  set('rfq_contact',        d.contact_person || '');
  set('rfq_contact_email',  d.contact_email  || '');
  set('rfq_sub_method',     d.submission_method || 'email');
  set('rfq_issue_date',     d.issue_date || new Date().toISOString().slice(0,10));
  set('rfq_target_start',   d.target_start_date || '');
  set('rfq_target_end',     d.target_completion_date || '');

  // Award
  set('rfq_award_amount', rfq.award_amount || '');
  set('rfq_award_notes',  rfq.award_notes  || '');

  // Contract Details
  set('rfq_contract_number', d.contract_number || generateContractNumber());
  set('rfq_contract_date',         d.contract_date   || '');
  set('rfq_contract_start',        d.contract_start  || d.target_start_date || '');
  set('rfq_substantial_completion',d.substantial_completion_date || '');
  set('rfq_total_completion',      d.total_completion_date || d.target_completion_date || '');
  set('rfq_ap_email',              d.ap_email || 'housing@clfn.on.ca');
  set('rfq_site_lead_name',        d.site_lead_name        || '');
  set('rfq_site_lead_phone',       d.site_lead_phone       || '');
  set('rfq_ct_signatory_name',     d.ct_signatory_name     || '');
  set('rfq_ct_signatory_title',    d.ct_signatory_title    || '');

  // Scope detail
  set('rfq_sow_summary',     d.sow_summary     || '');
  // (sow_detail textarea removed — work items now use dynamic scope detail rows)
  // (materials/exclusions/clfn_supplied now use dynamic rows — loaded above)

  // Price breakdown
  set('rfq_price_materials', d.price_materials || '');
  set('rfq_price_labour',    d.price_labour    || '');
  set('rfq_price_equipment', d.price_equipment || '');
  set('rfq_price_other',     d.price_other     || '');
  set('rfq_price_tax',       d.price_tax       || '');
  set('rfq_labour_hours',    d.labour_hours    || '');

  // Document attachment selection
  _rfqAttachedPaths = d.attached_doc_paths || [];

  // Dynamic row arrays
  _rfqScopeDetailRows  = d.scope_detail_rows   || [];
  _rfqMaterialsRows    = d.materials_rows      || [];
  _rfqExclusionsRows   = d.exclusions_rows     || [];
  _rfqClfnSuppliedRows = d.clfn_supplied_rows  || [];
  _rfqMilestoneRows    = (d.milestones || []).filter(function(m){ return m && (m.name || m.gross); });
  set('rfq_holdback_release', d.holdback_release || '');

  // Signatures
  set('rfq_sig_name',  d.sig_name  || '');
  set('rfq_sig_title', d.sig_title || '');
  set('rfq_ct_sig_date',    d.ct_sig_date    || '');

  _rfqRecalcPrices();

  // Awarded-to dropdown populated after recipients are loaded
  setTimeout(function(){
    _renderAwardedToDropdown();
    var awdEl = document.getElementById('rfq_awarded_to');
    if (awdEl && rfq.awarded_contractor_id) awdEl.value = rfq.awarded_contractor_id;
  }, 150);
}

function _renderAwardedToDropdown() {
  var sel = document.getElementById('rfq_awarded_to');
  if (!sel) return;
  var prev = sel.value;
  sel.innerHTML = '<option value="">-- Select contractor --</option>';
  Object.keys(_rfqSelectedCts).forEach(function(id) {
    var ct = (window._contractors || []).find(function(c){ return c && c.id === id; });
    if (!ct) return;
    var opt = document.createElement('option');
    opt.value = id;
    opt.textContent = ct.name + (ct.trade ? ' (' + ct.trade + ')' : '');
    if (id === prev) opt.selected = true;
    sel.appendChild(opt);
  });
}

function _loadRfqSowContext() {
  _rfqSowData = null; _rfqUnitData = null;
  if (!_rfqSowUnitId) return;

  // Find unit from cache (may enrich the address)
  _rfqUnitData = (window.housingUnits || []).find(function(u){ return u && u.id === _rfqSowUnitId; }) || null;
  var addr = ''
    || (_rfqUnitData ? ((_rfqUnitData.num||'') + ' ' + (_rfqUnitData.street||'')).trim() : '')
    || _rfqSowUnitId;

  // Find SOW in cache for scope items (secondary, best-effort)
  var sowEntry = (window._sowCache || {})[_rfqSowUnitId];
  if (sowEntry) {
    var sowsArr = Array.isArray(sowEntry.sows) ? sowEntry.sows
                : Array.isArray(sowEntry) ? sowEntry : null;
    if (sowsArr && _rfqSowPn) {
      _rfqSowData = sowsArr.find(function(s){ return s && s.project_number === _rfqSowPn; }) || null;
    }
    if (!_rfqSowData && sowsArr && sowsArr.length) _rfqSowData = sowsArr[0] || null;
    if (!_rfqSowData && sowEntry && sowEntry.items) _rfqSowData = sowEntry;
  }

  // Amount: nav context is authoritative (direct from SOW modal DOM), cache is fallback
  var raw = 0 || (_rfqSowData
    ? parseFloat(_rfqSowData.amount || _rfqSowData.totalCost || _rfqSowData.total_cost || 0)
    : 0);
  var amt = raw ? '$' + raw.toLocaleString('en-CA', {minimumFractionDigits:2}) : '--';

  // Populate display fields
  var sowDisp  = document.getElementById('rfq_sow_display');
  var budgDisp = document.getElementById('rfq_budget_display');
  var subLbl   = document.getElementById('rfqFormSub');
  if (sowDisp)  sowDisp.value  = (_rfqSowPn||'') + (addr ? '  —  ' + addr : '');
  if (budgDisp) budgDisp.value = amt;
  if (subLbl)   subLbl.textContent = addr || '';

  // Pre-populate scope items from SOW cache
  if (!_rfqScopeItems.length && _rfqSowData) {
    var rawItems = _rfqSowData.items || _rfqSowData.lineItems || [];
    _rfqScopeItems = rawItems.map(function(it){ return Object.assign({}, it, {_hidden:false}); });
  }

  // Pre-populate scope detail rows from scope items if not yet set
  if (!_rfqScopeDetailRows.length && _rfqScopeItems.length) {
    _rfqScopeDetailRows = _rfqScopeItems
      .filter(function(it){ return !it._hidden && (it.category || it.description); })
      .map(function(it){
        return {
          category:    it.category    || '',
          description: it.description || '',
          notes:       it.amount ? ('$' + Number(it.amount).toLocaleString('en-CA', {minimumFractionDigits:2})) : (it.notes || '')
        };
      });
  }
  renderScopeDetailRows();
  renderMaterialsRows();
  renderExclusionsRows();
  renderClfnSuppliedRows();
  renderMilestoneRows();
}

// ── Tab switching ─────────────────────────────────────────────────────────────
var _rfqContractingTabInited = false;

function switchRfqTab(tab) {
  _rfqActiveTab = tab;
  ['details','scope','recipients','documents','contracting'].forEach(function(t) {
    var btn = document.getElementById('rfqTabBtn_' + t);
    var panel = document.getElementById('rfqPanel_' + t);
    if (btn)   btn.classList.toggle('active', t === tab);
    if (panel) panel.style.display = (t === tab) ? '' : 'none';
  });
  if (tab === 'scope')      renderScopeTab();
  if (tab === 'recipients') renderContractorCards();
  if (tab === 'documents')  renderDocumentsTab();
  if (tab === 'contracting') {
    // Render dynamic row tables now that the container elements are visible
    renderScopeDetailRows();
    renderMaterialsRows();
    renderExclusionsRows();
    renderClfnSuppliedRows();
    renderMilestoneRows();
    // Sig pads were hidden at form-open time — init them on first visit
    if (!_rfqContractingTabInited) {
      _rfqContractingTabInited = true;
      setTimeout(function(){
        if (typeof _initSigPad === 'function') {
          _initSigPad('rfq_sig');
          _initSigPad('rfq_ct_sig');
          _initSigPad('rfq_ct_initial');
        }
      }, 50);
    }
  }
}

// ── Scope tab ─────────────────────────────────────────────────────────────────
function renderScopeTab() {
  var el = document.getElementById('rfqScopeContent');
  if (!el) return;
  var items = _rfqScopeItems.filter(function(it){ return it && (it.category || it.description); });
  if (!items.length) {
    el.innerHTML = '<div class="rfq-progress-msg">No line items found in the linked SOW. Save the SOW with at least one item first.</div>';
    return;
  }
  var rows = items.map(function(it, i) {
    return '<tr>'
      + '<td style="padding:6px 8px;"><input type="checkbox" ' + (it._hidden ? '' : 'checked') + ' onchange="_rfqScopeItems[' + i + ']._hidden = !this.checked" style="accent-color:var(--yellow);width:15px;height:15px;"/></td>'
      + '<td style="padding:6px 10px;font-size:12px;">' + escapeHtml(it.category||'--') + '</td>'
      + '<td style="padding:6px 10px;font-size:12px;">' + escapeHtml(it.description||'--') + '</td>'
      + '</tr>';
  });
  el.innerHTML = '<div style="font-size:11px;color:var(--muted);margin-bottom:10px;">Uncheck items to exclude them from the contractor-facing RFQ document. The underlying SOW is not modified.</div>'
    + '<table class="rfq-scope-table"><thead><tr><th style="width:40px;">Show</th><th style="width:28%">Category</th><th>Description</th></tr></thead>'
    + '<tbody>' + rows.join('') + '</tbody></table>';
}

// ── Recipients tab ────────────────────────────────────────────────────────────
function renderContractorCards() {
  var grid = document.getElementById('rfqContractorGrid');
  if (!grid) return;
  var activeOnly   = document.getElementById('rfq_filter_active') && document.getElementById('rfq_filter_active').checked;
  var tradeMatch   = document.getElementById('rfq_filter_trade')  && document.getElementById('rfq_filter_trade').checked;
  var searchEl     = document.getElementById('rfq_ct_search');
  var search       = searchEl ? searchEl.value.toLowerCase().trim() : '';

  var sowCategories = {};
  _rfqScopeItems.filter(function(it){ return !it._hidden && it.category; }).forEach(function(it){ sowCategories[it.category.toLowerCase()] = true; });

  var cts = (window._contractors || []).filter(function(ct) {
    if (!ct || !ct.name) return false;
    // Only exclude contractors with an explicit non-active status;
    // contractors with no status set are treated as active.
    if (activeOnly && ct.status && ct.status !== 'active') return false;
    // Trade match: only filter when SOW has scope items AND contractor has a trade value.
    if (tradeMatch && Object.keys(sowCategories).length && ct.trade) {
      var trade = ct.trade.toLowerCase();
      var hit = Object.keys(sowCategories).some(function(cat) {
        return trade.indexOf(cat) !== -1 || cat.indexOf(trade) !== -1;
      });
      if (!hit) return false;
    }
    if (search) {
      var hay = ((ct.name||'') + ' ' + (ct.trade||'')).toLowerCase();
      if (hay.indexOf(search) === -1) return false;
    }
    return true;
  });

  if (!cts.length) {
    grid.innerHTML = '<div class="rfq-progress-msg">No matching contractors.</div>';
    return;
  }

  grid.innerHTML = cts.map(function(ct) {
    var sel = !!_rfqSelectedCts[ct.id];
    var wsib = ct.wsib_expiry ? (new Date(ct.wsib_expiry) > new Date() ? 'WSIB valid' : 'WSIB EXPIRED') : 'WSIB unknown';
    var wsibClass = ct.wsib_expiry ? (new Date(ct.wsib_expiry) > new Date() ? 'rfq-ct-badge-ok' : 'rfq-ct-badge-warn') : 'rfq-ct-badge-warn';
    return '<div class="rfq-ct-card' + (sel ? ' is-selected' : '') + '" onclick="toggleContractor(\'' + escapeHtml(ct.id) + '\')">'
      + '<div class="rfq-ct-name">' + escapeHtml(ct.name) + '</div>'
      + '<div class="rfq-ct-trade">' + escapeHtml(ct.trade||'--') + '</div>'
      + '<div class="rfq-ct-email">' + escapeHtml(ct.email||'No email on file') + '</div>'
      + '<span class="rfq-ct-badge ' + wsibClass + '">' + wsib + '</span>'
      + '</div>';
  }).join('');
}

function toggleContractor(ctId) {
  if (_rfqSelectedCts[ctId]) delete _rfqSelectedCts[ctId];
  else _rfqSelectedCts[ctId] = true;
  _renderAwardedToDropdown();
  renderContractorCards();
  updateRecipientBadge();
}

function selectAllMatchingContractors() {
  var activeOnly = document.getElementById('rfq_filter_active') && document.getElementById('rfq_filter_active').checked;
  var sowCategories = {};
  _rfqScopeItems.filter(function(it){ return !it._hidden && it.category; }).forEach(function(it){ sowCategories[it.category.toLowerCase()] = true; });
  (window._contractors || []).forEach(function(ct) {
    if (!ct || !ct.name) return;
    if (activeOnly && ct.status !== 'active') return;
    if (Object.keys(sowCategories).length) {
      var trade = (ct.trade || '').toLowerCase();
      if (!Object.keys(sowCategories).some(function(cat){ return trade.indexOf(cat) !== -1 || cat.indexOf(trade) !== -1; })) return;
    }
    _rfqSelectedCts[ct.id] = true;
  });
  renderContractorCards();
  updateRecipientBadge();
}

function updateRecipientBadge() {
  var n   = Object.keys(_rfqSelectedCts).length;
  var el  = document.getElementById('rfqRecipientBadge');
  var btn = document.getElementById('rfqTabBtn_recipients');
  if (el) { el.textContent = n; el.style.display = n ? '' : 'none'; }
}

// ── Build RFQ payload from form ───────────────────────────────────────────────
function _buildRfqPayload() {
  var id   = document.getElementById('rfq_number').value.trim();
  var snap = _rfqScopeItems.filter(function(it){ return !it._hidden && (it.category || it.description); });
  function fv(elId) { var el = document.getElementById(elId); return el ? el.value.trim() : ''; }
  function fn(elId) { return parseFloat(fv(elId)) || null; }

  var milestones       = _readMilestoneRows();
  var scopeDetailRows  = _readScopeDetailRows();
  var materialsRows    = _readMaterialsRows();
  var exclusionsRows   = _readExclusionsRows();
  var clfnSuppliedRows = _readClfnSuppliedRows();

  return {
    id:                      id,
    sow_unit_id:             _rfqSowUnitId || '',
    sow_project_number:      _rfqSowPn || '',
    status:                  _rfqCurrentId ? ((window._rfqCache||{})[_rfqCurrentId] || {}).status || 'draft' : 'draft',
    closes_at:               fv('rfq_closes_at') || null,
    recipient_contractor_ids: Object.keys(_rfqSelectedCts),
    awarded_contractor_id:   fv('rfq_awarded_to')   || null,
    award_amount:            fn('rfq_award_amount'),
    award_notes:             fv('rfq_award_notes')   || null,
    data: {
      contact_person:         fv('rfq_contact'),
      contact_email:          fv('rfq_contact_email'),
      submission_method:      fv('rfq_sub_method'),
      issue_date:             fv('rfq_issue_date') || new Date().toISOString().slice(0,10),
      target_start_date:      fv('rfq_target_start'),
      target_completion_date: fv('rfq_target_end'),
      scope_snapshot:         snap,
      sig_name:               fv('rfq_sig_name'),
      sig_title:              fv('rfq_sig_title'),
      sig_data:               (typeof getSigDataURL === 'function') ? getSigDataURL('rfq_sig') : '',
      // Contract details
      contract_number:              fv('rfq_contract_number'),
      contract_date:                fv('rfq_contract_date'),
      contract_start:               fv('rfq_contract_start'),
      substantial_completion_date:  fv('rfq_substantial_completion'),
      total_completion_date:        fv('rfq_total_completion'),
      ap_email:                     fv('rfq_ap_email'),
      site_lead_name:               fv('rfq_site_lead_name'),
      site_lead_phone:              fv('rfq_site_lead_phone'),
      ct_signatory_name:            fv('rfq_ct_signatory_name'),
      ct_signatory_title:           fv('rfq_ct_signatory_title'),
      // Scope detail
      attached_doc_paths: _rfqAttachedPaths.slice(),
      sow_summary:        fv('rfq_sow_summary'),
      scope_detail_rows:  scopeDetailRows,
      materials_rows:     materialsRows,
      exclusions_rows:    exclusionsRows,
      clfn_supplied_rows: clfnSuppliedRows,
      // Price breakdown
      price_materials: fv('rfq_price_materials'),
      price_labour:    fv('rfq_price_labour'),
      price_equipment: fv('rfq_price_equipment'),
      price_other:     fv('rfq_price_other'),
      price_tax:       fv('rfq_price_tax'),
      labour_hours:    fv('rfq_labour_hours'),
      // Milestones
      milestones:        milestones,
      holdback_release:  fv('rfq_holdback_release'),
      // Contractor signature
      ct_sig_data:    (typeof getSigDataURL === 'function') ? getSigDataURL('rfq_ct_sig')      : '',
      ct_sig_date:    fv('rfq_ct_sig_date'),
      ct_initial_data:(typeof getSigDataURL === 'function') ? getSigDataURL('rfq_ct_initial')  : '',
      witness_date:   fv('rfq_witness_date')
    },
    created_by: (window.HOUSING_SESSION && window.HOUSING_SESSION.email) || '',
    updated_at: new Date().toISOString()
  };
}

// ── Save draft ────────────────────────────────────────────────────────────────
async function saveRfqDraft() {
  var payload = _buildRfqPayload();
  if (!payload.sow_unit_id) { showToast('No SOW linked to this RFQ'); return; }
  try {
    var r = await fetch(SUPABASE_URL + '/rest/v1/housing_rfq', {
      method: 'POST',
      headers: Object.assign({}, HOUSING_HEADERS, {'Prefer':'resolution=merge-duplicates,return=minimal'}),
      body: JSON.stringify(payload)
    });
    if (!r.ok) throw new Error(await r.text());
    window._rfqCache[payload.id] = payload;
    _rfqCurrentId = payload.id;
    if (typeof auditEntry === 'function') auditEntry('RFQ:' + payload.id, 'created', 'RFQ draft saved', window.currentRole || 'staff');
    showToast('Draft saved — ' + payload.id);
  } catch(e) { console.error('[rfq] save failed:', e); showToast('Save failed — see console'); }
}

// ── Preview PDF ───────────────────────────────────────────────────────────────
function previewRfqPdf() {
  var payload = _buildRfqPayload();
  if (typeof buildRfqDocumentHtml !== 'function') { showToast('Document builder not available'); return; }
  var sow = _rfqSowData;
  var unit = _rfqUnitData;
  var html = buildRfqDocumentHtml(payload, sow, unit);
  if (typeof showPrintPanel === 'function') showPrintPanel(html, payload.id);
  else {
    var w = window.open('','_blank');
    if (w) { w.document.write(html); w.document.close(); }
  }
}

// ── Issue RFQ ─────────────────────────────────────────────────────────────────
async function issueRfq() {
  var payload = _buildRfqPayload();
  // Validate
  if (!payload.sow_unit_id)                         { showToast('No SOW linked'); return; }
  if (!payload.closes_at)                           { showToast('Bid closing date is required'); return; }
  if (new Date(payload.closes_at) <= new Date())    { showToast('Closing date must be in the future'); return; }
  if (!payload.data.scope_snapshot.length)          { showToast('Add at least one scope item'); return; }
  if (!payload.recipient_contractor_ids.length)     { showToast('Select at least one recipient'); return; }

  var n = payload.recipient_contractor_ids.length;
  var confirmed = await showConfirm({
    title: 'Issue RFQ ' + payload.id + '?',
    message: 'This will email the RFQ package to ' + n + ' contractor' + (n===1?'':'s') + ' immediately and cannot be unsent.',
    confirmText: 'Issue RFQ',
    danger: false
  });
  if (!confirmed) return;

  showToast('Issuing RFQ to ' + n + ' contractor' + (n===1?'':'s') + '...');
  payload.status    = 'issued';
  payload.issued_at = new Date().toISOString();

  try {
    var r = await fetch(SUPABASE_URL + '/rest/v1/housing_rfq', {
      method: 'POST',
      headers: Object.assign({}, HOUSING_HEADERS, {'Prefer':'resolution=merge-duplicates,return=minimal'}),
      body: JSON.stringify(payload)
    });
    if (!r.ok) throw new Error(await r.text());
    window._rfqCache[payload.id] = payload;
    _rfqCurrentId = payload.id;
    if (typeof auditEntry === 'function') auditEntry('RFQ:' + payload.id, 'issued', 'RFQ issued to ' + n + ' contractors', window.currentRole || 'staff');

    // Send emails
    if (typeof sendRfqToRecipients === 'function') {
      var cts = (window._contractors || []).filter(function(ct){ return ct && payload.recipient_contractor_ids.indexOf(ct.id) !== -1; });
      await sendRfqToRecipients(payload, cts);
    }
    document.getElementById('rfqIssueBtn').disabled = true;
  } catch(e) { console.error('[rfq] issue failed:', e); showToast('Issue failed — see console'); }
}

// ── Cancel RFQ ────────────────────────────────────────────────────────────────
async function cancelRfq(rfqId) {
  var confirmed = await showConfirm({ title: 'Cancel ' + rfqId + '?', message: 'This marks the RFQ as cancelled. It cannot be re-issued.', confirmText: 'Cancel RFQ', danger: true });
  if (!confirmed) return;
  try {
    var r = await fetch(SUPABASE_URL + '/rest/v1/housing_rfq?id=eq.' + encodeURIComponent(rfqId), {
      method: 'PATCH', headers: Object.assign({}, HOUSING_HEADERS, {'Prefer':'return=minimal'}),
      body: JSON.stringify({ status: 'cancelled', updated_at: new Date().toISOString() })
    });
    if (!r.ok) throw new Error(await r.text());
    if (window._rfqCache && window._rfqCache[rfqId]) window._rfqCache[rfqId].status = 'cancelled';
    if (typeof auditEntry === 'function') auditEntry('RFQ:' + rfqId, 'cancelled', 'RFQ cancelled', window.currentRole || 'staff');
    showToast(rfqId + ' cancelled');
    renderRfqList();
  } catch(e) { console.error('[rfq] cancel failed:', e); showToast('Cancel failed'); }
}

// ── Award modal ───────────────────────────────────────────────────────────────
function showAwardModal(rfqId) {
  _rfqAwardingId = rfqId;
  var rfq = (window._rfqCache || {})[rfqId];
  if (!rfq) return;
  var cts = (rfq.recipient_contractor_ids || []).map(function(id){
    return (window._contractors || []).find(function(c){ return c && c.id === id; });
  }).filter(Boolean);

  var opts = cts.map(function(ct){
    return '<option value="' + escapeHtml(ct.id) + '">' + escapeHtml(ct.name) + '</option>';
  }).join('');

  document.getElementById('rfqAwardBody').innerHTML =
      '<div class="f" style="margin-bottom:12px;"><label>Winning Contractor</label>'
    + '<select id="award_ct_id" class="stg-lookup-input"><option value="">-- Select --</option>' + opts + '</select></div>'
    + '<div class="f" style="margin-bottom:12px;"><label>Award Amount ($)</label>'
    + '<input type="number" id="award_amount" class="stg-lookup-input" placeholder="0.00" min="0" step="0.01"/></div>'
    + '<div class="f"><label>Notes (optional)</label>'
    + '<textarea id="award_notes" class="stg-lookup-input" rows="2" placeholder="Any notes for the award decision..."></textarea></div>';

  var modal = document.getElementById('rfqAwardModal');
  modal.style.display = 'flex';
}

function closeAwardModal() {
  document.getElementById('rfqAwardModal').style.display = 'none';
  _rfqAwardingId = null;
}

async function confirmAward() {
  var ctId   = document.getElementById('award_ct_id').value;
  var amount = document.getElementById('award_amount').value;
  var notes  = document.getElementById('award_notes').value.trim();
  if (!ctId)   { showToast('Select a contractor'); return; }
  if (!amount) { showToast('Enter the award amount'); return; }
  closeAwardModal();
  if (typeof awardRfq === 'function') {
    var ok = await awardRfq(_rfqAwardingId, ctId, amount, notes);
    if (ok) renderRfqList();
  }
}

// ── Contract number generation ────────────────────────────────────────────
function generateContractNumber() {
  var year   = new Date().getFullYear();
  var prefix = 'CON-' + year + '-';
  var maxSeq = 0;
  Object.keys(window._rfqCache || {}).forEach(function(id) {
    var rfq = (window._rfqCache || {})[id];
    var cn  = rfq && rfq.data && rfq.data.contract_number;
    if (cn && String(cn).indexOf(prefix) === 0) {
      var seq = parseInt(String(cn).slice(prefix.length), 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  });
  return prefix + String(maxSeq + 1).padStart(4, '0');
}

// ── Scope detail dynamic rows ─────────────────────────────────────────────
function renderScopeDetailRows() {
  var el = document.getElementById('rfq_scope_detail_rows');
  if (!el) return;
  if (!_rfqScopeDetailRows.length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:10px 0;font-style:italic;">No items — click "+ Add Item" or link this RFQ to a SOW with scope items.</div>';
    return;
  }
  el.innerHTML = '<div style="overflow-x:auto;">'
    + '<table class="std-table" style="width:100%;table-layout:fixed;">'
    + '<thead><tr>'
    + '<th style="width:22%;">Category</th>'
    + '<th style="width:38%;">Description</th>'
    + '<th style="width:32%;">Notes / Specs</th>'
    + '<th style="width:8%;"></th>'
    + '</tr></thead><tbody>'
    + _rfqScopeDetailRows.map(function(row, i) {
        return '<tr>'
          + '<td style="padding:4px 6px;"><input type="text" id="rfq_sdr_cat_' + i + '" value="' + escapeHtml(row.category || '') + '" class="stg-lookup-input" style="padding:4px 6px;font-size:12px;" placeholder="Category"/></td>'
          + '<td style="padding:4px 6px;"><input type="text" id="rfq_sdr_desc_' + i + '" value="' + escapeHtml(row.description || '') + '" class="stg-lookup-input" style="padding:4px 6px;font-size:12px;" placeholder="Description"/></td>'
          + '<td style="padding:4px 6px;"><input type="text" id="rfq_sdr_notes_' + i + '" value="' + escapeHtml(row.notes || '') + '" class="stg-lookup-input" style="padding:4px 6px;font-size:12px;" placeholder="Specs, notes, amount"/></td>'
          + '<td style="padding:4px 6px;text-align:center;"><button type="button" onclick="removeScopeDetailRow(' + i + ')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:18px;line-height:1;" title="Remove">&times;</button></td>'
          + '</tr>';
      }).join('')
    + '</tbody></table></div>';
}

function addScopeDetailRow(row) {
  _readScopeDetailRows();
  _rfqScopeDetailRows.push(row || { category: '', description: '', notes: '' });
  renderScopeDetailRows();
}

function removeScopeDetailRow(i) {
  _readScopeDetailRows();
  _rfqScopeDetailRows.splice(i, 1);
  renderScopeDetailRows();
}

function _readScopeDetailRows() {
  var rows = [];
  var i = 0;
  while (document.getElementById('rfq_sdr_cat_' + i)) {
    rows.push({
      category:    (document.getElementById('rfq_sdr_cat_'   + i) || {}).value || '',
      description: (document.getElementById('rfq_sdr_desc_'  + i) || {}).value || '',
      notes:       (document.getElementById('rfq_sdr_notes_' + i) || {}).value || ''
    });
    i++;
  }
  _rfqScopeDetailRows = rows;
  return rows;
}

// ── Materials & Specifications dynamic rows ───────────────────────────────
function renderMaterialsRows() {
  var el = document.getElementById('rfq_materials_rows');
  if (!el) return;
  if (!_rfqMaterialsRows.length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:8px 0;font-style:italic;">No items — click "+ Add Material".</div>';
    return;
  }
  el.innerHTML = '<div style="overflow-x:auto;"><table class="std-table" style="width:100%;table-layout:fixed;">'
    + '<thead><tr><th style="width:30%;">Material / Product</th><th style="width:38%;">Specification / Standard</th><th style="width:24%;">Notes</th><th style="width:8%;"></th></tr></thead><tbody>'
    + _rfqMaterialsRows.map(function(r, i) {
        return '<tr>'
          + '<td style="padding:4px 6px;"><input type="text" id="rfq_mat_material_'+i+'" value="'+escapeHtml(r.material||'')+'" class="stg-lookup-input" style="padding:4px 6px;font-size:12px;" placeholder="e.g. IKO Cambridge shingles"/></td>'
          + '<td style="padding:4px 6px;"><input type="text" id="rfq_mat_spec_'+i+'" value="'+escapeHtml(r.specification||'')+'" class="stg-lookup-input" style="padding:4px 6px;font-size:12px;" placeholder="e.g. ASTM D3462, 30-year"/></td>'
          + '<td style="padding:4px 6px;"><input type="text" id="rfq_mat_notes_'+i+'" value="'+escapeHtml(r.notes||'')+'" class="stg-lookup-input" style="padding:4px 6px;font-size:12px;" placeholder="Optional"/></td>'
          + '<td style="padding:4px 6px;text-align:center;"><button type="button" onclick="removeMaterialsRow('+i+')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:18px;line-height:1;" title="Remove">&times;</button></td>'
          + '</tr>';
      }).join('')
    + '</tbody></table></div>';
}
function addMaterialsRow() { _readMaterialsRows(); _rfqMaterialsRows.push({material:'',specification:'',notes:''}); renderMaterialsRows(); }
function removeMaterialsRow(i) { _readMaterialsRows(); _rfqMaterialsRows.splice(i,1); renderMaterialsRows(); }
function _readMaterialsRows() {
  var rows = []; var i = 0;
  while (document.getElementById('rfq_mat_material_'+i)) {
    rows.push({ material:(document.getElementById('rfq_mat_material_'+i)||{}).value||'', specification:(document.getElementById('rfq_mat_spec_'+i)||{}).value||'', notes:(document.getElementById('rfq_mat_notes_'+i)||{}).value||'' });
    i++;
  }
  _rfqMaterialsRows = rows; return rows;
}

// ── Exclusions & Assumptions dynamic rows ────────────────────────────────
function renderExclusionsRows() {
  var el = document.getElementById('rfq_exclusions_rows');
  if (!el) return;
  if (!_rfqExclusionsRows.length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:8px 0;font-style:italic;">No exclusions — click "+ Add Exclusion".</div>';
    return;
  }
  el.innerHTML = '<div style="overflow-x:auto;"><table class="std-table" style="width:100%;table-layout:fixed;">'
    + '<thead><tr><th>Exclusion / Assumption</th><th style="width:8%;"></th></tr></thead><tbody>'
    + _rfqExclusionsRows.map(function(r, i) {
        return '<tr>'
          + '<td style="padding:4px 6px;"><input type="text" id="rfq_excl_text_'+i+'" value="'+escapeHtml(r.text||'')+'" class="stg-lookup-input" style="padding:4px 6px;font-size:12px;" placeholder="e.g. Disposal of hazardous materials is excluded"/></td>'
          + '<td style="padding:4px 6px;text-align:center;"><button type="button" onclick="removeExclusionRow('+i+')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:18px;line-height:1;" title="Remove">&times;</button></td>'
          + '</tr>';
      }).join('')
    + '</tbody></table></div>';
}
function addExclusionRow() { _readExclusionsRows(); _rfqExclusionsRows.push({text:''}); renderExclusionsRows(); }
function removeExclusionRow(i) { _readExclusionsRows(); _rfqExclusionsRows.splice(i,1); renderExclusionsRows(); }
function _readExclusionsRows() {
  var rows = []; var i = 0;
  while (document.getElementById('rfq_excl_text_'+i)) {
    rows.push({ text:(document.getElementById('rfq_excl_text_'+i)||{}).value||'' });
    i++;
  }
  _rfqExclusionsRows = rows; return rows;
}

// ── Items Supplied by Nation dynamic rows ─────────────────────────────────
function renderClfnSuppliedRows() {
  var el = document.getElementById('rfq_clfn_supplied_rows');
  if (!el) return;
  if (!_rfqClfnSuppliedRows.length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:8px 0;font-style:italic;">No items — click "+ Add Item" or leave empty if none.</div>';
    return;
  }
  el.innerHTML = '<div style="overflow-x:auto;"><table class="std-table" style="width:100%;table-layout:fixed;">'
    + '<thead><tr><th>Item Supplied by Nation</th><th style="width:8%;"></th></tr></thead><tbody>'
    + _rfqClfnSuppliedRows.map(function(r, i) {
        return '<tr>'
          + '<td style="padding:4px 6px;"><input type="text" id="rfq_clfn_item_'+i+'" value="'+escapeHtml(r.item||'')+'" class="stg-lookup-input" style="padding:4px 6px;font-size:12px;" placeholder="e.g. Paint, hardware, fixtures"/></td>'
          + '<td style="padding:4px 6px;text-align:center;"><button type="button" onclick="removeClfnSuppliedRow('+i+')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:18px;line-height:1;" title="Remove">&times;</button></td>'
          + '</tr>';
      }).join('')
    + '</tbody></table></div>';
}
function addClfnSuppliedRow() { _readClfnSuppliedRows(); _rfqClfnSuppliedRows.push({item:''}); renderClfnSuppliedRows(); }
function removeClfnSuppliedRow(i) { _readClfnSuppliedRows(); _rfqClfnSuppliedRows.splice(i,1); renderClfnSuppliedRows(); }
function _readClfnSuppliedRows() {
  var rows = []; var i = 0;
  while (document.getElementById('rfq_clfn_item_'+i)) {
    rows.push({ item:(document.getElementById('rfq_clfn_item_'+i)||{}).value||'' });
    i++;
  }
  _rfqClfnSuppliedRows = rows; return rows;
}

// ── Milestone dynamic rows ────────────────────────────────────────────────
function renderMilestoneRows() {
  var el = document.getElementById('rfq_milestone_rows');
  if (!el) return;
  if (!_rfqMilestoneRows.length) {
    el.innerHTML = '<div style="font-size:11px;color:var(--muted);padding:10px 0;font-style:italic;">No milestones — click "+ Add Milestone" to add payment milestones.</div>';
    return;
  }
  el.innerHTML = '<div style="overflow-x:auto;">'
    + '<table class="std-table" style="min-width:520px;">'
    + '<thead><tr>'
    + '<th style="width:28%;">Milestone</th>'
    + '<th style="width:10%;">%</th>'
    + '<th style="width:18%;">Gross ($)</th>'
    + '<th style="width:18%;">Holdback ($)</th>'
    + '<th style="width:18%;">Net</th>'
    + '<th style="width:8%;"></th>'
    + '</tr></thead><tbody>'
    + _rfqMilestoneRows.map(function(m, i) {
        return '<tr>'
          + '<td style="padding:4px 6px;"><input type="text"   id="rfq_mr_name_' + i + '"     value="' + escapeHtml(m.name    || '') + '" class="stg-lookup-input" style="padding:4px 6px;font-size:12px;" placeholder="e.g. Mobilization"/></td>'
          + '<td style="padding:4px 6px;"><input type="number" id="rfq_mr_pct_' + i + '"      value="' + escapeHtml(m.pct     || '') + '" class="stg-lookup-input" style="padding:4px 6px;font-size:12px;" placeholder="%" min="0" max="100" step="0.1" oninput="_rfqCalcMilestoneRow(' + i + ')"/></td>'
          + '<td style="padding:4px 6px;"><input type="number" id="rfq_mr_gross_' + i + '"    value="' + escapeHtml(m.gross   || '') + '" class="stg-lookup-input" style="padding:4px 6px;font-size:12px;" placeholder="0.00" min="0" step="0.01" oninput="_rfqCalcMilestoneRow(' + i + ')"/></td>'
          + '<td style="padding:4px 6px;"><input type="number" id="rfq_mr_holdback_' + i + '" value="' + escapeHtml(m.holdback|| '') + '" class="stg-lookup-input" style="padding:4px 6px;font-size:12px;" placeholder="0.00" min="0" step="0.01" oninput="_rfqCalcMilestoneRow(' + i + ')"/></td>'
          + '<td style="padding:4px 6px;"><input type="text"   id="rfq_mr_net_' + i + '"      value="' + escapeHtml(m.net     || '') + '" class="stg-lookup-input" style="padding:4px 6px;font-size:12px;background:var(--bg);color:var(--muted);" readonly/></td>'
          + '<td style="padding:4px 6px;text-align:center;"><button type="button" onclick="removeMilestoneRow(' + i + ')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:18px;line-height:1;" title="Remove">&times;</button></td>'
          + '</tr>';
      }).join('')
    + '</tbody></table></div>';
}

function addMilestoneRow() {
  _readMilestoneRows();
  _rfqMilestoneRows.push({ name: '', pct: '', gross: '', holdback: '', net: '' });
  renderMilestoneRows();
}

function removeMilestoneRow(i) {
  _readMilestoneRows();
  _rfqMilestoneRows.splice(i, 1);
  renderMilestoneRows();
}

function _rfqCalcMilestoneRow(i) {
  var gross    = parseFloat((document.getElementById('rfq_mr_gross_'    + i) || {}).value) || 0;
  var holdback = parseFloat((document.getElementById('rfq_mr_holdback_' + i) || {}).value) || 0;
  var net = gross - holdback;
  var netEl = document.getElementById('rfq_mr_net_' + i);
  if (netEl) netEl.value = net >= 0 ? '$' + net.toLocaleString('en-CA', {minimumFractionDigits:2, maximumFractionDigits:2}) : '';
  if (_rfqMilestoneRows[i]) {
    _rfqMilestoneRows[i].gross    = String((document.getElementById('rfq_mr_gross_'    + i) || {}).value || '');
    _rfqMilestoneRows[i].holdback = String((document.getElementById('rfq_mr_holdback_' + i) || {}).value || '');
    _rfqMilestoneRows[i].net      = netEl ? netEl.value : '';
  }
}

function _readMilestoneRows() {
  var rows = [];
  var i = 0;
  while (document.getElementById('rfq_mr_name_' + i)) {
    rows.push({
      name:     (document.getElementById('rfq_mr_name_'     + i) || {}).value || '',
      pct:      (document.getElementById('rfq_mr_pct_'      + i) || {}).value || '',
      gross:    (document.getElementById('rfq_mr_gross_'    + i) || {}).value || '',
      holdback: (document.getElementById('rfq_mr_holdback_' + i) || {}).value || '',
      net:      (document.getElementById('rfq_mr_net_'      + i) || {}).value || ''
    });
    i++;
  }
  _rfqMilestoneRows = rows;
  return rows;
}

// ── Auto-fill contractor details when awarded-to changes ──────────────────
function _rfqAutoFillContractor() {
  var sel = document.getElementById('rfq_awarded_to');
  if (!sel || !sel.value) return;
  var ct = (window._contractors || []).find(function(c){ return c && c.id === sel.value; });
  if (!ct) return;
  function setIfBlank(id, val) {
    var el = document.getElementById(id);
    if (el && !el.value.trim() && val) el.value = val;
  }
  // Pre-fill contractor signatory + site lead from contractor record if blank
  setIfBlank('rfq_ct_signatory_name',  ct.sigCt && ct.sigCt.name  ? ct.sigCt.name  : ct.name  || '');
  setIfBlank('rfq_ct_signatory_title', ct.sigCt && ct.sigCt.title ? ct.sigCt.title : '');
}

// ── Price auto-calculation (tax always $0 for First Nations) ─────────────
function _rfqRecalcPrices() {
  function fnum(id) { return parseFloat((document.getElementById(id) || {}).value) || 0; }
  function setRO(id, val) {
    var el = document.getElementById(id);
    if (el) el.value = '$' + (val || 0).toLocaleString('en-CA', {minimumFractionDigits:2, maximumFractionDigits:2});
  }
  var sub = fnum('rfq_price_materials') + fnum('rfq_price_labour') + fnum('rfq_price_equipment') + fnum('rfq_price_other');
  setRO('rfq_price_subtotal',      sub);
  setRO('rfq_price_total_incl_tax',sub); // tax = 0
}

// ── Documents tab ─────────────────────────────────────────────────────────

function renderDocumentsTab() {
  var rfqId = _rfqCurrentId || document.getElementById('rfq_number').value.trim();
  if (!rfqId) {
    var m = document.getElementById('rfq_doc_lib_mount');
    if (m) m.innerHTML = '<div class="rfq-progress-msg">Save the RFQ draft first to enable document uploads.</div>';
    return;
  }

  // Mount the standard DocLibrary (drag-and-drop, preview, delete)
  var mount = document.getElementById('rfq_doc_lib_mount');
  if (mount && window.DocLibrary) {
    mount.innerHTML = '';
    _rfqDocLib = window.DocLibrary.create(mount, {
      entityType:    'rfq',
      entityId:      rfqId,
      pathPrefix:    'tenants/' + (_rfqSowUnitId || rfqId),
      supabaseUrl:   SUPABASE_URL,
      supabaseAnon:  SUPABASE_ANON,
      storageBucket: STORAGE_BUCKET,
      getAuthToken:  function(){ return (window.HOUSING_HEADERS && window.HOUSING_HEADERS['Authorization'] || '').replace('Bearer ',''); },
      auditTable:    'housing_audit_log',
      getActor:      function(){ return (window.HOUSING_SESSION && window.HOUSING_SESSION.email) || window.currentRole || 'staff'; },
      categories: [
        { key:'site_plan', label:'Site Plan',       icon:'📍' },
        { key:'report',    label:'Report / Study',  icon:'📋' },
        { key:'spec',      label:'Specification',   icon:'📄' },
        { key:'photo',     label:'Photo',           icon:'📷' },
        { key:'other',     label:'Other',           icon:'📎' }
      ],
      maxSizeMB: 25
    });
  } else if (mount) {
    mount.innerHTML = '<div class="rfq-progress-msg">Document library not available.</div>';
  }

  // Render the email-attachment selection list
  _rfqRefreshAttachList();
}

async function _rfqRefreshAttachList() {
  var el = document.getElementById('rfq_doc_attach_section');
  if (!el) return;
  var rfqId = _rfqCurrentId || document.getElementById('rfq_number').value.trim();
  if (!rfqId) { el.innerHTML = ''; return; }

  el.innerHTML = '<div style="border-top:1px solid var(--border);padding-top:14px;">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
    +   '<div style="font-size:12px;font-weight:600;color:var(--text);">&#128231; Attach to contractor email</div>'
    +   '<button type="button" class="btn btn-ghost" style="font-size:11px;padding:4px 10px;" onclick="_rfqRefreshAttachList()">&#8635; Refresh</button>'
    + '</div>'
    + '<div id="rfq_doc_attach_list"><div style="font-size:11px;color:var(--muted);font-style:italic;">Loading&hellip;</div></div>'
    + '<div style="margin-top:8px;font-size:10px;color:var(--muted);">Checked files will be attached to each contractor email when you issue the RFQ. Max 3 MB per file (Graph API limit). Larger files should be shared via link instead.</div>'
    + '</div>';

  try {
    _rfqDocFiles = (typeof sbLoadFileMeta === 'function') ? await sbLoadFileMeta('rfq', rfqId) : [];
  } catch(e) { _rfqDocFiles = []; }

  var listEl = document.getElementById('rfq_doc_attach_list');
  if (!listEl) return;

  if (!_rfqDocFiles.length) {
    listEl.innerHTML = '<div style="font-size:11px;color:var(--muted);font-style:italic;">No files yet — upload using the document library above, then click Refresh.</div>';
    return;
  }

  listEl.innerHTML = _rfqDocFiles.map(function(f) {
    var isAttached = _rfqAttachedPaths.indexOf(f.path) !== -1;
    var dispName   = f.name || f.path.split('/').pop().replace(/^\d+_/, '');
    var sizeKb     = f.size ? Math.round(f.size / 1024) + ' KB' : '';
    var tooBig     = f.size && f.size > 3 * 1024 * 1024;
    var safePath   = escapeHtml(f.path).replace(/'/g, "\\'");
    return '<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--bg);border-radius:7px;margin-bottom:6px;cursor:' + (tooBig ? 'default' : 'pointer') + ';border:1px solid var(--border);">'
      +   '<input type="checkbox" '
      +     (isAttached ? 'checked ' : '')
      +     (tooBig ? 'disabled ' : '')
      +     'onchange="_rfqToggleAttach(\'' + safePath + '\', this.checked)" '
      +     'style="width:15px;height:15px;accent-color:var(--yellow);flex-shrink:0;cursor:' + (tooBig ? 'default' : 'pointer') + ';"/>'
      +   '<div style="min-width:0;flex:1;">'
      +     '<div style="font-size:12px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(dispName) + '</div>'
      +     '<div style="font-size:10px;color:var(--muted);margin-top:1px;">'
      +       escapeHtml(sizeKb)
      +       (tooBig ? ' &mdash; <span style="color:var(--danger,#dc2626);">&#9888; exceeds 3 MB &mdash; cannot attach to email</span>' : '')
      +     '</div>'
      +   '</div>'
      + '</label>';
  }).join('');
}

function _rfqToggleAttach(path, checked) {
  _rfqAttachedPaths = _rfqAttachedPaths.filter(function(p){ return p !== path; });
  if (checked) _rfqAttachedPaths.push(path);
}

// ── Generate Contractor Agreement PDF ────────────────────────────────────
// Renders the contract body from notifications.js CONTRACTS_DOCS_REGISTRY
// via jsPDF text primitives. getContractBody() always returns a non-empty
// body (registry default when no saved override), so no AcroForm fallback.
async function generateContractorContract() {
  if (typeof showToast === 'function') showToast('Generating contract PDF…');

  // Build data directly from current form state — don't depend on saveRfqDraft
  // completing successfully or _rfqCache being up to date. Save is fire-and-forget.
  var currentPayload = _buildRfqPayload();
  var d = currentPayload.data || {};
  if (typeof saveRfqDraft === 'function') saveRfqDraft().catch(function(e){ console.warn('[contract] background save failed:', e); });

  var rfqId = _rfqCurrentId || document.getElementById('rfq_number').value.trim();
  var rfq   = (window._rfqCache || {})[rfqId] || {};

  function fv(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }

  // Resolve awarded contractor
  var ctId = fv('rfq_awarded_to') || rfq.awarded_contractor_id;
  var ct   = (window._contractors || []).find(function(c){ return c && c.id === ctId; }) || {};

  // Resolve unit address
  var unit = (window.housingUnits || []).find(function(u){ return u && u.id === _rfqSowUnitId; }) || {};
  var addr = (unit.num || '') + ' ' + (unit.street || '');
  addr = addr.trim() || _rfqSowUnitId || '';

  // Price totals
  function numFmt(v) { return v ? '$' + Number(v).toLocaleString('en-CA', {minimumFractionDigits:2, maximumFractionDigits:2}) : ''; }
  var pMat  = parseFloat(d.price_materials || 0);
  var pLab  = parseFloat(d.price_labour    || 0);
  var pEqp  = parseFloat(d.price_equipment || 0);
  var pOth  = parseFloat(d.price_other     || 0);
  var pSub  = pMat + pLab + pEqp + pOth;
  var pTot  = pSub; // First Nations — tax always $0

  var tokens = {
    rfqNumber:               rfqId,
    contractNumber:          d.contract_number          || '',
    contractDate:            d.contract_date            || '',
    propertyAddress:         addr,
    projectType:             (_rfqSowData && (_rfqSowData.condition || _rfqSowData.type)) || '',
    sowReference:            _rfqSowPn || rfq.sow_project_number || '',
    quoteNumber:             rfqId,
    startDate:               d.contract_start           || d.target_start_date       || '',
    substantialCompletionDate: d.substantial_completion_date || '',
    totalCompletionDate:     d.total_completion_date    || d.target_completion_date  || '',
    contractorLegalName:     ct.name    || '',
    contractorOperatingName: ct.name    || '',
    contractorAddressLine1:  ct.address || '',
    contractorAddressLine2:  '',
    contractorGstHst:        ct.hst     || '',
    contractorWsib:          ct.wsibNum || '',
    contractorPhone:         ct.phone   || '',
    contractorSignatoryName: d.ct_signatory_name  || (ct.sigCt && ct.sigCt.name)  || ct.name || '',
    contractorSignatoryTitle:d.ct_signatory_title || (ct.sigCt && ct.sigCt.title) || '',
    contractorSignatoryEmail:ct.email   || '',
    contractorSiteLead:      d.site_lead_name  || '',
    contractorSiteLeadPhone: d.site_lead_phone || '',
    contractPrice:           numFmt(rfq.award_amount),
    contractPriceExclTax:    d.contract_price_excl_tax ? numFmt(d.contract_price_excl_tax) : numFmt(pSub),
    apEmail:                 d.ap_email || '',
    nationName:              (window.NATION_CONFIG && NATION_CONFIG.display_name) || 'Housing Authority',
    nationShort:             (window.NATION_CONFIG && NATION_CONFIG.short) || '',
    clfnSignatoryName:       d.sig_name  || '',
    clfnSignatoryTitle:      d.sig_title || '',
    sowSummary:              d.sow_summary     || '',
    sowDetailTable:          (d.scope_detail_rows || []).filter(function(r){ return r.category || r.description; }).map(function(r, i){ return (i+1) + '. ' + [r.category, r.description, r.notes].filter(Boolean).join(' — '); }).join('\n') || '',
    materialsSpecifications: (d.materials_rows    || []).filter(function(r){ return r.material || r.specification; }).map(function(r, i){ return (i+1) + '. ' + [r.material, r.specification, r.notes].filter(Boolean).join(' — '); }).join('\n') || '',
    exclusionsAssumptions:   (d.exclusions_rows   || []).filter(function(r){ return r.text; }).map(function(r, i){ return (i+1) + '. ' + r.text; }).join('\n') || '',
    clfnSuppliedItems:       (d.clfn_supplied_rows|| []).filter(function(r){ return r.item; }).map(function(r, i){ return (i+1) + '. ' + r.item; }).join('\n') || 'None',
    priceMaterials:          numFmt(pMat),
    priceLabour:             numFmt(pLab),
    priceEquipment:          numFmt(pEqp),
    priceOther:              numFmt(pOth),
    priceSubtotal:           numFmt(pSub),
    priceTax:                '$0.00',
    priceTotalInclTax:       numFmt(pTot),
    labourHours:             d.labour_hours    || '',
    holdbackRelease:         numFmt(d.holdback_release)
  };

  var filename = (tokens.nationShort || 'Housing') + '_Contract_' + rfqId + '.pdf';

  // ── jsPDF path ─────────────────────────────────────────────────────────
  var savedBody = (typeof getContractBody === 'function') ? getContractBody('contractor_agreement') : '';
  if (!savedBody || !savedBody.trim()) {
    if (typeof showToast === 'function') showToast('Contract body not found — check Settings → Contracts');
    return;
  }
  try {
      if (typeof _loadJsPdf === 'function') await _loadJsPdf();
      var logoDataUrl = (typeof _fetchLogoForPdf === 'function') ? await _fetchLogoForPdf() : null;
      var ctx = _makePdfDoc({
        nationName:     tokens.nationName,
        headerTitle:    'Contractor Agreement',
        headerSubtitle: [tokens.contractNumber, tokens.rfqNumber ? 'RFQ: ' + tokens.rfqNumber : ''].filter(Boolean).join('  |  '),
        logoDataUrl:    logoDataUrl
      });
      var pdf = ctx.pdf;

      var substituted = (typeof _substitutePlaceholders === 'function')
        ? _substitutePlaceholders(savedBody, tokens) : savedBody;
      if (typeof _parseHtmlToBlocks === 'function' && typeof _renderBlocksToPdf === 'function') {
        _renderBlocksToPdf(ctx, _parseHtmlToBlocks(substituted));
      }

      // Signatures section
      ctx.needSpace(50); ctx.gap(8);
      ctx.sectionHeader('Signatures');

      function _addSigBlock(label, sigId, nameVal) {
        ctx.needSpace(24);
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(60);
        pdf.text(label, ctx.marginL, ctx.y + 3); ctx.y += 6;
        var sigData = (typeof getSigDataURL === 'function') ? getSigDataURL(sigId) : '';
        if (sigData && sigData.indexOf('data:image/png;base64,') === 0) {
          try { pdf.addImage(sigData, 'PNG', ctx.marginL, ctx.y, 50, 12); } catch(e) {}
          ctx.y += 14;
        } else if (sigData && sigData.indexOf('typed:') === 0) {
          pdf.setFont('helvetica', 'italic'); pdf.setFontSize(14); pdf.setTextColor(20);
          pdf.text(sigData.replace('typed:',''), ctx.marginL, ctx.y + 4); ctx.y += 8;
        } else if (sigData && sigData.indexOf('wet:') === 0) {
          pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(80);
          var ref = sigData.replace('wet:','');
          pdf.text(ref === 'pending' ? 'Wet signature on file' : 'E-sign: '+ref, ctx.marginL, ctx.y + 4); ctx.y += 8;
        } else {
          pdf.setDrawColor(160); pdf.setLineWidth(0.4);
          pdf.line(ctx.marginL, ctx.y + 8, ctx.marginL + 70, ctx.y + 8); ctx.y += 11;
        }
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(80);
        if (nameVal) { pdf.text(nameVal, ctx.marginL, ctx.y + 3); ctx.y += 5; }
        pdf.setTextColor(0);
        ctx.y += 3;
      }

      _addSigBlock('Owner Representative', 'rfq_sig',         tokens.clfnSignatoryName + (tokens.clfnSignatoryTitle ? ', ' + tokens.clfnSignatoryTitle : ''));
      _addSigBlock('Contractor',           'rfq_ct_sig',       tokens.contractorSignatoryName + (tokens.contractorSignatoryTitle ? ', ' + tokens.contractorSignatoryTitle : ''));

      var base64 = ctx.finish();
      var binStr = atob(base64);
      var arr = new Uint8Array(binStr.length);
      for (var bi = 0; bi < binStr.length; bi++) arr[bi] = binStr.charCodeAt(bi);
      var blob = new Blob([arr], {type:'application/pdf'});

      // Download
      var dlUrl = URL.createObjectURL(blob);
      var dlLink = document.createElement('a');
      dlLink.href = dlUrl; dlLink.download = filename; dlLink.click();
      setTimeout(function(){ URL.revokeObjectURL(dlUrl); }, 3000);

      // Upload to unit document library so it appears on the inventory unit card
      if (_rfqSowUnitId && typeof window.sbUploadFile === 'function') {
        try {
          var storePath = 'tenants/' + _rfqSowUnitId + '/' + Date.now() + '_' + filename;
          await window.sbUploadFile(storePath, blob);
          if (typeof window.sbSaveFileMeta === 'function') {
            await window.sbSaveFileMeta('tenant', String(_rfqSowUnitId), storePath, filename, blob.size, 'application/pdf');
          }
        } catch(e) { console.warn('[contract] document library upload failed:', e); }
      }

      if (typeof showToast === 'function') showToast('Contract PDF saved — also added to unit documents');
  } catch(e) {
    console.error('[contract] generation failed:', e);
    if (typeof showToast === 'function') showToast('Contract PDF failed: ' + e.message);
  }
}

