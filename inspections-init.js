/* ============================================================
 * inspections-init.js — CLFN Housing Suite
 * Inspection records: list, create, edit, PDF, SOW creation
 * ============================================================ */

'use strict';

// ── State ────────────────────────────────────────────────────────────────────
window._inspections       = [];   // all inspection records
window._inspEditId        = null; // id of inspection being edited (null = new)
window._inspPendingPhotos = [];   // staged photos not yet uploaded
window._inspUnitFilter    = '';
window._inspTypeFilter    = '';
window._inspStatusFilter  = '';

var INSP_TYPES    = ['Move-In','Move-Out','Annual','Routine','Emergency'];
var INSP_STATUSES = ['pending','pass','fail','needs_repair'];

// Checklist template — sections with items
var INSP_CHECKLIST_TEMPLATE = [
  { section: 'Exterior', items: ['Foundation / Structure','Roof condition','Siding / Exterior walls','Windows & screens','Doors & locks','Driveway / Walkway','Deck / Porch / Steps'] },
  { section: 'Interior – General', items: ['Walls & ceilings','Floors','Doors & hardware','Smoke detectors','Carbon monoxide detector','Fire extinguisher','Pest evidence'] },
  { section: 'Kitchen', items: ['Cabinets & counters','Sink & faucet','Stove / Range','Refrigerator','Dishwasher','Exhaust fan','Plumbing – no leaks'] },
  { section: 'Bathroom(s)', items: ['Toilet','Sink & faucet','Tub / Shower','Caulking & grout','Exhaust fan','Plumbing – no leaks'] },
  { section: 'Bedrooms', items: ['Windows & locks','Closets','Flooring','Walls & ceilings'] },
  { section: 'Mechanical', items: ['Furnace / Heating system','Water heater','Electrical panel','Plumbing – main lines','Ventilation','Air conditioning (if applicable)'] },
  { section: 'Utility Connections', items: ['Hydro meter','Gas meter','Water shut-off accessible'] },
];

// ── Supabase helpers ─────────────────────────────────────────────────────────
function _inspHeaders() {
  return Object.assign({}, window.HOUSING_HEADERS || {}, { 'Content-Type': 'application/json' });
}

async function _inspLoad() {
  try {
    var r = await fetch(
      window.SUPABASE_URL + '/rest/v1/inspections?select=*&order=inspection_date.desc&limit=500',
      { headers: _inspHeaders() }
    );
    if (!r.ok) throw new Error(await r.text());
    window._inspections = await r.json();
  } catch(e) {
    console.warn('[Inspections] load error:', e);
    window._inspections = [];
  }
}

async function _inspSave(record) {
  var isNew = !record.id;
  var url   = window.SUPABASE_URL + '/rest/v1/inspections';
  var method, headers;
  if (isNew) {
    method  = 'POST';
    headers = Object.assign({}, _inspHeaders(), { 'Prefer': 'return=representation' });
  } else {
    method  = 'PATCH';
    url    += '?id=eq.' + encodeURIComponent(record.id);
    headers = Object.assign({}, _inspHeaders(), { 'Prefer': 'return=minimal' });
  }
  var r = await fetch(url, { method: method, headers: headers, body: JSON.stringify(record) });
  if (!r.ok) throw new Error(await r.text());
  if (isNew) {
    var rows = await r.json();
    return rows[0];
  }
  return record;
}

async function _inspDelete(id) {
  var r = await fetch(
    window.SUPABASE_URL + '/rest/v1/inspections?id=eq.' + encodeURIComponent(id),
    { method: 'DELETE', headers: _inspHeaders() }
  );
  if (!r.ok) throw new Error(await r.text());
}

