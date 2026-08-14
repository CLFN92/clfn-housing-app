/* ============================================================
 * projects-init.js — Capital Projects module
 * Funded lot-development / house-build projects: milestones,
 * budget vs actual costs, lots, unit creation + cost allocation.
 *
 * Naming note: "project" already means SOW elsewhere in this app
 * (SOW-YYYY-NN project numbers). Everything here is _prj*-prefixed
 * and capital-project reference numbers use the CP-YYYY-NN format.
 * ============================================================ */

'use strict';

// ── State ────────────────────────────────────────────────────────────────────
window._prjProjects     = [];   // all capital project rows
window._prjLots         = [];   // all lot rows (every project)
window._prjEditId       = null; // id of project being edited (null = new)
window._prjDraft        = null; // working copy of the open project
window._prjSearchFilter = '';
window._prjTypeFilter   = '';
window._prjStatusFilter = '';
var _prjDocLib          = null; // DocLibrary instance (Documents tab)
var _prjDocLibEntity    = null;

var PRJ_TYPES = [
  { id: 'lot_development', label: 'Lot Development' },
  { id: 'house_build',     label: 'House Build' },
  { id: 'mixed',           label: 'Mixed (Lots + Builds)' },
];
var PRJ_STATUSES = ['planning', 'active', 'on_hold', 'completed', 'cancelled'];
var PRJ_STATUS_LABELS = {
  planning: 'Planning', active: 'Active', on_hold: 'On Hold',
  completed: 'Completed', cancelled: 'Cancelled',
};
var PRJ_LOT_STATUSES = ['raw', 'serviced', 'built'];
var PRJ_LOT_STATUS_LABELS = { raw: 'Raw', serviced: 'Serviced', built: 'Built' };

// Default milestone checklists per project type. Staff can add / remove /
// rename rows after the template is applied (mirrors INSP_CHECKLIST_TEMPLATE).
var PRJ_MILESTONE_TEMPLATES = {
  lot_development: [
    'Funding confirmed',
    'Survey & legal descriptions',
    'Environmental / geotechnical assessment',
    'Road access constructed',
    'Lot clearing',
    'Water & sewer servicing',
    'Hydro servicing',
    'Final grading & lot inspection',
    'Lots ready for allocation',
  ],
  house_build: [
    'Funding confirmed',
    'Design & drawings finalized',
    'Permits & approvals',
    'Site prep & foundation',
    'Framing',
    'Exterior close-in (roof / siding / windows)',
    'Mechanical / electrical / plumbing rough-in',
    'Insulation & drywall',
    'Interior finishes',
    'Final inspection & occupancy permit',
    'Unit handover',
  ],
};
PRJ_MILESTONE_TEMPLATES.mixed =
  PRJ_MILESTONE_TEMPLATES.lot_development.concat(PRJ_MILESTONE_TEMPLATES.house_build);

// ── Small helpers ────────────────────────────────────────────────────────────
function _prjEsc(s) {
  if (typeof escapeHtml === 'function') return escapeHtml(s);
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, function(c){ return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; });
}
function _prjUuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){
    var r = Math.random()*16|0, v = c === 'x' ? r : (r&0x3|0x8); return v.toString(16);
  });
}
function _prjMoney(n, cents) {
  var v = Number(n);
  if (!isFinite(v)) return '—';
  return '$' + v.toLocaleString('en-CA', {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
}
function _prjTypeLabel(id) {
  var t = PRJ_TYPES.find(function(x){ return x.id === id; });
  return t ? t.label : (id || '—');
}
function _prjBadge(status) {
  return '<span class="prj-badge prj-badge-' + _prjEsc(status || 'planning') + '">'
    + _prjEsc(PRJ_STATUS_LABELS[status] || status || 'Planning') + '</span>';
}
function _prjLotBadge(status) {
  return '<span class="prj-badge prj-lot-badge-' + _prjEsc(status || 'raw') + '">'
    + _prjEsc(PRJ_LOT_STATUS_LABELS[status] || status || 'Raw') + '</span>';
}
function _prjNationLabel() {
  var nc = window.NATION_CONFIG || {};
  return (nc.display_name || nc.short || '') + ' — Housing';
}

// Funding source options: the shared BUDGET_POOLS registry + "Other".
function _prjFundingSources() {
  var pools = (window.BUDGET_POOLS || []).map(function(p){ return { id: p.id, label: p.label }; });
  pools.push({ id: 'other', label: 'Other…' });
  return pools;
}

// ── Permissions ──────────────────────────────────────────────────────────────
function _prjCanManage() {
  var role = window.currentRole || '';
  if (typeof APPROVAL_AUTHORITY !== 'undefined' && APPROVAL_AUTHORITY && typeof APPROVAL_AUTHORITY.can === 'function') {
    return APPROVAL_AUTHORITY.can('manageProjects', role);
  }
  var r = (window.CLFN_PERMS && CLFN_PERMS.normalizeRole) ? CLFN_PERMS.normalizeRole(role) : role;
  return r === 'ed' || r === 'super_user' || r === 'housing_manager';
}
function _prjCanAllocate() {
  var role = window.currentRole || '';
  if (typeof APPROVAL_AUTHORITY !== 'undefined' && APPROVAL_AUTHORITY && typeof APPROVAL_AUTHORITY.can === 'function') {
    return APPROVAL_AUTHORITY.can('allocateProjectCosts', role);
  }
  var r = (window.CLFN_PERMS && CLFN_PERMS.normalizeRole) ? CLFN_PERMS.normalizeRole(role) : role;
  return r === 'ed' || r === 'super_user';
}

// Lock the whole detail modal for non-managers (mirrors _rfqApplyReadOnly).
// Tabs, Close and anything marked data-prj-keep stay usable.
function _prjApplyReadOnly() {
  var ro = !_prjCanManage();
  var modal = document.getElementById('prjModal');
  if (!modal) return;

  modal.querySelectorAll('input, select, textarea').forEach(function(c) {
    if (ro) {
      if (!c.hasAttribute('data-ro-was')) c.setAttribute('data-ro-was', c.disabled ? '1' : '0');
      c.disabled = true;
    } else if (c.hasAttribute('data-ro-was')) {
      if (c.getAttribute('data-ro-was') === '0') c.disabled = false;
      c.removeAttribute('data-ro-was');
    }
  });
  modal.querySelectorAll('button').forEach(function(b) {
    if (b.closest('.tic-tabs') || b.hasAttribute('data-prj-keep')) return;
    if (ro) {
      if (!b.hasAttribute('data-ro-was')) b.setAttribute('data-ro-was', b.disabled ? '1' : '0');
      b.disabled = true;
    } else if (b.hasAttribute('data-ro-was')) {
      if (b.getAttribute('data-ro-was') === '0') b.disabled = false;
      b.removeAttribute('data-ro-was');
    }
  });

  var banner = document.getElementById('prjReadOnlyBanner');
  if (ro && !banner) {
    banner = document.createElement('div');
    banner.id = 'prjReadOnlyBanner';
    banner.innerHTML = '🔒 View only — only staff with the "Create / edit capital projects" authority can edit this project.';
    var shell = modal.querySelector('.tic-shell');
    var tabs  = modal.querySelector('.tic-tabs');
    if (shell && tabs) shell.insertBefore(banner, tabs);
  } else if (!ro && banner) {
    banner.remove();
  }
}

// ── Supabase helpers ─────────────────────────────────────────────────────────
function _prjHeaders() {
  return Object.assign({}, window.HOUSING_HEADERS || {}, { 'Content-Type': 'application/json' });
}

async function _prjLoad() {
  try {
    var r = await fetch(
      window.SUPABASE_URL + '/rest/v1/housing_projects?select=*&archived=eq.false&order=created_at.desc&limit=500',
      { headers: _prjHeaders() }
    );
    if (!r.ok) throw new Error(await r.text());
    window._prjProjects = await r.json();
  } catch(e) {
    console.warn('[Projects] load error:', e);
    window._prjProjects = [];
  }
}

async function _prjLoadLots() {
  try {
    var r = await fetch(
      window.SUPABASE_URL + '/rest/v1/housing_project_lots?select=*&order=lot_number&limit=2000',
      { headers: _prjHeaders() }
    );
    if (!r.ok) throw new Error(await r.text());
    window._prjLots = await r.json();
  } catch(e) {
    console.warn('[Projects] lots load error:', e);
    window._prjLots = [];
  }
}

// Save (insert or update) a project row. On insert, retries with a bumped
// CP- number if the unique project_number constraint rejects it (two devices
// creating projects at once — same collision-retry pattern as RFQ numbering).
async function _prjSaveProject(row, isNew) {
  var attempts = 0;
  while (true) {
    attempts++;
    var url = window.SUPABASE_URL + '/rest/v1/housing_projects';
    var method = 'POST';
    if (!isNew) { method = 'PATCH'; url += '?id=eq.' + encodeURIComponent(row.id); }
    var r = await fetch(url, {
      method: method,
      headers: Object.assign({}, _prjHeaders(), { 'Prefer': 'return=representation' }),
      body: JSON.stringify(row),
    });
    if (r.ok) {
      var rows = await r.json();
      return (rows && rows[0]) || row;
    }
    var txt = await r.text();
    var isDup = r.status === 409 || /duplicate|23505/i.test(txt);
    if (isNew && isDup && attempts <= 6) {
      row.project_number = _prjBumpNumber(row.project_number);
      continue;
    }
    throw new Error(txt);
  }
}

async function _prjPatchLot(lotId, partial) {
  var r = await fetch(
    window.SUPABASE_URL + '/rest/v1/housing_project_lots?id=eq.' + encodeURIComponent(lotId),
    { method: 'PATCH', headers: _prjHeaders(), body: JSON.stringify(partial) }
  );
  if (!r.ok) throw new Error(await r.text());
  var lot = (window._prjLots || []).find(function(l){ return l.id === lotId; });
  if (lot) Object.assign(lot, partial);
}

async function _prjDeleteLot(lotId) {
  var r = await fetch(
    window.SUPABASE_URL + '/rest/v1/housing_project_lots?id=eq.' + encodeURIComponent(lotId),
    { method: 'DELETE', headers: _prjHeaders() }
  );
  if (!r.ok) throw new Error(await r.text());
  window._prjLots = (window._prjLots || []).filter(function(l){ return l.id !== lotId; });
}

// ── CP- reference numbers ────────────────────────────────────────────────────
function _prjNextNumber() {
  var year = new Date().getFullYear();
  var max = 0;
  (window._prjProjects || []).forEach(function(p) {
    var m = /^CP-(\d{4})-(\d+)$/.exec(p.project_number || '');
    if (m && Number(m[1]) === year) max = Math.max(max, Number(m[2]));
  });
  return 'CP-' + year + '-' + ('0' + (max + 1)).slice(-2);
}
function _prjBumpNumber(num) {
  var m = /^CP-(\d{4})-(\d+)$/.exec(num || '');
  if (!m) return _prjNextNumber();
  var nn = Number(m[2]) + 1;
  return 'CP-' + m[1] + '-' + ('0' + nn).slice(-2);
}

// ── Derived values ───────────────────────────────────────────────────────────
function _prjData(p) { return (p && typeof p.data === 'object' && p.data) || {}; }
function _prjSpent(p) {
  return (_prjData(p).expenses || []).reduce(function(sum, e){ return sum + (Number(e.amount) || 0); }, 0);
}
function _prjMilestoneStats(p) {
  var ms = _prjData(p).milestones || [];
  var done = ms.filter(function(m){ return m.done; }).length;
  return { total: ms.length, done: done };
}
function _prjLotsFor(pid) {
  return (window._prjLots || []).filter(function(l){ return l.project_id === pid; });
}
function _prjUnitsForProject(pid) {
  return (window.housingUnits || []).filter(function(u){ return u && u.projectId === pid && !u.archived; });
}

// ── List view ────────────────────────────────────────────────────────────────
function renderProjectsList() {
  var list = window._prjProjects || [];

  if (window._prjSearchFilter) {
    var q = window._prjSearchFilter.toLowerCase();
    list = list.filter(function(p) {
      return (p.name || '').toLowerCase().indexOf(q) !== -1
          || (p.project_number || '').toLowerCase().indexOf(q) !== -1;
    });
  }
  if (window._prjTypeFilter)   list = list.filter(function(p){ return p.type === window._prjTypeFilter; });
  if (window._prjStatusFilter) list = list.filter(function(p){ return p.status === window._prjStatusFilter; });

  // KPIs (over all projects, not the filtered list)
  var all   = window._prjProjects || [];
  var kpiEl = document.getElementById('prj_kpi_strip');
  if (kpiEl) {
    var active   = all.filter(function(p){ return p.status === 'active' || p.status === 'planning'; }).length;
    var budget   = all.reduce(function(s, p){ return s + (Number(p.budget) || 0); }, 0);
    var spent    = all.reduce(function(s, p){ return s + _prjSpent(p); }, 0);
    var lots     = window._prjLots || [];
    var delivered = lots.filter(function(l){ return l.unit_id; }).length;
    var serviced  = lots.filter(function(l){ return l.status === 'serviced' || l.status === 'built'; }).length;
    kpiEl.innerHTML =
      _prjKpi(active, 'Active Projects') +
      _prjKpi(_prjMoney(budget), 'Total Funded Budget') +
      _prjKpi(_prjMoney(spent), 'Spent to Date') +
      _prjKpi(delivered, 'Units Delivered') +
      _prjKpi(serviced, 'Lots Serviced');
  }

  var tbody = document.getElementById('prj_tbody');
  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--muted);font-size:13px;">No capital projects found.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(function(p) {
    var ms = _prjMilestoneStats(p);
    return '<tr onclick="openPrjModal(\'' + _prjEsc(p.id) + '\')">'
      + '<td style="font-weight:600;white-space:nowrap;">' + _prjEsc(p.project_number || '—') + '</td>'
      + '<td><div style="font-weight:600;font-size:13px;">' + _prjEsc(p.name || '—') + '</div></td>'
      + '<td>' + _prjEsc(_prjTypeLabel(p.type)) + '</td>'
      + '<td>' + _prjBadge(p.status) + '</td>'
      + '<td>' + (p.budget != null ? _prjMoney(p.budget) : '<span style="color:var(--muted);">—</span>') + '</td>'
      + '<td>' + _prjMoney(_prjSpent(p)) + '</td>'
      + '<td>' + (ms.total ? ms.done + ' / ' + ms.total : '<span style="color:var(--muted);">—</span>') + '</td>'
      + '<td>' + _prjEsc(p.target_date || '—') + '</td>'
      + '</tr>';
  }).join('');
}

