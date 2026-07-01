'use strict';

var _rfqCurrentId       = null;
var _rfqSowUnitId       = null;
var _rfqSowPn           = null;
var _rfqSowData         = null;
var _rfqUnitData        = null;
var _rfqScopeItems      = [];
var _rfqSelectedCts     = {};
var _rfqBids            = {};   // staff-entered bids: { [contractorId]: {amount, notes, received_at} }
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

  // RFQ module gate — sub-pages don't run the login hydration, so apply saved
  // module overrides now and bounce back to the dashboard if RFQ is turned off.
  if (typeof initModuleEnablement === 'function') initModuleEnablement();
  if (window.CLFN_MODULES && !window.CLFN_MODULES.isEnabled('rfq')) {
    if (typeof showToast === 'function') showToast('The RFQ module is turned off for your nation.');
    window.location.href = 'housing.html';
    return;
  }

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

    // Show building name for commercial/admin/band buildings
    var _bldgTypes = ['admin_building','band_building','commercial_building'];
    var _isBldg    = _bldgTypes.indexOf(unit.type || '') >= 0;
    var _bldgNameEl  = document.getElementById('rfq_building_name_display');
    var _bldgNameRow = document.getElementById('rfq_building_name_row');
    if (_bldgNameEl)  _bldgNameEl.value = (_isBldg && unit.buildingName) ? unit.buildingName : '';
    if (_bldgNameRow) _bldgNameRow.style.display = (_isBldg && unit.buildingName) ? '' : 'none';

    // Pre-populate scope items if not already set
    if (!_rfqScopeItems.length && sow) {
      var items = sow.items || sow.lineItems || [];
      _rfqScopeItems = items.map(function(it){ return Object.assign({}, it, {_hidden:false}); });
    }

    // Prefill the Scope Summary paragraph from the SOW work items for a NEW RFQ
    // (blank until now, so staff re-typed it). Never touch a saved RFQ or a
    // value the user already entered.
    if (!_rfqCurrentId) {
      var sumEl = document.getElementById('rfq_sow_summary');
      if (sumEl && !(sumEl.value || '').trim()) {
        var _lines = (sow.items || sow.lineItems || []).map(function(it){
          return ((it.category ? it.category + ': ' : '') + (it.description || '')).trim();
        }).filter(Boolean);
        if (_lines.length) {
          sumEl.value = 'Requested scope of work at ' + addr + ':\n- ' + _lines.join('\n- ');
        }
      }
    }
  } catch(e) {
    console.warn('[rfq] SOW fetch failed:', e);
  }
}

// ── Edit permission ──────────────────────────────────────────────────────────
// Only the Housing Manager and Executive Director may edit an RFQ. Everyone
// else sees the full record read-only (all info visible, nothing editable).
function _rfqCanEdit() {
  var r = (window.CLFN_PERMS && CLFN_PERMS.normalizeRole)
        ? CLFN_PERMS.normalizeRole(window.currentRole)
        : (window.currentRole || '');
  return r === 'ed' || r === 'housing_manager';
}

// Lock or unlock the whole RFQ form based on _rfqCanEdit(). Disables every
// input/select/textarea and every button except navigation (tabs, Back to
// List, Preview PDF). Restores state cleanly when an editor opens it. Safe to
// call repeatedly (after each dynamic re-render / tab switch).
function _rfqApplyReadOnly() {
  var ro = !_rfqCanEdit();
  window._rfqReadOnly = ro;
  var form = document.getElementById('rfqFormView');
  if (!form) return;
  form.classList.toggle('rfq-readonly', ro);

  form.querySelectorAll('input, select, textarea').forEach(function(c) {
    if (ro) {
      if (!c.hasAttribute('data-ro-was')) c.setAttribute('data-ro-was', c.disabled ? '1' : '0');
      c.disabled = true;
    } else if (c.hasAttribute('data-ro-was')) {
      if (c.getAttribute('data-ro-was') === '0') c.disabled = false;
      c.removeAttribute('data-ro-was');
    }
  });

  form.querySelectorAll('button').forEach(function(b) {
    if (b.closest('.pill-tabs') || b.closest('.tab-bar') || b.hasAttribute('data-rfq-keep')) return;
    if (ro) {
      if (!b.hasAttribute('data-ro-was')) b.setAttribute('data-ro-was', b.disabled ? '1' : '0');
      b.disabled = true;
    } else if (b.hasAttribute('data-ro-was')) {
      if (b.getAttribute('data-ro-was') === '0') b.disabled = false;
      b.removeAttribute('data-ro-was');
    }
  });

  // Banner
  var banner = document.getElementById('rfqReadOnlyBanner');
  if (ro && !banner) {
    banner = document.createElement('div');
    banner.id = 'rfqReadOnlyBanner';
    banner.innerHTML = '🔒 View only — only the Housing Manager or Executive Director can edit this RFQ.';
    form.insertBefore(banner, form.firstChild);
  } else if (!ro && banner) {
    banner.remove();
  }
}

function showRfqForm(rfqId, unitId, sowPn) {
  document.getElementById('rfqListView').style.display  = 'none';
  document.getElementById('rfqFormView').style.display  = '';
  switchRfqTab('details');

  _rfqCurrentId            = rfqId || null;
  _rfqSelectedCts          = {};
  _rfqBids                 = {};
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
    _rfqBids = (rfq.data && rfq.data.bids) ? JSON.parse(JSON.stringify(rfq.data.bids)) : {};
    _populateFormFields(rfq);
    document.getElementById('rfqFormHeading').textContent = rfqId;
    document.getElementById('rfqIssueBtn').disabled = rfq.status !== 'draft';
    var _unlockBtn = document.getElementById('rfqUnlockBtn');
    if (_unlockBtn) {
      var _isEd = (window.currentRole === 'ed');
      _unlockBtn.style.display = (_isEd && rfq.status === 'issued') ? '' : 'none';
    }
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
    var _unlockBtnNew = document.getElementById('rfqUnlockBtn');
    if (_unlockBtnNew) _unlockBtnNew.style.display = 'none';
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
    _rfqApplyReadOnly();
  }, 80);
  _rfqApplyReadOnly();
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
  set('rfq_award_amount', rfq.award_amount ? _rfqFmtMoney(rfq.award_amount) : '');
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
  set('rfq_ct_quote_number',       d.ct_quote_number       || '');

  // Scope detail
  set('rfq_sow_summary',     d.sow_summary     || '');
  // (sow_detail textarea removed — work items now use dynamic scope detail rows)
  // (materials/exclusions/clfn_supplied now use dynamic rows — loaded above)

  // Price breakdown — stored as numbers; display formatted as $###,###.00.
  function setMoney(id, v){ var el=document.getElementById(id); if(el) el.value = (v===''||v==null) ? '' : _rfqFmtMoney(_rfqParseNum(v)); }
  setMoney('rfq_price_materials',      d.price_materials);
  setMoney('rfq_price_labour',         d.price_labour);
  setMoney('rfq_price_equipment',      d.price_equipment);
  setMoney('rfq_price_subcontractors', d.price_subcontractors);
  setMoney('rfq_price_other',          d.price_other);
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
  setMoney('rfq_holdback_release', d.holdback_release);  // recomputed by _rfqRecalcPrices on tab open
  set('rfq_holdback_days', (d.holdback_days != null && d.holdback_days !== '') ? d.holdback_days : '60');  // default 60-day lien period

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
  if (tab === 'recipients') { renderContractorCards(); renderBidsSection(); }
  if (tab === 'documents')  renderDocumentsTab();
  if (tab === 'contracting') {
    // Render dynamic row tables now that the container elements are visible
    renderScopeDetailRows();
    renderMaterialsRows();
    renderExclusionsRows();
    renderClfnSuppliedRows();
    renderMilestoneRows();
    _rfqRecalcPrices();   // compute subtotal/total/holdback + refresh milestones from the loaded prices
    _rfqRenderAwardedContractorInfo();   // show the awarded contractor's on-file details
    _rfqUpdateHoldbackReleaseDate();     // compute the holdback release date from substantial completion
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
  // Re-apply read-only after any tab render re-creates fields/buttons.
  _rfqApplyReadOnly();
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
  renderBidsSection();
  updateRecipientBadge();
}

