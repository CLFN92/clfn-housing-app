/* ============================================================
 * housing-modals-sow.js — SOW (Scope of Work) modal & helpers
 *
 * Extracted from housing-modals.js for size. Covers:
 *   - SOW photos & documents widget (window._sowFiles staging)
 *   - openSowModal / saveSOW / markSowComplete / reopenSow
 *   - SOW lock & permission helpers (canEditSow, canMarkSowComplete, …)
 *   - SOW table on the Unit Detail card (udpRenderSowTable, udpNewSow, …)
 *   - printSOW (print template)
 *
 * Loaded AFTER housing-modals.js because:
 *   - _currentDetailUnitId is declared in housing-modals.js
 *   - The SOW table renderer is invoked from openUnitDetail there
 * ============================================================ */

// ══════════════════════════════════════════════════════════
// RENOVATION SCOPE OF WORK
// ══════════════════════════════════════════════════════════

// SOW modal state — which unit's SOW is currently open and which line item
// index is being edited inline. Reset by openSowModal / closeSowModal.
var _sowUnitId  = null;
var _sowItemIdx = 0;

// ── SOW Photos & Documents widget ───────────────────────────────────────────
// Files list is staged on window._sowFiles while the modal is open; saveSOW()
// writes it to data.files, populateSow() restores it. Files are uploaded
// directly to Supabase Storage via sbUploadAndSave() — same bucket as photos.
window._sowFiles      = [];
window._SOW_MAX_BYTES = 50 * 1024 * 1024; // 50MB cumulative cap

function _sowFileIcon(name, type) {
  var n = (name || '').toLowerCase();
  if ((type||'').indexOf('image/') === 0) return '🖼️';        // 🖼
  if (n.endsWith('.pdf'))                   return '📄';            // 📄
  if (/\.(xlsx?|csv)$/.test(n))             return '📊';            // 📊
  if (/\.(docx?|txt|rtf)$/.test(n))         return '📝';            // 📝
  return '📎';                                                       // 📎
}
function _sowFmtSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024)              return bytes + ' B';
  if (bytes < 1024 * 1024)       return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
function _sowTotalBytes() {
  return (window._sowFiles || []).reduce(function(sum, f){ return sum + (f.size || 0); }, 0);
}
function renderSowFiles() {
  var list = document.getElementById('sow_files_list');
  var meta = document.getElementById('sow_files_size');
  if (!list) return;
  var files = window._sowFiles || [];
  if (meta) {
    var used = _sowTotalBytes();
    var pct  = Math.round(used / window._SOW_MAX_BYTES * 100);
    meta.textContent = files.length
      ? _sowFmtSize(used) + ' of 50 MB used (' + pct + '%)'
      : '';
    meta.classList.toggle('is-warn', used >= window._SOW_MAX_BYTES);
  }
  if (!files.length) {
    list.innerHTML = '<div class="file-list-empty">No photos or documents attached.</div>';
    return;
  }
  list.innerHTML = files.map(function(f){
    var icon  = _sowFileIcon(f.name, f.type);
    var size  = _sowFmtSize(f.size);
    var added = f.addedAt || '';
    var url   = (typeof sbGetFileUrl === 'function') ? sbGetFileUrl(f.path) : '#';
    var pathAttr = (f.path || '').replace(/"/g, '&quot;');
    return '<div class="file-row">'
      + '<span class="file-icon">' + icon + '</span>'
      + '<span class="file-name">' + (f.name || f.path || '—') + '</span>'
      + '<span class="file-meta">' + size + (added ? ' &middot; ' + added : '') + '</span>'
      + '<span class="file-actions">'
        + '<a href="' + url + '" target="_blank" rel="noopener" title="Download">Download</a>'
        + '<button type="button" class="file-delete" onclick="removeSowFile(\'' + pathAttr + '\')" title="Remove">&times;</button>'
      + '</span>'
      + '</div>';
  }).join('');
}
async function handleSowFileUpload(input) {
  var files = Array.from(input.files || []);
  if (!files.length) return;
  if (!_sowUnitId) {
    showToast('Save the SOW first or open it on a unit before attaching files.');
    input.value = '';
    return;
  }
  // Cumulative size check
  var available = window._SOW_MAX_BYTES - _sowTotalBytes();
  var queued = 0, accepted = [];
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (queued + f.size > available) {
      showToast('Skipped "' + f.name + '" — would exceed 50 MB limit.');
      continue;
    }
    queued += f.size;
    accepted.push(f);
  }
  if (!accepted.length) { input.value = ''; return; }
  var zone = document.getElementById('sow_drop_zone');
  if (zone) zone.classList.add('is-drag');
  try {
    for (var j = 0; j < accepted.length; j++) {
      var rec = await sbUploadAndSave('sow', _sowUnitId, accepted[j], 'units/' + _sowUnitId + '/sow_files');
      window._sowFiles.push(rec);
    }
    renderSowFiles();
    showToast('✓ ' + accepted.length + ' file' + (accepted.length > 1 ? 's' : '') + ' attached');
  } catch (e) {
    console.warn('[SOW FILE] upload failed:', e);
    showToast('Upload failed: ' + (e.message || 'unknown error'));
  }
  if (zone) zone.classList.remove('is-drag');
  input.value = '';
}
function sowFileDrop(e) {
  e.preventDefault();
  var zone = document.getElementById('sow_drop_zone');
  if (zone) zone.classList.remove('is-drag');
  var dt = e.dataTransfer;
  if (!dt || !dt.files || !dt.files.length) return;
  // Reuse handleSowFileUpload by faking an input shape
  handleSowFileUpload({ files: dt.files, value: '' });
}
async function removeSowFile(path) {
  if (!path) return;
  var ok = await showConfirm({
    title:       'Remove this file?',
    message:     'The file will be deleted from this SOW. This cannot be undone.',
    confirmText: 'Remove',
    danger:      true
  });
  if (!ok) return;
  try {
    if (typeof sbDeleteFile === 'function') await sbDeleteFile(path);
  } catch (e) { console.warn('[SOW FILE] delete failed:', e); }
  window._sowFiles = (window._sowFiles || []).filter(function(f){ return f.path !== path; });
  renderSowFiles();
}