function _prjKpi(val, lbl) {
  return '<div class="prj-kpi"><div class="prj-kpi-val">' + val + '</div><div class="prj-kpi-lbl">' + lbl + '</div></div>';
}

// ── Detail modal ─────────────────────────────────────────────────────────────
function openPrjModal(id) {
  var p = id ? (window._prjProjects || []).find(function(x){ return x.id === id; }) : null;
  if (id && !p) { showToast('Project not found'); return; }
  if (!id && !_prjCanManage()) { showToast('Only authorized staff can create projects'); return; }

  window._prjEditId = id || null;
  _prjDocLib = null; _prjDocLibEntity = null;

  // Working draft: full copy of the row incl. the data blob.
  if (p) {
    window._prjDraft = JSON.parse(JSON.stringify(p));
    window._prjDraft.data = _prjData(window._prjDraft);
  } else {
    window._prjDraft = {
      id: null,
      project_number: null,
      name: '',
      type: 'house_build',
      status: 'planning',
      funding_source: '',
      budget: null,
      start_date: null,
      target_date: null,
      archived: false,
      data: {
        description: '',
        milestones: PRJ_MILESTONE_TEMPLATES.house_build.map(function(name){
          return { id: _prjUuid(), name: name, targetDate: null, done: false, completedDate: null, notes: '' };
        }),
        expenses: [],
        allocation: null,
      },
    };
  }
  if (!window._prjDraft.data.milestones) window._prjDraft.data.milestones = [];
  if (!window._prjDraft.data.expenses)   window._prjDraft.data.expenses = [];

  var modal = document.getElementById('prjModal');
  if (!modal) return;
  modal.innerHTML = _prjBuildModalHTML();
  modal.classList.add('is-open');

  _prjRenderOverview();
  _prjRenderMilestones();
  _prjRenderCosts();
  _prjRenderLots();
  _prjRefreshStrip();
  _prjApplyReadOnly();

  if (typeof _initScrollCollapse === 'function') {
    _initScrollCollapse(modal.querySelector('.tic-body'), modal.querySelector('.tic-strip'));
  }
}

function closePrjModal() {
  var modal = document.getElementById('prjModal');
  if (modal) { modal.classList.remove('is-open'); modal.innerHTML = ''; }
  window._prjDraft = null;
  window._prjEditId = null;
  _prjDocLib = null; _prjDocLibEntity = null;
}