// ── Render: list view ────────────────────────────────────────────────────────
function renderInspectionsList() {
  var list = window._inspections || [];

  // Apply filters
  if (window._inspUnitFilter)   list = list.filter(function(i){ return (i.unit_address||'').toLowerCase().indexOf(window._inspUnitFilter.toLowerCase()) !== -1; });
  if (window._inspTypeFilter)   list = list.filter(function(i){ return i.type === window._inspTypeFilter; });
  if (window._inspStatusFilter) list = list.filter(function(i){ return i.overall_status === window._inspStatusFilter; });

  // KPIs
  var all    = window._inspections;
  var kpiEl  = document.getElementById('insp_kpi_strip');
  if (kpiEl) {
    var total   = all.length;
    var pass    = all.filter(function(i){ return i.overall_status === 'pass'; }).length;
    var repairs = all.filter(function(i){ return i.overall_status === 'needs_repair'; }).length;
    var fail    = all.filter(function(i){ return i.overall_status === 'fail'; }).length;
    var thisYr  = all.filter(function(i){ return (i.inspection_date||'').startsWith(new Date().getFullYear()+''); }).length;
    kpiEl.innerHTML =
      _inspKpi(total,   'Total')         +
      _inspKpi(pass,    'Pass',    'pass') +
      _inspKpi(repairs, 'Needs Repair','needs_repair') +
      _inspKpi(fail,    'Fail',    'fail') +
      _inspKpi(thisYr,  'This Year');
  }

  var tbody = document.getElementById('insp_tbody');
  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--muted);font-size:13px;">No inspections found.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(function(insp) {
    var badge   = _inspBadge(insp.overall_status);
    var items   = insp.checklist ? JSON.parse(typeof insp.checklist === 'string' ? insp.checklist : JSON.stringify(insp.checklist)) : [];
    var repairs = items.filter(function(it){ return it.rating === 'repair'; }).length;
    var photoCount = (insp.photos ? (typeof insp.photos === 'string' ? JSON.parse(insp.photos) : insp.photos) : []).length;
    return '<tr onclick="openInspectionModal(\'' + _esc(insp.id) + '\')">'
      + '<td><div style="font-weight:600;font-size:13px;">' + _esc(insp.unit_address || insp.unit_id) + '</div></td>'
      + '<td>' + _esc(insp.type || '—') + '</td>'
      + '<td>' + _esc(insp.inspection_date || '—') + '</td>'
      + '<td>' + badge + '</td>'
      + '<td>' + _esc(insp.inspector_name || '—') + '</td>'
      + '<td>' + (repairs > 0 ? '<span style="color:var(--warn-amber-text,#b45309);font-weight:600;">' + repairs + ' item' + (repairs===1?'':'s') + '</span>' : '<span style="color:var(--muted);">—</span>') + '</td>'
      + '<td>' + (photoCount > 0 ? '<span style="color:var(--muted);">📷 '+photoCount+'</span>' : '<span style="color:var(--muted);">—</span>') + '</td>'
      + '</tr>';
  }).join('');
}

function _inspKpi(val, lbl, status) {
  var color = status === 'pass' ? '#15803d' : status === 'needs_repair' ? '#b45309' : status === 'fail' ? '#b91c1c' : 'var(--text)';
  return '<div class="insp-kpi"><div class="insp-kpi-val" style="color:' + color + ';">' + val + '</div><div class="insp-kpi-lbl">' + lbl + '</div></div>';
}

function _inspBadge(status) {
  var labels = { pass:'Pass', fail:'Fail', needs_repair:'Needs Repair', pending:'Pending' };
  var cls    = 'insp-badge insp-badge-' + (status || 'pending');
  return '<span class="' + cls + '">' + (labels[status] || status || 'Pending') + '</span>';
}

function _esc(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, function(c){ return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; });
}