var SOW_CATEGORIES = [
  'Foundation / Structure','Roofing','Exterior Walls / Siding','Windows & Doors',
  'Insulation','Plumbing','Electrical','Heating / HVAC','Interior Walls / Drywall',
  'Flooring','Kitchen','Bathroom','Painting','Accessibility Modifications','Other'
];

function openSowModal(unitId, projectNumber) {
  _sowUnitId  = unitId || null;
  _sowItemIdx = 0;

  // Resolve which SOW to open:
  //   - If projectNumber was passed, edit that specific SOW.
  //   - If no projectNumber but the unit has existing SOWs, open the most recent one.
  //     This preserves legacy behavior where call sites like the inventory 🔨 button
  //     expect "open the SOW for this unit" and fall back gracefully for multi-SOW.
  //   - If no projectNumber AND the unit has zero SOWs, create a new one with a
  //     freshly-auto-incremented project number.
  var existingList = unitId ? (typeof getUnitSowList === 'function' ? getUnitSowList(unitId) : []) : [];
  if(!projectNumber && existingList.length > 0){
    // Pick the most recent SOW for this unit so unit-detail click opens it.
    var sortedByDate = existingList.slice().sort(function(a, b){
      return (b.created_at || '').localeCompare(a.created_at || '');
    });
    projectNumber = sortedByDate[0].project_number || null;
  }

  var isEdit = !!projectNumber;
  var saved = (unitId && projectNumber) ? getSowByProjectNumber(unitId, projectNumber) : null;
  window._sowEditingProjectNumber = isEdit ? projectNumber : null;  // remember for save
  window._sowWasPreviouslySaved = isEdit && !!saved;
  var label = '';
  if(unitId) {
    var allUnits = (typeof housingUnits !== 'undefined' && housingUnits.length) ? housingUnits : (window.HOUSING_UNITS_DATA||[]);
    var u = allUnits.find(function(x){ return x.id===unitId; });
    if(u) label = u.num+' '+u.street+' · '+u.bedrooms+'-bed';
  }
  var lbl = document.getElementById('sow_unit_label');
  if(lbl) lbl.textContent = label || 'No unit selected';
  var today = new Date().toISOString().slice(0,10);
  var dateEl = document.getElementById('sow_date'); if(dateEl) dateEl.value = today;
  if(saved) {
    populateSow(saved);
  } else {
    resetSow();
    if(label) { var addr=document.getElementById('sow_address'); if(addr) addr.value=label; }
  }
  // Auto-populate tenant name from unit's assigned tenant (for new SOWs only).
  if(unitId && !saved) {
    var allUnits2 = (typeof housingUnits !== 'undefined' && housingUnits.length) ? housingUnits : (window.HOUSING_UNITS_DATA||[]);
    var u2 = allUnits2.find(function(x){ return x.id===unitId; });
    if(u2 && u2.assignedName) {
      var tnEl = document.getElementById('sow_tenant_name');
      if(tnEl) tnEl.value = u2.assignedName;
    }
  }

  // Show project number header (new visual identifier for the SOW).
  var pnLabel = document.getElementById('sow_project_number_label');
  if(pnLabel){
    var pn = isEdit ? projectNumber : (unitId ? nextProjectNumber(unitId) : '(no unit)');
    pnLabel.textContent = pn;
    window._sowEditingProjectNumber = pn;  // lock in the project number for save (handles new too)
  }

  var modal = document.getElementById('sowModal');
  if(modal){ modal.style.removeProperty('display'); modal.style.setProperty('display','flex','important'); }

  // Init signature pads
  setTimeout(function(){
    if(true) {
      _initSigPad('sow_sig_canvas_tenant');
      _initSigPad('sow_sig_canvas_staff');
    }
  }, 100);

  // Hide budget badge
  setTimeout(function(){
    var badge = document.getElementById('sow_budget_badge');
    if(badge) badge.style.display = 'none';
  }, 50);

  // Apply the locked/unlocked state based on the SOW's status and the current user's role.
  _applySowModalLock(saved);
}