function _prjBuildModalHTML() {
  var d = window._prjDraft;
  var isNew = !d.id;
  return '' +
    '<div class="tic-shell">' +

      '<div class="tic-hero">' +
        '<div class="tic-hero-main">' +
          '<div class="lbl-uppercase-sm">' + _prjEsc(_prjNationLabel()) + '</div>' +
          '<h2 id="prj_hero_name" class="tic-name">' + _prjEsc(d.name || 'New Capital Project') + '</h2>' +
          '<div class="tic-hero-sub" id="prj_hero_number">' + _prjEsc(d.project_number || (isNew ? 'Number assigned on first save' : '')) + '</div>' +
        '</div>' +
        '<button type="button" onclick="closePrjModal()" class="tic-close-btn" aria-label="Close" data-prj-keep>✕</button>' +
      '</div>' +

      '<div class="tic-strip">' +
        '<div class="tic-strip-tile"><span class="tic-strip-icon">🏗️</span><div class="tic-strip-lbl">Status</div><div id="prj_strip_status" class="tic-strip-val">—</div></div>' +
        '<div class="tic-strip-tile"><span class="tic-strip-icon">💰</span><div class="tic-strip-lbl">Budget</div><div id="prj_strip_budget" class="tic-strip-val">—</div></div>' +
        '<div class="tic-strip-tile"><span class="tic-strip-icon">🧾</span><div class="tic-strip-lbl">Spent</div><div id="prj_strip_spent" class="tic-strip-val">—</div></div>' +
        '<div class="tic-strip-tile"><span class="tic-strip-icon">📅</span><div class="tic-strip-lbl">Target</div><div id="prj_strip_target" class="tic-strip-val">—</div></div>' +
      '</div>' +

      '<div class="tic-tabs" id="prj_tab_bar" role="tablist">' +
        '<button type="button" class="tic-tab tic-active" data-modal-tab="overview"   onclick="_prjSwitchTab(\'overview\')"   role="tab">Overview</button>' +
        '<button type="button" class="tic-tab"            data-modal-tab="milestones" onclick="_prjSwitchTab(\'milestones\')" role="tab">Milestones</button>' +
        '<button type="button" class="tic-tab"            data-modal-tab="costs"      onclick="_prjSwitchTab(\'costs\')"      role="tab">Costs</button>' +
        '<button type="button" class="tic-tab"            data-modal-tab="lots"       onclick="_prjSwitchTab(\'lots\')"       role="tab">Lots &amp; Units</button>' +
        '<button type="button" class="tic-tab"            data-modal-tab="documents"  onclick="_prjSwitchTab(\'documents\')"  role="tab">Documents</button>' +
      '</div>' +

      '<div class="tic-body">' +
        '<div class="tic-panel tic-active" data-modal-panel="overview"   id="prj_panel_overview"></div>' +
        '<div class="tic-panel"            data-modal-panel="milestones" id="prj_panel_milestones"></div>' +
        '<div class="tic-panel"            data-modal-panel="costs"      id="prj_panel_costs"></div>' +
        '<div class="tic-panel"            data-modal-panel="lots"       id="prj_panel_lots"></div>' +
        '<div class="tic-panel"            data-modal-panel="documents"  id="prj_panel_documents"></div>' +
      '</div>' +

      '<div class="tic-footer">' +
        (d.id ? '<button type="button" onclick="_prjArchiveProject()" class="btn btn-ghost">🗄 Archive</button>' : '') +
        '<span class="tic-footer-spacer"></span>' +
        '<button type="button" onclick="closePrjModal()" class="btn btn-ghost" data-prj-keep>Cancel</button>' +
        '<button id="prj_save_btn" type="button" onclick="savePrjProject()" class="btn btn-primary">💾 Save Project</button>' +
      '</div>' +

    '</div>';
}

// Tab switching — scoped to #prjModal (the .tic-tab/.tic-panel classes are
// reused by the TIC / Edit Unit card elsewhere in the DOM).
function _prjSwitchTab(name) {
  var modal = document.getElementById('prjModal');
  if (!modal) return;
  modal.querySelectorAll('.tic-tab').forEach(function(t) {
    t.classList.toggle('tic-active', t.getAttribute('data-modal-tab') === name);
  });
  modal.querySelectorAll('.tic-panel').forEach(function(pn) {
    pn.classList.toggle('tic-active', pn.getAttribute('data-modal-panel') === name);
  });
  if (name === 'documents') _prjMountDocs();
  _prjApplyReadOnly();
}