// ── Modal: open ──────────────────────────────────────────────────────────────
function openInspectionModal(id) {
  var insp = id ? (window._inspections || []).find(function(i){ return i.id === id; }) : null;
  window._inspEditId        = id || null;
  window._inspPendingPhotos = [];

  var units = window.housingUnits || [];
  var today = new Date().toISOString().split('T')[0];

  // Build unit data for searchable combobox
  var unitList = units.filter(function(u){ return !u.archived; }).map(function(u){
    return { id: u.id, addr: (u.num ? u.num + ' ' + u.street : u.id) };
  }).sort(function(a,b){ return a.addr.localeCompare(b.addr); });
  var preAddr = insp ? (insp.unit_address || insp.unit_id || '') : '';

  var typeOpts = INSP_TYPES.map(function(t){
    return '<option value="' + t + '"' + (insp && insp.type === t ? ' selected' : '') + '>' + t + '</option>';
  }).join('');

  var statusOpts = INSP_STATUSES.map(function(s){
    var labels = { pending:'Pending', pass:'Pass', fail:'Fail', needs_repair:'Needs Repair' };
    return '<option value="' + s + '"' + (insp && insp.overall_status === s ? ' selected' : (!insp && s==='pending' ? ' selected' : '')) + '>' + labels[s] + '</option>';
  }).join('');

  // Parse checklist
  var savedChecklist = [];
  if (insp && insp.checklist) {
    try { savedChecklist = typeof insp.checklist === 'string' ? JSON.parse(insp.checklist) : insp.checklist; } catch(e){}
  }

  // Build checklist HTML
  var clHtml = INSP_CHECKLIST_TEMPLATE.map(function(sec, si) {
    var items = sec.items.map(function(item, ii) {
      var key     = sec.section + '|' + item;
      var saved   = savedChecklist.find(function(x){ return x.key === key; }) || {};
      var rating  = saved.rating || '';
      var note    = saved.notes  || '';
      var btnPass   = '<button type="button" class="' + (rating==='pass'  ?'active-pass':'')   + '" onclick="_inspSetRating(this,\'pass\')"   data-key="' + _esc(key) + '">✓ Pass</button>';
      var btnFail   = '<button type="button" class="' + (rating==='fail'  ?'active-fail':'')   + '" onclick="_inspSetRating(this,\'fail\')"   data-key="' + _esc(key) + '">✗ Fail</button>';
      var btnRepair = '<button type="button" class="' + (rating==='repair'?'active-repair':'') + '" onclick="_inspSetRating(this,\'repair\')" data-key="' + _esc(key) + '">⚠ Repair</button>';
      var btnNA     = '<button type="button" class="' + (rating==='na'    ?'active-na':'')     + '" onclick="_inspSetRating(this,\'na\')"     data-key="' + _esc(key) + '">N/A</button>';
      return '<div class="insp-cl-item">'
        + '<div><div class="insp-cl-item-label">' + _esc(item) + '</div></div>'
        + '<div class="insp-cl-rating">' + btnPass + btnFail + btnRepair + btnNA + '</div>'
        + '<input class="insp-cl-item-note-inp" type="text" placeholder="Notes (optional)" data-key="' + _esc(key) + '" value="' + _esc(note) + '"/>'
        + '</div>';
    }).join('');
    return '<div class="insp-cl-section">'
      + '<div class="insp-cl-section-hdr" onclick="_inspToggleSection(this)">'
      +   '<span>' + _esc(sec.section) + '</span>'
      +   '<span style="font-size:11px;color:var(--muted);" id="insp_sec_summary_' + si + '"></span>'
      + '</div>'
      + '<div class="insp-cl-section-body">' + items + '</div>'
      + '</div>';
  }).join('');

  // Photos
  var savedPhotos = [];
  if (insp && insp.photos) {
    try { savedPhotos = typeof insp.photos === 'string' ? JSON.parse(insp.photos) : insp.photos; } catch(e){}
  }
  var photoHtml = _inspRenderPhotoGrid(savedPhotos, []);

  var modal = document.getElementById('insp_modal');
  modal.innerHTML =
    '<div style="background:var(--surface);border-radius:12px;width:100%;max-width:740px;max-height:95vh;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,.35);">'
    + '<div class="modal-hdr">'
    +   '<div><div class="lbl-yellow">🔍 ' + (insp ? 'Edit Inspection' : 'New Inspection') + '</div>'
    +   '<div class="txt-sm-meta">' + (insp ? _esc(insp.unit_address||insp.unit_id) + ' · ' + _esc(insp.type) : 'Complete the checklist and save.') + '</div></div>'
    +   '<button type="button" onclick="closeInspectionModal()" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted);">&times;</button>'
    + '</div>'
    + '<div style="overflow-y:auto;padding:18px 22px;flex:1;">'

    // ── Details
    + '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--yellow);margin-bottom:10px;padding-bottom:5px;border-bottom:1px solid var(--border);">Inspection Details</div>'
    + '<div class="tic-grid-2" style="margin-bottom:16px;">'
    +   '<div class="f"><label class="tic-field-lbl">Unit</label><div class="insp-combo-wrap" id="insp_unit_wrap"><input id="insp_unit_search" type="text" class="tic-input" autocomplete="off" placeholder="Search address…" value="' + _esc(preAddr) + '" oninput="_inspUnitFilter(this)" onfocus="_inspUnitOpenDrop()"/><input type="hidden" id="insp_unit" value="' + _esc(insp ? insp.unit_id||'' : '') + '"/><div id="insp_unit_drop" class="insp-combo-drop"></div></div></div>'
    +   '<div class="f"><label class="tic-field-lbl">Type</label><select id="insp_type" class="tic-input">' + typeOpts + '</select></div>'
    +   '<div class="f"><label class="tic-field-lbl">Inspection Date</label><input id="insp_date" type="date" class="tic-input" value="' + _esc(insp ? insp.inspection_date : today) + '"/></div>'
    +   '<div class="f"><label class="tic-field-lbl">Overall Status</label><select id="insp_status" class="tic-input">' + statusOpts + '</select></div>'
    +   '<div class="f"><label class="tic-field-lbl">Inspector Name</label><input id="insp_inspector" type="text" class="tic-input" value="' + _esc(insp ? insp.inspector_name : (window.HOUSING_SESSION&&window.HOUSING_SESSION.name||'')) + '" placeholder="Full name"/></div>'
    +   '<div class="f"><label class="tic-field-lbl">Inspector Role</label><input id="insp_role" type="text" class="tic-input" value="' + _esc(insp ? insp.inspector_role : (window.currentRole||'')) + '" placeholder="Role"/></div>'
    + '</div>'

    // ── Checklist
    + '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--yellow);margin:16px 0 10px;padding-bottom:5px;border-bottom:1px solid var(--border);">Inspection Checklist</div>'
    + '<div class="insp-checklist" id="insp_checklist">' + clHtml + '</div>'

    // ── General notes
    + '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--yellow);margin:16px 0 10px;padding-bottom:5px;border-bottom:1px solid var(--border);">General Notes</div>'
    + '<textarea id="insp_notes" class="tic-input" rows="4" style="resize:vertical;min-height:80px;width:100%;box-sizing:border-box;" placeholder="Overall observations, recommendations…">' + _esc(insp ? insp.general_notes : '') + '</textarea>'

    // ── Photos
    + '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--yellow);margin:16px 0 10px;padding-bottom:5px;border-bottom:1px solid var(--border);">Photos</div>'
    + '<div id="insp_photo_grid">' + photoHtml + '</div>'
    + '<label style="display:inline-flex;align-items:center;gap:7px;margin-top:8px;cursor:pointer;font-size:12px;color:var(--muted);border:1px dashed var(--border);border-radius:7px;padding:8px 14px;">'
    +   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
    +   'Add photos'
    +   '<input type="file" accept="image/*" multiple style="display:none;" onchange="_inspHandlePhotos(this)"/>'
    + '</label>'

    + '</div>'

    // ── Footer
    + '<div class="modal-footer" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 22px;border-top:1px solid var(--border);">'
    +   '<div style="display:flex;gap:8px;">'
    +     (insp ? '<button type="button" class="btn btn-ghost" onclick="_inspConfirmDelete()">Delete</button>' : '')
    +     (insp ? '<button type="button" class="btn btn-ghost" onclick="generateInspectionPDF()">⬇ PDF</button>' : '')
    +   '</div>'
    +   '<div style="display:flex;gap:8px;">'
    +     '<button type="button" class="btn btn-ghost" onclick="closeInspectionModal()">Cancel</button>'
    +     '<button type="button" class="btn btn-primary" onclick="saveInspection()">Save Inspection</button>'
    +   '</div>'
    + '</div>'
    + '</div>';

  modal.style.display = 'flex';
  _inspUpdateSectionSummaries();
}

