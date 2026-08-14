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
  { id: 'lot_development',     label: 'Lot Development' },
  { id: 'house_build',         label: 'House Build' },
  { id: 'mixed',               label: 'Mixed (Lots + Builds)' },
  { id: 'commercial_building', label: 'Commercial Building' },
  { id: 'band_building',       label: 'Band Building' },
  { id: 'infrastructure',      label: 'Infrastructure Project' },
];
var PRJ_STATUSES = ['planning', 'active', 'on_hold', 'completed', 'cancelled'];
var PRJ_STATUS_LABELS = {
  planning: 'Planning', active: 'Active', on_hold: 'On Hold',
  completed: 'Completed', cancelled: 'Cancelled',
};
var PRJ_LOT_STATUSES = ['raw', 'serviced', 'built'];
var PRJ_LOT_STATUS_LABELS = { raw: 'Raw', serviced: 'Serviced', built: 'Built' };

// Funder-compliance document slots on every expense (cost line): funders ask
// for the invoice copy, confirmation the contractor/supplier was paid (EFT
// confirmation), and proof it cleared the bank account (statement).
var PRJ_EXP_DOC_KINDS = [
  { k: 'invoice', label: 'Invoice' },
  { k: 'eft',     label: 'EFT / Payment' },
  { k: 'bank',    label: 'Bank proof' },
];

// Selection state for building a payment request (expense id -> true).
window._prjReqSel = {};

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
PRJ_MILESTONE_TEMPLATES.commercial_building = [
  'Funding confirmed',
  'Design & drawings finalized',
  'Permits & approvals',
  'Site prep & foundation',
  'Structural framing',
  'Building envelope (roof / walls / glazing)',
  'Mechanical / electrical / plumbing rough-in',
  'Interior fit-out',
  'Fire & accessibility inspections',
  'Final inspection & occupancy permit',
  'Handover / lease-up',
];
PRJ_MILESTONE_TEMPLATES.band_building = [
  'Funding confirmed',
  'Community consultation',
  'Design & drawings finalized',
  'Permits & approvals',
  'Site prep & foundation',
  'Structural framing',
  'Building envelope (roof / walls / glazing)',
  'Mechanical / electrical / plumbing rough-in',
  'Interior fit-out',
  'Final inspection & occupancy permit',
  'Grand opening / handover',
];
PRJ_MILESTONE_TEMPLATES.infrastructure = [
  'Funding confirmed',
  'Engineering & design',
  'Environmental assessment',
  'Permits & approvals',
  'Tender & award',
  'Site prep / clearing',
  'Construction',
  'Commissioning & testing',
  'Final inspection',
  'In service',
];

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
          return { id: _prjUuid(), name: name, targetDate: null, done: false, completedDate: null, notes: '', budgetAmount: null };
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
  _prjRenderPnl();
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
        '<button type="button" class="tic-tab"            data-modal-tab="pnl"        onclick="_prjSwitchTab(\'pnl\')"        role="tab">P &amp; L</button>' +
        '<button type="button" class="tic-tab"            data-modal-tab="lots"       onclick="_prjSwitchTab(\'lots\')"       role="tab">Lots &amp; Units</button>' +
        '<button type="button" class="tic-tab"            data-modal-tab="documents"  onclick="_prjSwitchTab(\'documents\')"  role="tab">Documents</button>' +
      '</div>' +

      '<div class="tic-body">' +
        '<div class="tic-panel tic-active" data-modal-panel="overview"   id="prj_panel_overview"></div>' +
        '<div class="tic-panel"            data-modal-panel="milestones" id="prj_panel_milestones"></div>' +
        '<div class="tic-panel"            data-modal-panel="costs"      id="prj_panel_costs"></div>' +
        '<div class="tic-panel"            data-modal-panel="pnl"        id="prj_panel_pnl"></div>' +
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
  if (name === 'pnl') _prjRenderPnl();   // recompute from the latest expenses/budgets
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

  var grants = d.data.grants || [];
  var hasGrants = grants.length > 0;
  var grantRows = grants.map(function(g, i) {
    var agrChip = (g.doc && g.doc.path)
      ? '<span class="prj-doc-chip prj-doc-ok">' +
          '<a href="#" onclick="_prjOpenGrantDoc(' + i + ');return false;" title="Open ' + _prjEsc(g.doc.name || 'funding agreement') + '">📄 Agreement</a>' +
          '<button type="button" title="Detach the funding agreement" onclick="_prjUnlinkGrantDoc(' + i + ')">✕</button>' +
        '</span>'
      : '<button type="button" class="prj-doc-chip prj-doc-missing" title="Attach the signed funding agreement" onclick="_prjAttachGrantDoc(' + i + ')">📎 Agreement</button>';
    return '<div class="prj-row prj-row-grant">' +
      '<input class="tic-input" type="text" placeholder="Funder (e.g. ISC, CMHC, OFNLP)" value="' + _prjEsc(g.source || '') + '" oninput="_prjGrantField(' + i + ',\'source\',this.value)"/>' +
      '<input class="tic-input" type="text" placeholder="Agreement / reference #" value="' + _prjEsc(g.reference || '') + '" oninput="_prjGrantField(' + i + ',\'reference\',this.value)"/>' +
      '<input class="tic-input" type="number" min="0" step="0.01" placeholder="Amount" value="' + (g.amount != null ? _prjEsc(g.amount) : '') + '" onchange="_prjGrantField(' + i + ',\'amount\',this.value);_prjGrantsRecalc()"/>' +
      '<div style="display:flex;align-items:center;">' + agrChip + '</div>' +
      '<button type="button" class="prj-row-remove" title="Remove grant" onclick="_prjGrantRemove(' + i + ')">✕</button>' +
    '</div>';
  }).join('');

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
        '<div class="f"><label>Funded Budget (CAD)' + (hasGrants ? ' <span style="font-size:10px;font-weight:400;color:var(--muted);">(= sum of grants below)</span>' : '') + '</label><input id="prj_f_budget" class="tic-input" type="number" min="0" step="0.01" placeholder="e.g. 2500000" value="' + (d.budget != null ? _prjEsc(d.budget) : '') + '"' + (hasGrants ? ' disabled' : '') + ' oninput="window._prjDraft.budget=(this.value===\'\'?null:Number(this.value));_prjRefreshStrip()"/></div>' +
        '<div class="f"><label>PO # <span style="font-size:10px;font-weight:400;color:var(--muted);">(from accounting)</span></label><input id="prj_f_po" class="tic-input" type="text" placeholder="e.g. PO-2026-0042" value="' + _prjEsc(d.data.poNumber || '') + '" oninput="window._prjDraft.data.poNumber=this.value"/></div>' +
        '<div class="f"><label>Department # <span style="font-size:10px;font-weight:400;color:var(--muted);">(cost-centre)</span></label><input id="prj_f_dept" class="tic-input" type="text" placeholder="e.g. 15-4200" value="' + _prjEsc(d.data.deptNumber || '') + '" oninput="window._prjDraft.data.deptNumber=this.value"/></div>' +
        '<div class="f"><label>Start Date</label><input id="prj_f_start" class="tic-input" type="date" value="' + _prjEsc(d.start_date || '') + '" onchange="window._prjDraft.start_date=this.value||null"/></div>' +
        '<div class="f"><label>Target Completion</label><input id="prj_f_target" class="tic-input" type="date" value="' + _prjEsc(d.target_date || '') + '" onchange="window._prjDraft.target_date=this.value||null;_prjRefreshStrip()"/></div>' +
      '</div>' +
    '</div>' +
    '<div class="tic-section">' +
      '<div class="tic-section-h">Grants / Funding Agreements</div>' +
      '<div style="font-size:12px;color:var(--muted);margin-bottom:8px;">A project can be funded by more than one grant. When grants are listed, the Funded Budget above is their sum, and payment requests are made against a specific grant.</div>' +
      '<div class="prj-rows">' + grantRows + '</div>' +
      '<button type="button" class="prj-addrow" onclick="_prjGrantAdd()">+ Add grant</button>' +
    '</div>' +
    '<div class="tic-section">' +
      '<div class="tic-section-h">Description</div>' +
      '<textarea id="prj_f_desc" class="tic-textarea" rows="4" placeholder="What this project delivers, funding agreement reference, conditions…" oninput="window._prjDraft.data.description=this.value">' + _prjEsc(d.data.description || '') + '</textarea>' +
    '</div>' +
    '<div class="tic-section" id="prj_linked_rfqs_section" style="display:none;">' +
      '<div class="tic-section-h">Linked RFQs</div>' +
      '<div id="prj_linked_rfqs"></div>' +
    '</div>';
  _prjLoadLinkedRfqs();
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