// ── SOW completion state control ──────────────────────────────────────────
// Applies read-only lock when a SOW is completed AND the viewer isn't the ED.
// Also toggles the Mark Complete / Reopen buttons based on status + permissions.
function _applySowModalLock(sow){
  var modal = document.getElementById('sowModal');
  if(!modal) return;
  var completed = isSowCompleted(sow);
  var canEdit   = canEditSow(sow);
  var readOnly  = completed && !canEdit;

  // Banner
  var banner = document.getElementById('sow_readonly_banner');
  if(banner) banner.style.display = readOnly ? 'block' : 'none';

  // Mark Complete button: only show when SOW is NOT completed AND viewer is HM or ED AND there's a unit/saved SOW.
  var mcBtn = document.getElementById('sow_mark_complete_btn');
  if(mcBtn){
    var showMC = !completed && canMarkSowComplete() && !!_sowUnitId && !!window._sowEditingProjectNumber;
    mcBtn.style.display = showMC ? 'flex' : 'none';
  }

  // Reopen button: only show when completed AND viewer is ED.
  var roBtn = document.getElementById('sow_reopen_btn');
  if(roBtn){
    roBtn.style.display = (completed && canReopenSow()) ? 'flex' : 'none';
  }

  // Save button: hidden in read-only mode.
  var saveBtn = document.getElementById('sow_save_btn');
  if(saveBtn) saveBtn.style.display = readOnly ? 'none' : '';

  // Disable every form control inside the modal body when read-only.
  // Inputs in the header (like close button) are outside this query.
  var body = modal.querySelector('div[style*="padding:24px"]');
  if(body){
    var controls = body.querySelectorAll('input, select, textarea, button');
    controls.forEach(function(el){
      // Never disable the "close the modal" or "add SOW line" structural controls? Actually,
      // when read-only we disable them all so the SOW is effectively frozen in view.
      // The only escape is the X in the modal header (not inside body), which stays enabled.
      if(readOnly){
        el.setAttribute('data-sow-locked', '1');
        el.disabled = true;
        el.style.opacity = '0.6';
        el.style.cursor = 'not-allowed';
      } else if(el.getAttribute('data-sow-locked') === '1'){
        // Un-lock if we previously locked this element.
        el.removeAttribute('data-sow-locked');
        el.disabled = false;
        el.style.opacity = '';
        el.style.cursor = '';
      }
    });
    // Disable signature canvases too (they're <canvas> not form controls; swap pointer-events).
    body.querySelectorAll('canvas').forEach(function(c){
      c.style.pointerEvents = readOnly ? 'none' : '';
      c.style.opacity = readOnly ? '0.55' : '';
    });
  }
}

function markSowComplete(){
  if(!_sowUnitId || !window._sowEditingProjectNumber){
    showToast('Save the SOW before marking complete.');
    return;
  }
  if(!canMarkSowComplete()){
    showToast('Only Housing Manager or Executive Director can mark a SOW complete.');
    return;
  }
  var pn = window._sowEditingProjectNumber;
  showConfirm({
    title:       'Mark SOW ' + pn + ' as Completed?',
    message:     'This locks the SOW, work order, and progress reports from further edits. Only the Executive Director can reopen it.',
    confirmText: 'Mark Complete'
  }).then(function(ok){
    if (!ok) return;
    var sow = getSowByProjectNumber(_sowUnitId, pn);
    if(!sow){ showToast('SOW not found'); return; }
    sow.approval_status = 'completed';
    sow.completed_at = new Date().toISOString();
    sow.completed_by = window.currentUserName || _realRoleForPermissions();
    upsertSowInList(_sowUnitId, sow);
    auditEntry('SOW:'+_sowUnitId, 'sow_completed', 'SOW '+pn+' marked Completed', _realRoleForPermissions());
    showToast('✓ SOW marked Completed');
    _applySowModalLock(sow);
  });
}

function reopenSow(){
  if(!_sowUnitId || !window._sowEditingProjectNumber) return;
  if(!canReopenSow()){
    showToast('Only the Executive Director can reopen a completed SOW.');
    return;
  }
  var pn = window._sowEditingProjectNumber;
  showConfirm({
    title:       'Reopen SOW ' + pn + ' for editing?',
    message:     'This returns the SOW to its prior approval state so it can be modified.',
    confirmText: 'Reopen'
  }).then(function(ok){
    if (!ok) return;
    var sow = getSowByProjectNumber(_sowUnitId, pn);
    if(!sow){ showToast('SOW not found'); return; }
    if(sow.edName && sow.edDate) sow.approval_status = 'ed_approved';
    else if(sow.hmName && sow.hmDate) sow.approval_status = 'hm_approved';
    else if((sow.tenantSig && sow.tenantSig.image) || (sow.staffSig && sow.staffSig.image)) sow.approval_status = 'signed';
    else sow.approval_status = 'draft';
    sow.reopened_at = new Date().toISOString();
    sow.reopened_by = window.currentUserName || _realRoleForPermissions();
    upsertSowInList(_sowUnitId, sow);
    auditEntry('SOW:'+_sowUnitId, 'sow_reopened', 'SOW '+pn+' reopened for editing', _realRoleForPermissions());
    showToast('SOW reopened');
    _applySowModalLock(sow);
  });
}
