function _prjRefreshStrip() {
  var d = window._prjDraft;
  if (!d) return;
  var set = function(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
  set('prj_strip_status', PRJ_STATUS_LABELS[d.status] || d.status || '—');
  set('prj_strip_budget', d.budget != null && d.budget !== '' ? _prjMoney(d.budget) : '—');
  set('prj_strip_spent',  _prjMoney(_prjSpent(d)));
  set('prj_strip_target', d.target_date || '—');
  set('prj_hero_name',    d.name || 'New Capital Project');
}

// ── Overview tab ─────────────────────────────────────────────────────────────
function _prjRenderOverview() {
  var d = window._prjDraft;
  var host = document.getElementById('prj_panel_overview');
  if (!host || !d) return;

  var sources = _prjFundingSources();
  var isPool = sources.some(function(s){ return s.id === d.funding_source; });
  var selVal = d.funding_source ? (isPool ? d.funding_source : 'other') : '';
  var otherVal = (!isPool && d.funding_source) ? d.funding_source : '';

  host.innerHTML =
    '<div class="tic-section">' +
      '<div class="tic-section-h">Project Details</div>' +
      '<div class="tic-grid-2">' +
        '<div class="f"><label>Project Name *</label><input id="prj_f_name" class="tic-input" type="text" placeholder="e.g. 2026 Subdivision Phase 2" value="' + _prjEsc(d.name || '') + '" oninput="window._prjDraft.name=this.value;_prjRefreshStrip()"/></div>' +
        '<div class="f"><label>Project Type</label><select id="prj_f_type" class="tic-input" onchange="_prjTypeChanged(this.value)">' +
          PRJ_TYPES.map(function(t){ return '<option value="' + t.id + '"' + (d.type === t.id ? ' selected' : '') + '>' + _prjEsc(t.label) + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="f"><label>Status</label><select id="prj_f_status" class="tic-input" onchange="window._prjDraft.status=this.value;_prjRefreshStrip()">' +
          PRJ_STATUSES.map(function(s){ return '<option value="' + s + '"' + (d.status === s ? ' selected' : '') + '>' + _prjEsc(PRJ_STATUS_LABELS[s]) + '</option>'; }).join('') +
        '</select></div>' +
        '<div class="f"><label>Funding Source</label><select id="prj_f_funding" class="tic-input" onchange="_prjFundingChanged(this.value)">' +
          '<option value="">— Select —</option>' +
          sources.map(function(s){ return '<option value="' + s.id + '"' + (selVal === s.id ? ' selected' : '') + '>' + _prjEsc(s.label) + '</option>'; }).join('') +
        '</select>' +
        '<input id="prj_f_funding_other" class="tic-input" type="text" placeholder="Funding source…" style="margin-top:6px;' + (selVal === 'other' ? '' : 'display:none;') + '" value="' + _prjEsc(otherVal) + '" oninput="window._prjDraft.funding_source=this.value"/></div>' +
        '<div class="f"><label>Funded Budget (CAD)</label><input id="prj_f_budget" class="tic-input" type="number" min="0" step="0.01" placeholder="e.g. 2500000" value="' + (d.budget != null ? _prjEsc(d.budget) : '') + '" oninput="window._prjDraft.budget=(this.value===\'\'?null:Number(this.value));_prjRefreshStrip()"/></div>' +
        '<div class="f"><label>Start Date</label><input id="prj_f_start" class="tic-input" type="date" value="' + _prjEsc(d.start_date || '') + '" onchange="window._prjDraft.start_date=this.value||null"/></div>' +
        '<div class="f"><label>Target Completion</label><input id="prj_f_target" class="tic-input" type="date" value="' + _prjEsc(d.target_date || '') + '" onchange="window._prjDraft.target_date=this.value||null;_prjRefreshStrip()"/></div>' +
      '</div>' +
    '</div>' +
    '<div class="tic-section">' +
      '<div class="tic-section-h">Description</div>' +
      '<textarea id="prj_f_desc" class="tic-textarea" rows="4" placeholder="What this project delivers, funding agreement reference, conditions…" oninput="window._prjDraft.data.description=this.value">' + _prjEsc(d.data.description || '') + '</textarea>' +
    '</div>';
}

function _prjFundingChanged(val) {
  var other = document.getElementById('prj_f_funding_other');
  if (val === 'other') {
    if (other) { other.style.display = ''; other.focus(); }
    window._prjDraft.funding_source = other ? other.value : '';
  } else {
    if (other) other.style.display = 'none';
    window._prjDraft.funding_source = val;
  }
}

// Type change: offer to (re)apply the milestone template for the new type.
function _prjTypeChanged(val) {
  var d = window._prjDraft;
  var prev = d.type;
  d.type = val;
  var tmpl = PRJ_MILESTONE_TEMPLATES[val] || [];
  var ms = d.data.milestones || [];
  var untouched = !ms.length || (!ms.some(function(m){ return m.done || m.targetDate; })
    && JSON.stringify(ms.map(function(m){ return m.name; })) === JSON.stringify(PRJ_MILESTONE_TEMPLATES[prev] || []));
  var apply = function() {
    d.data.milestones = tmpl.map(function(name){
      return { id: _prjUuid(), name: name, targetDate: null, done: false, completedDate: null, notes: '' };
    });
    _prjRenderMilestones();
    _prjRenderCosts();
  };
  if (untouched) { apply(); return; }
  if (typeof showConfirm === 'function') {
    showConfirm({
      title: 'Replace milestones?',
      message: 'Switch the milestone list to the ' + _prjTypeLabel(val) + ' template? Your current milestones (and their progress) will be replaced.',
      confirmText: 'Replace',
    }).then(function(ok){ if (ok) apply(); });
  }
}

// ── Milestones tab ───────────────────────────────────────────────────────────
function _prjRenderMilestones() {
  var d = window._prjDraft;
  var host = document.getElementById('prj_panel_milestones');
  if (!host || !d) return;
  var ms = d.data.milestones || [];

  var rows = ms.map(function(m, i) {
    return '<div class="prj-row prj-row-ms' + (m.done ? ' prj-row-done' : '') + '">' +
      '<input type="checkbox"' + (m.done ? ' checked' : '') + ' title="Mark complete" onchange="_prjMsToggle(' + i + ', this.checked)" style="accent-color:var(--yellow);width:16px;height:16px;cursor:pointer;"/>' +
      '<div style="min-width:0;">' +
        '<input class="tic-input" type="text" placeholder="Milestone name…" value="' + _prjEsc(m.name || '') + '" oninput="_prjMsField(' + i + ',\'name\',this.value)"/>' +
        (m.done && m.completedDate ? '<div style="font-size:11px;color:var(--muted);margin-top:3px;">Completed ' + _prjEsc(m.completedDate) + '</div>' : '') +
      '</div>' +
      '<input class="tic-input" type="date" title="Target date" value="' + _prjEsc(m.targetDate || '') + '" onchange="_prjMsField(' + i + ',\'targetDate\',this.value||null)"/>' +
      '<button type="button" class="prj-row-remove" title="Remove milestone" onclick="_prjMsRemove(' + i + ')">✕</button>' +
      '<input class="tic-input prj-ms-notes" type="text" placeholder="Notes (optional)" value="' + _prjEsc(m.notes || '') + '" oninput="_prjMsField(' + i + ',\'notes\',this.value)" style="padding:5px 9px;font-size:12px;"/>' +
    '</div>';
  }).join('');

  var stats = _prjMilestoneStats(d);
  host.innerHTML =
    '<div class="tic-section">' +
      '<div class="tic-section-h">Milestones' + (stats.total ? ' — ' + stats.done + ' of ' + stats.total + ' complete' : '') + '</div>' +
      '<div class="prj-rows">' + (rows || '<div style="color:var(--muted);font-size:13px;">No milestones yet — add one below or pick a project type on the Overview tab to apply its template.</div>') + '</div>' +
      '<button type="button" class="prj-addrow" onclick="_prjMsAdd()">+ Add milestone</button>' +
    '</div>';
}

function _prjMsField(i, key, val) {
  var ms = window._prjDraft.data.milestones;
  if (ms && ms[i]) ms[i][key] = val;
}
function _prjMsToggle(i, checked) {
  var ms = window._prjDraft.data.milestones;
  if (!ms || !ms[i]) return;
  ms[i].done = checked;
  ms[i].completedDate = checked ? new Date().toISOString().slice(0, 10) : null;
  _prjRenderMilestones();
}
function _prjMsAdd() {
  window._prjDraft.data.milestones.push({ id: _prjUuid(), name: '', targetDate: null, done: false, completedDate: null, notes: '' });
  _prjRenderMilestones();
  var host = document.getElementById('prj_panel_milestones');
  var inputs = host ? host.querySelectorAll('.prj-row-ms input[type="text"]') : [];
  if (inputs.length) inputs[inputs.length - 1].focus();
}
function _prjMsRemove(i) {
  window._prjDraft.data.milestones.splice(i, 1);
  _prjRenderMilestones();
  _prjRenderCosts();
}

// ── Costs tab ────────────────────────────────────────────────────────────────
function _prjRenderCosts() {
  var d = window._prjDraft;
  var host = document.getElementById('prj_panel_costs');
  if (!host || !d) return;

  var exp    = d.data.expenses || [];
  var ms     = d.data.milestones || [];
  var spent  = _prjSpent(d);
  var budget = Number(d.budget) || 0;
  var pct    = budget > 0 ? Math.min(100, Math.round(spent / budget * 100)) : 0;
  var over   = budget > 0 && spent > budget;

  var msOpts = '<option value="">— No milestone —</option>' + ms.map(function(m) {
    return '<option value="' + _prjEsc(m.id) + '">' + _prjEsc(m.name || '(unnamed)') + '</option>';
  }).join('');

  var expRows = exp.map(function(e, i) {
    var msName = '';
    if (e.milestoneId) {
      var m = ms.find(function(x){ return x.id === e.milestoneId; });
      msName = m ? (m.name || '(unnamed)') : '';
    }
    return '<div class="prj-row prj-row-exp">' +
      '<div style="font-size:12px;white-space:nowrap;">' + _prjEsc(e.date || '—') + '</div>' +
      '<div style="font-size:13px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;">' + _prjEsc(e.vendor || '—') + '</div>' +
      '<div style="font-size:12px;color:var(--muted);min-width:0;overflow:hidden;text-overflow:ellipsis;">' + _prjEsc(e.description || '') + '</div>' +
      '<div style="font-size:13px;font-weight:600;text-align:right;white-space:nowrap;">' + _prjMoney(e.amount, true) + '</div>' +
      '<div style="font-size:11px;color:var(--muted);min-width:0;overflow:hidden;text-overflow:ellipsis;">' + (msName ? '🏁 ' + _prjEsc(msName) : '') + '</div>' +
      '<button type="button" class="prj-row-remove" title="Remove expense" onclick="_prjExpRemove(' + i + ')">✕</button>' +
    '</div>';
  }).join('');

  // Per-milestone subtotals (only milestones that have expenses)
  var subtotals = ms.map(function(m) {
    var sub = exp.filter(function(e){ return e.milestoneId === m.id; })
                 .reduce(function(s, e){ return s + (Number(e.amount) || 0); }, 0);
    return sub > 0 ? '<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid var(--border);"><span>' + _prjEsc(m.name || '(unnamed)') + '</span><span style="font-weight:600;">' + _prjMoney(sub, true) + '</span></div>' : '';
  }).join('');
  var untagged = exp.filter(function(e){ return !e.milestoneId; })
                    .reduce(function(s, e){ return s + (Number(e.amount) || 0); }, 0);
  if (untagged > 0) {
    subtotals += '<div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;"><span style="color:var(--muted);">Not tied to a milestone</span><span style="font-weight:600;">' + _prjMoney(untagged, true) + '</span></div>';
  }

  var alloc = d.data.allocation;
  var allocHtml = alloc
    ? '<div style="font-size:12px;color:var(--muted);margin-top:8px;">Last allocation: ' + _prjMoney(alloc.total, true) + ' across ' + alloc.unitCount + ' unit' + (alloc.unitCount === 1 ? '' : 's') + ' (' + (alloc.basis === 'budget' ? 'funded budget' : 'actuals to date') + ') by ' + _prjEsc(alloc.allocatedBy || '—') + ' on ' + _prjEsc((alloc.allocatedAt || '').slice(0, 10)) + '</div>'
    : '';

  host.innerHTML =
    '<div class="tic-section">' +
      '<div class="tic-section-h">Budget vs Actual</div>' +
      '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;">' +
        '<span>Spent: <b>' + _prjMoney(spent, true) + '</b>' + (over ? ' <span style="color:#b91c1c;font-weight:700;">(over budget)</span>' : '') + '</span>' +
        '<span>Budget: <b>' + (budget > 0 ? _prjMoney(budget, true) : '—') + '</b></span>' +
      '</div>' +
      '<div class="prj-budget-bar"><div class="prj-budget-fill' + (over ? ' prj-over' : '') + '" style="width:' + (budget > 0 ? pct : 0) + '%;"></div></div>' +
      (subtotals ? '<div style="margin-top:12px;">' + subtotals + '</div>' : '') +
      (_prjCanAllocate()
        ? '<div style="margin-top:14px;"><button type="button" class="btn btn-ghost" onclick="_prjOpenAllocateModal()">💰 Allocate Costs to Units</button>' + allocHtml + '</div>'
        : allocHtml) +
    '</div>' +
    '<div class="tic-section">' +
      '<div class="tic-section-h">Log an Expense</div>' +
      '<div class="tic-grid-3">' +
        '<div class="f"><label>Date</label><input id="prj_exp_date" class="tic-input" type="date" value="' + new Date().toISOString().slice(0, 10) + '"/></div>' +
        '<div class="f"><label>Vendor / Payee</label><input id="prj_exp_vendor" class="tic-input" type="text" placeholder="e.g. contractor, supplier"/></div>' +
        '<div class="f"><label>Amount (CAD) *</label><input id="prj_exp_amount" class="tic-input" type="number" min="0" step="0.01" placeholder="0.00"/></div>' +
        '<div class="f"><label>Description</label><input id="prj_exp_desc" class="tic-input" type="text" placeholder="What was this for?"/></div>' +
        '<div class="f"><label>Milestone (optional)</label><select id="prj_exp_ms" class="tic-input">' + msOpts + '</select></div>' +
        '<div class="f"><label>&nbsp;</label><button type="button" class="btn btn-primary" onclick="_prjExpAdd()">+ Add Expense</button></div>' +
      '</div>' +
    '</div>' +
    '<div class="tic-section">' +
      '<div class="tic-section-h">Expenses (' + exp.length + ')</div>' +
      '<div class="prj-rows">' + (expRows || '<div style="color:var(--muted);font-size:13px;">No expenses logged yet.</div>') + '</div>' +
    '</div>';
}

function _prjExpAdd() {
  var get = function(id){ var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  var amount = Number(get('prj_exp_amount'));
  if (!amount || amount <= 0) { showToast('Enter an expense amount', { type: 'error' }); return; }
  window._prjDraft.data.expenses.push({
    id: _prjUuid(),
    date: get('prj_exp_date') || new Date().toISOString().slice(0, 10),
    vendor: get('prj_exp_vendor'),
    description: get('prj_exp_desc'),
    amount: Math.round(amount * 100) / 100,
    milestoneId: get('prj_exp_ms') || null,
    enteredBy: (window.HOUSING_SESSION && HOUSING_SESSION.email) || window.currentRole || 'staff',
    createdAt: new Date().toISOString(),
  });
  _prjRenderCosts();
  _prjRefreshStrip();
}

function _prjExpRemove(i) {
  var exp = window._prjDraft.data.expenses;
  if (!exp || !exp[i]) return;
  var doIt = function() { exp.splice(i, 1); _prjRenderCosts(); _prjRefreshStrip(); };
  if (typeof showConfirm === 'function') {
    showConfirm({ title: 'Remove expense?', message: 'Remove this ' + _prjMoney(exp[i].amount, true) + ' expense from the project?', confirmText: 'Remove', danger: true })
      .then(function(ok){ if (ok) doIt(); });
  } else { doIt(); }
}

// ── Cost allocation ──────────────────────────────────────────────────────────
// Cents-safe equal split: every unit gets round(total/n); the last unit
// absorbs the rounding remainder so the amounts sum to the total exactly.
function _prjAllocAmounts(total, n) {
  var totalCents = Math.round(total * 100);
  var perCents   = Math.round(totalCents / n);
  if (perCents * (n - 1) > totalCents) perCents = Math.floor(totalCents / n);
  var out = [];
  for (var i = 0; i < n - 1; i++) out.push(perCents / 100);
  out.push(Math.max(0, totalCents - perCents * (n - 1)) / 100);
  return out;
}

function _prjOpenAllocateModal() {
  var d = window._prjDraft;
  if (!d || !d.id) { showToast('Save the project first', { type: 'error' }); return; }
  if (!_prjCanAllocate()) { showToast('Only authorized staff can allocate project costs'); return; }
  var units = _prjUnitsForProject(d.id);
  if (!units.length) { showToast('No units are linked to this project yet — create or link units on the Lots & Units tab first', { type: 'error' }); return; }

  var ov = document.createElement('div');
  ov.id = 'prjAllocModal';
  ov.className = 'modal-overlay modal-overlay-centered modal-z-1100 is-open';
  ov.innerHTML =
    '<div class="modal-body modal-body-lg">' +
      '<div class="modal-hdr">' +
        '<div class="modal-hdr-title">Allocate Costs to Units</div>' +
        '<button type="button" class="btn-close-dark-30" onclick="document.getElementById(\'prjAllocModal\').remove()">&times;</button>' +
      '</div>' +
      '<div class="modal-body-stack" style="padding:18px 24px;">' +
        '<p class="txt-help m-0">Divides the project total equally across the ' + units.length + ' linked unit' + (units.length === 1 ? '' : 's') + ' and writes each unit\'s <b>Construction Cost</b>. Insured Value is prefilled only where it is currently empty — existing values are never overwritten.</p>' +
        '<div style="display:flex;gap:18px;margin:14px 0;">' +
          '<label style="display:flex;align-items:center;gap:7px;font-size:13px;cursor:pointer;"><input type="radio" name="prj_alloc_basis" value="actuals" checked onchange="_prjAllocPreview()" style="accent-color:var(--yellow);"/> Actuals to date (' + _prjMoney(_prjSpent(d), true) + ')</label>' +
          '<label style="display:flex;align-items:center;gap:7px;font-size:13px;cursor:pointer;"><input type="radio" name="prj_alloc_basis" value="budget" onchange="_prjAllocPreview()" style="accent-color:var(--yellow);"/> Funded budget (' + (d.budget != null ? _prjMoney(d.budget, true) : '—') + ')</label>' +
        '</div>' +
        '<div id="prj_alloc_preview"></div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button type="button" class="btn btn-ghost" onclick="document.getElementById(\'prjAllocModal\').remove()">Cancel</button>' +
        '<button id="prj_alloc_confirm" type="button" class="btn btn-primary" onclick="_prjRunAllocation()">Allocate</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(ov);
  _prjAllocPreview();
}

function _prjAllocBasis() {
  var el = document.querySelector('input[name="prj_alloc_basis"]:checked');
  return el ? el.value : 'actuals';
}

function _prjAllocPreview() {
  var d = window._prjDraft;
  var host = document.getElementById('prj_alloc_preview');
  if (!host || !d) return;
  var basis = _prjAllocBasis();
  var total = basis === 'budget' ? (Number(d.budget) || 0) : _prjSpent(d);
  var units = _prjUnitsForProject(d.id);
  var btn   = document.getElementById('prj_alloc_confirm');

  if (total <= 0) {
    host.innerHTML = '<div style="font-size:13px;color:#b91c1c;">' + (basis === 'budget' ? 'No funded budget is set on this project.' : 'No expenses have been logged yet.') + '</div>';
    if (btn) btn.disabled = true;
    return;
  }
  if (btn) btn.disabled = false;

  var amounts = _prjAllocAmounts(total, units.length);
  host.innerHTML =
    '<div style="max-height:260px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;">' +
    units.map(function(u, i) {
      var cur = (u.constructionCost != null && u.constructionCost !== '') ? Number(u.constructionCost) : null;
      var changed = cur == null || Math.abs(cur - amounts[i]) >= 0.005;
      return '<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 12px;border-bottom:1px solid var(--border);font-size:13px;">' +
        '<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;">' + _prjEsc((u.num || '') + ' ' + (u.street || '')) + '</span>' +
        '<span style="white-space:nowrap;">' +
          (cur != null ? '<span style="color:var(--muted);text-decoration:' + (changed ? 'line-through' : 'none') + ';">' + _prjMoney(cur, true) + '</span> ' : '') +
          (changed ? '<b>' + _prjMoney(amounts[i], true) + '</b>' : '<span style="color:var(--muted);">unchanged</span>') +
        '</span>' +
      '</div>';
    }).join('') +
    '</div>' +
    '<div style="font-size:12px;color:var(--muted);margin-top:8px;">Total allocated: <b>' + _prjMoney(total, true) + '</b> (' + _prjMoney(amounts[0], true) + ' per unit; the last unit absorbs the rounding remainder)</div>';
}

async function _prjRunAllocation() {
  var d = window._prjDraft;
  if (!d || !d.id || !_prjCanAllocate()) return;
  var basis = _prjAllocBasis();
  var total = basis === 'budget' ? (Number(d.budget) || 0) : _prjSpent(d);
  var units = _prjUnitsForProject(d.id);
  if (total <= 0 || !units.length) return;

  var btn = document.getElementById('prj_alloc_confirm');
  if (btn) { btn.disabled = true; btn.textContent = 'Allocating…'; }

  var amounts = _prjAllocAmounts(total, units.length);
  var failures = 0;
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    u.constructionCost = amounts[i];
    // Prefill-only: never overwrite a non-empty Insured Value.
    if (u.insuredValue == null || u.insuredValue === '') u.insuredValue = amounts[i];
    var ok = true;
    try { ok = await sbSaveUnit(u); } catch(e) { ok = false; }
    if (!ok) failures++;
  }

  d.data.allocation = {
    basis: basis,
    total: Math.round(total * 100) / 100,
    unitCount: units.length,
    perUnit: units.map(function(u, i){ return { unitId: u.id, amount: amounts[i] }; }),
    allocatedBy: (window.HOUSING_SESSION && HOUSING_SESSION.email) || window.currentRole || 'staff',
    allocatedAt: new Date().toISOString(),
  };
  try {
    await _prjSaveProject({ id: d.id, data: d.data, updated_at: new Date().toISOString() }, false);
    _prjSyncCache(d);
  } catch(e) { console.warn('[Projects] allocation snapshot save:', e); }

  if (typeof auditEntry === 'function') {
    auditEntry('PRJ:' + d.id, 'project_costs_allocated',
      _prjMoney(total, true) + ' across ' + units.length + ' units (basis: ' + (basis === 'budget' ? 'funded budget' : 'actuals') + ') — ' + (d.project_number || d.name));
  }

  var modal = document.getElementById('prjAllocModal');
  if (modal) modal.remove();
  _prjRenderCosts();
  showToast(failures
    ? 'Costs allocated, but ' + failures + ' unit save' + (failures === 1 ? '' : 's') + ' failed — retry allocation'
    : 'Costs allocated to ' + units.length + ' unit' + (units.length === 1 ? '' : 's'),
    failures ? { type: 'error' } : undefined);
}

// ── Lots & Units tab ─────────────────────────────────────────────────────────
function _prjRenderLots() {
  var d = window._prjDraft;
  var host = document.getElementById('prj_panel_lots');
  if (!host || !d) return;

  if (!d.id) {
    host.innerHTML = '<div class="tic-section"><div class="tic-section-h">Lots &amp; Units</div>' +
      '<div style="color:var(--muted);font-size:13px;">Save the project first, then add lots and create units here.</div></div>';
    return;
  }

  var lots = _prjLotsFor(d.id);
  var units = _prjUnitsForProject(d.id);
  var unitById = {};
  (window.housingUnits || []).forEach(function(u){ if (u && u.id) unitById[u.id] = u; });

  var rows = lots.map(function(l) {
    var u = l.unit_id ? unitById[l.unit_id] : null;
    var unitCell = u
      ? '<span style="font-weight:600;">' + _prjEsc((u.num || '') + ' ' + (u.street || '')) + '</span>'
      : (l.unit_id ? _prjEsc(l.unit_id) : '<span style="color:var(--muted);">—</span>');
    var statusSel = '<select class="tic-input" style="max-width:120px;padding:4px 8px;font-size:12px;" onchange="_prjSetLotStatus(\'' + _prjEsc(l.id) + '\', this.value)">' +
      PRJ_LOT_STATUSES.map(function(s){ return '<option value="' + s + '"' + (l.status === s ? ' selected' : '') + '>' + PRJ_LOT_STATUS_LABELS[s] + '</option>'; }).join('') +
      '</select>';
    var actions = l.unit_id
      ? '<button type="button" class="btn btn-ghost" style="padding:4px 10px;font-size:11px;" onclick="_prjUnlinkLot(\'' + _prjEsc(l.id) + '\')">Unlink unit</button>'
      : '<button type="button" class="btn btn-ghost" style="padding:4px 10px;font-size:11px;" onclick="_prjLinkUnitToLot(\'' + _prjEsc(l.id) + '\')">Link existing unit</button>'
        + '<button type="button" class="prj-row-remove" title="Remove lot" onclick="_prjRemoveLot(\'' + _prjEsc(l.id) + '\')">✕</button>';
    return '<tr>' +
      '<td style="font-weight:600;white-space:nowrap;">' + _prjEsc(l.lot_number) + '</td>' +
      '<td>' + _prjEsc(l.address || '—') + '</td>' +
      '<td>' + statusSel + '</td>' +
      '<td>' + unitCell + '</td>' +
      '<td style="white-space:nowrap;display:flex;gap:6px;align-items:center;">' + actions + '</td>' +
    '</tr>';
  }).join('');

  host.innerHTML =
    '<div class="tic-section">' +
      '<div class="tic-section-h">Lots (' + lots.length + ') — ' + units.length + ' unit' + (units.length === 1 ? '' : 's') + ' linked to this project</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">' +
        '<button type="button" class="btn btn-ghost" onclick="_prjAddLotsBatch()">+ Add Lots</button>' +
        '<button type="button" class="btn btn-ghost" onclick="_prjCreateUnitsFromLots()">🏠 Create Units from Lots</button>' +
      '</div>' +
      (lots.length
        ? '<div class="prj-table-wrap"><table class="prj-table"><thead><tr><th>Lot #</th><th>Address / Legal</th><th>Status</th><th>Unit</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div style="color:var(--muted);font-size:13px;">No lots yet. Use "+ Add Lots" to create them' + (d.type !== 'lot_development' ? ', or "Create Units from Lots" once lots exist' : '') + '.</div>') +
    '</div>';
}

function _prjAddLotsBatch() {
  var d = window._prjDraft;
  if (!d || !d.id || !_prjCanManage()) return;

  var ov = document.createElement('div');
  ov.id = 'prjLotsModal';
  ov.className = 'modal-overlay modal-overlay-centered modal-z-1100 is-open';
  ov.innerHTML =
    '<div class="modal-body modal-body-md">' +
      '<div class="modal-hdr">' +
        '<div class="modal-hdr-title">Add Lots</div>' +
        '<button type="button" class="btn-close-dark-30" onclick="document.getElementById(\'prjLotsModal\').remove()">&times;</button>' +
      '</div>' +
      '<div class="modal-body-stack" style="padding:18px 24px;">' +
        '<div class="tic-grid-2">' +
          '<div class="f"><label>How many lots?</label><input id="prj_lots_count" class="tic-input" type="number" min="1" max="200" value="1"/></div>' +
          '<div class="f"><label>Numbering starts at</label><input id="prj_lots_start" class="tic-input" type="number" min="1" value="1"/></div>' +
          '<div class="f"><label>Lot number prefix</label><input id="prj_lots_prefix" class="tic-input" type="text" value="Lot "/></div>' +
          '<div class="f"><label>Status</label><select id="prj_lots_status" class="tic-input">' +
            PRJ_LOT_STATUSES.map(function(s){ return '<option value="' + s + '">' + PRJ_LOT_STATUS_LABELS[s] + '</option>'; }).join('') +
          '</select></div>' +
        '</div>' +
        '<div class="f" style="margin-top:10px;"><label>Shared address / subdivision (optional)</label><input id="prj_lots_addr" class="tic-input" type="text" placeholder="e.g. Birch Crescent extension"/></div>' +
        '<div class="f" style="margin-top:10px;"><label>Legal description (optional)</label><input id="prj_lots_legal" class="tic-input" type="text" placeholder="e.g. Plan M-123, Parcel …"/></div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button type="button" class="btn btn-ghost" onclick="document.getElementById(\'prjLotsModal\').remove()">Cancel</button>' +
        '<button id="prj_lots_confirm" type="button" class="btn btn-primary" onclick="_prjSaveLotsBatch()">Add Lots</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(ov);
}

async function _prjSaveLotsBatch() {
  var d = window._prjDraft;
  var get = function(id){ var el = document.getElementById(id); return el ? el.value : ''; };
  var count  = Math.max(1, Math.min(200, parseInt(get('prj_lots_count')) || 1));
  var start  = Math.max(1, parseInt(get('prj_lots_start')) || 1);
  var prefix = get('prj_lots_prefix');
  var status = get('prj_lots_status') || 'raw';
  var addr   = get('prj_lots_addr').trim();
  var legal  = get('prj_lots_legal').trim();

  var rows = [];
  for (var i = 0; i < count; i++) {
    rows.push({
      project_id: d.id,
      lot_number: prefix + (start + i),
      address: addr || null,
      legal_description: legal || null,
      status: status,
      data: {},
    });
  }

  var btn = document.getElementById('prj_lots_confirm');
  if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
  try {
    var r = await fetch(window.SUPABASE_URL + '/rest/v1/housing_project_lots', {
      method: 'POST',
      headers: Object.assign({}, _prjHeaders(), { 'Prefer': 'return=representation' }),
      body: JSON.stringify(rows),
    });
    if (!r.ok) throw new Error(await r.text());
    var created = await r.json();
    window._prjLots = (window._prjLots || []).concat(created);
    if (typeof auditEntry === 'function') {
      auditEntry('PRJ:' + d.id, 'project_lots_added', count + ' lot' + (count === 1 ? '' : 's') + ' added to ' + (d.project_number || d.name));
    }
    var modal = document.getElementById('prjLotsModal');
    if (modal) modal.remove();
    _prjRenderLots();
    renderProjectsList();
    showToast(count + ' lot' + (count === 1 ? '' : 's') + ' added');
  } catch(e) {
    console.warn('[Projects] lots batch:', e);
    showToast('Could not add lots — check your connection and try again', { type: 'error' });
    if (btn) { btn.disabled = false; btn.textContent = 'Add Lots'; }
  }
}

async function _prjSetLotStatus(lotId, status) {
  try {
    await _prjPatchLot(lotId, { status: status });
    renderProjectsList();
  } catch(e) {
    console.warn('[Projects] lot status:', e);
    showToast('Could not update lot status', { type: 'error' });
    _prjRenderLots();
  }
}

function _prjRemoveLot(lotId) {
  if (!_prjCanManage()) return;
  var lot = (window._prjLots || []).find(function(l){ return l.id === lotId; });
  if (!lot) return;
  var doIt = async function() {
    try {
      await _prjDeleteLot(lotId);
      _prjRenderLots();
      renderProjectsList();
    } catch(e) {
      console.warn('[Projects] lot delete:', e);
      showToast('Could not remove the lot', { type: 'error' });
    }
  };
  if (typeof showConfirm === 'function') {
    showConfirm({ title: 'Remove lot?', message: 'Remove ' + _prjEsc(lot.lot_number) + ' from this project?', confirmText: 'Remove', danger: true })
      .then(function(ok){ if (ok) doIt(); });
  } else { doIt(); }
}

function _prjLinkUnitToLot(lotId) {
  var d = window._prjDraft;
  if (!d || !_prjCanManage()) return;
  var lot = (window._prjLots || []).find(function(l){ return l.id === lotId; });
  if (!lot) return;

  var candidates = (window.housingUnits || [])
    .filter(function(u){ return u && !u.archived && !u.projectId; })
    .map(function(u){ return { id: u.id, label: (u.num || '') + ' ' + (u.street || '') }; });
  if (!candidates.length) { showToast('No unlinked units available'); return; }

  var ov = document.createElement('div');
  ov.id = 'prjLinkModal';
  ov.className = 'modal-overlay modal-overlay-centered modal-z-1100 is-open';
  ov.innerHTML =
    '<div class="modal-body modal-body-sm">' +
      '<div class="modal-hdr">' +
        '<div class="modal-hdr-title">Link Unit to ' + _prjEsc(lot.lot_number) + '</div>' +
        '<button type="button" class="btn-close-dark-30" onclick="document.getElementById(\'prjLinkModal\').remove()">&times;</button>' +
      '</div>' +
      '<div class="modal-body-stack" style="padding:18px 24px;">' +
        '<div class="f"><label>Unit</label><div id="prj_link_unit_wrap"></div></div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button type="button" class="btn btn-ghost" onclick="document.getElementById(\'prjLinkModal\').remove()">Cancel</button>' +
        '<button id="prj_link_confirm" type="button" class="btn btn-primary" disabled onclick="_prjConfirmLinkUnit(\'' + _prjEsc(lotId) + '\')">Link Unit</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(ov);

  window._prjLinkPick = null;
  if (typeof clfnSearchSelect === 'function') {
    clfnSearchSelect({
      wrap: document.getElementById('prj_link_unit_wrap'),
      items: candidates,
      placeholder: 'Search units…',
      onChange: function(id) {
        window._prjLinkPick = id || null;
        var btn = document.getElementById('prj_link_confirm');
        if (btn) btn.disabled = !id;
      },
    });
  }
}

async function _prjConfirmLinkUnit(lotId) {
  var d = window._prjDraft;
  var unitId = window._prjLinkPick;
  if (!d || !unitId) return;
  var u = (window.housingUnits || []).find(function(x){ return x.id === unitId; });
  if (!u) return;

  u.projectId = d.id;
  u.lotId = lotId;
  try {
    if (typeof saveUnitWithDraftFallback === 'function') await saveUnitWithDraftFallback(u);
    else await sbSaveUnit(u);
    await _prjPatchLot(lotId, { unit_id: u.id, status: 'built' });
    if (typeof auditEntry === 'function') {
      auditEntry('PRJ:' + d.id, 'project_unit_linked', (u.num || '') + ' ' + (u.street || '') + ' linked to lot on ' + (d.project_number || d.name));
    }
    var modal = document.getElementById('prjLinkModal');
    if (modal) modal.remove();
    _prjRenderLots();
    renderProjectsList();
    showToast('Unit linked');
  } catch(e) {
    console.warn('[Projects] link unit:', e);
    showToast('Could not link the unit', { type: 'error' });
  }
}

function _prjUnlinkLot(lotId) {
  if (!_prjCanManage()) return;
  var d = window._prjDraft;
  var lot = (window._prjLots || []).find(function(l){ return l.id === lotId; });
  if (!lot || !lot.unit_id) return;
  var u = (window.housingUnits || []).find(function(x){ return x.id === lot.unit_id; });
  var doIt = async function() {
    try {
      if (u) {
        delete u.projectId;
        delete u.lotId;
        if (typeof saveUnitWithDraftFallback === 'function') await saveUnitWithDraftFallback(u);
        else await sbSaveUnit(u);
      }
      await _prjPatchLot(lotId, { unit_id: null });
      _prjRenderLots();
      renderProjectsList();
    } catch(e) {
      console.warn('[Projects] unlink:', e);
      showToast('Could not unlink the unit', { type: 'error' });
    }
  };
  if (typeof showConfirm === 'function') {
    showConfirm({ title: 'Unlink unit?', message: 'Detach the unit from ' + _prjEsc(lot.lot_number) + '? The unit itself is not deleted.', confirmText: 'Unlink' })
      .then(function(ok){ if (ok) doIt(); });
  } else { doIt(); }
}

// Batch "Create Units from Lots": pick lots without a unit, one shared field
// set; each unit is created with the same recipe as the Add Unit modal
// (STREET-NUM slug id, collision-checked, saveUnitWithDraftFallback).
function _prjCreateUnitsFromLots() {
  var d = window._prjDraft;
  if (!d || !d.id || !_prjCanManage()) return;
  var lots = _prjLotsFor(d.id).filter(function(l){ return !l.unit_id; });
  if (!lots.length) { showToast('Every lot on this project already has a unit — add more lots first'); return; }

  var lotRows = lots.map(function(l, i) {
    var numGuess = (String(l.lot_number || '').match(/\d+/) || [''])[0];
    return '<div style="display:grid;grid-template-columns:auto 1fr 130px;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);">' +
      '<input type="checkbox" data-prj-cu-lot="' + _prjEsc(l.id) + '" checked style="accent-color:var(--yellow);width:16px;height:16px;cursor:pointer;"/>' +
      '<span style="font-size:13px;">' + _prjEsc(l.lot_number) + (l.address ? ' <span style="color:var(--muted);">· ' + _prjEsc(l.address) + '</span>' : '') + '</span>' +
      '<input class="tic-input" type="text" data-prj-cu-num="' + _prjEsc(l.id) + '" placeholder="Unit #" value="' + _prjEsc(numGuess) + '" style="padding:5px 9px;font-size:12px;"/>' +
    '</div>';
  }).join('');

  var ov = document.createElement('div');
  ov.id = 'prjUnitsModal';
  ov.className = 'modal-overlay modal-overlay-centered modal-z-1100 is-open';
  ov.innerHTML =
    '<div class="modal-body modal-body-lg">' +
      '<div class="modal-hdr">' +
        '<div class="modal-hdr-title">Create Units from Lots</div>' +
        '<button type="button" class="btn-close-dark-30" onclick="document.getElementById(\'prjUnitsModal\').remove()">&times;</button>' +
      '</div>' +
      '<div class="modal-body-stack" style="padding:18px 24px;max-height:70vh;overflow-y:auto;">' +
        '<div class="tic-section-h">Shared unit details</div>' +
        '<div class="tic-grid-3">' +
          '<div class="f"><label>Street *</label><input id="prj_cu_street" class="tic-input" type="text" placeholder="e.g. Birch Crescent" value="' + _prjEsc((lots[0].address || '').replace(/^\d+\s*/, '')) + '"/></div>' +
          '<div class="f"><label>Bedrooms</label><select id="prj_cu_bedrooms" class="tic-input">' +
            [1,2,3,4,5].map(function(n){ return '<option value="' + n + '"' + (n === 3 ? ' selected' : '') + '>' + n + '</option>'; }).join('') +
          '</select></div>' +
          '<div class="f"><label>Bathrooms</label><select id="prj_cu_bathrooms" class="tic-input"><option>1</option><option>1.5</option><option>2</option><option>2.5</option><option>3</option></select></div>' +
          '<div class="f"><label>Type</label><select id="prj_cu_type" class="tic-input"><option value="detached unit">Detached unit</option><option value="duplex">Duplex</option><option value="triplex">Triplex</option><option value="apartment">Apartment</option></select></div>' +
          '<div class="f"><label>Funder</label><input id="prj_cu_funder" class="tic-input" type="text" placeholder="e.g. CMHC_95, Band"/></div>' +
          '<div class="f"><label>Year Built</label><input id="prj_cu_year" class="tic-input" type="text" value="' + new Date().getFullYear() + '"/></div>' +
        '</div>' +
        '<div class="tic-section-h" style="margin-top:16px;">Lots to build on (' + lots.length + ')</div>' +
        lotRows +
      '</div>' +
      '<div class="modal-footer">' +
        '<button type="button" class="btn btn-ghost" onclick="document.getElementById(\'prjUnitsModal\').remove()">Cancel</button>' +
        '<button id="prj_cu_confirm" type="button" class="btn btn-primary" onclick="_prjConfirmCreateUnits()">Create Units</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(ov);
}

async function _prjConfirmCreateUnits() {
  var d = window._prjDraft;
  var ov = document.getElementById('prjUnitsModal');
  if (!d || !ov) return;
  var get = function(id){ var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  var street = get('prj_cu_street');
  if (!street) { showToast('Street is required', { type: 'error' }); return; }

  var picks = [];
  ov.querySelectorAll('[data-prj-cu-lot]').forEach(function(cb) {
    if (!cb.checked) return;
    var lotId = cb.getAttribute('data-prj-cu-lot');
    var numEl = ov.querySelector('[data-prj-cu-num="' + lotId + '"]');
    picks.push({ lotId: lotId, num: numEl ? numEl.value.trim() : '' });
  });
  if (!picks.length) { showToast('Select at least one lot', { type: 'error' }); return; }
  if (picks.some(function(p){ return !p.num; })) { showToast('Every selected lot needs a unit number', { type: 'error' }); return; }

  var btn = document.getElementById('prj_cu_confirm');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }

  var units = window.housingUnits || (window.housingUnits = []);
  var created = 0, failed = [];
  for (var i = 0; i < picks.length; i++) {
    var p = picks[i];
    // Same id recipe as saveNewUnit (housing-modals.js): STREET-NUM slug,
    // collision-checked in memory, with a suffix fallback for batch clashes.
    var baseId = (street.toUpperCase().replace(/\s+/g, '-') + '-' + p.num).replace(/[^A-Z0-9\-]/g, '');
    var newId = baseId, suffix = 'B'.charCodeAt(0);
    while (units.find(function(u){ return u.id === newId; })) {
      if (suffix > 'F'.charCodeAt(0)) { newId = null; break; }
      newId = baseId + '-' + String.fromCharCode(suffix++);
    }
    if (!newId) { failed.push(p.num + ' ' + street); continue; }

    var newUnit = {
      id: newId, street: street, num: p.num,
      bedrooms: parseInt(get('prj_cu_bedrooms')) || 3,
      bathrooms: get('prj_cu_bathrooms') || '1',
      type: get('prj_cu_type') || 'detached unit',
      foundation: '',
      funder: get('prj_cu_funder') || '',
      phase: d.project_number || '',
      year: get('prj_cu_year') || '',
      monthlyRent: null,
      constructionCost: null,
      notes: '',
      accessible: false,
      isElders: false,
      status: 'vacant',
      assignedTo: null, assignedDate: null, assignedName: null,
      projectId: d.id,
      lotId: p.lotId,
    };
    units.push(newUnit);
    try {
      if (typeof saveUnitWithDraftFallback === 'function') await saveUnitWithDraftFallback(newUnit);
      else await sbSaveUnit(newUnit);
      await _prjPatchLot(p.lotId, { unit_id: newId, status: 'built' });
      created++;
    } catch(e) {
      console.warn('[Projects] create unit:', e);
      failed.push(p.num + ' ' + street);
    }
  }

  if (created && typeof auditEntry === 'function') {
    auditEntry('PRJ:' + d.id, 'project_units_created', created + ' unit' + (created === 1 ? '' : 's') + ' created from lots on ' + (d.project_number || d.name));
  }
  ov.remove();
  _prjRenderLots();
  renderProjectsList();
  if (typeof renderInventoryView === 'function') { try { renderInventoryView(); } catch(e) {} }
  showToast(failed.length
    ? created + ' created; failed: ' + failed.join(', ')
    : created + ' unit' + (created === 1 ? '' : 's') + ' created and linked to this project',
    failed.length ? { type: 'error' } : undefined);
}

// ── Documents tab ────────────────────────────────────────────────────────────
function _prjMountDocs() {
  var d = window._prjDraft;
  var host = document.getElementById('prj_panel_documents');
  if (!host || !d) return;
  if (!d.id) {
    host.innerHTML = '<div class="tic-section"><div class="tic-section-h">Documents</div>' +
      '<div style="color:var(--muted);font-size:13px;">Save the project first, then attach funding agreements, drawings, and reports here.</div></div>';
    return;
  }
  if (_prjDocLib && _prjDocLibEntity === d.id) return;

  host.innerHTML = '<div class="tic-section"><div class="tic-section-h">Documents</div><div id="prj_doclib_mount"></div></div>';
  if (!window.DocLibrary) return;
  _prjDocLibEntity = d.id;
  _prjDocLib = window.DocLibrary.create(document.getElementById('prj_doclib_mount'), {
    entityType:    'project',
    entityId:      d.id,
    readOnly:      !_prjCanManage(),
    pathPrefix:    'projects/' + d.id,
    supabaseUrl:   window.SUPABASE_URL,
    supabaseAnon:  window.SUPABASE_ANON,
    storageBucket: window.STORAGE_BUCKET || 'housing-files',
    getAuthToken:  function(){ return (window.HOUSING_HEADERS && window.HOUSING_HEADERS['Authorization'] || '').replace('Bearer ', ''); },
    auditTable:    'housing_audit_log',
    getActor:      function(){ return (window.HOUSING_SESSION && window.HOUSING_SESSION.email) || window.currentRole || 'staff'; },
    categories: [
      { key: 'funding',  label: 'Funding Agreement', icon: '💰' },
      { key: 'drawing',  label: 'Drawing / Plan',    icon: '📐' },
      { key: 'permit',   label: 'Permit / Approval', icon: '📋' },
      { key: 'report',   label: 'Report / Study',    icon: '📄' },
      { key: 'image',    label: 'Image',             icon: '🖼️' },
      { key: 'other',    label: 'Other',             icon: '📎' },
    ],
  });
}

// ── Save / archive ───────────────────────────────────────────────────────────
async function savePrjProject() {
  var d = window._prjDraft;
  if (!d) return;
  if (!_prjCanManage()) { showToast('Only authorized staff can edit projects'); return; }
  if (!d.name || !d.name.trim()) { showToast('Project name is required', { type: 'error' }); _prjSwitchTab('overview'); return; }

  var isNew = !d.id;
  var row = {
    project_number: d.project_number || _prjNextNumber(),
    name: d.name.trim(),
    type: d.type || 'house_build',
    status: d.status || 'planning',
    funding_source: d.funding_source || null,
    budget: (d.budget === '' || d.budget == null) ? null : Number(d.budget),
    start_date: d.start_date || null,
    target_date: d.target_date || null,
    archived: false,
    data: d.data,
  };
  if (!isNew) { row.id = d.id; row.updated_at = new Date().toISOString(); }

  var btn = document.getElementById('prj_save_btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    var saved = await _prjSaveProject(row, isNew);
    d.id = saved.id;
    d.project_number = saved.project_number || row.project_number;
    window._prjEditId = d.id;
    _prjSyncCache(Object.assign({}, saved, { data: d.data }));

    if (typeof auditEntry === 'function') {
      auditEntry('PRJ:' + d.id, isNew ? 'project_created' : 'project_updated',
        (d.project_number || '') + ' ' + d.name + ' (' + _prjTypeLabel(d.type) + ', ' + (PRJ_STATUS_LABELS[d.status] || d.status) + ')');
    }

    var numEl = document.getElementById('prj_hero_number');
    if (numEl) numEl.textContent = d.project_number || '';
    _prjRefreshStrip();
    _prjRenderLots();     // a just-saved project unlocks the lots tab
    _prjMountDocsIfOpen();
    renderProjectsList();
    showToast(isNew ? 'Project ' + (d.project_number || '') + ' created' : 'Project saved');
  } catch(e) {
    console.warn('[Projects] save:', e);
    showToast('Could not save the project — check your connection and try again', { type: 'error' });
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 Save Project'; }
  }
}

function _prjMountDocsIfOpen() {
  var panel = document.getElementById('prj_panel_documents');
  if (panel && panel.classList.contains('tic-active')) _prjMountDocs();
}

// Keep the in-memory list in sync with a saved row.
function _prjSyncCache(saved) {
  var list = window._prjProjects || (window._prjProjects = []);
  var i = list.findIndex(function(p){ return p.id === saved.id; });
  if (i === -1) list.unshift(saved); else list[i] = Object.assign({}, list[i], saved);
}

function _prjArchiveProject() {
  var d = window._prjDraft;
  if (!d || !d.id || !_prjCanManage()) return;
  if (typeof showConfirm !== 'function') return;
  showConfirm({
    title: 'Archive project?',
    message: 'Archive ' + _prjEsc(d.project_number || d.name) + '? It disappears from the list but its lots, units, and history are kept.',
    confirmText: 'Archive', danger: true,
  }).then(async function(ok) {
    if (!ok) return;
    try {
      await _prjSaveProject({ id: d.id, archived: true, updated_at: new Date().toISOString() }, false);
      window._prjProjects = (window._prjProjects || []).filter(function(p){ return p.id !== d.id; });
      if (typeof auditEntry === 'function') {
        auditEntry('PRJ:' + d.id, 'project_archived', (d.project_number || '') + ' ' + d.name);
      }
      closePrjModal();
      renderProjectsList();
      showToast('Project archived');
    } catch(e) {
      console.warn('[Projects] archive:', e);
      showToast('Could not archive the project', { type: 'error' });
    }
  });
}

// ── Boot ─────────────────────────────────────────────────────────────────────
(async function initProjectsPage() {
  try {
    var token = sessionStorage.getItem('clfn_housing_token');
    if (!token) { window.location.href = 'index.html'; return; }

    var savedRole  = sessionStorage.getItem('clfn_housing_role') || '';
    var savedName  = sessionStorage.getItem('clfn_housing_name') || '';
    var savedEmail = sessionStorage.getItem('clfn_housing_email_session') || '';
    if (window.HOUSING_HEADERS) HOUSING_HEADERS['Authorization'] = 'Bearer ' + token;
    if (window.HOUSING_SESSION) {
      HOUSING_SESSION.accessToken = token;
      HOUSING_SESSION.role  = savedRole;
      HOUSING_SESSION.name  = savedName;
      HOUSING_SESSION.email = savedEmail;
    }
    window.currentRole = savedRole;
    window._realRole   = savedRole;

    if (typeof resolveHousingRole === 'function') {
      try { await resolveHousingRole(); } catch(e) { console.warn('[projects] role resolve:', e); }
    }
    var role = (typeof HOUSING_SESSION !== 'undefined' && HOUSING_SESSION.role) || savedRole;
    window.currentRole = role;
    window._realRole   = role;

    if (typeof initModuleEnablement === 'function') try { initModuleEnablement(); } catch(e) {}
    if (window.CLFN_MODULES && !window.CLFN_MODULES.isEnabled('projects')) {
      window.location.href = 'housing.html'; return;
    }

    if (typeof updateHeaderUser             === 'function') updateHeaderUser(role);
    if (typeof updateRoleSwitcherVisibility === 'function') updateRoleSwitcherVisibility();
    if (typeof renderHeaderNav              === 'function') renderHeaderNav();
    if (typeof applyRoleVisibility          === 'function') applyRoleVisibility(role);
    if (typeof setHeaderNavActive           === 'function') setHeaderNavActive('projects');

    if (typeof loadHousingData === 'function') {
      try { await loadHousingData(); } catch(e) { console.warn('[projects] data load:', e); }
    }
    // Units are needed for linking + allocation; fall back to a direct load
    // when loadHousingData didn't populate them on this page.
    if ((!window.housingUnits || !window.housingUnits.length) && typeof sbLoadUnits === 'function') {
      try { window.housingUnits = await sbLoadUnits() || []; } catch(e) { console.warn('[projects] units load:', e); }
    }
    // Pick up ED-customised approval-authority overrides (manageProjects etc.).
    if (typeof initApprovalAuthority === 'function') { try { initApprovalAuthority(); } catch(e) {} }

    var view = document.getElementById('projectsView');
    if (view) view.style.display = 'flex';

    if (!_prjCanManage()) {
      var newBtn = document.getElementById('prj_new_btn');
      if (newBtn) newBtn.style.display = 'none';
    }

    await Promise.all([_prjLoad(), _prjLoadLots()]);
    renderProjectsList();

    // Deep link: projects.html?project=<id> auto-opens that project.
    var params = new URLSearchParams(window.location.search);
    var open = params.get('project');
    if (open) openPrjModal(open);
  } catch(e) {
    console.error('[projects] init error:', e);
  } finally {
    document.body.style.opacity = '1';
  }
}());