// ── Grants (multiple funding agreements per project) ─────────────────────────
function _prjGrantField(i, key, val) {
  var g = window._prjDraft.data.grants;
  if (!g || !g[i]) return;
  g[i][key] = key === 'amount' ? ((val === '' || val == null) ? null : Math.round(Number(val) * 100) / 100) : val;
  if (key === 'source') _prjGrantsSyncFundingSource();
}
function _prjGrantAdd() {
  var d = window._prjDraft;
  if (!d.data.grants) d.data.grants = [];
  d.data.grants.push({ id: _prjUuid(), source: '', reference: '', amount: null });
  _prjGrantsRecalc();
}
function _prjGrantRemove(i) {
  var d = window._prjDraft;
  if (!d.data.grants || !d.data.grants[i]) return;
  d.data.grants.splice(i, 1);
  _prjGrantsRecalc();
}
// Funding-agreement attachment per grant (g.doc = {path, name}) — same
// pattern as the expense compliance docs: upload to projects/<id>/grants/,
// meta entity 'project' so the agreement also files into the Documents tab.
function _prjAttachGrantDoc(i) {
  var d = window._prjDraft;
  if (!d || !_prjCanManage()) return;
  if (!d.id) { showToast('Save the project first, then attach the agreement', { type: 'error' }); return; }
  var g = d.data.grants && d.data.grants[i];
  if (!g) return;

  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.png,.jpg,.jpeg,.doc,.docx';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.onchange = async function() {
    var file = input.files && input.files[0];
    input.remove();
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { showToast('File is too large (25 MB max)', { type: 'error' }); return; }
    var safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
    var path = 'projects/' + d.id + '/grants/' + g.id + '/' + safeName;
    try {
      showToast('Uploading ' + safeName + '…');
      await sbUploadFile(path, file);
      if (typeof sbSaveFileMeta === 'function') {
        sbSaveFileMeta('project', d.id, path, file.name, file.size, file.type);
      }
      g.doc = { path: path, name: file.name };
      await _prjSaveProject({ id: d.id, data: d.data, updated_at: new Date().toISOString() }, false);
      _prjSyncCache(d);
      if (typeof auditEntry === 'function') {
        auditEntry('PRJ:' + d.id, 'project_grant_doc_attached', 'Funding agreement ' + file.name + ' attached to grant ' + (g.source || g.reference || '') + ' on ' + (d.project_number || d.name));
      }
      _prjRenderOverview();
      showToast('Funding agreement attached');
    } catch(e) {
      console.warn('[Projects] grant doc upload:', e);
      showToast('Upload failed — check your connection and try again', { type: 'error' });
    }
  };
  input.click();
}

async function _prjOpenGrantDoc(i) {
  var d = window._prjDraft;
  var g = d && d.data.grants && d.data.grants[i];
  if (!g || !g.doc || !g.doc.path) return;
  try {
    var url = await sbGetSignedUrl(g.doc.path);
    if (url) window.open(url, '_blank', 'noopener');
    else showToast('Could not open the agreement', { type: 'error' });
  } catch(err) {
    console.warn('[Projects] open grant doc:', err);
    showToast('Could not open the agreement', { type: 'error' });
  }
}

function _prjUnlinkGrantDoc(i) {
  var d = window._prjDraft;
  if (!d || !_prjCanManage()) return;
  var g = d.data.grants && d.data.grants[i];
  if (!g || !g.doc || typeof showConfirm !== 'function') return;
  showConfirm({
    title: 'Detach funding agreement?',
    message: 'Detach "' + _prjEsc(g.doc.name || '') + '" from this grant? The file itself stays in the project\'s Documents tab.',
    confirmText: 'Detach',
  }).then(async function(ok) {
    if (!ok) return;
    delete g.doc;
    if (d.id) {
      try {
        await _prjSaveProject({ id: d.id, data: d.data, updated_at: new Date().toISOString() }, false);
        _prjSyncCache(d);
      } catch(err) { console.warn('[Projects] detach grant doc save:', err); }
    }
    _prjRenderOverview();
  });
}

// When grants exist the project budget is their sum; funding_source becomes
// the funder names joined (keeps the column searchable / meaningful).
function _prjGrantsRecalc() {
  var d = window._prjDraft;
  var grants = d.data.grants || [];
  if (grants.length) {
    d.budget = Math.round(grants.reduce(function(s, g){ return s + (Number(g.amount) || 0); }, 0) * 100) / 100;
  }
  _prjGrantsSyncFundingSource();
  _prjRenderOverview();
  _prjRefreshStrip();
}
function _prjGrantsSyncFundingSource() {
  var d = window._prjDraft;
  var grants = d.data.grants || [];
  if (grants.length) {
    d.funding_source = grants.map(function(g){ return g.source; }).filter(Boolean).join(', ');
  }
}