// ═══════════════════════════════════════════════════════════════════════════
// MULTI-SOW MODEL (one unit → many scopes of work)
// ═══════════════════════════════════════════════════════════════════════════
// Storage shape in housing_sow.data:
//   NEW:    { sows: [{project_number, created_at, approval_status, amount, progress, ...sowFields}, ...] }
//   LEGACY: { ...sowFields }  (a single SOW stored flat — migrated on read)
//
// Migration: _migrateLegacySow wraps legacy records as { sows: [legacy] } transparently.
// Writes always use the NEW shape.





// ── SOW helpers (getSowByProjectNumber, canEditSow, canMarkSowComplete,
//    canReopenSow, upsertSowInList, nextProjectNumber) live in shared-sow.js ──

// ── SOW table on Unit Detail card ─────────────────────────────────────────
// Renders every SOW for a given unit as a row in a table inside the Unit Detail modal.
function udpRenderSowTable(unitId){
  var wrap = document.getElementById('udp_sow_table_wrap');
  if(!wrap) return;
  var list = getUnitSowList(unitId);
  if(!list.length){
    wrap.innerHTML = '<div style="padding:18px;text-align:center;color:var(--muted);font-size:12px;font-style:italic;background:var(--bg);">No scopes of work yet. Click <strong style="color:var(--text);">New SOW</strong> to create one.</div>';
    return;
  }
  // Sort newest first by created_at.
  list = list.slice().sort(function(a, b){
    return (b.created_at || '').localeCompare(a.created_at || '');
  });

  var statusStyles = {
    draft:        {bg:'#f4f4f0', c:'#666',    label:'Draft'},
    signed:       {bg:'#eff6ff', c:'#1d4ed8', label:'Signed'},
    hm_approved:  {bg:'#fffbeb', c:'#92400e', label:'HM Approved'},
    ed_approved:  {bg:'#f0fdf4', c:'#15803d', label:'ED Approved'},
    completed:    {bg:'#f0fdf4', c:'#15803d', label:'Completed'}
  };

  function fmtCurrency(n){
    var v = Number(n) || 0;
    return '$' + v.toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:0});
  }
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  var rows = list.map(function(sow){
    var ss = statusStyles[sow.approval_status] || {bg:'#f4f4f0', c:'#666', label:sow.approval_status || '—'};
    var pn = esc(sow.project_number || '—');
    var date = esc(sow.created_at || sow.date || '—');
    var amount = (sow.amount == null) ? '—' : fmtCurrency(sow.amount);
    var progressPct = (sow.progress && typeof sow.progress.percent === 'number') ? sow.progress.percent : null;
    var progressCell = progressPct == null
      ? '<span style="color:var(--muted);font-size:11px;">—</span>'
      : '<div style="display:flex;align-items:center;gap:6px;min-width:80px;"><div style="flex:1;height:4px;background:var(--border);border-radius:2px;overflow:hidden;"><div style="height:100%;width:'+Math.min(100,Math.max(0,progressPct))+'%;background:'+(progressPct>=100?'var(--success)':'var(--info-blue)')+';"></div></div><span style="font-size:10px;font-weight:700;color:var(--muted);min-width:26px;text-align:right;">'+progressPct+'%</span></div>';
    // Project # cell is clickable — opens the full SOW document in print-ready view.
    // Build row actions based on completion state + viewer role.
    // Completed SOW + non-ED → View (opens read-only) instead of Edit.
    // Work Order stays available to everyone regardless of status.
    var locked = isSowCompleted(sow) && !canEditSow(sow);
    var editBtn = locked
      ? '<button onclick="udpEditSow(\''+esc(unitId)+'\',\''+pn+'\')" title="View SOW (read-only)" style="background:none;border:1px solid var(--border);color:var(--muted);padding:4px 9px;border-radius:5px;cursor:pointer;font-size:10px;font-weight:600;font-family:DM Sans,sans-serif;margin-right:4px;">View</button>'
      : '<button onclick="udpEditSow(\''+esc(unitId)+'\',\''+pn+'\')" title="Edit SOW" style="background:none;border:1px solid var(--border);color:var(--text);padding:4px 9px;border-radius:5px;cursor:pointer;font-size:10px;font-weight:600;font-family:DM Sans,sans-serif;margin-right:4px;">Edit</button>';
    return '<tr style="border-top:1px solid var(--border);">'
      +'<td style="padding:8px 10px;font-size:11px;color:var(--muted);white-space:nowrap;">'+date+'</td>'
      +'<td style="padding:8px 10px;"><span style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:10px;background:'+ss.bg+';color:'+ss.c+';white-space:nowrap;">'+ss.label+(locked?' 🔒':'')+'</span></td>'
      +'<td style="padding:8px 10px;font-size:12px;font-weight:700;white-space:nowrap;">'+amount+'</td>'
      +'<td style="padding:8px 10px;font-size:11px;"><button onclick="udpOpenSowDocument(\''+esc(unitId)+'\',\''+pn+'\')" style="background:none;border:none;color:var(--text);padding:0;font-family:ui-monospace,Menlo,Monaco,\'Courier New\',monospace;font-size:11px;font-weight:600;cursor:pointer;text-decoration:underline;text-decoration-color:var(--border);text-underline-offset:2px;" title="Open full SOW document">'+pn+'</button></td>'
      +'<td style="padding:8px 10px;font-size:10px;">'+progressCell+'</td>'
      +'<td style="padding:6px 8px;white-space:nowrap;text-align:right;">'
        +editBtn
        +'<button onclick="udpPrintWorkOrder(\''+esc(unitId)+'\',\''+pn+'\')" title="Print work order" style="background:var(--yellow);border:none;color:var(--dark);padding:4px 9px;border-radius:5px;cursor:pointer;font-size:10px;font-weight:700;font-family:DM Sans,sans-serif;">Work Order</button>'
      +'</td>'
      +'</tr>';
  }).join('');

  wrap.innerHTML = '<div class="overflow-x"><table style="width:100%;border-collapse:collapse;font-family:DM Sans,sans-serif;">'
    +'<thead><tr style="background:var(--bg);"><th style="padding:7px 10px;font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);text-align:left;">Date</th>'
    +'<th style="padding:7px 10px;font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);text-align:left;">Status</th>'
    +'<th style="padding:7px 10px;font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);text-align:left;">Amount</th>'
    +'<th style="padding:7px 10px;font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);text-align:left;">Project #</th>'
    +'<th style="padding:7px 10px;font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);text-align:left;">Progress</th>'
    +'<th style="padding:7px 10px;"></th></tr></thead>'
    +'<tbody>'+rows+'</tbody></table></div>';
}