// ── Unit searchable combobox ──────────────────────────────────────────────────
function _inspUnitOpenDrop() {
  _inspUnitRenderDrop(document.getElementById('insp_unit_search') ? document.getElementById('insp_unit_search').value : '');
  setTimeout(function(){
    document.addEventListener('click', _inspUnitOutsideClick, { once: true, capture: true });
  }, 0);
}

function _inspUnitFilter(input) {
  _inspUnitRenderDrop(input.value);
  // Clear selection when user types
  document.getElementById('insp_unit').value = '';
}

function _inspUnitRenderDrop(query) {
  var drop = document.getElementById('insp_unit_drop');
  if (!drop) return;
  var units = window.housingUnits || [];
  var list = units.filter(function(u){ return !u.archived; }).map(function(u){
    return { id: u.id, addr: (u.num ? u.num + ' ' + u.street : u.id) };
  }).sort(function(a,b){ return a.addr.localeCompare(b.addr); });
  var q = (query || '').toLowerCase().trim();
  if (q) list = list.filter(function(u){ return u.addr.toLowerCase().indexOf(q) !== -1; });
  if (!list.length) {
    drop.innerHTML = '<div class="insp-combo-empty">No units found</div>';
  } else {
    drop.innerHTML = list.map(function(u){
      return '<div class="insp-combo-item" onmousedown="_inspUnitSelect(\'' + _esc(u.id) + '\',\'' + _esc(u.addr) + '\')">' + _esc(u.addr) + '</div>';
    }).join('');
  }
  drop.style.display = 'block';
}

function _inspUnitSelect(id, addr) {
  document.getElementById('insp_unit').value = id;
  var search = document.getElementById('insp_unit_search');
  if (search) search.value = addr;
  var drop = document.getElementById('insp_unit_drop');
  if (drop) drop.style.display = 'none';
}