// ── Linked RFQs (rfq.data.capital_project_id set on the RFQ Details tab) ─────
async function _prjLoadLinkedRfqs() {
  var d = window._prjDraft;
  if (!d || !d.id) return;
  var pid = d.id;
  try {
    var r = await fetch(
      window.SUPABASE_URL + '/rest/v1/housing_rfq?select=id,status,award_amount,sow_project_number,data&data-%3E%3Ecapital_project_id=eq.' + encodeURIComponent(pid) + '&order=created_at.desc&limit=100',
      { headers: _prjHeaders() }
    );
    if (!r.ok) return;
    var rfqs = await r.json();
    // Modal may have moved on to another project while we fetched.
    if (!window._prjDraft || window._prjDraft.id !== pid) return;
    var section = document.getElementById('prj_linked_rfqs_section');
    var host = document.getElementById('prj_linked_rfqs');
    if (!section || !host || !rfqs.length) return;
    section.style.display = '';
    host.innerHTML = rfqs.map(function(q) {
      return '<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px;align-items:center;">' +
        '<span><a href="rfq.html?rfq=' + encodeURIComponent(q.id) + '" style="color:var(--text);font-weight:600;">' + _prjEsc(q.id) + '</a>' +
          (q.sow_project_number ? ' <span style="color:var(--muted);font-size:11px;">· ' + _prjEsc(q.sow_project_number) + '</span>' : '') + '</span>' +
        '<span style="white-space:nowrap;color:var(--muted);">' + _prjEsc(q.status || '') +
          (q.award_amount ? ' · ' + _prjMoney(q.award_amount, true) : '') + '</span>' +
      '</div>';
    }).join('');
  } catch(e) { console.warn('[Projects] linked RFQs:', e); }
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
      return { id: _prjUuid(), name: name, targetDate: null, done: false, completedDate: null, notes: '', budgetAmount: null };
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
    var mover = '<span class="prj-ms-mover">' +
      '<button type="button" title="Move up" ' + (i === 0 ? 'disabled ' : '') + 'onclick="_prjMsMove(' + i + ', -1)">▲</button>' +
      '<button type="button" title="Move down" ' + (i === ms.length - 1 ? 'disabled ' : '') + 'onclick="_prjMsMove(' + i + ', 1)">▼</button>' +
    '</span>';
    return '<div class="prj-row prj-row-ms' + (m.done ? ' prj-row-done' : '') + '">' +
      mover +
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
function _prjMsMove(i, dir) {
  var ms = window._prjDraft.data.milestones;
  var j = i + dir;
  if (!ms || !ms[i] || j < 0 || j >= ms.length) return;
  var tmp = ms[i]; ms[i] = ms[j]; ms[j] = tmp;
  _prjRenderMilestones();
  _prjRenderPnl();   // the P & L rows follow milestone order
}

function _prjMsToggle(i, checked) {
  var ms = window._prjDraft.data.milestones;
  if (!ms || !ms[i]) return;
  ms[i].done = checked;
  ms[i].completedDate = checked ? new Date().toISOString().slice(0, 10) : null;
  _prjRenderMilestones();
}
function _prjMsAdd() {
  window._prjDraft.data.milestones.push({ id: _prjUuid(), name: '', targetDate: null, done: false, completedDate: null, notes: '', budgetAmount: null });
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
    var claimed = _prjExpClaim(e);
    // Selection cell: checkbox for unclaimed rows (builds the next payment
    // request); a lock for rows already included in one.
    var selCell = claimed
      ? '<span title="Included in payment request ' + _prjEsc(claimed.number) + '" style="font-size:13px;">🔒</span>'
      : '<input type="checkbox"' + (window._prjReqSel[e.id] ? ' checked' : '') + ' title="Include in the next payment request" onchange="_prjReqToggle(\'' + _prjEsc(e.id) + '\', this.checked)" style="accent-color:var(--yellow);width:15px;height:15px;cursor:pointer;"/>';

    // Funder-compliance documents: invoice + proof of payment (EFT) + bank
    // statement proof, one chip per slot.
    var docChips = PRJ_EXP_DOC_KINDS.map(function(k){ return _prjDocChip(e, i, k.k, k.label); }).join('');
    var attachedCount = PRJ_EXP_DOC_KINDS.filter(function(k){ return _prjExpDoc(e, k.k); }).length;
    var docStatus = attachedCount === PRJ_EXP_DOC_KINDS.length
      ? '<span style="font-size:11px;color:#15803d;font-weight:600;white-space:nowrap;">✓ Docs complete</span>'
      : '<span style="font-size:11px;color:var(--warn-amber-text,#b45309);white-space:nowrap;">' + attachedCount + ' of ' + PRJ_EXP_DOC_KINDS.length + ' docs</span>';
    var claimedBadge = claimed
      ? '<span style="font-size:11px;font-weight:700;color:#1d4ed8;background:#eff6ff;border-radius:10px;padding:2px 8px;white-space:nowrap;">Claimed · ' + _prjEsc(claimed.number) + '</span>'
      : '';

    var vendorInfo = [e.vendorAddress, e.vendorPhone].filter(Boolean).join(' · ');
    var vendorCell = e.contractorId
      ? '<a href="contractors.html?openContractor=' + encodeURIComponent(e.contractorId) + '" title="Open the contractor file' + (vendorInfo ? ' — ' + _prjEsc(vendorInfo) : '') + '" style="color:var(--text);text-decoration:underline;">🔗 ' + _prjEsc(e.vendor || '—') + '</a>'
      : '<span' + (vendorInfo ? ' title="' + _prjEsc(vendorInfo) + '"' : '') + '>' + _prjEsc(e.vendor || '—') + '</span>';
    return '<div class="prj-row prj-row-exp' + (claimed ? ' prj-row-claimed' : '') + '">' +
      '<div>' + selCell + '</div>' +
      '<div style="font-size:12px;white-space:nowrap;">' + _prjEsc(e.date || '—') + '</div>' +
      '<div style="font-size:13px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;">' + vendorCell + '</div>' +
      '<div style="font-size:12px;color:var(--muted);min-width:0;overflow:hidden;text-overflow:ellipsis;">' + _prjEsc(e.description || '') + '</div>' +
      '<div style="font-size:13px;font-weight:600;text-align:right;white-space:nowrap;">' + _prjMoney(e.amount, true) + '</div>' +
      '<div style="font-size:11px;color:var(--muted);min-width:0;overflow:hidden;text-overflow:ellipsis;">' + (msName ? '🏁 ' + _prjEsc(msName) : '') + '</div>' +
      '<button type="button" class="prj-row-remove" title="Remove expense" onclick="_prjExpRemove(' + i + ')">✕</button>' +
      '<div class="prj-exp-docs"><span style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;">Docs</span>' + docChips + '<span style="flex:1;"></span>' + docStatus + claimedBadge + '</div>' +
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
        '<div class="f" style="position:relative;"><label>Vendor / Payee *</label>' +
          '<input id="prj_exp_vendor" class="tic-input" type="text" autocomplete="off" placeholder="Search contractors or type a business name…"' +
            ' oninput="_prjVendorInput(this.value)" onfocus="_prjVendorSearch(this.value)"' +
            ' onblur="setTimeout(function(){var dd=document.getElementById(\'prj_exp_vendor_dd\');if(dd)dd.style.display=\'none\';},180)"/>' +
          '<input type="hidden" id="prj_exp_vendor_ctid"/>' +
          '<div id="prj_exp_vendor_dd" class="prj-vendor-dd" style="display:none;"></div>' +
          '<div id="prj_exp_vendor_link" style="display:none;font-size:11px;color:#15803d;margin-top:4px;"></div>' +
        '</div>' +
        '<div class="f"><label>Amount (CAD) *</label><input id="prj_exp_amount" class="tic-input" type="number" min="0" step="0.01" placeholder="0.00"/></div>' +
        '<div class="f" id="prj_exp_addr_f"><label>Business Address *</label><input id="prj_exp_vendor_addr" class="tic-input" type="text" placeholder="Street, town, province"/></div>' +
        '<div class="f" id="prj_exp_phone_f"><label>Business Phone *</label><input id="prj_exp_vendor_phone" class="tic-input" type="tel" placeholder="e.g. 705-555-0100"/></div>' +
        '<div class="f"><label>Description</label><input id="prj_exp_desc" class="tic-input" type="text" placeholder="What was this for?"/></div>' +
        '<div class="f"><label>Milestone (optional)</label><select id="prj_exp_ms" class="tic-input">' + msOpts + '</select></div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px;">' +
        '<span style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;">Attach docs</span>' +
        '<span id="prj_exp_staged" style="display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap;"></span>' +
        '<span style="flex:1;"></span>' +
        '<button type="button" class="btn btn-primary" onclick="_prjExpAdd()">+ Add Expense</button>' +
      '</div>' +
      (d.id ? '' : '<div style="font-size:11px;color:var(--muted);margin-top:6px;">Save the project to enable document attachments.</div>') +
    '</div>' +
    '<div class="tic-section">' +
      '<div class="tic-section-h">Expenses (' + exp.length + ')</div>' +
      (exp.length ? '<div style="font-size:12px;color:var(--muted);margin-bottom:8px;">Attach the funder-compliance documents to each cost line (invoice, EFT payment confirmation, bank statement proof), then tick the lines to include in the next payment request.</div>' : '') +
      '<div class="prj-rows">' + (expRows || '<div style="color:var(--muted);font-size:13px;">No expenses logged yet.</div>') + '</div>' +
    '</div>' +
    _prjPaymentRequestSectionHtml();
  _prjRenderStagedChips();
}

// ── Vendor / payee picker ────────────────────────────────────────────────────
// The vendor field searches the contractor registry (window._contractors —
// loaded by loadHousingData at boot). Picking a contractor links the expense
// to it (contractorId; address/phone come from the contractor file). Typing a
// name without picking = a manual vendor, which requires business name,
// address, and phone so the funder-compliance record is complete.
function _prjVendorInput(val) {
  var ctid = document.getElementById('prj_exp_vendor_ctid');
  if (ctid && ctid.value) {   // typing breaks an existing contractor link
    ctid.value = '';
    _prjVendorSyncManualFields();
  }
  _prjVendorSearch(val);
}

function _prjVendorSearch(q) {
  var dd = document.getElementById('prj_exp_vendor_dd');
  if (!dd) return;
  var list = (window._contractors || []).filter(function(c){ return c && c.name && !c.archived; });
  var qq = (q || '').toLowerCase().trim();
  if (qq) {
    list = list.filter(function(c) {
      return (c.name || '').toLowerCase().indexOf(qq) !== -1
          || (c.trade || '').toLowerCase().indexOf(qq) !== -1;
    });
  }
  list = list.slice(0, 8);
  if (!list.length) { dd.style.display = 'none'; return; }
  dd.innerHTML = list.map(function(c) {
    return '<div class="prj-vendor-dd-item" onmousedown="_prjVendorPick(\'' + _prjEsc(String(c.id)) + '\')">' +
      '<span style="font-weight:600;">' + _prjEsc(c.name) + '</span>' +
      '<span style="color:var(--muted);font-size:11px;"> ' + _prjEsc(c.trade || '') + (c.phone ? ' · ' + _prjEsc(c.phone) : '') + '</span>' +
    '</div>';
  }).join('') +
  '<div class="prj-vendor-dd-item" style="color:var(--muted);font-size:11px;cursor:default;" onmousedown="event.preventDefault()">…or keep typing to enter a vendor manually (address &amp; phone required)</div>';
  dd.style.display = '';
}

function _prjVendorPick(ctId) {
  var ct = (window._contractors || []).find(function(c){ return String(c.id) === ctId; });
  if (!ct) return;
  var nameEl = document.getElementById('prj_exp_vendor');
  var ctidEl = document.getElementById('prj_exp_vendor_ctid');
  var dd     = document.getElementById('prj_exp_vendor_dd');
  if (nameEl) nameEl.value = ct.name || '';
  if (ctidEl) ctidEl.value = String(ct.id);
  if (dd) dd.style.display = 'none';
  _prjVendorSyncManualFields();
}

function _prjVendorUnlink() {
  var ctidEl = document.getElementById('prj_exp_vendor_ctid');
  if (ctidEl) ctidEl.value = '';
  _prjVendorSyncManualFields();
}

// Linked contractor → hide the manual address/phone fields and show the link
// line; manual vendor → show + require them.
function _prjVendorSyncManualFields() {
  var ctidEl = document.getElementById('prj_exp_vendor_ctid');
  var linked = !!(ctidEl && ctidEl.value);
  var addrF  = document.getElementById('prj_exp_addr_f');
  var phoneF = document.getElementById('prj_exp_phone_f');
  var link   = document.getElementById('prj_exp_vendor_link');
  if (addrF)  addrF.style.display  = linked ? 'none' : '';
  if (phoneF) phoneF.style.display = linked ? 'none' : '';
  if (link) {
    if (linked) {
      var ct = (window._contractors || []).find(function(c){ return String(c.id) === ctidEl.value; });
      link.innerHTML = '🔗 Linked to contractor file' + (ct && ct.phone ? ' · ' + _prjEsc(ct.phone) : '') +
        ' <a href="#" onclick="_prjVendorUnlink();return false;" style="color:var(--muted);">unlink</a>';
      link.style.display = '';
    } else {
      link.style.display = 'none';
    }
  }
}

// ── Staged documents on the entry form ───────────────────────────────────────
// The invoice / EFT / bank proof can be attached while logging the expense —
// they upload when "+ Add Expense" is clicked, so the docs land on the new
// cost line immediately instead of requiring a second trip to the row.
window._prjExpStagedDocs = {};

function _prjRenderStagedChips() {
  var host = document.getElementById('prj_exp_staged');
  if (!host) return;
  var canAttach = !!(window._prjDraft && window._prjDraft.id);
  host.innerHTML = PRJ_EXP_DOC_KINDS.map(function(k) {
    var f = window._prjExpStagedDocs[k.k];
    if (f) {
      return '<span class="prj-doc-chip prj-doc-ok"><span title="' + _prjEsc(f.name) + '">📄 ' + _prjEsc(k.label) + '</span>' +
        '<button type="button" title="Remove staged file" onclick="_prjUnstageExpDoc(\'' + k.k + '\')">✕</button></span>';
    }
    return '<button type="button" class="prj-doc-chip prj-doc-missing"' + (canAttach ? '' : ' disabled title="Save the project first"') +
      ' onclick="_prjStageExpDoc(\'' + k.k + '\')">📎 ' + _prjEsc(k.label) + '</button>';
  }).join('');
}

function _prjStageExpDoc(kind) {
  if (!window._prjDraft || !window._prjDraft.id) { showToast('Save the project first, then attach documents', { type: 'error' }); return; }
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.onchange = function() {
    var file = input.files && input.files[0];
    input.remove();
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { showToast('File is too large (25 MB max)', { type: 'error' }); return; }
    window._prjExpStagedDocs[kind] = file;
    _prjRenderStagedChips();
  };
  input.click();
}

function _prjUnstageExpDoc(kind) {
  delete window._prjExpStagedDocs[kind];
  _prjRenderStagedChips();
}

// Shared uploader: storage + DocLibrary meta + set the slot on the expense.
// Does NOT save the project row — callers batch their own save.
async function _prjUploadExpenseDocFile(e, kind, file) {
  var d = window._prjDraft;
  var safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
  var path = 'projects/' + d.id + '/expenses/' + e.id + '/' + kind + '_' + safeName;
  await sbUploadFile(path, file);
  if (typeof sbSaveFileMeta === 'function') {
    sbSaveFileMeta('project', d.id, path, file.name, file.size, file.type);
  }
  if (!e.docs) e.docs = {};
  e.docs[kind] = { path: path, name: file.name };
}

async function _prjExpAdd() {
  var d = window._prjDraft;
  var get = function(id){ var el = document.getElementById(id); return el ? el.value.trim() : ''; };
  var amount = Number(get('prj_exp_amount'));
  if (!amount || amount <= 0) { showToast('Enter an expense amount', { type: 'error' }); return; }
  var vendor = get('prj_exp_vendor');
  if (!vendor) { showToast('Enter the vendor / payee', { type: 'error' }); return; }
  var ctId = get('prj_exp_vendor_ctid') || null;
  var addr = '', phone = '';
  if (ctId) {
    var ct = (window._contractors || []).find(function(c){ return String(c.id) === ctId; });
    addr  = (ct && ct.address) || '';
    phone = (ct && ct.phone) || '';
  } else {
    addr  = get('prj_exp_vendor_addr');
    phone = get('prj_exp_vendor_phone');
    if (!addr || !phone) {
      showToast('This vendor is not a registered contractor — enter the business address and phone number', { type: 'error' });
      return;
    }
  }

  var expense = {
    id: _prjUuid(),
    date: get('prj_exp_date') || new Date().toISOString().slice(0, 10),
    vendor: vendor,
    contractorId: ctId,
    vendorAddress: addr,
    vendorPhone: phone,
    description: get('prj_exp_desc'),
    amount: Math.round(amount * 100) / 100,
    milestoneId: get('prj_exp_ms') || null,
    enteredBy: (window.HOUSING_SESSION && HOUSING_SESSION.email) || window.currentRole || 'staff',
    createdAt: new Date().toISOString(),
  };
  d.data.expenses.push(expense);

  // Upload any staged compliance docs onto the new line, then persist so the
  // uploads can't be orphaned. (Staging is disabled until the project is
  // saved, so d.id is guaranteed here whenever staged files exist.)
  var staged = Object.keys(window._prjExpStagedDocs || {});
  if (staged.length && d.id) {
    var failed = 0;
    for (var i = 0; i < staged.length; i++) {
      try { await _prjUploadExpenseDocFile(expense, staged[i], window._prjExpStagedDocs[staged[i]]); }
      catch(e) { console.warn('[Projects] staged doc upload:', e); failed++; }
    }
    try {
      await _prjSaveProject({ id: d.id, data: d.data, updated_at: new Date().toISOString() }, false);
      _prjSyncCache(d);
    } catch(e) { console.warn('[Projects] expense save:', e); }
    if (failed) showToast(failed + ' document upload' + (failed === 1 ? '' : 's') + ' failed — re-attach from the cost line', { type: 'error' });
  } else if (d.id) {
    // Persist the new line right away (matches the attach-doc behavior).
    _prjSaveProject({ id: d.id, data: d.data, updated_at: new Date().toISOString() }, false)
      .then(function(){ _prjSyncCache(d); })
      .catch(function(e){ console.warn('[Projects] expense save:', e); });
  }

  window._prjExpStagedDocs = {};
  _prjRenderCosts();
  _prjRefreshStrip();
}

function _prjExpRemove(i) {
  var exp = window._prjDraft.data.expenses;
  if (!exp || !exp[i]) return;
  if (exp[i].claimedIn) {
    showToast('This cost line is part of payment request ' + (exp[i].claimedNumber || '') + ' — undo that request first', { type: 'error' });
    return;
  }
  var doIt = function() { delete window._prjReqSel[exp[i].id]; exp.splice(i, 1); _prjRenderCosts(); _prjRefreshStrip(); };
  if (typeof showConfirm === 'function') {
    showConfirm({ title: 'Remove expense?', message: 'Remove this ' + _prjMoney(exp[i].amount, true) + ' expense from the project?', confirmText: 'Remove', danger: true })
      .then(function(ok){ if (ok) doIt(); });
  } else { doIt(); }
}

// ── P & L tab ────────────────────────────────────────────────────────────────
// Budget vs actual with variance, one row per milestone (the milestone list is
// the project's cost-category breakdown). Milestone budgets are entered here
// (stored as budgetAmount on each milestone in the data jsonb); actuals are
// the expenses tagged to that milestone on the Costs tab.
function _prjRenderPnl() {
  var d = window._prjDraft;
  var host = document.getElementById('prj_panel_pnl');
  if (!host || !d) return;
  var ms  = d.data.milestones || [];
  var exp = d.data.expenses || [];

  var actualFor = function(msId) {
    return exp.filter(function(e){ return e.milestoneId === msId; })
              .reduce(function(s, e){ return s + (Number(e.amount) || 0); }, 0);
  };
  var varCell = function(v, hasBudget) {
    if (!hasBudget) return '<td style="text-align:right;color:var(--muted);">—</td>';
    var color = v < 0 ? '#b91c1c' : '#15803d';
    return '<td style="text-align:right;font-weight:600;color:' + color + ';">' + (v < 0 ? '-' : '') + _prjMoney(Math.abs(v), true) + '</td>';
  };

  // Rows a staff member removed from the P & L (e.g. "Funding confirmed" has
  // no cost) carry pnlHidden on the milestone — the milestone itself stays on
  // the Milestones tab. Hidden rows that still have money against them are
  // rolled into one aggregate line so the totals never understate.
  var budgetTotal = 0, actualTotal = 0;
  var hiddenBudget = 0, hiddenActual = 0, hiddenNames = [];
  var rows = '';
  ms.forEach(function(m, i) {
    var budget = (m.budgetAmount != null && m.budgetAmount !== '') ? Number(m.budgetAmount) : null;
    var actual = actualFor(m.id);
    budgetTotal += budget || 0;
    actualTotal += actual;
    if (m.pnlHidden) {
      hiddenBudget += budget || 0;
      hiddenActual += actual;
      hiddenNames.push({ i: i, name: m.name || '(unnamed)' });
      return;
    }
    rows += '<tr' + (m.done ? ' style="opacity:.72;"' : '') + '>' +
      '<td>' + _prjEsc(m.name || '(unnamed)') + (m.done ? ' <span style="color:#15803d;" title="Milestone complete">✓</span>' : '') + '</td>' +
      '<td style="text-align:right;"><input class="tic-input" type="number" min="0" step="0.01" placeholder="0.00" value="' + (budget != null ? _prjEsc(budget) : '') + '" onchange="_prjMsBudget(' + i + ', this.value)" style="max-width:130px;text-align:right;padding:5px 9px;font-size:12px;display:inline-block;"/></td>' +
      '<td style="text-align:right;">' + (actual ? _prjMoney(actual, true) : '<span style="color:var(--muted);">—</span>') + '</td>' +
      varCell(budget != null ? budget - actual : 0, budget != null) +
      '<td style="width:24px;"><button type="button" class="prj-row-remove" title="Remove this row from the P &amp; L (the milestone stays on the Milestones tab)" onclick="_prjPnlHide(' + i + ')">✕</button></td>' +
    '</tr>';
  });
  if (hiddenBudget > 0 || hiddenActual > 0) {
    rows += '<tr><td style="color:var(--muted);">Removed rows (still counted)</td>' +
      '<td style="text-align:right;color:var(--muted);">' + (hiddenBudget ? _prjMoney(hiddenBudget, true) : '—') + '</td>' +
      '<td style="text-align:right;color:var(--muted);">' + (hiddenActual ? _prjMoney(hiddenActual, true) : '—') + '</td>' +
      '<td style="text-align:right;color:var(--muted);">—</td><td></td></tr>';
  }

  var untagged = exp.filter(function(e){ return !e.milestoneId; })
                    .reduce(function(s, e){ return s + (Number(e.amount) || 0); }, 0);
  if (untagged > 0) {
    actualTotal += untagged;
    rows += '<tr><td style="color:var(--muted);">Not tied to a milestone</td>' +
      '<td style="text-align:right;color:var(--muted);">—</td>' +
      '<td style="text-align:right;">' + _prjMoney(untagged, true) + '</td>' +
      '<td style="text-align:right;color:var(--muted);">—</td><td></td></tr>';
  }

  var totalVar = budgetTotal - actualTotal;
  var funded = Number(d.budget) || 0;
  var fundedNote = (funded > 0 && Math.abs(budgetTotal - funded) >= 0.005)
    ? '<div style="font-size:12px;color:var(--warn-amber-text,#b45309);margin-top:8px;">⚠️ Milestone budgets total ' + _prjMoney(budgetTotal, true) + ', but the project\'s funded budget is ' + _prjMoney(funded, true) + '.</div>'
    : '';

  host.innerHTML =
    '<div class="tic-section">' +
      '<div class="tic-section-h">Profit &amp; Loss — Budget vs Actual by Milestone</div>' +
      (ms.length
        ? '<div class="prj-table-wrap"><table class="prj-table"><thead><tr>' +
            '<th>Milestone</th><th style="text-align:right;">Budget</th><th style="text-align:right;">Actual</th><th style="text-align:right;">Variance</th><th></th>' +
          '</tr></thead><tbody>' + rows +
          '<tr style="border-top:2px solid var(--border);"><td style="font-weight:700;">Total</td>' +
            '<td style="text-align:right;font-weight:700;">' + _prjMoney(budgetTotal, true) + '</td>' +
            '<td style="text-align:right;font-weight:700;">' + _prjMoney(actualTotal, true) + '</td>' +
            varCell(totalVar, budgetTotal > 0) +
          '<td></td></tr></tbody></table></div>' + fundedNote +
          (hiddenNames.length
            ? '<div style="font-size:12px;color:var(--muted);margin-top:8px;">Hidden from P &amp; L: ' +
                hiddenNames.map(function(h){ return _prjEsc(h.name) + ' <button type="button" class="btn btn-ghost" style="padding:1px 7px;font-size:10px;" onclick="_prjPnlRestore(' + h.i + ')">restore</button>'; }).join(' · ') +
              '</div>'
            : '') +
          '<div style="font-size:12px;color:var(--muted);margin-top:8px;">Enter each milestone\'s budget here; actuals come from expenses tagged to that milestone on the Costs tab. Variance = budget − actual (red means over budget). Rows without a cost (e.g. "Funding confirmed") can be removed with the ✕ — the milestone itself stays on the Milestones tab.</div>'
        : '<div style="color:var(--muted);font-size:13px;">No milestones yet — add them on the Milestones tab to build the P &amp; L breakdown.</div>') +
    '</div>';
}

function _prjMsBudget(i, val) {
  var ms = window._prjDraft.data.milestones;
  if (!ms || !ms[i]) return;
  ms[i].budgetAmount = (val === '' || val == null) ? null : Math.round(Number(val) * 100) / 100;
  _prjRenderPnl();
}

function _prjPnlHide(i) {
  var ms = window._prjDraft.data.milestones;
  if (!ms || !ms[i]) return;
  ms[i].pnlHidden = true;
  _prjRenderPnl();
}

function _prjPnlRestore(i) {
  var ms = window._prjDraft.data.milestones;
  if (!ms || !ms[i]) return;
  delete ms[i].pnlHidden;
  _prjRenderPnl();
}

// ── Expense document attachments (funder compliance) ─────────────────────────
// Each expense (cost line) has three typed document slots — invoice, EFT
// payment confirmation, bank statement proof — stored as e.docs[kind] =
// {path, name}. Files upload to projects/<id>/expenses/<expenseId>/ and the
// file_uploaded meta row uses entity 'project', so every document also
// appears in the project's Documents tab DocLibrary.
// Backward compat: the earlier single e.doc is treated as the invoice slot.
function _prjExpDoc(e, kind) {
  if (e.docs && e.docs[kind] && e.docs[kind].path) return e.docs[kind];
  if (kind === 'invoice' && e.doc && e.doc.path) return e.doc;
  return null;
}

function _prjExpClaim(e) {
  if (!e.claimedIn) return null;
  var reqs = (window._prjDraft && window._prjDraft.data.paymentRequests) || [];
  var req = reqs.find(function(r){ return r.id === e.claimedIn; });
  return req || { id: e.claimedIn, number: e.claimedNumber || 'REQ-?' };
}

function _prjDocChip(e, i, kind, label) {
  var doc = _prjExpDoc(e, kind);
  if (doc) {
    return '<span class="prj-doc-chip prj-doc-ok">' +
      '<a href="#" onclick="_prjOpenExpenseDoc(' + i + ',\'' + kind + '\');return false;" title="Open ' + _prjEsc(doc.name || 'document') + '">📄 ' + _prjEsc(label) + '</a>' +
      '<button type="button" title="Detach ' + _prjEsc(label) + '" onclick="_prjUnlinkExpenseDoc(' + i + ',\'' + kind + '\')">✕</button>' +
    '</span>';
  }
  return '<button type="button" class="prj-doc-chip prj-doc-missing" title="Attach the ' + _prjEsc(label) + ' document" onclick="_prjAttachExpenseDoc(' + i + ',\'' + kind + '\')">📎 ' + _prjEsc(label) + '</button>';
}

function _prjAttachExpenseDoc(i, kind) {
  var d = window._prjDraft;
  if (!d || !_prjCanManage()) return;
  if (!d.id) { showToast('Save the project first, then attach documents', { type: 'error' }); return; }
  var exp = d.data.expenses;
  if (!exp || !exp[i]) return;
  kind = kind || 'invoice';

  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.onchange = async function() {
    var file = input.files && input.files[0];
    input.remove();
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { showToast('File is too large (25 MB max)', { type: 'error' }); return; }
    var safeName = file.name.replace(/[^A-Za-z0-9._-]/g, '_');
    var path = 'projects/' + d.id + '/expenses/' + exp[i].id + '/' + kind + '_' + safeName;
    try {
      showToast('Uploading ' + safeName + '…');
      await sbUploadFile(path, file);
      if (typeof sbSaveFileMeta === 'function') {
        sbSaveFileMeta('project', d.id, path, file.name, file.size, file.type);
      }
      if (!exp[i].docs) exp[i].docs = {};
      exp[i].docs[kind] = { path: path, name: file.name };
      if (kind === 'invoice' && exp[i].doc) delete exp[i].doc;   // legacy slot superseded
      // Persist right away so the uploaded file can't be orphaned by an
      // unsaved draft.
      await _prjSaveProject({ id: d.id, data: d.data, updated_at: new Date().toISOString() }, false);
      _prjSyncCache(d);
      if (typeof auditEntry === 'function') {
        auditEntry('PRJ:' + d.id, 'project_expense_doc_attached', kind + ' document ' + file.name + ' attached to a ' + _prjMoney(exp[i].amount, true) + ' expense on ' + (d.project_number || d.name));
      }
      _prjRenderCosts();
      showToast('Document attached');
    } catch(e) {
      console.warn('[Projects] expense doc upload:', e);
      showToast('Upload failed — check your connection and try again', { type: 'error' });
    }
  };
  input.click();
}

async function _prjOpenExpenseDoc(i, kind) {
  var d = window._prjDraft;
  var e = d && d.data.expenses && d.data.expenses[i];
  var doc = e && _prjExpDoc(e, kind || 'invoice');
  if (!doc) return;
  try {
    var url = await sbGetSignedUrl(doc.path);
    if (url) window.open(url, '_blank', 'noopener');
    else showToast('Could not open the document', { type: 'error' });
  } catch(err) {
    console.warn('[Projects] open expense doc:', err);
    showToast('Could not open the document', { type: 'error' });
  }
}

function _prjUnlinkExpenseDoc(i, kind) {
  var d = window._prjDraft;
  if (!d || !_prjCanManage()) return;
  var e = d.data.expenses && d.data.expenses[i];
  kind = kind || 'invoice';
  var doc = e && _prjExpDoc(e, kind);
  if (!doc) return;
  if (typeof showConfirm !== 'function') return;
  showConfirm({
    title: 'Detach document?',
    message: 'Detach "' + _prjEsc(doc.name || '') + '" from this expense? The file itself stays in the project\'s Documents tab.',
    confirmText: 'Detach',
  }).then(async function(ok) {
    if (!ok) return;
    if (e.docs && e.docs[kind]) delete e.docs[kind];
    if (kind === 'invoice' && e.doc) delete e.doc;
    if (d.id) {
      try {
        await _prjSaveProject({ id: d.id, data: d.data, updated_at: new Date().toISOString() }, false);
        _prjSyncCache(d);
      } catch(err) { console.warn('[Projects] detach doc save:', err); }
    }
    _prjRenderCosts();
  });
}

// ── Payment requests (claims to funders) ─────────────────────────────────────
// Staff tick cost lines, pick the grant being billed, and export: a PDF claim
// summary sheet plus every attached compliance document downloads, and the
// included lines are marked "Claimed" with the request number so nothing is
// double-claimed. Stored in data.paymentRequests[]:
//   { id, number (REQ-NN within the project), date, grantId|null, funder,
//     grantReference, expenseIds[], total, createdBy, createdAt }

function _prjReqToggle(expId, checked) {
  if (checked) window._prjReqSel[expId] = true;
  else delete window._prjReqSel[expId];
  _prjRenderCosts();
}

function _prjSelectedExpenses() {
  var exp = (window._prjDraft && window._prjDraft.data.expenses) || [];
  return exp.filter(function(e){ return window._prjReqSel[e.id] && !e.claimedIn; });
}

function _prjPaymentRequestSectionHtml() {
  var d = window._prjDraft;
  if (!d) return '';
  var reqs = d.data.paymentRequests || [];
  var sel = _prjSelectedExpenses();
  var selTotal = sel.reduce(function(s, e){ return s + (Number(e.amount) || 0); }, 0);

  var reqRows = reqs.map(function(r) {
    return '<tr>' +
      '<td style="font-weight:600;white-space:nowrap;">' + _prjEsc(r.number) + '</td>' +
      '<td>' + _prjEsc(r.date || '') + '</td>' +
      '<td style="min-width:0;overflow:hidden;text-overflow:ellipsis;">' + _prjEsc(r.funder || '—') + (r.grantReference ? ' <span style="color:var(--muted);font-size:11px;">· ' + _prjEsc(r.grantReference) + '</span>' : '') + '</td>' +
      '<td style="text-align:right;">' + (r.expenseIds || []).length + '</td>' +
      '<td style="text-align:right;font-weight:600;white-space:nowrap;">' + _prjMoney(r.total, true) + '</td>' +
      '<td style="white-space:nowrap;">' +
        '<button type="button" class="btn btn-ghost" style="padding:3px 9px;font-size:11px;" title="Re-export the summary sheet and documents" onclick="_prjExportRequest(\'' + _prjEsc(r.id) + '\')">⬇ Export</button> ' +
        '<button type="button" class="prj-row-remove" title="Undo this payment request (unmarks its cost lines)" onclick="_prjUndoRequest(\'' + _prjEsc(r.id) + '\')">✕</button>' +
      '</td>' +
    '</tr>';
  }).join('');

  return '<div class="tic-section">' +
    '<div class="tic-section-h">Payment Requests (Claims to Funders)</div>' +
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px;">' +
      '<button type="button" class="btn btn-primary" ' + (sel.length ? '' : 'disabled ') + 'onclick="_prjOpenPaymentRequestModal()">📤 New Payment Request' + (sel.length ? ' (' + sel.length + ' selected · ' + _prjMoney(selTotal, true) + ')' : '') + '</button>' +
      (!sel.length ? '<span style="font-size:12px;color:var(--muted);">Tick cost lines above to build a request.</span>' : '') +
    '</div>' +
    (reqs.length
      ? '<div class="prj-table-wrap"><table class="prj-table"><thead><tr><th>Request</th><th>Date</th><th>Funder</th><th style="text-align:right;">Items</th><th style="text-align:right;">Total</th><th></th></tr></thead><tbody>' + reqRows + '</tbody></table></div>'
      : '<div style="font-size:12px;color:var(--muted);">No payment requests yet.</div>') +
  '</div>';
}

function _prjOpenPaymentRequestModal() {
  var d = window._prjDraft;
  if (!d || !_prjCanManage()) return;
  if (!d.id) { showToast('Save the project first', { type: 'error' }); return; }
  var sel = _prjSelectedExpenses();
  if (!sel.length) return;
  var total = sel.reduce(function(s, e){ return s + (Number(e.amount) || 0); }, 0);
  var grants = d.data.grants || [];

  var missingDocs = sel.filter(function(e) {
    return PRJ_EXP_DOC_KINDS.some(function(k){ return !_prjExpDoc(e, k.k); });
  });

  var grantPicker = grants.length
    ? '<div class="f"><label>Bill against grant</label><select id="prj_req_grant" class="tic-input">' +
        grants.map(function(g, i){ return '<option value="' + _prjEsc(g.id) + '"' + (i === 0 ? ' selected' : '') + '>' + _prjEsc((g.source || 'Grant') + (g.reference ? ' — ' + g.reference : '') + (g.amount != null ? ' (' + _prjMoney(g.amount) + ')' : '')) + '</option>'; }).join('') +
      '</select></div>'
    : '<div class="f"><label>Funder</label><input id="prj_req_funder" class="tic-input" type="text" placeholder="Funder name" value="' + _prjEsc(d.funding_source || '') + '"/></div>';

  var ov = document.createElement('div');
  ov.id = 'prjReqModal';
  ov.className = 'modal-overlay modal-overlay-centered modal-z-1100 is-open';
  ov.innerHTML =
    '<div class="modal-body modal-body-lg">' +
      '<div class="modal-hdr">' +
        '<div class="modal-hdr-title">New Payment Request</div>' +
        '<button type="button" class="btn-close-dark-30" onclick="document.getElementById(\'prjReqModal\').remove()">&times;</button>' +
      '</div>' +
      '<div class="modal-body-stack" style="padding:18px 24px;max-height:70vh;overflow-y:auto;">' +
        '<div class="tic-grid-2">' + grantPicker +
          '<div class="f"><label>Request date</label><input id="prj_req_date" class="tic-input" type="date" value="' + new Date().toISOString().slice(0, 10) + '"/></div>' +
        '</div>' +
        (missingDocs.length
          ? '<div style="margin-top:12px;padding:10px 14px;background:var(--warn-amber-bg,#fffbeb);border:1px solid var(--warn-amber-border,#fde68a);border-radius:8px;font-size:12px;color:var(--warn-amber-text,#b45309);">⚠️ ' + missingDocs.length + ' of the selected cost line' + (missingDocs.length === 1 ? ' is' : 's are') + ' missing compliance documents (invoice / EFT / bank proof). You can still export, but the funder may reject the claim.</div>'
          : '') +
        '<div style="margin-top:12px;max-height:220px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;">' +
          sel.map(function(e) {
            var n = PRJ_EXP_DOC_KINDS.filter(function(k){ return _prjExpDoc(e, k.k); }).length;
            return '<div style="display:flex;justify-content:space-between;gap:10px;padding:7px 12px;border-bottom:1px solid var(--border);font-size:12px;">' +
              '<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;">' + _prjEsc(e.date || '') + ' · ' + _prjEsc(e.vendor || '—') + (e.description ? ' · ' + _prjEsc(e.description) : '') + '</span>' +
              '<span style="white-space:nowrap;">' + (n === PRJ_EXP_DOC_KINDS.length ? '<span style="color:#15803d;">✓</span>' : '<span style="color:var(--warn-amber-text,#b45309);">' + n + '/3</span>') + ' <b>' + _prjMoney(e.amount, true) + '</b></span>' +
            '</div>';
          }).join('') +
        '</div>' +
        '<div style="font-size:13px;font-weight:700;margin-top:10px;text-align:right;">Total requested: ' + _prjMoney(total, true) + '</div>' +
        '<p class="txt-help" style="margin-top:10px;">Exporting downloads a PDF claim summary plus every attached document, and marks the included cost lines as claimed under this request number.</p>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button type="button" class="btn btn-ghost" onclick="document.getElementById(\'prjReqModal\').remove()">Cancel</button>' +
        '<button id="prj_req_confirm" type="button" class="btn btn-primary" onclick="_prjRunPaymentRequest()">📤 Export &amp; Mark Claimed</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(ov);
}

async function _prjRunPaymentRequest() {
  var d = window._prjDraft;
  if (!d || !d.id || !_prjCanManage()) return;
  var sel = _prjSelectedExpenses();
  if (!sel.length) return;
  var total = Math.round(sel.reduce(function(s, e){ return s + (Number(e.amount) || 0); }, 0) * 100) / 100;

  var grants = d.data.grants || [];
  var grantId = null, funder = '', grantRef = '';
  var grantSel = document.getElementById('prj_req_grant');
  if (grantSel) {
    grantId = grantSel.value || null;
    var g = grants.find(function(x){ return x.id === grantId; });
    if (g) { funder = g.source || ''; grantRef = g.reference || ''; }
  } else {
    var funderEl = document.getElementById('prj_req_funder');
    funder = funderEl ? funderEl.value.trim() : '';
  }
  var dateEl = document.getElementById('prj_req_date');
  var reqDate = (dateEl && dateEl.value) || new Date().toISOString().slice(0, 10);

  var btn = document.getElementById('prj_req_confirm');
  if (btn) { btn.disabled = true; btn.textContent = 'Exporting…'; }

  if (!d.data.paymentRequests) d.data.paymentRequests = [];
  var seq = d.data.paymentRequests.reduce(function(max, r) {
    var m = /^REQ-(\d+)$/.exec(r.number || '');
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0) + 1;
  var req = {
    id: _prjUuid(),
    number: 'REQ-' + ('0' + seq).slice(-2),
    date: reqDate,
    grantId: grantId,
    funder: funder,
    grantReference: grantRef,
    expenseIds: sel.map(function(e){ return e.id; }),
    total: total,
    createdBy: (window.HOUSING_SESSION && HOUSING_SESSION.email) || window.currentRole || 'staff',
    createdAt: new Date().toISOString(),
  };
  d.data.paymentRequests.push(req);
  sel.forEach(function(e) { e.claimedIn = req.id; e.claimedNumber = req.number; });

  try {
    await _prjSaveProject({ id: d.id, data: d.data, updated_at: new Date().toISOString() }, false);
    _prjSyncCache(d);
  } catch(e) {
    console.warn('[Projects] payment request save:', e);
    showToast('Could not save the payment request — nothing was marked', { type: 'error' });
    // Roll back the in-memory marking so the UI matches the server.
    d.data.paymentRequests = d.data.paymentRequests.filter(function(r){ return r.id !== req.id; });
    sel.forEach(function(e) { delete e.claimedIn; delete e.claimedNumber; });
    if (btn) { btn.disabled = false; btn.textContent = '📤 Export & Mark Claimed'; }
    return;
  }

  if (typeof auditEntry === 'function') {
    auditEntry('PRJ:' + d.id, 'project_payment_request', req.number + ' — ' + _prjMoney(total, true) + ' (' + sel.length + ' items) to ' + (funder || 'funder') + ' on ' + (d.project_number || d.name));
  }

  window._prjReqSel = {};
  var modal = document.getElementById('prjReqModal');
  if (modal) modal.remove();
  _prjRenderCosts();

  await _prjExportRequestFiles(req);
  showToast('Payment request ' + req.number + ' exported — cost lines marked claimed');
}

// Re-export (summary PDF + all attached documents) for an existing request.
async function _prjExportRequest(reqId) {
  var d = window._prjDraft;
  var req = d && (d.data.paymentRequests || []).find(function(r){ return r.id === reqId; });
  if (!req) return;
  await _prjExportRequestFiles(req);
}

async function _prjExportRequestFiles(req) {
  var d = window._prjDraft;
  var exp = (d.data.expenses || []).filter(function(e){ return (req.expenseIds || []).indexOf(e.id) !== -1; });
  try {
    await _prjGenerateRequestPdf(req, exp);
  } catch(e) {
    console.warn('[Projects] request PDF:', e);
    showToast('Could not generate the summary PDF', { type: 'error' });
  }
  // Download every attached compliance document, sequentially (parallel
  // downloads get blocked as popups by most browsers).
  var failed = 0;
  for (var i = 0; i < exp.length; i++) {
    for (var k = 0; k < PRJ_EXP_DOC_KINDS.length; k++) {
      var doc = _prjExpDoc(exp[i], PRJ_EXP_DOC_KINDS[k].k);
      if (!doc) continue;
      try { await _prjDownloadDoc(doc, req.number); }
      catch(e) { console.warn('[Projects] doc download:', e); failed++; }
    }
  }
  if (failed) showToast(failed + ' document download' + (failed === 1 ? '' : 's') + ' failed — use the row links to fetch them individually', { type: 'error' });
}

async function _prjDownloadDoc(doc, prefix) {
  var url = await sbGetSignedUrl(doc.path);
  if (!url) throw new Error('no url');
  var r = await fetch(url);
  if (!r.ok) throw new Error('fetch failed');
  var blob = await r.blob();
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (prefix ? prefix + '_' : '') + (doc.name || 'document');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 10000);
  // Small gap so the browser treats each download as user-initiated flow.
  await new Promise(function(res){ setTimeout(res, 350); });
}

function _prjGenerateRequestPdf(req, exp) {
  return new Promise(function(resolve, reject) {
    var loadjsPDF = function(cb) {
      if (window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API && window.jspdf.jsPDF.API.autoTable) { cb(); return; }
      if (window.jspdf && window.jspdf.jsPDF && document.getElementById('prj_jspdf_at')) { cb(); return; }
      var s1 = document.createElement('script');
      s1.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s1.onload = function() {
        var s2 = document.createElement('script');
        s2.id = 'prj_jspdf_at';
        s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js';
        s2.onload = cb;
        s2.onerror = reject;
        document.head.appendChild(s2);
      };
      s1.onerror = reject;
      if (window.jspdf && window.jspdf.jsPDF) { s1.onload(); return; }
      document.head.appendChild(s1);
    };

    loadjsPDF(function() {
      try {
        var d = window._prjDraft;
        var nc = window.NATION_CONFIG || {};
        var doc = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
        var y = 16;

        doc.setFontSize(14); doc.setFont('helvetica', 'bold');
        doc.text((nc.display_name || nc.short || '') + ' — Housing', 14, y); y += 7;
        doc.setFontSize(12);
        doc.text('Payment Request ' + req.number + ' — Claim Summary', 14, y); y += 8;

        doc.setFontSize(9); doc.setFont('helvetica', 'normal');
        doc.text('Project: ' + (d.project_number || '') + '  ' + (d.name || ''), 14, y);
        doc.text('Date: ' + (req.date || ''), 150, y); y += 5;
        doc.text('Funder: ' + (req.funder || '—') + (req.grantReference ? '  (Ref: ' + req.grantReference + ')' : ''), 14, y); y += 5;
        doc.text('Department #: ' + (d.data.deptNumber || '—') + '    PO #: ' + (d.data.poNumber || '—'), 14, y); y += 5;
        doc.text('Prepared by: ' + ((window.HOUSING_SESSION && (HOUSING_SESSION.name || HOUSING_SESSION.email)) || ''), 14, y); y += 4;

        var rows = exp.map(function(e) {
          var docsCol = PRJ_EXP_DOC_KINDS.map(function(k) {
            return (k.k === 'invoice' ? 'Inv' : k.k === 'eft' ? 'EFT' : 'Bank') + (_prjExpDoc(e, k.k) ? ' Y' : ' -');
          }).join('  ');
          var vendorCol = (e.vendor || '') +
            ((e.vendorAddress || e.vendorPhone) ? '\n' + [e.vendorAddress, e.vendorPhone].filter(Boolean).join(' / ') : '');
          return [e.date || '', vendorCol, e.description || '', '$' + (Number(e.amount) || 0).toFixed(2), docsCol];
        });
        rows.push(['', '', 'TOTAL REQUESTED', '$' + (Number(req.total) || 0).toFixed(2), '']);

        doc.autoTable({
          startY: y + 2,
          head: [['Date', 'Vendor / Payee', 'Description', 'Amount', 'Docs attached']],
          body: rows,
          theme: 'striped',
          headStyles: { fillColor: [17, 17, 15], textColor: [248, 228, 26], fontSize: 8, fontStyle: 'bold' },
          bodyStyles: { fontSize: 8 },
          columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 40 }, 2: { cellWidth: 60 }, 3: { cellWidth: 24, halign: 'right' }, 4: { cellWidth: 38 } },
          margin: { left: 14, right: 14 },
        });

        var fy = doc.lastAutoTable.finalY + 8;
        doc.setFontSize(8);
        doc.text('Supporting documents (invoice, EFT payment confirmation, bank statement proof) accompany this summary.', 14, fy); fy += 10;
        if (fy > 240) { doc.addPage(); fy = 20; }
        doc.setDrawColor(150, 150, 150);
        doc.line(14, fy + 12, 90, fy + 12);
        doc.text('Authorized signature', 14, fy + 17);
        doc.line(120, fy + 12, 170, fy + 12);
        doc.text('Date', 120, fy + 17);

        doc.save(((d.project_number || 'project') + '_' + req.number + '_PaymentRequest.pdf').replace(/\s+/g, '_'));
        resolve();
      } catch(e) { reject(e); }
    });
  });
}