function udpNewSow(){
  if(!_currentDetailUnitId) return;
  closeUnitDetail();
  openSowModal(_currentDetailUnitId);  // no projectNumber → new SOW
}

function udpEditSow(unitId, projectNumber){
  closeUnitDetail();
  openSowModal(unitId, projectNumber);
}

function udpOpenSowDocument(unitId, projectNumber){
  // Opens the full SOW as a print-ready document (same as "Full SOW" button inside the modal).
  // Loads the SOW into the modal first so printSOW() has the right data, then triggers print.
  var sow = getSowByProjectNumber(unitId, projectNumber);
  if(!sow){ showToast('SOW not found'); return; }
  closeUnitDetail();
  openSowModal(unitId, projectNumber);
  // Give the modal a tick to populate before printing.
  setTimeout(function(){ if(true) printSOW(); }, 250);
}

function udpPrintWorkOrder(unitId, projectNumber){
  // Prints a work order for the specific SOW. Loads the SOW into the modal briefly so
  // the existing printWorkOrder() (which reads from modal state) produces the right output.
  var sow = getSowByProjectNumber(unitId, projectNumber);
  if(!sow){ showToast('SOW not found'); return; }
  closeUnitDetail();
  openSowModal(unitId, projectNumber);
  setTimeout(function(){ if(true) printWorkOrder(); }, 250);
}