function _inspUnitOutsideClick(e) {
  var wrap = document.getElementById('insp_unit_wrap');
  if (!wrap || !wrap.contains(e.target)) {
    var drop = document.getElementById('insp_unit_drop');
    if (drop) drop.style.display = 'none';
  }
}

function closeInspectionModal() {
  var modal = document.getElementById('insp_modal');
  if (modal) modal.style.display = 'none';
  window._inspEditId        = null;
  window._inspPendingPhotos = [];
}

// ── Checklist interaction ────────────────────────────────────────────────────
function _inspSetRating(btn, rating) {
  var key  = btn.getAttribute('data-key');
  var wrap = btn.closest('.insp-cl-rating');
  if (!wrap) return;
  wrap.querySelectorAll('button').forEach(function(b){ b.className = ''; });
  btn.className = 'active-' + rating;
  _inspUpdateSectionSummaries();
}

function _inspToggleSection(hdr) {
  var body = hdr.nextElementSibling;
  if (!body) return;
  body.style.display = body.style.display === 'none' ? '' : 'none';
}

function _inspUpdateSectionSummaries() {
  INSP_CHECKLIST_TEMPLATE.forEach(function(sec, si) {
    var el = document.getElementById('insp_sec_summary_' + si);
    if (!el) return;
    var section   = document.querySelectorAll('.insp-cl-section')[si];
    if (!section) return;
    var btns    = section.querySelectorAll('.insp-cl-rating button.active-pass, .insp-cl-rating button.active-fail, .insp-cl-rating button.active-repair, .insp-cl-rating button.active-na');
    var repairs = section.querySelectorAll('.insp-cl-rating button.active-repair').length;
    var fails   = section.querySelectorAll('.insp-cl-rating button.active-fail').length;
    var rated   = btns.length;
    var total   = sec.items.length;
    var txt     = rated + '/' + total + ' rated';
    if (repairs) txt += ' · ' + repairs + ' repair';
    if (fails)   txt += ' · ' + fails + ' fail';
    el.textContent = txt;
    el.style.color = fails ? '#b91c1c' : repairs ? '#b45309' : 'var(--muted)';
  });
}

// ── Photos ───────────────────────────────────────────────────────────────────
function _inspRenderPhotoGrid(savedPhotos, pending) {
  var html = '';
  (savedPhotos || []).forEach(function(p, i) {
    var src = typeof sbGetFileUrl === 'function' ? sbGetFileUrl(p.path) : p.path;
    html += '<div class="insp-photo-thumb">'
      + '<img src="' + _esc(src) + '" alt="photo"/>'
      + '<button type="button" onclick="_inspRemoveSavedPhoto(' + i + ')" title="Remove">✕</button>'
      + '</div>';
  });
  (pending || []).forEach(function(p, i) {
    html += '<div class="insp-photo-thumb">'
      + '<img src="' + _esc(p.data) + '" alt="pending photo"/>'
      + '<button type="button" onclick="_inspRemovePendingPhoto(' + i + ')" title="Remove">✕</button>'
      + '</div>';
  });
  return '<div class="insp-photo-grid">' + html + '</div>';
}

function _inspHandlePhotos(input) {
  var files = Array.from(input.files || []).filter(function(f){ return f.type.startsWith('image/'); });
  if (!files.length) return;
  var pending = window._inspPendingPhotos;
  var readers = files.map(function(f) {
    return new Promise(function(resolve) {
      var r = new FileReader();
      r.onload = function(e) { pending.push({ file: f, data: e.target.result }); resolve(); };
      r.readAsDataURL(f);
    });
  });
  Promise.all(readers).then(function() {
    var insp = window._inspEditId ? (window._inspections||[]).find(function(i){ return i.id === window._inspEditId; }) : null;
    var saved = insp && insp.photos ? (typeof insp.photos === 'string' ? JSON.parse(insp.photos) : insp.photos) : [];
    var grid = document.getElementById('insp_photo_grid');
    if (grid) grid.innerHTML = _inspRenderPhotoGrid(saved, pending);
  });
  input.value = '';
}

function _inspRemovePendingPhoto(idx) {
  window._inspPendingPhotos.splice(idx, 1);
  var insp = window._inspEditId ? (window._inspections||[]).find(function(i){ return i.id === window._inspEditId; }) : null;
  var saved = insp && insp.photos ? (typeof insp.photos === 'string' ? JSON.parse(insp.photos) : insp.photos) : [];
  var grid = document.getElementById('insp_photo_grid');
  if (grid) grid.innerHTML = _inspRenderPhotoGrid(saved, window._inspPendingPhotos);
}