// ── Bids Received (staff-entered tendering) ────────────────────────────────
function renderBidsSection() {
  var mount = document.getElementById('rfqBidsMount');
  if (!mount) return;
  var ids = Object.keys(_rfqSelectedCts);
  if (!ids.length) {
    mount.innerHTML = '<div class="rfq-progress-msg">Select contractors above to record their bids.</div>';
    return;
  }
  var rows = ids.map(function(id){
    var ct  = (window._contractors || []).find(function(c){ return c && c.id === id; }) || { id:id, name:id };
    var bid = _rfqBids[id] || {};
    return { id:id, ct:ct, amount:(bid.amount != null ? bid.amount : ''), notes:bid.notes||'', received:bid.received_at||'', docPath:bid.doc_path||'', docName:bid.doc_name||'' };
  });
  var lowest = null;
  rows.forEach(function(r){ var a = parseFloat(r.amount); if (!isNaN(a) && a > 0 && (lowest === null || a < lowest)) lowest = a; });
  rows.sort(function(a,b){
    var av = parseFloat(a.amount), bv = parseFloat(b.amount);
    var ah = !isNaN(av) && av > 0, bh = !isNaN(bv) && bv > 0;
    if (ah && bh) return av - bv;
    if (ah) return -1; if (bh) return 1;
    return (a.ct.name||'').localeCompare(b.ct.name||'');
  });
  var html = '<table class="rfq-scope-table"><thead><tr>'
    + '<th>Contractor</th><th style="width:135px;">Bid Amount ($)</th><th>Notes</th><th style="width:130px;">Received</th><th style="width:170px;">Quote File</th><th style="width:96px;"></th>'
    + '</tr></thead><tbody>';
  rows.forEach(function(r){
    var av = parseFloat(r.amount); var isLow = !isNaN(av) && av > 0 && lowest !== null && av === lowest;
    var idEsc = escapeHtml(r.id);
    var amtDisp = (r.amount === '' || r.amount == null || isNaN(av)) ? '' : _rfqFmtMoney(av);
    var fileCell = r.docPath
      ? '<a href="#" onclick="_rfqViewBidFile(\'' + idEsc + '\');return false;" title="View attached quote" style="font-size:12px;color:var(--info-blue,#1d4ed8);text-decoration:none;">&#128206; ' + escapeHtml(r.docName || 'Quote') + '</a>'
        + ' <button type="button" onclick="_rfqRemoveBidFile(\'' + idEsc + '\')" title="Remove file" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:12px;padding:0 2px;">&times;</button>'
      : '<label ondragover="event.preventDefault();this.style.borderColor=\'var(--yellow)\';" ondragleave="this.style.borderColor=\'var(--border)\';" ondrop="_rfqDropBidFile(event,\'' + idEsc + '\')" title="Drop a file here or click to choose" style="display:inline-flex;align-items:center;gap:5px;padding:5px 9px;border:1px dashed var(--border);border-radius:6px;font-size:11px;color:var(--muted);cursor:pointer;max-width:158px;">'
        + '<input type="file" onchange="_rfqAttachBidFile(\'' + idEsc + '\', this)" style="display:none;"/>'
        + '<span>&#128206; Drop or choose</span></label>';
    html += '<tr' + (isLow ? ' style="background:var(--success-bg,#f0fdf4);"' : '') + '>'
      + '<td style="padding:6px 10px;font-size:12px;font-weight:600;">' + escapeHtml(r.ct.name||r.id)
      +   (isLow ? ' <span style="font-size:10px;color:#15803d;font-weight:700;">LOWEST</span>' : '') + '</td>'
      + '<td style="padding:4px 8px;"><input type="text" inputmode="decimal" value="' + escapeHtml(amtDisp) + '" onfocus="_rfqCurrencyFocus(this)" oninput="_rfqSetBidAmount(\'' + idEsc + '\',this.value)" onblur="_rfqCurrencyBlur(this)" onchange="renderBidsSection()" class="stg-lookup-input" style="width:118px;" placeholder="$0.00"/></td>'
      + '<td style="padding:4px 8px;"><input type="text" value="' + escapeHtml(r.notes) + '" oninput="_rfqSetBid(\'' + idEsc + '\',\'notes\',this.value)" class="stg-lookup-input" placeholder="Optional"/></td>'
      + '<td style="padding:4px 8px;"><input type="date" value="' + escapeHtml(r.received) + '" oninput="_rfqSetBid(\'' + idEsc + '\',\'received_at\',this.value)" class="stg-lookup-input"/></td>'
      + '<td style="padding:4px 8px;">' + fileCell + '</td>'
      + '<td style="padding:4px 8px;"><button type="button" class="btn btn-primary btn-sm" onclick="_rfqAwardFromBid(\'' + idEsc + '\')"' + ((isNaN(av)||av<=0) ? ' disabled style="opacity:.5;"' : '') + '>Award &rarr;</button></td>'
      + '</tr>';
  });
  html += '</tbody></table>';
  mount.innerHTML = html;
}

function _rfqSetBid(id, field, val) {
  if (!_rfqBids[id]) _rfqBids[id] = {};
  _rfqBids[id][field] = val;
}

// Store the bid amount as a clean number (empty stays empty) so sort/award/PDF
// logic keeps working; the cell displays it formatted as $###,###.00.
function _rfqSetBidAmount(id, raw) {
  var clean = String(raw || '').replace(/[$,\s]/g, '');
  _rfqSetBid(id, 'amount', clean === '' ? '' : (parseFloat(clean) || 0));
}

// Drag-and-drop onto a bid row's file dropzone.
function _rfqDropBidFile(e, id) {
  e.preventDefault();
  if (e.currentTarget) e.currentTarget.style.borderColor = 'var(--border)';
  var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  _rfqAttachBidFile(id, { files: [file], value: '' });   // reuse the upload path
}

// ── Bid quote-file attach (stored on rfq.data.bids[id].doc_path) ────────────
async function _rfqAttachBidFile(id, inputEl) {
  var file = inputEl && inputEl.files && inputEl.files[0];
  if (!file) return;
  if (typeof window.sbUploadFile !== 'function') { showToast('File upload is not available on this page'); return; }
  var rfqId = _rfqCurrentId || (document.getElementById('rfq_number') || {}).value || 'draft';
  var safe  = String(file.name).replace(/[^\w.\-]+/g, '_');
  var path  = 'rfq/' + rfqId + '/bids/' + id + '_' + safe;
  showToast('Uploading ' + file.name + '…');
  try {
    await window.sbUploadFile(path, file);
    if (!_rfqBids[id]) _rfqBids[id] = {};
    _rfqBids[id].doc_path = path;
    _rfqBids[id].doc_name = file.name;
    renderBidsSection();
    // Persist the reference so it survives a reload (only when the RFQ has a
    // linked SOW/unit — otherwise saveRfqDraft would toast "No SOW linked").
    if (_rfqSowUnitId && typeof saveRfqDraft === 'function') {
      try { await saveRfqDraft(); } catch(e) { console.warn('[rfq] post-attach save failed:', e); }
    }
    showToast('✓ Quote attached for ' + (( (window._contractors||[]).find(function(c){return c&&c.id===id;})||{}).name || 'contractor'));
  } catch(e) {
    console.warn('[rfq] bid file upload failed:', e);
    showToast('Upload failed — see console', { type: 'error' });
  }
  if (inputEl) inputEl.value = '';   // allow re-selecting the same file
}