function saveSOW(){
  var get=function(id){ var el=document.getElementById(id); return el?el.value.trim():''; };
  var chk=function(id){ var el=document.getElementById(id); return el?el.checked:false; };
  var data = {
    unitId:_sowUnitId, address:get('sow_address'), date:get('sow_date'),
    tenantName:get('sow_tenant_name'),
    preparedBy:get('sow_prepared_by'), contractor:get('sow_contractor'), contractorId:(document.getElementById('sow_contractor_id')||{}).value||'',
    condition:get('sow_condition'), totalCost:get('sow_total_cost'),
    startDate:get('sow_start_date'), endDate:get('sow_end_date'), notes:get('sow_notes'),
    hmName:get('sow_hm_name'), hmDate:get('sow_hm_date'),
    edName:get('sow_ed_name'), edDate:get('sow_ed_date'),
    tenantSig: {
      name:  get('sow_sig_tenant_name'),
      date:  get('sow_sig_tenant_date'),
      image: (typeof getSigDataURL === 'function') ? getSigDataURL('sow_sig_canvas_tenant') : ''
    },
    staffSig: {
      name:  get('sow_sig_staff_name'),
      date:  get('sow_sig_staff_date'),
      image: (typeof getSigDataURL === 'function') ? getSigDataURL('sow_sig_canvas_staff') : ''
    },
    mold:chk('sow_mold'), asbestos:chk('sow_asbestos'), electrical:chk('sow_electrical'),
    structural:chk('sow_structural'), plumbing:chk('sow_plumbing'), fire:chk('sow_fire'),
    rentArrears:chk('sow_rent_arrears'), tenantDamage:chk('sow_tenant_damage'),
    negligence:chk('sow_negligence'), vandalism:chk('sow_vandalism'),
    policeReport:chk('sow_police_report'), accountabilityNotes:get('sow_accountability_notes'),
    items:collectSowItems(),
    files: (window._sowFiles || []).slice(),
    savedAt:new Date().toISOString()
  };
  // ── Multi-SOW fields ───────────────────────────────────────────────────
  // Stamp the project number (either the one being edited or a fresh one for new SOWs).
  data.project_number = window._sowEditingProjectNumber || (_sowUnitId ? nextProjectNumber(_sowUnitId) : 'NO-UNIT-SOW-001');
  // Preserve created_at if editing an existing SOW; otherwise stamp today.
  if(_sowUnitId){
    var existing = getSowByProjectNumber(_sowUnitId, data.project_number);
    data.created_at = (existing && existing.created_at) || data.date || new Date().toISOString().slice(0,10);
    // Preserve progress block so editing SOW doesn't wipe progress.
    if(existing && existing.progress) data.progress = existing.progress;
  } else {
    data.created_at = data.date || new Date().toISOString().slice(0,10);
  }
  // Normalize the amount to a number for table display / sorting.
  var totalNum = parseFloat(String(data.totalCost||'').replace(/[^0-9.\-]/g,'')) || 0;
  data.amount = totalNum;

  // ── Approval-chain authority gate ─────────────────────────────────────────
  // Strip name/date fields the actor isn't authorized to fill so the
  // auto-promotion below cannot bump status past what they're allowed.
  var _saveRole = window.currentRole || 'staff';
  if(!APPROVAL_AUTHORITY.can('approveSowOverThreshold', _saveRole)){
    data.edName = ''; data.edDate = '';
  }
  if(!APPROVAL_AUTHORITY.can('approveSowUnderThreshold', _saveRole) &&
     !APPROVAL_AUTHORITY.can('approveSowOverThreshold', _saveRole)){
    data.hmName = ''; data.hmDate = '';
  }

  // Compute a simple approval_status from the signature / approval fields on the form.
  // EXCEPTION: if the SOW was already marked 'completed', preserve that — only markSowComplete/reopenSow
  // should transition into or out of the completed state. This keeps Save from accidentally
  // downgrading a completed SOW when an ED edits its fields.
  var existingForStatus = _sowUnitId && data.project_number ? getSowByProjectNumber(_sowUnitId, data.project_number) : null;
  if(existingForStatus && existingForStatus.approval_status === 'completed'){
    data.approval_status = 'completed';
    if(existingForStatus.completed_at) data.completed_at = existingForStatus.completed_at;
    if(existingForStatus.completed_by) data.completed_by = existingForStatus.completed_by;
  } else if(data.edName && data.edDate && APPROVAL_AUTHORITY.can('approveSowOverThreshold', _saveRole)) data.approval_status = 'ed_approved';
  else if(data.hmName && data.hmDate && APPROVAL_AUTHORITY.can('approveSowUnderThreshold', _saveRole)) data.approval_status = 'hm_approved';
  else if((data.tenantSig && data.tenantSig.image) || (data.staffSig && data.staffSig.image)) data.approval_status = 'signed';
  else data.approval_status = 'draft';

  if(_sowUnitId) upsertSowInList(_sowUnitId, data);

  // ── Audit trail ──────────────────────────────────────────────────────────
  var role = window.currentRole || 'staff';
  var addr = data.address || _sowUnitId || 'unit';
  var isNew = !window._sowWasPreviouslySaved;
  window._sowWasPreviouslySaved = true;

  // Core save event
  var detail = (isNew ? 'SOW created' : 'SOW updated') + ' — ' + addr;
  if(data.totalCost) detail += ' · Total: ' + data.totalCost;
  if(data.condition) detail += ' · Condition: ' + data.condition;
  auditEntry('SOW:'+(_sowUnitId||'?'), isNew ? 'sow_created' : 'sow_updated', detail, role);

  // Tenant signature captured
  if(data.tenantSig && (data.tenantSig.name || data.tenantSig.image)) {
    auditEntry('SOW:'+(_sowUnitId||'?'), 'sow_tenant_signed',
      'Tenant signature recorded — ' + (data.tenantSig.name || 'name not provided') +
      (data.tenantSig.date ? ' on ' + data.tenantSig.date : ''), role);
  }
  // Staff signature captured
  if(data.staffSig && (data.staffSig.name || data.staffSig.image)) {
    auditEntry('SOW:'+(_sowUnitId||'?'), 'sow_staff_signed',
      'Staff signature recorded — ' + (data.staffSig.name || 'name not provided') +
      (data.staffSig.date ? ' on ' + data.staffSig.date : ''), role);
  }
  // HM approval recorded
  if(data.hmName) {
    auditEntry('SOW:'+(_sowUnitId||'?'), 'sow_hm_approval',
      'HM approval recorded — ' + data.hmName + (data.hmDate ? ' on ' + data.hmDate : ''), role);
  }
  // ED approval recorded
  if(data.edName) {
    auditEntry('SOW:'+(_sowUnitId||'?'), 'sow_ed_approval',
      'ED approval recorded — ' + data.edName + (data.edDate ? ' on ' + data.edDate : ''), role);
  }
  // Accountability flags
  var flags = [];
  if(data.rentArrears)  flags.push('rent arrears');
  if(data.tenantDamage) flags.push('tenant damage');
  if(data.negligence)   flags.push('negligence');
  if(data.vandalism)    flags.push('vandalism');
  if(data.policeReport) flags.push('police report');
  if(flags.length) {
    auditEntry('SOW:'+(_sowUnitId||'?'), 'sow_accountability',
      'Accountability flags set: ' + flags.join(', '), role);
  }
  // Refresh the inline audit panel if visible
  if(true) renderSowAuditLog(_sowUnitId);

  var ind=document.getElementById('sow_saved_indicator');
  if(ind) ind.textContent='✓ Saved '+new Date().toLocaleTimeString();
  showToast('Scope of work saved');
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
    return '<div class="print-sec">'
      +'<div style="font-size:8.5px;font-weight:bold;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:4px;">'+role+'</div>'
      +'<div style="font-size:11px;font-weight:bold;color:var(--text);margin-bottom:6px;">'+(name||'_____________________________')+'</div>'
      +'<div style="height:40px;border-bottom:1px solid var(--muted);margin-bottom:4px;"></div>'
      +'<div style="font-size:9px;color:var(--muted);">Date: '+(date||'_____________')+'</div>'
      +'</div>';
  }

  var itemRows = items.filter(function(it){ return it.category||it.description||it.cost; }).map(function(it, i){
    var cost = it.cost ? '$'+parseFloat(it.cost).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) : '—';
    return '<tr style="'+(i%2===1?'background:var(--bg);':'')+'">'
      +'<td style="padding:7px 10px;border-bottom:1px solid var(--border);font-size:10px;color:var(--text);">'+( it.category||'—')+'</td>'
      +'<td style="padding:7px 10px;border-bottom:1px solid var(--border);font-size:10px;color:var(--text);">'+(it.description||'—')+'</td>'
      +'<td style="padding:7px 10px;border-bottom:1px solid var(--border);font-size:10px;text-align:right;font-weight:600;color:var(--text);">'+cost+'</td>'
      +'</tr>';
  }).join('');

  var _natDisp  = (window.NATION_CONFIG && (NATION_CONFIG.display_name || NATION_CONFIG.name)) || '';
  var _natShort = (window.NATION_CONFIG && NATION_CONFIG.short) || '';
  var html = '<!DOCTYPE html><html lang="en"><head>'
    +'<meta charset="UTF-8"/>'
    +'<title>Scope of Work — '+_natShort+' Housing</title>'
    +'<style>'
    +'*{box-sizing:border-box;margin:0;padding:0;}'
    +'body{font-family:Georgia,serif;font-size:11px;color:var(--text);background:#fff;}'
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
    +'.header-title .org{font-size:13px;font-weight:bold;color:var(--yellow);letter-spacing:.04em;}'
    +'.header-title .dept{font-size:10px;color:#ccc;margin-top:2px;}'
    +'.header-right{text-align:right;}'
    +'.header-right .doc-type{font-size:16px;font-weight:bold;color:var(--yellow);letter-spacing:.05em;}'
    +'.header-right .doc-date{font-size:9px;color:#aaa;margin-top:3px;}'
    +'.yellow-bar{background:var(--yellow);height:4px;}'
    +'.body{padding:20px 0 0;}'
    +'.section{margin-bottom:20px;}'
    +'.section-title{font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:.08em;color:#fff;background:#000;padding:5px 10px;margin-bottom:0;}'
    +'.section-body{border:1px solid var(--border);border-top:none;padding:12px 14px;}'
    +'.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px;}'
    +'.grid-4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px 16px;}'
    +'.field label{display:block;font-size:8.5px;font-weight:bold;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:3px;}'
    +'.field span{display:block;font-size:11px;color:var(--text);min-height:14px;border-bottom:1px solid #e0e0e0;padding-bottom:3px;}'
    +'table{width:100%;border-collapse:collapse;font-size:10px;}'
    +'th{background:#000;color:var(--yellow);padding:7px 10px;text-align:left;font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:.05em;}'
    +'th.right{text-align:right;}'
    +'.total-row td{background:var(--yellow);color:#000;font-weight:bold;padding:8px 10px;font-size:11px;}'
    +'.hazard-badge{display:inline-block;background:#fff0f0;color:#b91c1c;border:1px solid #fca5a5;padding:3px 9px;border-radius:3px;font-size:9px;font-weight:bold;margin:2px;}'
    +'.sig-block{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:4px;}'
    +'.sig-line{margin-top:32px;border-top:1px solid #333;padding-top:5px;font-size:9px;color:var(--muted);}'
    +'.sig-name{font-size:11px;font-weight:bold;color:var(--text);margin-bottom:2px;}'
    +'.footer{margin-top:24px;border-top:3px solid var(--yellow);padding-top:8px;display:flex;justify-content:space-between;align-items:center;}'
    +'.footer-left{font-size:8.5px;color:var(--muted);}'
    +'.footer-right{font-size:8.5px;color:var(--muted);}'
    +'</style>'
    +'</head><body>'

    /* HEADER */
    +'<div class="header">'
      +'<div class="header-left">'
        +'<img class="header-logo" src="LOGO_SRC" alt="'+_natShort+'"/>'
        +'<div class="header-title">'
          +'<div class="org">'+_natDisp+'</div>'
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
          +'<div class="section-body" style="font-size:11px;line-height:1.6;color:var(--text);">'+get('sow_notes')+'</div>'
        +'</div>'
      : '')

    /* Accountability */
    +((acctFlags.length || acctNotes)
      ? '<div class="section">'
          +'<div class="section-title">Tenant Accountability</div>'
          +'<div class="section-body">'
            +(acctFlags.length ? '<div style="margin-bottom:8px;">'+acctFlags.map(function(f){ return '<span class="hazard-badge">'+f+'</span>'; }).join(' ')+'</div>' : '')
            +(acctNotes ? '<div style="font-size:10px;color:var(--text);line-height:1.5;">'+acctNotes+'</div>' : '')
          +'</div>'
        +'</div>'
      : '')

    /* Terms & Conditions */
    +'<div class="section">'      +'<div class="section-title">Terms &amp; Conditions</div>'      +'<div class="section-body" style="font-size:9.5px;color:var(--text);line-height:1.65;">'        +'<p style="font-size:8.5px;font-weight:bold;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:10px;">'+_natDisp+' &mdash; Housing Department</p>'        +'<div class="print-mb"><strong>1. Prioritization of Requests.</strong> Renovation requests are assessed and prioritized based on urgency of need, health and safety risk to occupants, and overall unit condition. Immediate hazards &mdash; structural, electrical, plumbing, or fire safety &mdash; take priority over general maintenance and cosmetic work.</div>'        +'<div class="print-mb"><strong>2. Funding Eligibility &amp; Unit Qualifying Criteria.</strong> Approval is subject to available funding and the qualifying criteria of the unit under its applicable program (e.g. ISC, CMHC Sec. 95, CMHC Sec. 56.1, or Band-funded). Funding availability may affect the scope, cost ceiling, or timing of approved work.</div>'        +'<div class="print-mb"><strong>3. Budget Authority &amp; Approval Routing.</strong> Requests within the Housing Manager&rsquo;s approved budget authority may be approved by the HM. Requests exceeding that threshold require Executive Director approval before work commences. No work begins until all approvals are documented.</div>'        +'<div class="print-mb"><strong>4. Tenant Responsibilities.</strong> The tenant must provide timely access to the unit for inspection and work. Damage, negligence, or vandalism attributed to the tenant may reduce priority and may result in financial responsibility for a portion of repair costs.</div>'        +'<div class="print-mb"><strong>5. No Guarantee of Approval or Timeline.</strong> Submission does not guarantee approval or a specific completion date. Decisions will be communicated in writing. Priority and scheduling may change based on available resources and emerging urgent community needs.</div>'        +'<div><strong>6. Accuracy of Information.</strong> All information must be accurate and complete. False or misleading information may result in the request being cancelled, delayed, or referred for further review.</div>'      +'</div>'    +'</div>'
    /* Acknowledgement & Signatures */
    +'<div class="section">'
      +'<div class="section-title">Signatures &amp; Acknowledgement</div>'
      +'<div class="section-body">'
        /* Declaration text */
        +'<div style="font-size:9.5px;color:var(--text);line-height:1.6;margin-bottom:14px;padding:10px 12px;background:var(--bg);border-left:3px solid var(--yellow);">'
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
        +'<div style="font-size:9px;color:var(--muted);margin-bottom:12px;">Budget authority: HM may approve up to the configured limit. Work exceeding this limit requires Executive Director approval.</div>'
        +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">'
          +approvalBlock('Housing Manager Approval', get('sow_hm_name'), get('sow_hm_date'))
          +approvalBlock('Executive Director Approval', get('sow_ed_name'), get('sow_ed_date'))
        +'</div>'
      +'</div>'
    +'</div>'

    +'</div>'/* /body */

    /* FOOTER */
    +'<div class="footer">'
      +'<div class="footer-left">'+escapeHtml(buildNationFooterStrip())+'</div>'
      +'<div class="footer-right">Generated '+today+'</div>'
    +'</div>'

    +'</body></html>';

  /* Inject logo */
  html = html.replace('LOGO_SRC', 'data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAbXB9ADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB//9k=');

  showPrintPanel(html, 'Scope of Work');
}