function _inspRemoveSavedPhoto(idx) {
  var insp = window._inspEditId ? (window._inspections||[]).find(function(i){ return i.id === window._inspEditId; }) : null;
  if (!insp) return;
  var photos = insp.photos ? (typeof insp.photos === 'string' ? JSON.parse(insp.photos) : insp.photos) : [];
  photos.splice(idx, 1);
  insp.photos = photos;
  var grid = document.getElementById('insp_photo_grid');
  if (grid) grid.innerHTML = _inspRenderPhotoGrid(photos, window._inspPendingPhotos);
}

// ── Collect checklist from DOM ────────────────────────────────────────────────
function _inspCollectChecklist() {
  var items = [];
  var sections = document.querySelectorAll('#insp_checklist .insp-cl-section');
  sections.forEach(function(sec, si) {
    var sectionName = INSP_CHECKLIST_TEMPLATE[si] ? INSP_CHECKLIST_TEMPLATE[si].section : '';
    sec.querySelectorAll('.insp-cl-item').forEach(function(row, ii) {
      var itemName = INSP_CHECKLIST_TEMPLATE[si] ? (INSP_CHECKLIST_TEMPLATE[si].items[ii] || '') : '';
      var key      = sectionName + '|' + itemName;
      var activeBtn = row.querySelector('.insp-cl-rating button[class*="active"]');
      var rating   = '';
      if (activeBtn) {
        if (activeBtn.classList.contains('active-pass'))   rating = 'pass';
        if (activeBtn.classList.contains('active-fail'))   rating = 'fail';
        if (activeBtn.classList.contains('active-repair')) rating = 'repair';
        if (activeBtn.classList.contains('active-na'))     rating = 'na';
      }
      var noteInp = row.querySelector('.insp-cl-item-note-inp');
      var notes   = noteInp ? noteInp.value.trim() : '';
      if (rating || notes) {
        items.push({ key: key, section: sectionName, item: itemName, rating: rating, notes: notes });
      }
    });
  });
  return items;
}

// ── Save ─────────────────────────────────────────────────────────────────────
async function saveInspection() {
  var unitId   = (document.getElementById('insp_unit') || {}).value || '';
  var unitAddr = (document.getElementById('insp_unit_search') || {}).value || '';
  if (!unitId) { if(typeof showToast==='function') showToast('Please select a unit.', {type:'error'}); return; }

  var date    = (document.getElementById('insp_date')       || {}).value || '';
  var type    = (document.getElementById('insp_type')       || {}).value || '';
  var status  = (document.getElementById('insp_status')     || {}).value || 'pending';
  var inspector = (document.getElementById('insp_inspector') || {}).value || '';
  var role    = (document.getElementById('insp_role')        || {}).value || '';
  var notes   = (document.getElementById('insp_notes')       || {}).value || '';
  if (!date) { if(typeof showToast==='function') showToast('Please enter an inspection date.', {type:'error'}); return; }

  var checklist = _inspCollectChecklist();

  // Upload pending photos
  var existingInsp = window._inspEditId ? (window._inspections||[]).find(function(i){ return i.id === window._inspEditId; }) : null;
  var photos = existingInsp && existingInsp.photos ? (typeof existingInsp.photos === 'string' ? JSON.parse(existingInsp.photos) : existingInsp.photos) : [];
  if (window._inspPendingPhotos && window._inspPendingPhotos.length && typeof sbUploadAndSave === 'function') {
    var tempId = window._inspEditId || ('insp-' + Date.now());
    for (var i = 0; i < window._inspPendingPhotos.length; i++) {
      try {
        var rec = await sbUploadAndSave('inspection', tempId, window._inspPendingPhotos[i].file, 'inspections/' + tempId + '/photos');
        photos.push(rec);
      } catch(e) { console.warn('[Inspections] photo upload failed:', e); }
    }
    window._inspPendingPhotos = [];
  }

  var record = {
    unit_id:        unitId,
    unit_address:   unitAddr,
    type:           type,
    inspection_date: date,
    inspector_name: inspector,
    inspector_role: role,
    overall_status: status,
    checklist:      checklist,
    general_notes:  notes,
    photos:         photos,
    created_by:     (window.HOUSING_SESSION && window.HOUSING_SESSION.email) || window.currentRole || '',
  };
  if (window._inspEditId) record.id = window._inspEditId;

  var saveBtn = document.querySelector('#insp_modal .btn-primary');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  try {
    var saved = await _inspSave(record);

    // Update local cache
    var idx = (window._inspections||[]).findIndex(function(i){ return i.id === (window._inspEditId || saved.id); });
    if (idx >= 0) window._inspections[idx] = saved;
    else window._inspections.unshift(saved);

    // Update unit inspection dates
    if (typeof housingUnits !== 'undefined') {
      var unit = housingUnits.find(function(u){ return u.id === unitId; });
      if (unit) {
        unit.lastInspectionDate = date;
        if (typeof sbSaveUnit === 'function') sbSaveUnit(unit);
      }
    }

    if(typeof showToast==='function') showToast('Inspection saved.');

    // Check if any items need repair — prompt to create SOW
    var repairItems = checklist.filter(function(it){ return it.rating === 'repair'; });
    closeInspectionModal();
    renderInspectionsList();

    if (repairItems.length && status !== 'pass') {
      _inspPromptSOW(saved, repairItems);
    }
  } catch(e) {
    if(typeof showToast==='function') showToast('Save failed: ' + e.message, {type:'error'});
    console.warn('[Inspections] save error:', e);
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Inspection'; }
  }
}