function _rfqViewBidFile(id) {
  var bid = _rfqBids[id] || {};
  if (!bid.doc_path) return;
  if (typeof window.sbGetSignedUrl !== 'function') { showToast('Cannot open file'); return; }
  // Open the tab synchronously (before the await) so the browser doesn't block it.
  var w = window.open('', '_blank');
  window.sbGetSignedUrl(bid.doc_path).then(function(url) {
    if (w) w.location = url; else window.location = url;
  }).catch(function(e) {
    console.warn('[rfq] sign bid file failed:', e);
    if (w) w.close();
    showToast('Could not open the file', { type: 'error' });
  });
}

function _rfqRemoveBidFile(id) {
  if (!_rfqBids[id]) return;
  delete _rfqBids[id].doc_path;
  delete _rfqBids[id].doc_name;
  renderBidsSection();
  if (_rfqSowUnitId && typeof saveRfqDraft === 'function') { try { saveRfqDraft(); } catch(e) {} }
}

async function _rfqAwardFromBid(id) {
  var bid = _rfqBids[id] || {};
  var amt = parseFloat(bid.amount) || 0;
  if (!(amt > 0)) { showToast('Enter a bid amount first'); return; }
  if (!_rfqCurrentId) { showToast('Save and issue the RFQ before awarding'); return; }
  // Persist the recorded bids first so the award (and the regret emails to the
  // other bidders) see them in the cached RFQ record.
  if (typeof saveRfqDraft === 'function') { try { await saveRfqDraft(); } catch(e){ console.warn('[rfq] pre-award save failed:', e); } }
  showAwardModal(_rfqCurrentId, { contractorId:id, amount:amt, notes:bid.notes || '' });
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
    award_amount:            _rfqParseNum(fv('rfq_award_amount')) || null,
    award_notes:             fv('rfq_award_notes')   || null,
    data: {
      contact_person:         fv('rfq_contact'),
      contact_email:          fv('rfq_contact_email'),
      submission_method:      fv('rfq_sub_method'),
      issue_date:             fv('rfq_issue_date') || new Date().toISOString().slice(0,10),
      target_start_date:      fv('rfq_target_start'),
      target_completion_date: fv('rfq_target_end'),
      scope_snapshot:         snap,
      bids:                   _rfqBids,

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
      ct_quote_number:              fv('rfq_ct_quote_number'),
      // Scope detail
      attached_doc_paths: _rfqAttachedPaths.slice(),
      sow_summary:        fv('rfq_sow_summary'),
      scope_detail_rows:  scopeDetailRows,
      materials_rows:     materialsRows,
      exclusions_rows:    exclusionsRows,
      clfn_supplied_rows: clfnSuppliedRows,
      // Price breakdown — stored as clean numbers (formatting is display-only).
      price_materials:      _rfqParseNum(fv('rfq_price_materials')),
      price_labour:         _rfqParseNum(fv('rfq_price_labour')),
      price_equipment:      _rfqParseNum(fv('rfq_price_equipment')),
      price_subcontractors: _rfqParseNum(fv('rfq_price_subcontractors')),
      price_other:          _rfqParseNum(fv('rfq_price_other')),
      price_tax:       fv('rfq_price_tax'),
      labour_hours:    fv('rfq_labour_hours'),
      // Milestones
      milestones:          milestones,
      holdback_release:    _rfqParseNum(fv('rfq_holdback_release')),
      holdback_days:       fv('rfq_holdback_days'),
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
  if (!_rfqCanEdit()) { showToast('View only — only the Housing Manager or ED can edit this RFQ'); return; }
  var payload = _buildRfqPayload();
  if (!payload.sow_unit_id) { showToast('No SOW linked to this RFQ'); return; }
  try {
    if (!_rfqCurrentId) {
      // FIRST save of a new RFQ — collision-safe insert. RFQ numbers are
      // generated by scanning the in-memory cache, so two people creating an
      // RFQ at the same time can pick the same RFQ-YYYY-NNNN. The old
      // merge-duplicates upsert would then silently OVERWRITE the other RFQ.
      // Instead do a plain insert (errors on a duplicate id); on a 409 conflict
      // bump the number and retry so nothing is lost.
      var saved = false, lastErr = '', attempts = 0;
      while (!saved && attempts < 6) {
        attempts++;
        var ri = await fetch(SUPABASE_URL + '/rest/v1/housing_rfq', {
          method: 'POST',
          headers: Object.assign({}, HOUSING_HEADERS, {'Prefer':'return=minimal'}),
          body: JSON.stringify(payload)
        });
        if (ri.ok) { saved = true; break; }
        if (ri.status === 409) {
          var m = /^(.*-)(\d+)$/.exec(payload.id);
          if (m) {
            var numStr = String(parseInt(m[2], 10) + 1);
            while (numStr.length < m[2].length) numStr = '0' + numStr;
            payload.id = m[1] + numStr;
            var numEl = document.getElementById('rfq_number'); if (numEl) numEl.value = payload.id;
            continue;   // retry with the next number
          }
        }
        lastErr = await ri.text(); break;
      }
      if (!saved) throw new Error(lastErr || 'Could not claim a unique RFQ number');
    } else {
      // Re-save of an existing RFQ — upsert (update) on the known id.
      var ru = await fetch(SUPABASE_URL + '/rest/v1/housing_rfq', {
        method: 'POST',
        headers: Object.assign({}, HOUSING_HEADERS, {'Prefer':'resolution=merge-duplicates,return=minimal'}),
        body: JSON.stringify(payload)
      });
      if (!ru.ok) throw new Error(await ru.text());
    }
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
  if (!_rfqCanEdit()) { showToast('View only — only the Housing Manager or ED can edit this RFQ'); return; }
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

// ── Unlock RFQ (ED only) ───────────────────────────────────────────────────────
async function unlockRfq() {
  if (!_rfqCanEdit()) { showToast('View only — only the Housing Manager or ED can edit this RFQ'); return; }
  var rfqId = _rfqCurrentId;
  if (!rfqId) return;
  var confirmed = await showConfirm({
    title: 'Unlock ' + rfqId + '?',
    message: 'This returns the RFQ to draft status so it can be edited. Contractors who already received the issued RFQ should be notified separately.',
    confirmText: 'Unlock',
    danger: false
  });
  if (!confirmed) return;
  try {
    var r = await fetch(SUPABASE_URL + '/rest/v1/housing_rfq?id=eq.' + encodeURIComponent(rfqId), {
      method: 'PATCH',
      headers: Object.assign({}, HOUSING_HEADERS, { 'Content-Type': 'application/json', 'Prefer': 'return=representation' }),
      body: JSON.stringify({ status: 'draft', issued_at: null, updated_at: new Date().toISOString() })
    });
    if (!r.ok) { showToast('Failed to unlock RFQ'); return; }
    var rows = await r.json();
    if (rows && rows[0] && window._rfqCache) window._rfqCache[rfqId] = rows[0];
    if (typeof auditEntry === 'function') auditEntry('RFQ:' + rfqId, 'unlocked', 'RFQ returned to draft', window.currentRole || 'staff');
    showToast('RFQ unlocked — now in draft');
    showRfqForm(rfqId, null, null);
  } catch(e) {
    console.warn('[rfq] unlock failed:', e);
    showToast('Failed to unlock RFQ');
  }
}

// ── Cancel RFQ ────────────────────────────────────────────────────────────────
async function cancelRfq(rfqId) {
  if (!_rfqCanEdit()) { showToast('View only — only the Housing Manager or ED can edit this RFQ'); return; }
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
// prefill (optional): { contractorId, amount, notes } — used by "Award from bid".
function showAwardModal(rfqId, prefill) {
  _rfqAwardingId = rfqId;
  var rfq = (window._rfqCache || {})[rfqId];
  if (!rfq) return;
  var cts = (rfq.recipient_contractor_ids || []).map(function(id){
    return (window._contractors || []).find(function(c){ return c && c.id === id; });
  }).filter(Boolean);

  var bids = Object.assign({}, (rfq.data && rfq.data.bids) || {}, _rfqBids || {});
  var opts = cts.map(function(ct){
    var b = bids[ct.id]; var amt = b && parseFloat(b.amount);
    var suffix = (amt && amt > 0) ? '  (bid $' + amt.toLocaleString('en-CA', {minimumFractionDigits:2}) + ')' : '';
    return '<option value="' + escapeHtml(ct.id) + '">' + escapeHtml(ct.name) + suffix + '</option>';
  }).join('');

  document.getElementById('rfqAwardBody').innerHTML =
      '<div class="f" style="margin-bottom:12px;"><label>Winning Contractor</label>'
    + '<select id="award_ct_id" class="stg-lookup-input"><option value="">-- Select --</option>' + opts + '</select></div>'
    + '<div class="f" style="margin-bottom:12px;"><label>Award Amount ($)</label>'
    + '<input type="number" id="award_amount" class="stg-lookup-input" placeholder="0.00" min="0" step="0.01"/></div>'
    + '<div class="f"><label>Notes (optional)</label>'
    + '<textarea id="award_notes" class="stg-lookup-input" rows="2" placeholder="Any notes for the award decision..."></textarea></div>';

  if (prefill) {
    var sel = document.getElementById('award_ct_id'); if (sel && prefill.contractorId) sel.value = prefill.contractorId;
    var amt = document.getElementById('award_amount'); if (amt && prefill.amount != null) amt.value = prefill.amount;
    var nt  = document.getElementById('award_notes');  if (nt && prefill.notes) nt.value = prefill.notes;
  }

  var modal = document.getElementById('rfqAwardModal');
  modal.style.display = 'flex';
}

function closeAwardModal() {
  document.getElementById('rfqAwardModal').style.display = 'none';
  _rfqAwardingId = null;
}

// Returns a list of eligibility problems for awarding to this contractor
// (empty = good to go): not approved, or expired WSIB / insurance.
function _rfqContractorEligibility(ct) {
  if (!ct) return ['not found in the contractor registry'];
  var issues = [];
  if ((ct.status || '') !== 'approved') issues.push('not approved (status: ' + (ct.status || 'unknown').replace(/_/g,' ') + ')');
  var today = new Date().toISOString().slice(0,10);
  if (ct.wsibExpiry && ct.wsibExpiry < today) issues.push('WSIB expired ' + ct.wsibExpiry);
  if (ct.insExpiry  && ct.insExpiry  < today) issues.push('insurance expired ' + ct.insExpiry);
  return issues;
}

async function confirmAward() {
  if (!_rfqCanEdit()) { showToast('View only — only the Housing Manager or ED can edit this RFQ'); return; }
  var ctId   = document.getElementById('award_ct_id').value;
  var amount = document.getElementById('award_amount').value;
  var notes  = document.getElementById('award_notes').value.trim();
  if (!ctId)   { showToast('Select a contractor'); return; }
  if (!amount) { showToast('Enter the award amount'); return; }
  // Capture the RFQ id BEFORE closeAwardModal() clears _rfqAwardingId — otherwise
  // awardRfq() was being handed null.
  var rfqId = _rfqAwardingId;
  var ct    = (window._contractors || []).find(function(c){ return c && c.id === ctId; });

  // Eligibility warning (not a hard block — ED can override): flag awarding to
  // an un-approved contractor or one with expired WSIB / insurance.
  var _elig = _rfqContractorEligibility(ct);
  if (_elig.length && typeof showConfirm === 'function') {
    var _go = await showConfirm({
      title:       'Contractor eligibility',
      message:     ((ct && ct.name) || 'This contractor') + ' is ' + _elig.join('; ') + '. Award anyway?',
      confirmText: 'Award anyway', cancelText: 'Cancel'
    });
    if (!_go) return;   // leave the award modal open so they can pick another
  }
  closeAwardModal();
  if (typeof awardRfq !== 'function') return;
  var ok = await awardRfq(rfqId, ctId, amount, notes);
  if (!ok) return;

  // Hand off straight into the contract instead of stranding the user on the
  // list and making them re-open + re-key everything.
  var amtLabel = '$' + (parseFloat(amount) || 0).toLocaleString('en-CA', {minimumFractionDigits:2});
  var proceed  = (typeof showConfirm === 'function')
    ? await showConfirm({
        title:       'Awarded',
        message:     ((ct && ct.name) || 'Contractor') + ' awarded ' + amtLabel + '. Set up the contract now?',
        confirmText: 'Set up contract →', cancelText: 'Later'
      })
    : false;
  if (proceed) {
    showRfqForm(rfqId);
    switchRfqTab('contracting');
    _rfqSeedContractFromAward(rfqId);
  } else {
    renderRfqList();
  }
}

// Manual award (no notifications) — for tenders run manually/offline where the
// app is used only for contracting. Records the awarded contractor + amount from
// the Scope Award card, marks the linked SOW approved, and jumps to Contracting
// WITHOUT issuing the RFQ or emailing anyone.
async function _rfqManualAward() {
  if (!_rfqCanEdit()) { showToast('View only — only the Housing Manager or ED can edit this RFQ'); return; }
  var ctId = (document.getElementById('rfq_awarded_to') || {}).value || '';
  var amt  = _rfqParseNum((document.getElementById('rfq_award_amount') || {}).value);
  if (!ctId)       { showToast('Select the awarded contractor above (Awarded To)'); return; }
  if (!(amt > 0))  { showToast('Enter the award amount'); return; }
  // The award patches the cached RFQ record, so make sure it exists first.
  if (typeof saveRfqDraft === 'function') { try { await saveRfqDraft(); } catch(e){ console.warn('[rfq] manual-award pre-save failed:', e); } }
  if (!_rfqCurrentId) { showToast('Save the RFQ first'); return; }
  var ct   = (window._contractors || []).find(function(c){ return c && c.id === ctId; });
  var elig = (typeof _rfqContractorEligibility === 'function') ? _rfqContractorEligibility(ct) : [];
  var msg  = ((ct && ct.name) || 'This contractor') + ' will be recorded as the awarded contractor for '
           + _rfqFmtMoney(amt) + '. <strong>No emails will be sent</strong>, and the linked SOW will be marked approved.'
           + (elig.length ? '<br><br>Note: ' + escapeHtml((ct && ct.name) || 'the contractor') + ' is ' + escapeHtml(elig.join('; ')) + '.' : '');
  if (typeof showConfirm === 'function') {
    var go = await showConfirm({ title: 'Record award (no notifications)?', message: msg, confirmText: 'Record award', cancelText: 'Cancel' });
    if (!go) return;
  }
  var notes = (document.getElementById('rfq_award_notes') || {}).value || '';
  var ok = (typeof awardRfq === 'function') ? await awardRfq(_rfqCurrentId, ctId, amt, notes, { skipNotify: true }) : false;
  if (ok) {
    showRfqForm(_rfqCurrentId);
    switchRfqTab('contracting');
    _rfqSeedContractFromAward(_rfqCurrentId);
  }
}

// Prefill the Contracting tab from the award so the contractor + price aren't
// re-entered: select the awarded contractor (fills signatory), and seed the
// contract price from the award amount when the breakdown is still empty (so
// the on-screen Contract Price matches what the PDF prints).
function _rfqSeedContractFromAward(rfqId) {
  var rfq = (window._rfqCache || {})[rfqId];
  if (!rfq) return;
  var awEl = document.getElementById('rfq_awarded_to');
  if (awEl && rfq.awarded_contractor_id) awEl.value = rfq.awarded_contractor_id;
  if (typeof _rfqAutoFillContractor === 'function') _rfqAutoFillContractor();

  var amt = parseFloat(rfq.award_amount) || 0;
  if (amt) {
    var ids = ['rfq_price_materials','rfq_price_labour','rfq_price_equipment','rfq_price_subcontractors','rfq_price_other'];
    var anyFilled = ids.some(function(id){ var el = document.getElementById(id); return el && _rfqParseNum(el.value) > 0; });
    var other = document.getElementById('rfq_price_other');
    if (!anyFilled && other) {
      other.value = _rfqFmtMoney(amt);   // agreed lump sum; staff can redistribute into materials/labour
      if (typeof _rfqRecalcPrices === 'function') _rfqRecalcPrices();
    }
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
    _rfqCheckMilestoneTotal();
    return;
  }
  var mfmt = function(v){ return (v === '' || v == null) ? '' : _rfqFmtMoney(_rfqParseNum(v)); };
  el.innerHTML = '<div style="overflow-x:auto;">'
    + '<table class="std-table" style="min-width:560px;">'
    + '<thead><tr>'
    + '<th style="width:26%;">Milestone</th>'
    + '<th style="width:10%;">%</th>'
    + '<th style="width:18%;">Gross ($)</th>'
    + '<th style="width:18%;">Holdback ($)</th>'
    + '<th style="width:18%;">Net</th>'
    + '<th style="width:8%;"></th>'
    + '</tr></thead><tbody>'
    + _rfqMilestoneRows.map(function(m, i) {
        return '<tr>'
          + '<td style="padding:4px 6px;"><input type="text"   id="rfq_mr_name_' + i + '"     value="' + escapeHtml(m.name    || '') + '" class="stg-lookup-input" style="padding:4px 6px;font-size:12px;" placeholder="e.g. Mobilization"/></td>'
          + '<td style="padding:4px 6px;"><input type="number" id="rfq_mr_pct_' + i + '"      value="' + escapeHtml(m.pct     || '') + '" class="stg-lookup-input" style="padding:4px 6px;font-size:12px;" placeholder="%" min="0" max="100" step="0.1" oninput="_rfqCalcMilestoneRow(' + i + ',\'pct\')"/></td>'
          + '<td style="padding:4px 6px;"><input type="text"   inputmode="decimal" id="rfq_mr_gross_' + i + '" value="' + escapeHtml(mfmt(m.gross)) + '" class="stg-lookup-input" style="padding:4px 6px;font-size:12px;" placeholder="$0.00" onfocus="_rfqCurrencyFocus(this)" oninput="_rfqCalcMilestoneRow(' + i + ',\'gross\')" onblur="_rfqCurrencyBlur(this)"/></td>'
          + '<td style="padding:4px 6px;"><input type="text"   id="rfq_mr_holdback_' + i + '" value="' + escapeHtml(mfmt(m.holdback)) + '" class="stg-lookup-input" style="padding:4px 6px;font-size:12px;background:var(--bg);color:var(--muted);" readonly title="10% of gross"/></td>'
          + '<td style="padding:4px 6px;"><input type="text"   id="rfq_mr_net_' + i + '"      value="' + escapeHtml(mfmt(m.net)) + '" class="stg-lookup-input" style="padding:4px 6px;font-size:12px;background:var(--bg);color:var(--muted);" readonly/></td>'
          + '<td style="padding:4px 6px;text-align:center;"><button type="button" onclick="removeMilestoneRow(' + i + ')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:18px;line-height:1;" title="Remove">&times;</button></td>'
          + '</tr>';
      }).join('')
    + '</tbody></table></div>';
  _rfqCheckMilestoneTotal();
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

// Recompute one milestone row. source = 'pct' (gross = pct% of contract price)
// or 'gross' (pct = gross / contract price). Holdback auto = 10% of gross.
function _rfqCalcMilestoneRow(i, source) {
  var total   = _rfqContractTotal();
  var pctEl   = document.getElementById('rfq_mr_pct_' + i);
  var grossEl = document.getElementById('rfq_mr_gross_' + i);
  var hbEl    = document.getElementById('rfq_mr_holdback_' + i);
  var netEl   = document.getElementById('rfq_mr_net_' + i);
  if (!pctEl || !grossEl) return;
  var pct   = _rfqParseNum(pctEl.value);
  var gross = _rfqParseNum(grossEl.value);
  if (source === 'pct' && total > 0) {
    gross = total * pct / 100;
    grossEl.value = _rfqFmtMoney(gross);
  } else if (source === 'gross' && total > 0) {
    pct = gross / total * 100;
    pctEl.value = String(Math.round(pct * 100) / 100);
  }
  var holdback = gross * 0.10;                 // 10% holdback
  if (hbEl)  hbEl.value  = _rfqFmtMoney(holdback);
  var net = gross - holdback;
  if (netEl) netEl.value = _rfqFmtMoney(net >= 0 ? net : 0);
  if (_rfqMilestoneRows[i]) {
    _rfqMilestoneRows[i].pct      = pctEl.value;
    _rfqMilestoneRows[i].gross    = String(gross || '');
    _rfqMilestoneRows[i].holdback = String(holdback || '');
    _rfqMilestoneRows[i].net      = String(net >= 0 ? net : 0);
  }
  _rfqCheckMilestoneTotal();
}

// When the contract price changes, re-derive each milestone's gross from its %.
function _rfqRefreshMilestonesFromTotal() {
  var total = _rfqContractTotal();
  var i = 0;
  while (document.getElementById('rfq_mr_pct_' + i)) {
    var pctEl = document.getElementById('rfq_mr_pct_' + i);
    var pct   = _rfqParseNum(pctEl.value);
    if (pct > 0 && total > 0) {
      var grossEl = document.getElementById('rfq_mr_gross_' + i);
      var hbEl    = document.getElementById('rfq_mr_holdback_' + i);
      var netEl   = document.getElementById('rfq_mr_net_' + i);
      var gross   = total * pct / 100;
      var hb      = gross * 0.10;
      if (grossEl) grossEl.value = _rfqFmtMoney(gross);
      if (hbEl)    hbEl.value    = _rfqFmtMoney(hb);
      if (netEl)   netEl.value   = _rfqFmtMoney(gross - hb);
      if (_rfqMilestoneRows[i]) {
        _rfqMilestoneRows[i].gross    = String(gross);
        _rfqMilestoneRows[i].holdback = String(hb);
        _rfqMilestoneRows[i].net      = String(gross - hb);
      }
    }
    i++;
  }
}

// Summary + guard: total of milestone gross cannot exceed the contract price.
function _rfqCheckMilestoneTotal() {
  var summ = document.getElementById('rfq_milestone_summary');
  if (!summ) return true;
  var total = _rfqContractTotal();
  var sumGross = 0, i = 0;
  while (document.getElementById('rfq_mr_gross_' + i)) { sumGross += _rfqParseNum(document.getElementById('rfq_mr_gross_' + i).value); i++; }
  if (i === 0) { summ.innerHTML = ''; return true; }
  var over = sumGross > total + 0.005;
  var pctOfTotal = total > 0 ? Math.round(sumGross / total * 1000) / 10 : 0;
  summ.innerHTML = 'Milestones total <strong>' + _rfqFmtMoney(sumGross) + '</strong> of contract price <strong>' + _rfqFmtMoney(total) + '</strong>'
    + (total > 0 ? ' (' + pctOfTotal + '%)' : '')
    + (over ? ' &mdash; <span style="color:var(--danger,#dc2626);font-weight:700;">exceeds the contract price</span>' : '');
  summ.style.color = over ? 'var(--danger,#dc2626)' : 'var(--muted)';
  return !over;
}

function _readMilestoneRows() {
  var rows = [];
  var i = 0;
  while (document.getElementById('rfq_mr_name_' + i)) {
    rows.push({
      name:     (document.getElementById('rfq_mr_name_' + i) || {}).value || '',
      pct:      (document.getElementById('rfq_mr_pct_'  + i) || {}).value || '',
      // Store clean numbers (strip $ , formatting) so the payload/PDF parse cleanly.
      gross:    String(_rfqParseNum((document.getElementById('rfq_mr_gross_'    + i) || {}).value) || ''),
      holdback: String(_rfqParseNum((document.getElementById('rfq_mr_holdback_' + i) || {}).value) || ''),
      net:      String(_rfqParseNum((document.getElementById('rfq_mr_net_'      + i) || {}).value) || '')
    });
    i++;
  }
  _rfqMilestoneRows = rows;
  return rows;
}

// ── Auto-fill contractor details when awarded-to changes ──────────────────
// When a contractor is picked in the Scope-tab Award card, prepopulate as much
// of the Contracting page as possible: signatory + site lead from the record,
// the read-only contractor-detail panel, and the contract amount into pricing.
function _rfqAutoFillContractor() {
  var sel = document.getElementById('rfq_awarded_to');
  var ct  = (sel && sel.value) ? (window._contractors || []).find(function(c){ return c && c.id === sel.value; }) : null;
  if (ct) {
    var setIfBlank = function(id, val){ var el = document.getElementById(id); if (el && !el.value.trim() && val) el.value = val; };
    setIfBlank('rfq_ct_signatory_name',  ct.sigCt && ct.sigCt.name  ? ct.sigCt.name  : ct.name  || '');
    setIfBlank('rfq_ct_signatory_title', ct.sigCt && ct.sigCt.title ? ct.sigCt.title : '');
    setIfBlank('rfq_site_lead_phone',    ct.phone || '');
  }
  _rfqRenderAwardedContractorInfo();
  _rfqSeedPriceFromAward();
}

// Seed the contract price from the Award Amount when the breakdown is still
// empty (agreed lump sum -> Other line; staff can redistribute). No-op once any
// price line has a value, so it never clobbers manual entry.
function _rfqSeedPriceFromAward() {
  var amt = _rfqParseNum((document.getElementById('rfq_award_amount') || {}).value);
  if (!(amt > 0)) return;
  var ids = ['rfq_price_materials','rfq_price_labour','rfq_price_equipment','rfq_price_subcontractors','rfq_price_other'];
  var anyFilled = ids.some(function(id){ var el = document.getElementById(id); return el && _rfqParseNum(el.value) > 0; });
  var other = document.getElementById('rfq_price_other');
  if (!anyFilled && other) {
    other.value = _rfqFmtMoney(amt);
    if (typeof _rfqRecalcPrices === 'function') _rfqRecalcPrices();
  }
}

// Holdback release timing: N days after Substantial Completion -> a date.
function _rfqAddDays(dateStr, days) {
  if (!dateStr) return '';
  var d = new Date(dateStr + 'T12:00:00');
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + (parseInt(days, 10) || 0));
  return d.toISOString().slice(0, 10);
}
function _rfqUpdateHoldbackReleaseDate() {
  var out = document.getElementById('rfq_holdback_release_date');
  if (!out) return;
  var sc   = (document.getElementById('rfq_substantial_completion') || {}).value || '';
  var days = (document.getElementById('rfq_holdback_days') || {}).value || '';
  if (sc && days !== '') {
    var rd = _rfqAddDays(sc, days);
    out.textContent = rd ? ('Est. release date: ' + rd) : '';
  } else if (!sc && days !== '') {
    out.textContent = 'Set a Substantial Completion Date to compute the release date.';
  } else {
    out.textContent = '';
  }
}

// Read-only summary of the awarded contractor's on-file details (the ones that
// print on the contract but have no form field), shown at the top of Contract
// Details so staff can verify before generating.
function _rfqRenderAwardedContractorInfo() {
  var box = document.getElementById('rfq_awarded_ct_info');
  if (!box) return;
  var sel = document.getElementById('rfq_awarded_to');
  var ct  = (sel && sel.value) ? (window._contractors || []).find(function(c){ return c && c.id === sel.value; }) : null;
  if (!ct) { box.style.display = 'none'; box.innerHTML = ''; return; }
  var today = new Date().toISOString().slice(0,10);
  var row = function(label, val){
    return val ? '<div style="display:flex;gap:8px;"><span style="min-width:96px;color:var(--muted);">' + label + '</span><span style="color:var(--text);">' + escapeHtml(String(val)) + '</span></div>' : '';
  };
  var expiring = function(num, exp){
    if (!num) return '';
    var s = String(num);
    if (exp) s += ' (exp ' + exp + (exp < today ? ' — EXPIRED' : '') + ')';
    return s;
  };
  var phone = ct.phone ? ((typeof formatPhone === 'function') ? formatPhone(ct.phone) : ct.phone) : '';
  box.style.display = '';
  box.innerHTML = '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:12px;line-height:1.7;margin-bottom:14px;">'
    + '<div style="font-weight:700;color:var(--text);margin-bottom:4px;">&#127981; Awarded Contractor</div>'
    + row('Name', ct.name)
    + row('Trade', ct.trade)
    + row('Address', ct.address)
    + row('Phone', phone)
    + row('Email', ct.email)
    + row('GST/HST #', ct.hst)
    + row('WSIB #', expiring(ct.wsibNum, ct.wsibExpiry))
    + row('Insurance', ct.insProvider ? (ct.insProvider + (ct.insExpiry ? ' (exp ' + ct.insExpiry + (ct.insExpiry < today ? ' — EXPIRED' : '') + ')' : '')) : '')
    + '</div>';
}

// ── Currency helpers ($###,###.00) ───────────────────────────────────────
function _rfqParseNum(v){ return parseFloat(String(v == null ? '' : v).replace(/[$,\s]/g, '')) || 0; }
function _rfqFmtMoney(n){ return '$' + (Number(n) || 0).toLocaleString('en-CA', {minimumFractionDigits:2, maximumFractionDigits:2}); }
// On focus, strip formatting so the field is easy to edit; on blur, re-format.
function _rfqCurrencyFocus(el){ if (el) el.value = String(el.value || '').replace(/[$,\s]/g, ''); }
function _rfqCurrencyBlur(el){ if (!el) return; var raw = String(el.value || '').replace(/[$,\s]/g, ''); el.value = (raw === '') ? '' : _rfqFmtMoney(parseFloat(raw) || 0); }

// Contract price = sum of the price-breakdown lines.
function _rfqContractTotal(){
  return _rfqParseNum((document.getElementById('rfq_price_materials')     || {}).value)
       + _rfqParseNum((document.getElementById('rfq_price_labour')        || {}).value)
       + _rfqParseNum((document.getElementById('rfq_price_equipment')     || {}).value)
       + _rfqParseNum((document.getElementById('rfq_price_subcontractors')|| {}).value)
       + _rfqParseNum((document.getElementById('rfq_price_other')         || {}).value);
}

// ── Price auto-calculation (tax always $0 for First Nations) ─────────────
function _rfqRecalcPrices() {
  function setRO(id, val) { var el = document.getElementById(id); if (el) el.value = _rfqFmtMoney(val || 0); }
  var sub = _rfqContractTotal();
  setRO('rfq_price_subtotal',       sub);
  setRO('rfq_price_total_incl_tax', sub);          // tax = 0
  setRO('rfq_holdback_release',     sub * 0.10);   // holdback release = 10% of contract price
  // Contract price changed -> refresh each milestone's gross/holdback/net from its %.
  _rfqRefreshMilestonesFromTotal();
  _rfqCheckMilestoneTotal();
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
      readOnly:      !_rfqCanEdit(),   // viewers see docs but can't upload/delete
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
        { key:'image',     label:'Image',           icon:'🖼️' },
        { key:'other',     label:'Other',           icon:'📎' }
      ],
      maxSizeMB: 25,
      onChange: function(action) {
        if (action === 'upload' || action === 'delete') _rfqRefreshAttachList();
      }
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

// ── Contract readiness gate ──────────────────────────────────────────────
// Don't produce a blank / half-signed contract. Mirrors the TIC lease gate:
// require an awarded contractor, a price, key dates, and both signatures.
function _rfqContractMissing() {
  var missing = [];
  var fv  = function(id){ var el=document.getElementById(id); return el ? (el.value||'').trim() : ''; };
  var sig = function(id){ return (typeof getSigDataURL==='function') ? getSigDataURL(id) : ''; };
  var rfqId = _rfqCurrentId || fv('rfq_number');
  var rfq   = (window._rfqCache || {})[rfqId] || {};
  if (!(fv('rfq_awarded_to') || rfq.awarded_contractor_id)) missing.push('Awarded contractor (select on the Contracting tab)');
  var priceOk = (parseFloat(rfq.award_amount)||0) > 0
    || ['rfq_price_materials','rfq_price_labour','rfq_price_equipment','rfq_price_subcontractors','rfq_price_other']
         .some(function(id){ return _rfqParseNum(fv(id)) > 0; });
  if (!priceOk) missing.push('Contract price (award amount or price breakdown)');
  if (!fv('rfq_contract_date')) missing.push('Contract date');
  if (!fv('rfq_total_completion') && !fv('rfq_target_end')) missing.push('Completion date');
  // Milestone gross total cannot exceed the contract price.
  var _total = _rfqContractTotal();
  var _sumG = 0, _mi = 0;
  while (document.getElementById('rfq_mr_gross_' + _mi)) { _sumG += _rfqParseNum(document.getElementById('rfq_mr_gross_' + _mi).value); _mi++; }
  if (_mi > 0 && _sumG > _total + 0.005) {
    missing.push('Milestone payments (' + _rfqFmtMoney(_sumG) + ') exceed the contract price (' + _rfqFmtMoney(_total) + ')');
  }
  return missing;
}
// Signatures are a SOFT check — contracts are often generated first, then
// signed on paper / re-generated. Returns which sig blocks are still blank.
function _rfqContractMissingSigs() {
  var sig = function(id){ return (typeof getSigDataURL==='function') ? getSigDataURL(id) : ''; };
  var out = [];
  if (!sig('rfq_sig'))         out.push('Owner / Nation representative signature');
  if (!sig('rfq_ct_sig'))      out.push('Contractor signature');
  if (!sig('rfq_ct_initial'))  out.push('Contractor acknowledgement initial');
  return out;
}
function _rfqShowChecklist(title, items) {
  var existing = document.getElementById('rfq_checklist_modal');
  if (existing) existing.remove();
  var rows = items.map(function(it){
    return '<div style="display:flex;align-items:flex-start;gap:9px;padding:8px 0;border-bottom:1px solid var(--border);">'
      + '<span style="color:var(--danger,#dc2626);font-size:14px;line-height:1.3;">&#9711;</span>'
      + '<span style="font-size:12.5px;color:var(--text);line-height:1.5;">' + escapeHtml(it) + '</span></div>';
  }).join('');
  var m = document.createElement('div');
  m.id = 'rfq_checklist_modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:11000;display:flex;align-items:center;justify-content:center;padding:16px;';
  m.innerHTML =
      '<div style="background:var(--surface);border-radius:12px;width:100%;max-width:440px;box-shadow:0 8px 40px rgba(0,0,0,.4);">'
    + '<div class="modal-hdr"><div><div class="lbl-yellow">&#9888;&#65039; ' + escapeHtml(title) + '</div>'
    +   '<div class="txt-sm-meta">Complete these before generating the contract:</div></div></div>'
    + '<div style="padding:14px 22px 4px;">' + rows + '</div>'
    + '<div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;">'
    +   '<button type="button" onclick="document.getElementById(\'rfq_checklist_modal\').remove()" class="btn btn-primary">Got it</button>'
    + '</div></div>';
  document.body.appendChild(m);
}

// ── Generate Contractor Agreement PDF ────────────────────────────────────
// Renders the contract body from notifications.js CONTRACTS_DOCS_REGISTRY
// via jsPDF text primitives. getContractBody() always returns a non-empty
// body (registry default when no saved override), so no AcroForm fallback.
async function generateContractorContract() {
  if (!_rfqCanEdit()) { showToast('View only — only the Housing Manager or ED can generate a contract'); return; }
  // Readiness gate — hard-block on missing contract essentials.
  var _missing = _rfqContractMissing();
  if (_missing.length) { _rfqShowChecklist('Not ready to generate', _missing); return; }
  // Signatures are soft — allow generating an unsigned copy to sign on paper.
  var _noSigs = _rfqContractMissingSigs();
  if (_noSigs.length && typeof showConfirm === 'function') {
    var _goSig = await showConfirm({
      title:       'Generate without signatures?',
      message:     'No signature captured for: ' + _noSigs.join(', ') + '. Generate the contract anyway (e.g. to sign on paper)? You can re-generate after signing.',
      confirmText: 'Generate anyway', cancelText: 'Cancel'
    });
    if (!_goSig) return;
  }

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
  var pSubc = parseFloat(d.price_subcontractors || 0);
  var pOth  = parseFloat(d.price_other     || 0);
  var pSub  = pMat + pLab + pEqp + pSubc + pOth;
  var pTot  = pSub; // First Nations — tax always $0

  var tokens = {
    rfqNumber:               rfqId,
    contractNumber:          d.contract_number          || '',
    contractDate:            d.contract_date            || '',
    propertyAddress:         addr,
    projectType:             (_rfqSowData && (_rfqSowData.condition || _rfqSowData.type)) || '',
    sowReference:            _rfqSowPn || rfq.sow_project_number || '',
    quoteNumber:             d.ct_quote_number || rfqId,
    contractorQuoteNumber:   d.ct_quote_number || '',
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
    priceSubcontractors:     numFmt(pSubc),
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
      // Defense against saved template overrides that still carry the old
      // Schedule B stub / Signatures block: cut the body at the first of those
      // headings so we don't duplicate the dynamic Schedule B + Signatures below.
      var _cut = substituted.search(/<h2>\s*(SCHEDULE B|SIGNATURES)/i);
      if (_cut >= 0) substituted = substituted.slice(0, _cut);
      if (typeof _parseHtmlToBlocks === 'function' && typeof _renderBlocksToPdf === 'function') {
        _renderBlocksToPdf(ctx, _parseHtmlToBlocks(substituted));
      }

      // Section heading that matches the body template's <h2> (12pt bold) so the
      // appended Schedule B / Signatures sections are consistent with the body
      // rather than the smaller uppercase sectionHeader style.
      function h2Heading(text) {
        ctx.needSpace(15); ctx.gap(2);
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); pdf.setTextColor(30);
        var hl = pdf.splitTextToSize(String(text), ctx.contentW);
        pdf.text(hl, ctx.marginL, ctx.y + 4);
        ctx.y += hl.length * 5.5 + 4;
        pdf.setTextColor(0);
      }

      // ── Schedule B — Milestone Payment Schedule + holdback release terms ──
      var _ms = (d.milestones || []).filter(function(m){ return m && (m.name || parseFloat(m.gross)); });
      h2Heading('Schedule B — Milestone Payment Schedule');
      if (_ms.length) {
        var cW = ctx.contentW, mL = ctx.marginL;
        var cols = [
          { w:0.34, label:'Milestone',      align:'left'  },
          { w:0.10, label:'%',              align:'right' },
          { w:0.19, label:'Gross',          align:'right' },
          { w:0.19, label:'Holdback (10%)', align:'right' },
          { w:0.18, label:'Net Payable',    align:'right' }
        ];
        var xs = [], xacc = mL; cols.forEach(function(c){ xs.push(xacc); xacc += c.w * cW; });
        var cellX = function(i){ return cols[i].align === 'right' ? xs[i] + cols[i].w * cW - 1 : xs[i]; };
        ctx.needSpace(8);
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(90);
        cols.forEach(function(c, i){ pdf.text(c.label, cellX(i), ctx.y + 3, { align: c.align }); });
        ctx.y += 5; pdf.setDrawColor(210); pdf.setLineWidth(0.2); pdf.line(mL, ctx.y, mL + cW, ctx.y); ctx.y += 1;
        var sumG = 0, sumH = 0, sumN = 0;
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(30);
        _ms.forEach(function(m){
          ctx.needSpace(6);
          var g = parseFloat(m.gross) || 0, h = parseFloat(m.holdback) || 0, n = parseFloat(m.net) || 0;
          sumG += g; sumH += h; sumN += n;
          var vals = [ m.name || '—', (m.pct ? (Math.round(parseFloat(m.pct) * 10) / 10 + '%') : ''), numFmt(g) || '$0.00', numFmt(h) || '$0.00', numFmt(n) || '$0.00' ];
          cols.forEach(function(c, i){ pdf.text(pdf.splitTextToSize(String(vals[i]), c.w * cW - 2), cellX(i), ctx.y + 3, { align: c.align }); });
          ctx.y += 5.5;
        });
        ctx.needSpace(7);
        pdf.setDrawColor(210); pdf.line(mL, ctx.y, mL + cW, ctx.y); ctx.y += 1;
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(20);
        pdf.text('Total', cellX(0), ctx.y + 3, { align: 'left' });
        pdf.text(numFmt(sumG) || '$0.00', cellX(2), ctx.y + 3, { align: 'right' });
        pdf.text(numFmt(sumH) || '$0.00', cellX(3), ctx.y + 3, { align: 'right' });
        pdf.text(numFmt(sumN) || '$0.00', cellX(4), ctx.y + 3, { align: 'right' });
        ctx.y += 6; pdf.setTextColor(0);
      } else {
        ctx.paragraph('Payment shall be made as a single lump sum upon Substantial Completion, subject to the holdback provisions below.', 9);
      }
      var _hbDays = d.holdback_days || '60';
      var _hbDate = (typeof _rfqAddDays === 'function') ? _rfqAddDays(d.substantial_completion_date || d.total_completion_date || '', _hbDays) : '';
      ctx.paragraph('Statutory holdback (10% of the value of each progress payment): ' + (numFmt(d.holdback_release) || '$0.00')
        + '. The holdback shall be released ' + _hbDays + ' days after the date of Substantial Completion'
        + (_hbDate ? ' (on or about ' + _hbDate + ')' : '')
        + ', following expiry of the applicable lien period under the Construction Act and provided no liens have been preserved.', 9);

      // ── Contractor Acknowledgement (initialled) ──
      h2Heading('Contractor Acknowledgement');
      ctx.paragraph('By initialling below, the Contractor confirms that it is in good standing with WSIB, holds the insurance required under this Agreement, will comply with the Construction Act and the Occupational Health and Safety Act (OHSA), and accepts the prompt payment and adjudication framework set out in this Agreement.', 9);
      ctx.needSpace(18);
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(60);
      pdf.text('Contractor Initials:', ctx.marginL, ctx.y + 4);
      var _ix = ctx.marginL + 34;
      var _initData = (typeof getSigDataURL === 'function') ? getSigDataURL('rfq_ct_initial') : '';
      if (_initData && _initData.indexOf('data:image/png;base64,') === 0) {
        try { pdf.addImage(_initData, 'PNG', _ix, ctx.y - 1, 24, 9); } catch(e) {}
      } else if (_initData && _initData.indexOf('typed:') === 0) {
        pdf.setFont('helvetica', 'italic'); pdf.setFontSize(13); pdf.setTextColor(20);
        pdf.text(_initData.replace('typed:', ''), _ix, ctx.y + 4);
      } else if (_initData && _initData.indexOf('wet:') === 0) {
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(80);
        pdf.text('Initialled (on file)', _ix, ctx.y + 4);
      } else {
        pdf.setDrawColor(160); pdf.setLineWidth(0.4); pdf.line(_ix, ctx.y + 5, _ix + 30, ctx.y + 5);
      }
      pdf.setTextColor(0);
      ctx.y += 12;

      // Signatures section — keep the block together on a page, but let
      // h2Heading own the spacing so it matches the other section headers.
      ctx.needSpace(50);
      h2Heading('Signatures');

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

      // Upload once to Storage, then file it in BOTH document libraries:
      //  - the unit's (entity 'tenant') so it appears on the inventory unit card
      //  - this RFQ's (entity 'rfq') so it appears on the RFQ Documents tab
      // Both DocLibraries read the same tenants/<unitId> path prefix, so a
      // single stored object surfaces in both once each meta row is written.
      var savedToRfq = false;
      if (_rfqSowUnitId && typeof window.sbUploadFile === 'function') {
        try {
          var storePath = 'tenants/' + _rfqSowUnitId + '/' + Date.now() + '_' + filename;
          await window.sbUploadFile(storePath, blob);
          if (typeof window.sbSaveFileMeta === 'function') {
            await window.sbSaveFileMeta('tenant', String(_rfqSowUnitId), storePath, filename, blob.size, 'application/pdf');
            if (_rfqCurrentId) {
              await window.sbSaveFileMeta('rfq', String(_rfqCurrentId), storePath, filename, blob.size, 'application/pdf');
              savedToRfq = true;
            }
          }
          // Refresh the RFQ Documents tab so the contract shows immediately.
          if (savedToRfq && _rfqDocLib && typeof _rfqDocLib.refresh === 'function') _rfqDocLib.refresh();
          if (savedToRfq && typeof _rfqRefreshAttachList === 'function') _rfqRefreshAttachList();
        } catch(e) { console.warn('[contract] document library upload failed:', e); }
      }

      if (typeof showToast === 'function') {
        showToast(savedToRfq
          ? 'Contract PDF saved — added to RFQ and unit documents'
          : 'Contract PDF saved — also added to unit documents');
      }
  } catch(e) {
    console.error('[contract] generation failed:', e);
    if (typeof showToast === 'function') showToast('Contract PDF failed: ' + e.message);
  }
}

