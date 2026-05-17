'use strict';

var _rfqCurrentId   = null;
var _rfqSowUnitId   = null;
var _rfqSowPn       = null;
var _rfqSowData     = null;
var _rfqUnitData    = null;
var _rfqScopeItems  = [];
var _rfqSelectedCts = {};
var _rfqActiveTab   = 'details';
var _rfqAwardingId  = null;

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
    showRfqForm(rfqId, null, null, null);
  } else if (unitId && sowPn) {
    // New RFQ from SOW — show form immediately then fetch SOW data from Supabase
    showRfqForm(null, unitId, sowPn, null);
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
var _rfqNavCtx = null; // SOW navigation context (legacy, kept for compat)

// Fetch the SOW record from Supabase and populate form fields.
// Called after showRfqForm() so the form is already visible.
async function _fetchAndPopulateSow(unitId, sowPn) {
  try {
    var r = await fetch(
      SUPABASE_URL + '/rest/v1/housing_sow?unit_id=eq.' + encodeURIComponent(unitId) + '&select=data',
      { headers: HOUSING_HEADERS }
    );
    if (!r.ok) return;
    var rows = await r.json();
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

function showRfqForm(rfqId, unitId, sowPn, navCtx) {
  _rfqNavCtx = navCtx || null;
  document.getElementById('rfqListView').style.display  = 'none';
  document.getElementById('rfqFormView').style.display  = '';
  switchRfqTab('details');

  _rfqCurrentId  = rfqId || null;
  _rfqSelectedCts = {};
  _rfqScopeItems  = [];

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
    // Default closing: 14 days from now
    var closing = new Date(Date.now() + 14*24*60*60*1000);
    document.getElementById('rfq_closes_at').value = closing.toISOString().slice(0,16);
    // Default contact = current user
    var session = window.HOUSING_SESSION || {};
    document.getElementById('rfq_contact').value = session.name || '';
    document.getElementById('rfq_contact_email').value = session.email || '';
    document.getElementById('rfqFormHeading').textContent = 'New Request for Quotes';
    document.getElementById('rfqIssueBtn').disabled = false;
  }

  // Load SOW data and unit
  _loadRfqSowContext();
  updateRecipientBadge();
  _renderAwardedToDropdown();
  setTimeout(function(){ if (typeof _initSigPad === 'function') _initSigPad('rfq_sig'); }, 80);
}

function _populateFormFields(rfq) {
  var d = rfq.data || {};
  document.getElementById('rfq_number').value          = rfq.id;
  document.getElementById('rfq_status_display').value  = rfq.status || 'draft';
  document.getElementById('rfq_closes_at').value       = rfq.closes_at ? rfq.closes_at.slice(0,16) : '';
  document.getElementById('rfq_contact').value         = d.contact_person || '';
  document.getElementById('rfq_contact_email').value   = d.contact_email  || '';
  document.getElementById('rfq_sub_method').value      = d.submission_method || 'email';
  // Award fields
  var amtEl = document.getElementById('rfq_award_amount');
  var notEl = document.getElementById('rfq_award_notes');
  var snmEl = document.getElementById('rfq_sig_name');
  var sttEl = document.getElementById('rfq_sig_title');
  if (amtEl) amtEl.value = rfq.award_amount || '';
  if (notEl) notEl.value = rfq.award_notes  || '';
  if (snmEl) snmEl.value = d.sig_name       || '';
  if (sttEl) sttEl.value = d.sig_title      || '';
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

  // _rfqNavCtx carries the data read directly from the open SOW modal DOM
  // by openRfqFromSow() -- always authoritative when coming from a SOW.
  var navAddr   = (_rfqNavCtx && _rfqNavCtx.addr)   || '';
  var navAmount = (_rfqNavCtx && _rfqNavCtx.amount)  || 0;

  // Find unit from cache (may enrich the address)
  _rfqUnitData = (window.housingUnits || []).find(function(u){ return u && u.id === _rfqSowUnitId; }) || null;
  var addr = navAddr
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
  var raw = navAmount || (_rfqSowData
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
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchRfqTab(tab) {
  _rfqActiveTab = tab;
  ['details','scope','recipients'].forEach(function(t) {
    var btn = document.getElementById('rfqTabBtn_' + t);
    var panel = document.getElementById('rfqPanel_' + t);
    if (btn)   btn.classList.toggle('active', t === tab);
    if (panel) panel.style.display = (t === tab) ? '' : 'none';
  });
  if (tab === 'scope')      renderScopeTab();
  if (tab === 'recipients') renderContractorCards();
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
  return {
    id:                      id,
    sow_unit_id:             _rfqSowUnitId || '',
    sow_project_number:      _rfqSowPn || '',
    status:                  _rfqCurrentId ? ((window._rfqCache||{})[_rfqCurrentId] || {}).status || 'draft' : 'draft',
    closes_at:               document.getElementById('rfq_closes_at').value || null,
    recipient_contractor_ids: Object.keys(_rfqSelectedCts),
    // Award fields (top-level columns in housing_rfq)
    awarded_contractor_id: (document.getElementById('rfq_awarded_to')   || {}).value || null,
    award_amount:          parseFloat((document.getElementById('rfq_award_amount') || {}).value) || null,
    award_notes:           (document.getElementById('rfq_award_notes')  || {}).value.trim() || null,
    data: {
      contact_person:    document.getElementById('rfq_contact').value.trim(),
      contact_email:     document.getElementById('rfq_contact_email').value.trim(),
      submission_method: document.getElementById('rfq_sub_method').value,
      scope_snapshot:    snap,
      sig_name:          (document.getElementById('rfq_sig_name')  || {}).value || '',
      sig_title:         (document.getElementById('rfq_sig_title') || {}).value || '',
      sig_data:          (typeof getSigDataURL === 'function') ? getSigDataURL('rfq_sig') : ''
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