// ── SOW prompt ───────────────────────────────────────────────────────────────
function _inspPromptSOW(insp, repairItems) {
  var msg = repairItems.length + ' item' + (repairItems.length===1?'':'s') + ' marked as needing repair. Create a Scope of Work (SOW) for this unit?';
  if (!confirm(msg)) return;

  // Build SOW line items from repair checklist items
  var lineItems = repairItems.map(function(it) {
    return { category: it.section, description: it.item + (it.notes ? ': ' + it.notes : ''), quote: 0, cost: 0 };
  });

  // Pre-populate the SOW cache for this unit and open the SOW modal
  if (!window._sowCache) window._sowCache = {};
  window._sowCache[insp.unit_id] = window._sowCache[insp.unit_id] || {};
  var existing = window._sowCache[insp.unit_id];
  // Merge new items with any existing SOW items
  existing.items = (existing.items || []).concat(lineItems);
  existing.inspectionRef = insp.id;

  if (typeof openSOWModal === 'function') {
    openSOWModal(insp.unit_id);
    if(typeof showToast==='function') showToast('Repair items pre-loaded into the SOW.');
  } else {
    if(typeof showToast==='function') showToast('SOW pre-loaded. Open the unit\'s Scope of Work to review.', {type:'info'});
  }
}

// ── Delete ───────────────────────────────────────────────────────────────────
function _inspConfirmDelete() {
  if (!window._inspEditId) return;
  if (!confirm('Delete this inspection record? This cannot be undone.')) return;
  _inspDelete(window._inspEditId).then(function() {
    window._inspections = (window._inspections||[]).filter(function(i){ return i.id !== window._inspEditId; });
    closeInspectionModal();
    renderInspectionsList();
    if(typeof showToast==='function') showToast('Inspection deleted.');
  }).catch(function(e) {
    if(typeof showToast==='function') showToast('Delete failed: ' + e.message, {type:'error'});
  });
}