function _prjUndoRequest(reqId) {
  var d = window._prjDraft;
  if (!d || !_prjCanManage()) return;
  var req = (d.data.paymentRequests || []).find(function(r){ return r.id === reqId; });
  if (!req || typeof showConfirm !== 'function') return;
  showConfirm({
    title: 'Undo payment request?',
    message: 'Remove ' + _prjEsc(req.number) + ' (' + _prjMoney(req.total, true) + ')? Its cost lines are unmarked so they can be claimed again. Use this only if the request was not actually submitted to the funder.',
    confirmText: 'Undo request', danger: true,
  }).then(async function(ok) {
    if (!ok) return;
    d.data.paymentRequests = (d.data.paymentRequests || []).filter(function(r){ return r.id !== reqId; });
    (d.data.expenses || []).forEach(function(e) {
      if (e.claimedIn === reqId) { delete e.claimedIn; delete e.claimedNumber; }
    });
    try {
      await _prjSaveProject({ id: d.id, data: d.data, updated_at: new Date().toISOString() }, false);
      _prjSyncCache(d);
      if (typeof auditEntry === 'function') {
        auditEntry('PRJ:' + d.id, 'project_payment_request_undone', req.number + ' undone on ' + (d.project_number || d.name));
      }
    } catch(e) { console.warn('[Projects] undo request:', e); }
    _prjRenderCosts();
  });
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

  // Existing units/lots linked directly to the project (not via a project-lot).
  var _lotUnitIds = {};
  lots.forEach(function(l){ if (l.unit_id) _lotUnitIds[l.unit_id] = true; });
  var directLinked = units.filter(function(u){ return u && !_lotUnitIds[u.id]; });
  var directRows = directLinked.map(function(u){
    var isLot = (typeof _isLot === 'function' && _isLot(u));
    var tag = isLot
      ? '<span style="font-size:10px;font-weight:700;color:#15803d;">LOT</span>'
      : '<span style="font-size:10px;font-weight:700;color:#1d4ed8;">UNIT</span>';
    return '<tr><td>' + tag + '</td>' +
      '<td style="font-weight:600;">' + _prjEsc(((u.num || '') + ' ' + (u.street || '')).trim()) + '</td>' +
      '<td style="white-space:nowrap;">' + (_prjCanManage()
        ? '<button type="button" class="btn btn-ghost" style="padding:4px 10px;font-size:11px;" onclick="_prjUnlinkExisting(\'' + _prjEsc(u.id) + '\')">Unlink</button>'
        : '') + '</td></tr>';
  }).join('');

  host.innerHTML =
    '<div class="tic-section">' +
      '<div class="tic-section-h">Lots (' + lots.length + ') — ' + units.length + ' unit' + (units.length === 1 ? '' : 's') + ' linked to this project</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">' +
        '<button type="button" class="btn btn-ghost" onclick="_prjAddLotsBatch()">+ Add Lots</button>' +
        '<button type="button" class="btn btn-ghost" onclick="_prjCreateUnitsFromLots()">🏠 Create Units from Lots</button>' +
        '<button type="button" class="btn btn-ghost" onclick="_prjLinkExisting()">🔗 Link Existing Unit / Lot</button>' +
      '</div>' +
      (lots.length
        ? '<div class="prj-table-wrap"><table class="prj-table"><thead><tr><th>Lot #</th><th>Address / Legal</th><th>Status</th><th>Unit</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div style="color:var(--muted);font-size:13px;">No lots yet. Use "+ Add Lots" to create them' + (d.type !== 'lot_development' ? ', or "Create Units from Lots" once lots exist' : '') + '. You can also link an existing unit or lot above.</div>') +
    '</div>' +
    (directLinked.length
      ? '<div class="tic-section"><div class="tic-section-h">Linked existing units &amp; lots (' + directLinked.length + ')</div>' +
          '<div class="prj-table-wrap"><table class="prj-table"><thead><tr><th style="width:60px;">Type</th><th>Address</th><th></th></tr></thead><tbody>' + directRows + '</tbody></table></div>' +
        '</div>'
      : '');
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

// ── Link an EXISTING unit or (inventory) lot directly to the project ──────────
// Unlike "Link existing unit" (which attaches a unit to a project-lot), this
// associates any existing housing_units record -- a building OR a vacant lot
// (record_type:'lot') -- with the project by stamping projectId, so a project
// can cover existing units/lots, not only newly-created ones.
function _prjLinkExisting() {
  var d = window._prjDraft;
  if (!d || !d.id || !_prjCanManage()) return;
  var candidates = (window.housingUnits || [])
    .filter(function(u){ return u && !u.archived && !u.projectId; })
    .map(function(u){
      var isLot = (typeof _isLot === 'function' && _isLot(u));
      return { id: u.id, label: ((u.num || '') + ' ' + (u.street || '')).trim() + (isLot ? '  (Vacant Lot)' : '') };
    });
  if (!candidates.length) { showToast('No unlinked units or lots available'); return; }

  var ov = document.createElement('div');
  ov.id = 'prjLinkExModal';
  ov.className = 'modal-overlay modal-overlay-centered modal-z-1100 is-open';
  ov.innerHTML =
    '<div class="modal-body modal-body-sm">' +
      '<div class="modal-hdr"><div class="modal-hdr-title">Link Existing Unit or Lot</div>' +
        '<button type="button" class="btn-close-dark-30" onclick="document.getElementById(\'prjLinkExModal\').remove()">&times;</button></div>' +
      '<div class="modal-body-stack" style="padding:18px 24px;">' +
        '<div class="f"><label>Unit or Lot</label><div id="prj_linkex_wrap"></div></div>' +
        '<div class="txt-help">Associates an existing building or vacant lot with this project (counts toward cost allocation).</div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button type="button" class="btn btn-ghost" onclick="document.getElementById(\'prjLinkExModal\').remove()">Cancel</button>' +
        '<button id="prj_linkex_confirm" type="button" class="btn btn-primary" disabled onclick="_prjConfirmLinkExisting()">Link</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(ov);

  window._prjLinkExPick = null;
  if (typeof clfnSearchSelect === 'function') {
    clfnSearchSelect({
      wrap: document.getElementById('prj_linkex_wrap'),
      items: candidates,
      placeholder: 'Search units or lots…',
      onChange: function(id){ window._prjLinkExPick = id || null; var b = document.getElementById('prj_linkex_confirm'); if (b) b.disabled = !id; },
    });
  }
}
async function _prjConfirmLinkExisting() {
  var d = window._prjDraft;
  var unitId = window._prjLinkExPick;
  if (!d || !unitId) return;
  var u = (window.housingUnits || []).find(function(x){ return x.id === unitId; });
  if (!u) return;
  u.projectId = d.id;
  try {
    if (typeof saveUnitWithDraftFallback === 'function') await saveUnitWithDraftFallback(u);
    else await sbSaveUnit(u);
    if (typeof auditEntry === 'function') {
      var isLot = (typeof _isLot === 'function' && _isLot(u));
      auditEntry('PRJ:' + d.id, 'project_existing_linked', ((u.num || '') + ' ' + (u.street || '')).trim() + (isLot ? ' (lot)' : '') + ' linked to ' + (d.project_number || d.name), window.currentRole || '');
    }
  } catch(e) { console.warn('[Projects] link existing:', e); showToast('Could not link', { type: 'error' }); return; }
  var m = document.getElementById('prjLinkExModal'); if (m) m.remove();
  _prjRenderLots();
  renderProjectsList();
  showToast('Linked to project');
}
function _prjUnlinkExisting(unitId) {
  var d = window._prjDraft;
  if (!d || !_prjCanManage()) return;
  var u = (window.housingUnits || []).find(function(x){ return x.id === unitId; });
  if (!u) return;
  delete u.projectId; delete u.lotId;
  try { if (typeof saveUnitWithDraftFallback === 'function') saveUnitWithDraftFallback(u); else sbSaveUnit(u); } catch(e){}
  if (typeof auditEntry === 'function') auditEntry('PRJ:' + d.id, 'project_existing_unlinked', ((u.num || '') + ' ' + (u.street || '')).trim() + ' unlinked from ' + (d.project_number || d.name), window.currentRole || '');
  _prjRenderLots();
  renderProjectsList();
  showToast('Unlinked from project');
}
window._prjLinkExisting = _prjLinkExisting;
window._prjConfirmLinkExisting = _prjConfirmLinkExisting;
window._prjUnlinkExisting = _prjUnlinkExisting;

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