// ── PDF export ───────────────────────────────────────────────────────────────
function generateInspectionPDF() {
  var insp = window._inspEditId ? (window._inspections||[]).find(function(i){ return i.id === window._inspEditId; }) : null;
  if (!insp) return;

  var loadjsPDF = function(cb) {
    if (window.jspdf && window.jspdf.jsPDF) { cb(); return; }
    var s1 = document.createElement('script');
    s1.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s1.onload = function() {
      var s2 = document.createElement('script');
      s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js';
      s2.onload = cb;
      document.head.appendChild(s2);
    };
    document.head.appendChild(s1);
  };

  loadjsPDF(function() {
    var doc = new window.jspdf.jsPDF({ orientation:'portrait', unit:'mm', format:'letter' });
    var nation = (window.NATION_CONFIG && window.NATION_CONFIG.short) || 'CLFN';
    var y = 16;

    doc.setFontSize(14); doc.setFont('helvetica','bold');
    doc.text(nation + ' Housing — Unit Inspection Report', 14, y); y += 7;

    doc.setFontSize(9); doc.setFont('helvetica','normal');
    doc.text('Unit: ' + (insp.unit_address || insp.unit_id), 14, y);
    doc.text('Type: ' + (insp.type||'—'), 90, y); y += 5;
    doc.text('Date: ' + (insp.inspection_date||'—'), 14, y);
    doc.text('Inspector: ' + (insp.inspector_name||'—'), 90, y); y += 5;
    doc.text('Status: ' + (insp.overall_status||'—').replace('_',' ').toUpperCase(), 14, y); y += 3;

    doc.setDrawColor(200,200,200); doc.line(14, y, 200, y); y += 5;

    // Checklist table
    var checklist = insp.checklist ? (typeof insp.checklist === 'string' ? JSON.parse(insp.checklist) : insp.checklist) : [];
    var tableRows = [];
    INSP_CHECKLIST_TEMPLATE.forEach(function(sec) {
      sec.items.forEach(function(item) {
        var key  = sec.section + '|' + item;
        var cl   = checklist.find(function(x){ return x.key === key; }) || {};
        var r    = cl.rating || '—';
        tableRows.push([sec.section, item, r.charAt(0).toUpperCase()+r.slice(1).replace('_',' '), cl.notes||'']);
      });
    });

    doc.autoTable({
      startY: y,
      head: [['Section','Item','Rating','Notes']],
      body: tableRows,
      theme: 'striped',
      headStyles: { fillColor:[17,17,15], textColor:[248,228,26], fontSize:7, fontStyle:'bold' },
      bodyStyles: { fontSize:7 },
      columnStyles: { 0:{cellWidth:35}, 1:{cellWidth:65}, 2:{cellWidth:22}, 3:{cellWidth:55} },
      margin: { left:14, right:14 }
    });

    y = doc.lastAutoTable.finalY + 6;

    if (insp.general_notes) {
      doc.setFontSize(9); doc.setFont('helvetica','bold');
      doc.text('General Notes', 14, y); y += 4;
      doc.setFont('helvetica','normal');
      var lines = doc.splitTextToSize(insp.general_notes, 180);
      doc.text(lines, 14, y); y += lines.length * 4 + 4;
    }

    // Signature lines
    if (y > 230) { doc.addPage(); y = 16; }
    doc.setDrawColor(150,150,150);
    doc.line(14, y+14, 90, y+14);
    doc.line(110, y+14, 186, y+14);
    doc.setFontSize(8);
    doc.text('Inspector Signature', 14, y+18);
    doc.text('Date', 110, y+18);

    var filename = nation + '_Inspection_' + (insp.unit_address||insp.unit_id).replace(/\s+/g,'_') + '_' + (insp.inspection_date||'');
    doc.save(filename + '.pdf');
  });
}

// ── Page init ────────────────────────────────────────────────────────────────
(async function initInspectionsPage() {
  try {
    var token = sessionStorage.getItem('clfn_housing_token');
    if (!token) { window.location.href = 'index.html'; return; }

    var savedRole  = sessionStorage.getItem('clfn_housing_role')          || 'housing_employee_l1';
    var savedName  = sessionStorage.getItem('clfn_housing_name')          || '';
    var savedEmail = sessionStorage.getItem('clfn_housing_email_session') || '';
    if (typeof HOUSING_HEADERS !== 'undefined') HOUSING_HEADERS['Authorization'] = 'Bearer ' + token;
    if (typeof HOUSING_SESSION !== 'undefined') {
      HOUSING_SESSION.accessToken = token;
      HOUSING_SESSION.role        = savedRole;
      HOUSING_SESSION.name        = savedName;
      HOUSING_SESSION.email       = savedEmail;
    }
    window.currentRole = savedRole;
    window._realRole   = savedRole;

    if (typeof resolveHousingRole === 'function') {
      try { await resolveHousingRole(); } catch(e) { console.warn('[inspections] role resolve:', e); }
    }
    var role = (typeof HOUSING_SESSION !== 'undefined' && HOUSING_SESSION.role) || savedRole;
    window.currentRole = role;
    window._realRole   = role;

    if (typeof initModuleEnablement         === 'function') try { initModuleEnablement(); } catch(e) {}
    if (window.CLFN_MODULES && !window.CLFN_MODULES.isEnabled('inspections')) {
      window.location.href = 'housing.html'; return;
    }

    if (typeof updateHeaderUser             === 'function') updateHeaderUser(role);
    if (typeof updateRoleSwitcherVisibility === 'function') updateRoleSwitcherVisibility();
    if (typeof renderHeaderNav              === 'function') renderHeaderNav();
    if (typeof applyRoleVisibility          === 'function') applyRoleVisibility(role);
    if (typeof setHeaderNavActive           === 'function') setHeaderNavActive('inspections');

    if (typeof loadHousingData === 'function') {
      try { await loadHousingData(); } catch(e) { console.warn('[inspections] data load:', e); }
    }
    // Show the view (page-view-wide is display:none by default)
    var view = document.getElementById('inspectionsView');
    if (view) view.style.display = 'flex';

    try { await _inspLoad(); } catch(e) { console.warn('[inspections] insp load:', e); }
    renderInspectionsList();
  } catch(e) {
    console.error('[inspections] init error:', e);
  } finally {
    document.body.style.opacity = '1';
  }
}());
