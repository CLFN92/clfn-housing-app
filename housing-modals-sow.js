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
    showToast('Save the request first or open it on a unit before attaching files.');
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

// ════════════════════════════════════════════════════════════════════════════
// SOW MODAL TEMPLATE — single source of truth
// ════════════════════════════════════════════════════════════════════════════
// Until Stop B the SOW modal markup was duplicated across renos.html,
// inventory.html, match.html, and tenants.html — four copies that drifted
// (renos.html was an older variant missing project number, file uploads,
// mark-complete/reopen buttons, and used inline styles instead of semantic
// classes). The template lives here now; each page just hosts an empty
// <div id="sowModalHost"></div> and openSowModal() mounts the template on
// first call via _ensureSowModal().
//
// Sections are wrapped in 7 .modal-tab-panel containers so the modal can scroll
// far less on iPad/iPhone (Stop C tab refactor):
//   overview     — Unit Information + Condition Assessment
//   scope        — Scope of Work Items + Photos & Documents
//   safety       — Health & Safety Concerns
//   acct         — Tenant Accountability (no longer collapsible; tabs handle it)
//   notes        — Additional Notes + Terms & Conditions
//   sigs         — Signatures & Acknowledgement (Required)
//   approvals    — HM + ED approval fields
//
// All element IDs and onclick handlers are preserved exactly so existing JS
// (saveSOW, addSowItem, setSigMethod, clearSig, sowContractorSearch,
// markSowComplete, reopenSow, archiveCurrentSow, handleSowFileUpload,
// photoDragOver, photoDragLeave, sowFileDrop, printSOW, printWorkOrder,
// closeSowModal) keeps working unchanged.
function _buildSowModalHTML() {
  return '' +
    '<div class="modal-body-sow-shell">' +
      // ── Header ───────────────────────────────────────────────────────────
      '<div class="modal-hdr spacious sticky">' +
        '<div>' +
          '<div class="lbl-uppercase-sm" data-nation-template="{NATION} — Housing">Constance Lake First Nation — Housing</div>' +
          '<div class="txt-hdr-white">Maintenance Request</div>' +
          '<div id="sow_unit_label" class="txt-sm-meta"></div>' +
          '<div class="sow-pn-row"><span class="sow-pn-lbl">Project #</span><span id="sow_project_number_label" class="sow-pn-val"></span></div>' +
        '</div>' +
        '<div class="sow-hdr-actions">' +
          '<button id="sow_approve_btn" type="button" onclick="sowApproveInline()" class="sow-hdr-btn-success" style="display:none;">✓ Approve</button>' +
          '<button id="sow_mark_complete_btn" type="button" onclick="markSowComplete()" class="sow-hdr-btn-success" style="display:none;">✓ Mark Complete</button>' +
          '<button id="sow_reopen_btn" type="button" onclick="reopenSow()" class="sow-hdr-btn-warn" style="display:none;">↺ Reopen</button>' +
          '<button id="sow_archive_btn" type="button" onclick="archiveCurrentSow()" class="sow-hdr-btn-ghost" style="display:none;">🗄 Archive</button>' +
          '<button type="button" onclick="printWorkOrder()" class="sow-hdr-btn-primary">🏗 Work Order</button>' +
          '<button type="button" onclick="printSOW()" class="sow-hdr-btn-ghost">🖨 Full Request</button>' +
          '<button type="button" id="sow_rfq_btn" onclick="if(_sowUnitId&&window._sowEditingProjectNumber){saveSOW();try{var _c=window._sowCache&&window._sowCache[_sowUnitId];var _sa=_c&&Array.isArray(_c.sows)?_c.sows:(_c&&Array.isArray(_c)?_c:[]);var _sh=_sa.find(function(s){return s&&s.project_number===window._sowEditingProjectNumber;})||null;if(_sh)sessionStorage.setItem(\'_rfq_sow_handoff\',JSON.stringify(_sh));}catch(e){}window.location.href=\'rfq.html?unit=\'+encodeURIComponent(_sowUnitId)+\'&sow=\'+encodeURIComponent(window._sowEditingProjectNumber);}else{if(typeof showToast===\'function\')showToast(\'Save the request first\');}" class="sow-hdr-btn-ghost" style="display:none;">📋 RFQ</button>' +
          '<button type="button" onclick="closeSowModal()" class="btn-close-sm">✕</button>' +
        '</div>' +
      '</div>' +

      // Read-only banner (shown when SOW is marked Complete and locked)
      '<div id="sow_readonly_banner" class="banner-strip-success" style="display:none;"><span class="banner-icon">🔒</span>This Maintenance Request is marked Completed and is read-only. Only the Executive Director can reopen or modify a completed request.</div>' +

      // ── Tab strip (desktop) ──────────────────────────────────────────────
      // CSS hides this on viewports < 640px and shows the drawer below.
      '<div class="modal-tabs" id="sow_tab_bar">' +
        '<button type="button" class="modal-tab active" data-modal-tab="overview"  onclick="setSowTab(\'overview\')">Overview</button>' +
        '<button type="button" class="modal-tab"        data-modal-tab="scope"     onclick="setSowTab(\'scope\')">Work Items</button>' +
        '<button type="button" class="modal-tab"        data-modal-tab="documents" onclick="setSowTab(\'documents\')">Documents</button>' +
        '<button type="button" class="modal-tab"        data-modal-tab="safety"    onclick="setSowTab(\'safety\')">Health &amp; Safety</button>' +
        '<button type="button" class="modal-tab"        data-modal-tab="acct"      onclick="setSowTab(\'acct\')">Accountability</button>' +
        '<button type="button" class="modal-tab"        data-modal-tab="notes"     onclick="setSowTab(\'notes\')">Notes &amp; Terms</button>' +
        '<button type="button" class="modal-tab"        data-modal-tab="sigs"      onclick="setSowTab(\'sigs\')">Signatures</button>' +
      '</div>' +

      // ── Tab drawer (mobile) ──────────────────────────────────────────────
      // Always-open vertical tab list for small screens. No toggle — all 7
      // sections are visible at once so the user can tap any one without
      // an extra expand step. CSS hides this whole block on viewports
      // >= 640px (the horizontal strip above takes over).
      '<div class="modal-tab-drawer" id="sow_tab_drawer">' +
        '<button type="button" class="modal-drawer-item active" data-modal-tab="overview"  onclick="setSowTab(\'overview\')">Overview</button>' +
        '<button type="button" class="modal-drawer-item"        data-modal-tab="scope"     onclick="setSowTab(\'scope\')">Work Items</button>' +
        '<button type="button" class="modal-drawer-item"        data-modal-tab="documents" onclick="setSowTab(\'documents\')">Documents</button>' +
        '<button type="button" class="modal-drawer-item"        data-modal-tab="safety"    onclick="setSowTab(\'safety\')">Health &amp; Safety</button>' +
        '<button type="button" class="modal-drawer-item"        data-modal-tab="acct"      onclick="setSowTab(\'acct\')">Accountability</button>' +
        '<button type="button" class="modal-drawer-item"        data-modal-tab="notes"     onclick="setSowTab(\'notes\')">Notes &amp; Terms</button>' +
        '<button type="button" class="modal-drawer-item"        data-modal-tab="sigs"      onclick="setSowTab(\'sigs\')">Signatures</button>' +
      '</div>' +

      // ── Tab panels ───────────────────────────────────────────────────────
      '<div class="modal-body-stack">' +

        // ── OVERVIEW ─────────────────────────────────────────────────────
        '<div class="modal-tab-panel active" data-modal-panel="overview">' +
          '<div class="card card-flush-mb-overflow">' +
            '<div class="modal-hdr compact"><div class="lbl-yellow">Unit Information</div></div>' +
            '<div class="grid-c2-pad">' +
              '<div class="f"><label>Unit Address</label><input id="sow_address" type="text" placeholder="e.g. 11 Musko Road"/></div>' +
              '<div class="f"><label>Date Prepared</label><input id="sow_date" type="date"/></div>' +
              '<div class="f"><label>Current Tenant Name</label><input id="sow_tenant_name" type="text" placeholder="Full name of tenant"/></div>' +
              '<div class="f"><label>Prepared By (Staff)</label><input id="sow_prepared_by" type="text" placeholder="Staff name"/></div>' +
              '<div class="f"><label>PO Number <span style="font-size:10px;font-weight:400;color:var(--muted);">(from accounting)</span></label><input id="sow_po_number" type="text" placeholder="e.g. PO-2026-0042"/></div>' +
              '<div class="f sow-ct-row"><label>Contractor (if assigned)</label>' +
                '<input id="sow_contractor" type="text" placeholder="Search contractors…" autocomplete="off"' +
                  ' oninput="sowContractorSearch(this.value)" onfocus="sowContractorSearch(\'\')"' +
                  ' onblur="setTimeout(function(){var d=document.getElementById(\'sow_ct_dropdown\');if(d)d.style.display=\'none\';},180)"/>' +
                '<input type="hidden" id="sow_contractor_id"/>' +
                '<div id="sow_ct_dropdown"></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="card card-flush-mb">' +
            '<div class="modal-hdr compact"><div class="lbl-yellow">Condition Assessment</div></div>' +
            '<div class="grid-c2-pad">' +
              '<div class="f"><label>Overall Condition</label>' +
                '<select id="sow_condition">' +
                  '<option value="">— Select —</option>' +
                  '<option value="Good">Good — minor maintenance only</option>' +
                  '<option value="Fair">Fair — moderate repairs needed</option>' +
                  '<option value="Poor">Poor — significant repairs needed</option>' +
                  '<option value="Critical">Critical — unsafe / condemned</option>' +
                '</select>' +
              '</div>' +
              '<div class="f"><label>Fund Source <span id="sow_fund_badge" style="display:none;margin-left:6px;padding:1px 8px;border-radius:10px;font-size:10px;font-weight:700;vertical-align:middle;"></span></label>' +
                '<select id="sow_fund_source" onchange="_sowUpdateFundBadge(this.value)">' +
                  '<option value="">— Select fund source —</option>' +
                '</select>' +
                '<div id="sow_fund_rule" style="font-size:10px;color:var(--muted);margin-top:3px;"></div>' +
              '</div>' +
              '<div class="f"><label>Target Start Date</label><input id="sow_start_date" type="date"/></div>' +
              '<div class="f"><label>Target Completion Date</label><input id="sow_end_date" type="date"/></div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // ── SCOPE OF WORK ────────────────────────────────────────────────
        // Estimated Total Cost sits HERE (not on Overview) because the
        // value is auto-calculated from the SOW Items list above it —
        // reading top-to-bottom: itemize the work → see the total.
        '<div class="modal-tab-panel" data-modal-panel="scope">' +
          '<div class="card card-flush-mb">' +
            '<div class="modal-hdr compact"><div class="lbl-yellow">Work Items</div></div>' +
            '<div class="p-16">' +
              '<div id="sow_items"></div>' +
              '<button type="button" onclick="addSowItem()" class="sow-add-item-btn">+ Add Work Item</button>' +
            '</div>' +
          '</div>' +
          '<div class="card card-flush-mb">' +
            '<div class="modal-hdr compact"><div class="lbl-yellow">Estimated Total Cost</div></div>' +
            '<div class="grid-c2-pad">' +
              '<div class="f"><label>Sum of items above</label><input id="sow_total_cost" type="text" placeholder="Auto-calculated" readonly class="sow-total-cost-input"/></div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // ── DOCUMENTS ────────────────────────────────────────────────────
        // Photos + supporting documents (PDFs, quotes, inspection reports).
        // Split out of the Scope of Work tab so files don't compete with
        // the work-items list for screen space, especially on tablet.
        '<div class="modal-tab-panel" data-modal-panel="documents">' +
          '<div class="card card-flush-mb">' +
            '<div class="modal-hdr compact"><div class="lbl-yellow">Photos &amp; Documents</div><div id="sow_files_size" class="file-list-meta"></div></div>' +
            '<div class="p-16">' +
              '<div id="sow_drop_zone" class="upload-zone"' +
                ' ondragover="photoDragOver(event,\'sow_drop_zone\')"' +
                ' ondragleave="photoDragLeave(\'sow_drop_zone\')"' +
                ' ondrop="sowFileDrop(event)"' +
                ' onclick="document.getElementById(\'sow_files_input\').click()">' +
                '<svg class="upload-zone-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>' +
                '<div class="upload-zone-title">Drag files here or <span class="link-yellow">browse</span></div>' +
                '<div class="txt-muted-xs">Photos · PDF · DOC/DOCX · XLS/XLSX · CSV · TXT — up to 50 MB total</div>' +
                '<input type="file" id="sow_files_input" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" multiple onchange="handleSowFileUpload(this)"/>' +
              '</div>' +
              '<div id="sow_files_list" class="file-list"></div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // ── HEALTH & SAFETY ──────────────────────────────────────────────
        '<div class="modal-tab-panel" data-modal-panel="safety">' +
          '<div class="card card-flush-mb">' +
            '<div class="modal-hdr compact"><div class="lbl-yellow">Health &amp; Safety Concerns</div></div>' +
            '<div class="p-16">' +
              '<div class="grid-c3-tight">' +
                '<label class="check-row"><input type="checkbox" id="sow_mold" class="icon-sm"/> Mould / Mildew</label>' +
                '<label class="check-row"><input type="checkbox" id="sow_asbestos" class="icon-sm"/> Asbestos Risk</label>' +
                '<label class="check-row"><input type="checkbox" id="sow_electrical" class="icon-sm"/> Electrical Hazard</label>' +
                '<label class="check-row"><input type="checkbox" id="sow_structural" class="icon-sm"/> Structural Concern</label>' +
                '<label class="check-row"><input type="checkbox" id="sow_plumbing" class="icon-sm"/> Plumbing / Sewage</label>' +
                '<label class="check-row"><input type="checkbox" id="sow_fire" class="icon-sm"/> Fire Safety</label>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // ── ACCOUNTABILITY ───────────────────────────────────────────────
        '<div class="modal-tab-panel" data-modal-panel="acct">' +
          '<div class="card card-flush-mb">' +
            '<div class="modal-hdr compact"><div class="lbl-yellow">Tenant Accountability</div></div>' +
            '<div class="p-16">' +
              '<div class="sow-acct-hint">Record factors that affect renovation priority and tenant responsibility.</div>' +
              '<div class="sow-acct-list">' +
                '<div class="ftog"><label class="tsw"><input type="checkbox" id="sow_rent_arrears"/><span class="tsl"></span></label><label for="sow_rent_arrears" class="txt-sm-bold">Tenant has rent arrears</label></div>' +
                '<div class="ftog"><label class="tsw"><input type="checkbox" id="sow_tenant_damage"/><span class="tsl"></span></label><label for="sow_tenant_damage" class="txt-sm-bold">Damage caused by tenant</label></div>' +
                '<div class="ftog"><label class="tsw"><input type="checkbox" id="sow_negligence"/><span class="tsl"></span></label><label for="sow_negligence" class="txt-sm-bold">Negligence (failure to maintain / report issues)</label></div>' +
                '<div class="ftog"><label class="tsw"><input type="checkbox" id="sow_vandalism"/><span class="tsl"></span></label><label for="sow_vandalism" class="txt-sm-bold">Vandalism</label></div>' +
                '<div class="ftog"><label class="tsw"><input type="checkbox" id="sow_police_report"/><span class="tsl"></span></label><label for="sow_police_report" class="txt-sm-bold">Police report on file</label></div>' +
              '</div>' +
              '<div class="f"><label>Accountability Notes</label>' +
                '<textarea id="sow_accountability_notes" rows="2" placeholder="Details on tenant responsibility, incident dates, report numbers…"></textarea>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // ── NOTES & TERMS ────────────────────────────────────────────────
        '<div class="modal-tab-panel" data-modal-panel="notes">' +
          '<div class="card card-flush-mb">' +
            '<div class="modal-hdr compact"><div class="lbl-yellow">Additional Notes</div></div>' +
            '<div class="p-16">' +
              '<div class="f"><label>Special Instructions / Access Requirements</label>' +
                '<textarea id="sow_notes" rows="3" placeholder="Any additional context, access requirements, tenant considerations…"></textarea>' +
              '</div>' +
            '</div>' +
          '</div>' +
          // Terms & Conditions default to COLLAPSED — the section is long
          // boilerplate that users rarely need to read in full once they've
          // seen it once. The accordion uses the shared .collapsible-card
          // pattern (toggling .is-collapsed on the wrapper card hides the
          // .collapsible-body and rotates the chevron).
          '<div class="card card-flush-mb collapsible-card is-collapsed">' +
            '<div class="modal-hdr compact collapsible-head" onclick="this.parentElement.classList.toggle(\'is-collapsed\')">' +
              '<div class="lbl-yellow">Terms &amp; Conditions</div>' +
              '<svg class="collapsible-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--yellow)" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>' +
            '</div>' +
            '<div id="sow_terms_body" class="sow-terms-body collapsible-body">' +
              '<p class="sow-terms-eyebrow" data-nation-template="{NATION} — Housing Department">Constance Lake First Nation — Housing Department</p>' +
              '<p class="sow-terms-lead">By completing and submitting this Maintenance Request, the submitting party acknowledges and agrees to the following terms.</p>' +
              '<div class="flex-col-12">' +
                '<div class="yellow-accent"><div class="lbl-field">1. Prioritization of Requests</div><p class="txt-muted-sm">Renovation requests are assessed and prioritized based on the urgency of need, health and safety risk to occupants, and the overall condition of the unit. Requests involving immediate hazards — including structural, electrical, plumbing, or fire safety concerns — are given priority consideration over general maintenance and cosmetic work.</p></div>' +
                '<div class="yellow-accent"><div class="lbl-field">2. Funding Eligibility &amp; Unit Qualifying Criteria</div><p class="txt-muted-sm">Approval is subject to available funding and the qualifying criteria of the unit under its applicable program (e.g. ISC, CMHC Section 95, CMHC Section 56.1, or Band-funded). Not all units qualify under all funding sources, and funding availability may affect the scope, cost ceiling, or timing of approved work. Requests will be assessed against the current budget allocation for the relevant funding pool.</p></div>' +
                '<div class="yellow-accent"><div class="lbl-field">3. Budget Authority &amp; Approval Routing</div><p class="txt-muted-sm">Renovation requests within the Housing Manager’s approved budget authority may be approved by the Housing Manager. Any request exceeding that threshold — as established in the Housing Department’s current budget policy — requires Executive Director approval before work may commence. No work is to be initiated until all required approvals have been obtained and documented.</p></div>' +
                '<div class="yellow-accent"><div class="lbl-field">4. Tenant Responsibilities</div><p class="txt-muted-sm">The tenant is required to provide timely and reasonable access to the unit for inspection, assessment, and the completion of approved work. Damage, negligence, or vandalism attributed to the tenant may reduce the priority of the request and may result in the tenant being held financially responsible for a portion of repair costs, as determined by the Housing Manager.</p></div>' +
                '<div class="yellow-accent"><div class="lbl-field">5. No Guarantee of Approval or Timeline</div><p class="txt-muted-sm">Submission of this form does not guarantee approval or a specific completion date. The <span data-nation="short">CLFN</span> Housing Department will communicate decisions in writing. Priority and scheduling are subject to change based on available resources, contractor availability, and emerging urgent needs within the community.</p></div>' +
                '<div class="yellow-accent"><div class="lbl-field">6. Accuracy of Information</div><p class="txt-muted-sm">All information provided in this Maintenance Request must be accurate and complete. Submitting false or misleading information may result in the request being cancelled, delayed, or referred for further review.</p></div>' +
              '</div>' +
              '<p class="sow-terms-foot">By signing below, the tenant and the housing staff member confirm they have read, understood, and agree to these terms.</p>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // ── SIGNATURES ───────────────────────────────────────────────────
        '<div class="modal-tab-panel" data-modal-panel="sigs">' +
          '<div class="card card-flush-mb">' +
            '<div class="modal-hdr compact"><div class="lbl-yellow">Signatures &amp; Acknowledgement<span class="lbl-required">Required</span></div></div>' +
            '<div id="sow_sig_body" class="sow-sig-body">' +
              // Tenant signature
              '<div class="box-bg-card">' +
                '<div class="flex-row-mb">' +
                  '<div class="sow-sig-badge sow-sig-badge-tenant">T</div>' +
                  '<div><div class="fw-bold-sm">Tenant</div><div class="txt-xs-muted">I acknowledge the scope of work and grant access to the unit</div></div>' +
                '</div>' +
                '<div class="grid-c2-tight-mb">' +
                  '<div class="f"><label>Printed Name</label><input type="text" id="sow_sig_tenant_name" placeholder="Tenant full name"/></div>' +
                  '<div class="f"><label>Date</label><input type="date" id="sow_sig_tenant_date"/></div>' +
                '</div>' +
                '<div class="sig-canvas-wrap">' +
                  '<div class="tab-bar">' +
                    '<button type="button" onclick="setSigMethod(\'sow_sig_canvas_tenant\',\'canvas\')" id="sow_sig_canvas_tenant_tab_canvas" class="ct-sig-tab active">✏️ Draw</button>' +
                    '<button type="button" onclick="setSigMethod(\'sow_sig_canvas_tenant\',\'type\')"   id="sow_sig_canvas_tenant_tab_type"   class="ct-sig-tab">⌨️ Type</button>' +
                    '<button type="button" onclick="setSigMethod(\'sow_sig_canvas_tenant\',\'wet\')"    id="sow_sig_canvas_tenant_tab_wet"    class="ct-sig-tab">🖊 Wet / E-Sign</button>' +
                  '</div>' +
                  '<div id="sow_sig_canvas_tenant_panel_canvas" class="bg-paper">' +
                    '<canvas id="sow_sig_canvas_tenant" width="620" height="90" class="sig-canvas"></canvas>' +
                    '<div class="sig-footer-row"><span class="txt-xs-muted">Sign with finger or mouse</span><button type="button" onclick="clearSig(\'sow_sig_canvas_tenant\')" class="sig-clear-btn">Clear</button></div>' +
                  '</div>' +
                  '<div id="sow_sig_canvas_tenant_panel_type" class="sec-hidden"><input type="text" id="sow_sig_canvas_tenant_typed" placeholder="Type full legal name" class="sig-typed-input"/><div class="txt-fineprint">Typing your name constitutes a legal electronic signature</div></div>' +
                  '<div id="sow_sig_canvas_tenant_panel_wet" class="sec-hidden"><div class="txt-help">Print this form for a wet signature, or send via DocuSign / Adobe Sign and attach the signed copy.</div><input type="text" id="sow_sig_canvas_tenant_wet_ref" placeholder="Reference # or e-sign envelope ID (optional)" class="sig-wet-input"/></div>' +
                '</div>' +
              '</div>' +
              // Staff signature
              '<div class="box-bg-card">' +
                '<div class="flex-row-mb">' +
                  '<div class="sow-sig-badge sow-sig-badge-staff">S</div>' +
                  '<div><div class="fw-bold-sm">Housing Staff</div><div class="txt-xs-muted">Employee completing this scope of work</div></div>' +
                '</div>' +
                '<div class="grid-c2-tight-mb">' +
                  '<div class="f"><label>Printed Name</label><input type="text" id="sow_sig_staff_name" placeholder="Staff full name"/></div>' +
                  '<div class="f"><label>Date</label><input type="date" id="sow_sig_staff_date"/></div>' +
                '</div>' +
                '<div class="sig-canvas-wrap">' +
                  '<div class="tab-bar">' +
                    '<button type="button" onclick="setSigMethod(\'sow_sig_canvas_staff\',\'canvas\')" id="sow_sig_canvas_staff_tab_canvas" class="ct-sig-tab active">✏️ Draw</button>' +
                    '<button type="button" onclick="setSigMethod(\'sow_sig_canvas_staff\',\'type\')"   id="sow_sig_canvas_staff_tab_type"   class="ct-sig-tab">⌨️ Type</button>' +
                    '<button type="button" onclick="setSigMethod(\'sow_sig_canvas_staff\',\'wet\')"    id="sow_sig_canvas_staff_tab_wet"    class="ct-sig-tab">🖊 Wet / E-Sign</button>' +
                  '</div>' +
                  '<div id="sow_sig_canvas_staff_panel_canvas" class="bg-paper">' +
                    '<canvas id="sow_sig_canvas_staff" width="620" height="90" class="sig-canvas"></canvas>' +
                    '<div class="sig-footer-row"><span class="txt-xs-muted">Sign with finger or mouse</span><button type="button" onclick="clearSig(\'sow_sig_canvas_staff\')" class="sig-clear-btn">Clear</button></div>' +
                  '</div>' +
                  '<div id="sow_sig_canvas_staff_panel_type" class="sec-hidden"><input type="text" id="sow_sig_canvas_staff_typed" placeholder="Type full legal name" class="sig-typed-input"/><div class="txt-fineprint">Typing your name constitutes a legal electronic signature</div></div>' +
                  '<div id="sow_sig_canvas_staff_panel_wet" class="sec-hidden"><div class="txt-help">Print this form for a wet signature, or send via DocuSign / Adobe Sign and attach the signed copy.</div><input type="text" id="sow_sig_canvas_staff_wet_ref" placeholder="Reference # or e-sign envelope ID (optional)" class="sig-wet-input"/></div>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // Approvals tab removed — HM / ED approval flow is handled outside
        // the SOW form (Renovation Approvals view, internal-only). The
        // hidden inputs below preserve the IDs that saveSOW reads so the
        // existing status-computation logic doesn't break. Empty values
        // mean the auto-promote-to-hm_approved/ed_approved branches never
        // fire from the modal — the SOW status caps at "signed" until an
        // external approval action lifts it.
        '<div class="sow-hidden-approvals" hidden>' +
          '<input id="sow_hm_name" type="hidden"/>' +
          '<input id="sow_hm_date" type="hidden"/>' +
          '<input id="sow_ed_name" type="hidden"/>' +
          '<input id="sow_ed_date" type="hidden"/>' +
          '<span id="sow_budget_badge"></span>' +
        '</div>' +

      '</div>' + /* /modal-body-stack */

      // ── Footer ───────────────────────────────────────────────────────────
      '<div class="flex-sb sow-modal-footer">' +
        '<div id="sow_saved_indicator" class="txt-muted-sm"></div>' +
        '<div class="flex-row-10 sow-footer-right">' +
          // Review progress label — populated by _updateSowSaveButtonState.
          // Reads "3 of 8 sections reviewed" until all tabs have been
          // visited at least once; then flips to "All sections reviewed".
          '<div id="sow_review_progress" class="txt-muted-sm sow-review-progress"></div>' +
          '<button type="button" onclick="closeSowModal()" class="btn btn-ghost">Cancel</button>' +
          // Initial label is "Save Draft" because a fresh modal starts with
          // only the Overview tab visited. _updateSowSaveButtonState flips
          // it to "Submit Scope of Work" once all 8 tabs have been opened.
          '<button id="sow_save_btn" type="button" onclick="sowSaveClicked()" class="btn btn-primary" data-mode="draft">💾 Save Draft</button>' +
        '</div>' +
      '</div>' +

    '</div>'; /* /modal-body-sow-shell */
}

// Mount the SOW template into a host on first call. Re-using #sowModal as
// the overlay element so existing JS (display:flex toggles, status-driven
// lock styling) doesn't need to change. _sowModalMounted is a one-shot
// guard so we don't redo the innerHTML work on every open.
function _ensureSowModal() {
  if (window._sowModalMounted) return;
  // Resolve a host element. Each page should declare ONE of:
  //   <div id="sowModalHost"></div>            (preferred, post-consolidation)
  //   <div id="sowModal" class="modal-overlay">…stale markup…</div> (legacy)
  // If a host is present we mount cleanly. If only a legacy #sowModal
  // exists we replace its innerHTML so the old markup is shed.
  var host = document.getElementById('sowModalHost');
  var modal;
  if (host) {
    host.outerHTML = '<div id="sowModal" class="modal-overlay modal-z-900"></div>';
    modal = document.getElementById('sowModal');
  } else {
    modal = document.getElementById('sowModal');
    if (!modal) {
      // No host at all — page hasn't been wired up. Bail loudly so we
      // notice during dev rather than silently no-op.
      console.warn('[SOW] Neither #sowModalHost nor #sowModal exists on this page. SOW modal will not render.');
      return;
    }
  }
  modal.innerHTML = _buildSowModalHTML();
  window._sowModalMounted = true;
}

// Total tabs in the SOW modal — keep in sync with _buildSowModalHTML and
// _SOW_TAB_NAMES below. Drives the "Save Draft → Submit" gate: until the
// user has visited every tab the Save button writes draft status only.
var _SOW_TAB_NAMES  = ['overview','scope','documents','safety','acct','notes','sigs'];
var _SOW_TAB_TOTAL  = _SOW_TAB_NAMES.length;

// Tab switcher for the SOW modal. Mirrors the TIC pattern (data-modal-tab on
// the buttons, data-modal-panel on the panels). Also tracks visited tabs in
// window._sowVisitedTabs (a Set) so the Save button can flip between draft
// and submit modes. Updates BOTH the desktop tab strip and the mobile
// drawer in lockstep so the visible UI is the same regardless of viewport.
function setSowTab(name) {
  if (!window._sowVisitedTabs) window._sowVisitedTabs = new Set();
  window._sowVisitedTabs.add(name);
  // Desktop strip
  var bar = document.getElementById('sow_tab_bar');
  if (bar) {
    bar.querySelectorAll(".modal-tab").forEach(function(b){
      var n = b.getAttribute('data-modal-tab');
      b.classList.toggle('active', n === name);
      b.classList.toggle('visited', window._sowVisitedTabs.has(n));
    });
  }
  // Mobile drawer (always-open vertical list, mirrors the desktop strip)
  var drawer = document.getElementById('sow_tab_drawer');
  if (drawer) {
    drawer.querySelectorAll(".modal-drawer-item").forEach(function(b){
      var n = b.getAttribute('data-modal-tab');
      b.classList.toggle('active', n === name);
      b.classList.toggle('visited', window._sowVisitedTabs.has(n));
    });
  }
  // Panels
  document.querySelectorAll(".modal-tab-panel").forEach(function(p){
    p.classList.toggle('active', p.getAttribute('data-modal-panel') === name);
  });
  _updateSowSaveButtonState();
}

// Flips the Save button between "Save Draft" (not all tabs reviewed yet)
// and "Submit Scope of Work" (every tab has been clicked at least once).
// saveSOW reads btn.dataset.mode to decide whether to force draft status.
function _updateSowSaveButtonState() {
  var btn = document.getElementById('sow_save_btn');
  var prog = document.getElementById('sow_review_progress');
  if (!btn) return;
  var visited = (window._sowVisitedTabs && window._sowVisitedTabs.size) || 0;
  var allReviewed = visited >= _SOW_TAB_TOTAL;
  btn.dataset.mode  = allReviewed ? 'submit' : 'draft';
  btn.textContent   = allReviewed ? '📤 Submit Request' : '💾 Save Draft';
  if (prog) prog.textContent = allReviewed ? 'All sections reviewed' : (visited + ' of ' + _SOW_TAB_TOTAL + ' sections reviewed');
}

// ── Fund Source dropdown helpers ─────────────────────────────────────────
// Populates #sow_fund_source with pools eligible for the unit's funder type
// (from RENO_FUND_RULES). FNCFS is appended for all units with a note about
// the configurable dependent-age threshold (set in Settings → Reno Budget).
function _sowPopulateFundSourceDropdown(unitId, savedFundSource) {
  var sel = document.getElementById('sow_fund_source');
  if (!sel) return;

  var allUnits = (typeof housingUnits !== 'undefined' && housingUnits.length)
    ? housingUnits : (window.HOUSING_UNITS_DATA || []);
  var u      = unitId ? allUnits.find(function(x){ return x && x.id === unitId; }) : null;
  var funder = u ? (u.funder || '') : '';

  var rules   = (typeof RENO_FUND_RULES !== 'undefined') ? RENO_FUND_RULES : {};
  var rule    = rules[funder] || rules['band_house'] || rules[''] || { pools:[], rule:'' };
  var pools   = (typeof BUDGET_POOLS !== 'undefined') ? BUDGET_POOLS : [];

  var budgetData = (typeof loadBudgetData === 'function' && loadBudgetData()) || {};
  var fncfsAge   = (budgetData.fncfsDependantAge != null) ? budgetData.fncfsDependantAge : 17;

  var html = '<option value="">— Select fund source —</option>';
  rule.pools.forEach(function(pid) {
    var pool = pools.find(function(p){ return p.id === pid; });
    if (!pool || pool.requiresDependants) return; // FNCFS handled below
    html += '<option value="' + pid + '"' + (savedFundSource === pid ? ' selected' : '') + '>'
          + pool.icon + ' ' + pool.label + '</option>';
  });

  // Always offer FNCFS with an eligibility note
  var fncfs = pools.find(function(p){ return p.id === 'fncfs'; });
  if (fncfs) {
    html += '<option value="fncfs"' + (savedFundSource === 'fncfs' ? ' selected' : '') + '>'
          + fncfs.icon + ' ' + fncfs.label + ' (dependants under ' + fncfsAge + ')</option>';
  }

  sel.innerHTML = html;

  // Eligibility rule note
  var ruleEl = document.getElementById('sow_fund_rule');
  if (ruleEl) ruleEl.textContent = rule.rule || '';

  // Restore badge for already-saved fund source
  if (savedFundSource) _sowUpdateFundBadge(savedFundSource);
}

function _sowUpdateFundBadge(poolId) {
  var badge = document.getElementById('sow_fund_badge');
  if (!badge) return;
  if (!poolId) { badge.style.display = 'none'; return; }
  var pools = (typeof BUDGET_POOLS !== 'undefined') ? BUDGET_POOLS : [];
  var pool  = pools.find(function(p){ return p.id === poolId; });
  if (!pool) { badge.style.display = 'none'; return; }
  badge.textContent    = pool.icon + ' ' + pool.label;
  badge.style.display  = 'inline-block';
  badge.style.background = pool.bg || 'var(--bg)';
  badge.style.color      = pool.color || 'var(--text)';
  badge.style.border     = '1px solid ' + (pool.color || 'var(--border)');
}

function openSowModal(unitId, projectNumber) {
  // Mount the consolidated template on first call. Stays idempotent on
  // subsequent opens so element IDs survive between sessions.
  _ensureSowModal();
  // Reset visited-tab tracking. Re-opens of an EXISTING saved SOW pre-fill
  // all tabs as reviewed (the user is editing, not first-walking the form),
  // so the Save button immediately offers Submit mode. Brand-new SOWs
  // start with no tabs visited; setSowTab('overview') below adds the
  // first one. The "review every tab" gate only applies to new authoring.
  window._sowVisitedTabs = new Set();
  var willBeEdit = !!(projectNumber || (unitId && typeof getUnitSowList === 'function' && getUnitSowList(unitId).length));
  if (willBeEdit) {
    _SOW_TAB_NAMES.forEach(function(t){ window._sowVisitedTabs.add(t); });
  }
  // Always reset the tab to Overview on open — otherwise re-opening shows
  // whatever tab the user was last on, which is rarely what they want.
  if (typeof setSowTab === 'function') setSowTab('overview');
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
    if(u) label = u.num+' '+u.street+' · '+_roomBedLabel(u);
  }
  var lbl = document.getElementById('sow_unit_label');
  if(lbl) lbl.textContent = label || 'No unit selected';
  var today = new Date().toISOString().slice(0,10);
  var dateEl = document.getElementById('sow_date'); if(dateEl) dateEl.value = today;
  if(saved) {
    populateSow(saved);
  } else {
    resetSow();
  }
  if(label) { var addr=document.getElementById('sow_address'); if(addr) addr.value=label; }
  // Populate fund source dropdown for this unit's funder type
  var savedFs = saved ? (saved.fundSource || '') : '';
  _sowPopulateFundSourceDropdown(unitId, savedFs);

  // Auto-populate tenant name from the unit's assigned tenant whenever the
  // field is empty — covers both brand-new SOWs and existing SOWs that were
  // saved before this auto-fill existed (tenantName missing from the payload).
  // Never overwrites a value the user already entered.
  if(unitId) {
    var tnEl = document.getElementById('sow_tenant_name');
    if(tnEl && !tnEl.value) {
      var allUnits2 = (typeof housingUnits !== 'undefined' && housingUnits.length) ? housingUnits : (window.HOUSING_UNITS_DATA||[]);
      var u2 = allUnits2.find(function(x){ return x.id===unitId; });
      if(u2 && u2.assignedName) tnEl.value = u2.assignedName;
    }
  }
  // Auto-populate "Prepared By (Staff)" from the logged-in user. Done for both
  // new and existing SOWs, but only when the field is empty — never overwrite
  // a saved value (the original preparer should be preserved on re-open).
  var pbEl = document.getElementById('sow_prepared_by');
  if(pbEl && !pbEl.value){
    var sess = (typeof HOUSING_SESSION !== 'undefined' && HOUSING_SESSION) ? HOUSING_SESSION : null;
    var who = (sess && (sess.name || sess.email)) || (window.currentUserName || '');
    if(who) pbEl.value = who;
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

  // Field Employees are in-house labour — no contractor step on work orders.
  var _ctRow = document.querySelector('.sow-ct-row');
  if(_ctRow) _ctRow.style.display = (window.currentRole === 'field_employee') ? 'none' : '';

  // Inline Approve button — shown when the current user has approval authority
  // and the SOW is in a state that requires their specific action.
  var apBtn = document.getElementById('sow_approve_btn');
  if (apBtn) {
    var _aRole   = window._realRole || window.currentRole || '';
    var _canHm   = (typeof APPROVAL_AUTHORITY !== 'undefined') && APPROVAL_AUTHORITY.can('approveSowUnderThreshold', _aRole);
    var _canEd   = (typeof APPROVAL_AUTHORITY !== 'undefined') && APPROVAL_AUTHORITY.can('approveSowOverThreshold', _aRole);
    var _sowSt   = sow ? (sow.approval_status || '') : '';
    var _hasPn   = !!(sow && sow.project_number);
    var _hasItems= !!(sow && sow.items && sow.items.length);
    // HM sees button when SOW is unreviewed (not yet hm_approved or higher)
    var _showHm  = _canHm && !_canEd && _hasPn && _hasItems && !completed &&
                   (_sowSt === '' || _sowSt === 'draft' || _sowSt === 'signed' || _sowSt === 'submitted');
    // ED sees button when SOW is at hm_approved (needs ED final) or unreviewed (ED can act direct)
    var _showEd  = _canEd && _hasPn && _hasItems && !completed &&
                   (_sowSt === 'hm_approved' || _sowSt === '' || _sowSt === 'draft' || _sowSt === 'signed');
    var _showAp  = _showHm || _showEd;
    apBtn.style.display = _showAp ? 'flex' : 'none';
    apBtn.textContent   = (_sowSt === 'hm_approved') ? '✓ Final Approve' : '✓ Approve';
  }

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

  // Archive button: visible whenever the SOW has been initiated (has a
  // project_number) and isn't already archived — regardless of viewer role.
  // Hidden on new SOWs (no project number yet — nothing to archive) and on
  // already-archived SOWs (restore happens from the unit-detail-panel SOW
  // table where the archived row is visible).
  var arBtn = document.getElementById('sow_archive_btn');
  if(arBtn){
    var _arSaved = !!sow && !!sow.project_number;
    var _arShow  = _arSaved && !sow.archived;
    arBtn.style.display = _arShow ? 'flex' : 'none';
  }

  // RFQ button: show when SOW amount meets the threshold (or HM/ED override).
  var rfqBtn = document.getElementById('sow_rfq_btn');
  if (rfqBtn) {
    var _rfqRole = window.currentRole || '';
    var _rfqShow = !!sow && !sow.archived
      && (typeof moduleOn !== 'function' || moduleOn('rfq'))
      && (
        (typeof _sowMeetsRfqThreshold === 'function' && _sowMeetsRfqThreshold(sow)) ||
        (_rfqRole === 'housing_manager' || _rfqRole === 'ed')
      );
    rfqBtn.style.display = _rfqShow ? 'flex' : 'none';

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

// Inline approval from the SOW modal header — used when HM or ED opens a SOW
// directly (e.g. from the landing-page worklist) and wants to approve without
// navigating to the Renos Approvals page.
function sowApproveInline() {
  var role   = window._realRole || window.currentRole || '';
  var canHm  = (typeof APPROVAL_AUTHORITY !== 'undefined') && APPROVAL_AUTHORITY.can('approveSowUnderThreshold', role);
  var canEd  = (typeof APPROVAL_AUTHORITY !== 'undefined') && APPROVAL_AUTHORITY.can('approveSowOverThreshold', role);
  if (!canHm && !canEd) { if (typeof showToast === 'function') showToast('You do not have approval authority for this request.'); return; }

  var approver = canEd ? 'ed' : 'hm';
  var today    = new Date().toISOString().split('T')[0];
  var staffName = (typeof HOUSING_SESSION !== 'undefined' && HOUSING_SESSION.name) || role;

  var title   = approver === 'ed' ? 'Grant ED Final Approval?' : 'Approve as Housing Manager?';
  var message = approver === 'ed'
    ? 'This will record your ED approval on this Maintenance Request.'
    : 'This will record your HM approval and forward the request to the Executive Director for final approval.';

  if (typeof showConfirm !== 'function') return;
  showConfirm({ title: title, message: message, confirmText: 'Approve', danger: false }).then(function(ok) {
    if (!ok) return;
    // Set the appropriate approval fields (picked up by saveSOW → approval_status logic)
    var nmId  = approver === 'ed' ? 'sow_ed_name' : 'sow_hm_name';
    var dtId  = approver === 'ed' ? 'sow_ed_date' : 'sow_hm_date';
    var nmEl  = document.getElementById(nmId);
    var dtEl  = document.getElementById(dtId);
    if (nmEl) nmEl.value = staffName;
    if (dtEl) dtEl.value = today;
    // Trigger save — the save flow detects the approval fields and sets approval_status
    if (typeof sowSaveClicked === 'function') sowSaveClicked();
  });
}

function markSowComplete(){
  if(!_sowUnitId || !window._sowEditingProjectNumber){
    showToast('Save the request before marking complete.');
    return;
  }
  if(!canMarkSowComplete()){
    showToast('Only Housing Manager or Executive Director can mark a request complete.');
    return;
  }
  var pn = window._sowEditingProjectNumber;
  showConfirm({
    title:       'Mark Request ' + pn + ' as Completed?',
    message:     'This locks the Maintenance Request, work order, and progress reports from further edits. Only the Executive Director can reopen it.',
    confirmText: 'Mark Complete'
  }).then(function(ok){
    if (!ok) return;
    var sow = getSowByProjectNumber(_sowUnitId, pn);
    if(!sow){ showToast('Request not found'); return; }
    sow.approval_status = 'completed';
    sow.completed_at = new Date().toISOString();
    sow.completed_by = window.currentUserName || _realRoleForPermissions();
    upsertSowInList(_sowUnitId, sow);
    auditEntry('SOW:'+_sowUnitId, 'sow_completed', 'SOW '+pn+' marked Completed', _realRoleForPermissions());
    // If this completion drained the last active SOW on the unit, revert the
    // unit's status back to whatever it was before the renovation kicked in.
    try {
      var _allUnits = (typeof housingUnits !== 'undefined' && housingUnits.length) ? housingUnits : [];
      var _u = _allUnits.find(function(x){ return x.id === _sowUnitId; });
      if(_u && typeof hasActiveSows === 'function' && !hasActiveSows(_sowUnitId)
         && typeof revertUnitFromRepair === 'function' && revertUnitFromRepair(_u)){
        saveUnitWithDraftFallback(_u);
        auditEntry('UNIT:'+_sowUnitId, 'unit_status_auto', (_u.num+' '+_u.street).trim()+' → '+(_u.status||'updated')+' (SOW '+pn+' completed, no active SOWs remain)', _realRoleForPermissions());
      }
    } catch(e){ console.warn('[SOW] complete-revert threw:', e); }
    showToast('✓ Request marked Completed');
    _applySowModalLock(sow);
  });
}

function reopenSow(){
  if(!_sowUnitId || !window._sowEditingProjectNumber) return;
  if(!canReopenSow()){
    showToast('Only the Executive Director can reopen a completed request.');
    return;
  }
  var pn = window._sowEditingProjectNumber;
  showConfirm({
    title:       'Reopen Request ' + pn + ' for editing?',
    message:     'This returns the request to its prior approval state so it can be modified.',
    confirmText: 'Reopen'
  }).then(function(ok){
    if (!ok) return;
    var sow = getSowByProjectNumber(_sowUnitId, pn);
    if(!sow){ showToast('Request not found'); return; }
    if(sow.edName && sow.edDate) sow.approval_status = 'ed_approved';
    else if(sow.hmName && sow.hmDate) sow.approval_status = 'hm_approved';
    else if((sow.tenantSig && sow.tenantSig.image) || (sow.staffSig && sow.staffSig.image)) sow.approval_status = 'signed';
    else sow.approval_status = 'draft';
    sow.reopened_at = new Date().toISOString();
    sow.reopened_by = window.currentUserName || _realRoleForPermissions();
    upsertSowInList(_sowUnitId, sow);
    auditEntry('SOW:'+_sowUnitId, 'sow_reopened', 'SOW '+pn+' reopened for editing', _realRoleForPermissions());
    showToast('Request reopened');
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
    wrap.innerHTML = '<div style="padding:18px;text-align:center;color:var(--muted);font-size:12px;font-style:italic;background:var(--bg);">No maintenance requests yet. Click <strong style="color:var(--text);">New Request</strong> to create one.</div>';
    return;
  }
  // Filter archived SOWs out by default (toggle re-includes them).
  var _archivedTotal = list.filter(function(s){ return !!s.archived; }).length;
  var _visibleList = window._udpShowArchived ? list.slice() : list.filter(function(s){ return !s.archived; });
  // Sort newest first by created_at.
  list = _visibleList.sort(function(a, b){
    return (b.created_at || '').localeCompare(a.created_at || '');
  });

  var statusStyles = {
    draft:        {bg:'#f4f4f0', c:'#666',    label:'Draft'},
    signed:       {bg:'#eff6ff', c:'#1d4ed8', label:'Signed'},
    hm_approved:  {bg:'var(--warn-amber-bg)', c:'var(--warn-amber-text)', label:'HM Approved'},
    ed_approved:  {bg:'#f0fdf4', c:'#15803d', label:'ED Approved'},
    completed:    {bg:'#f0fdf4', c:'#15803d', label:'Completed'},
    archived:     {bg:'#f4f4f0', c:'var(--gray)',    label:'Archived'}
  };
  // Archive UI gating: HM/ED only. Read-only viewers don't see the button.
  var _udpRole = window.currentRole || 'staff';
  var _canArchive = (typeof ROLE !== 'undefined' && ROLE.isManagement && ROLE.isManagement(_udpRole));
  // "Show archived" toggle state lives on window so it survives re-renders
  // within the same panel session. Default: hide archived.
  if(window._udpShowArchived == null) window._udpShowArchived = false;

  // Local alias to the canonical formatCurrency so existing call sites
  // in this function keep working without renaming.
  var fmtCurrency = formatCurrency;
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
    var isArchived = !!sow.archived;
    // Archived SOWs always render the "Archived" pill (overrides the
    // approval-status pill) so the row's state is unmistakable when the
    // "Show archived" toggle is on.
    if(isArchived){ ss = statusStyles.archived; }
    var editBtn = locked
      ? '<button onclick="udpEditSow(\''+esc(unitId)+'\',\''+pn+'\')" title="View request (read-only)" style="background:none;border:1px solid var(--border);color:var(--muted);padding:4px 9px;border-radius:5px;cursor:pointer;font-size:10px;font-weight:600;font-family:DM Sans,sans-serif;margin-right:4px;">View</button>'
      : '<button onclick="udpEditSow(\''+esc(unitId)+'\',\''+pn+'\')" title="Edit request" style="background:none;border:1px solid var(--border);color:var(--text);padding:4px 9px;border-radius:5px;cursor:pointer;font-size:10px;font-weight:600;font-family:DM Sans,sans-serif;margin-right:4px;">Edit</button>';
    // Archive / Unarchive — HM/ED only. Archive on active SOWs, Unarchive
    // (restore) on archived ones. Both feed udpArchiveSow / udpUnarchiveSow
    // which confirm + persist + may revert the unit's status.
    var archiveBtn = '';
    if(_canArchive){
      archiveBtn = isArchived
        ? '<button onclick="udpUnarchiveSow(\''+esc(unitId)+'\',\''+pn+'\')" title="Restore archived request" style="background:none;border:1px solid var(--border);color:var(--muted);padding:4px 9px;border-radius:5px;cursor:pointer;font-size:10px;font-weight:600;font-family:DM Sans,sans-serif;margin-right:4px;">Restore</button>'
        : '<button onclick="udpArchiveSow(\''+esc(unitId)+'\',\''+pn+'\')" title="Archive this request" style="background:none;border:1px solid var(--border);color:var(--muted);padding:4px 9px;border-radius:5px;cursor:pointer;font-size:10px;font-weight:600;font-family:DM Sans,sans-serif;margin-right:4px;">🗄 Archive</button>';
    }
    return '<tr style="border-top:1px solid var(--border);'+(isArchived?'opacity:.6;':'')+'">'
      +'<td style="padding:8px 10px;font-size:11px;color:var(--muted);white-space:nowrap;">'+date+'</td>'
      +'<td style="padding:8px 10px;"><span style="font-size:10px;font-weight:700;padding:3px 8px;border-radius:10px;background:'+ss.bg+';color:'+ss.c+';white-space:nowrap;">'+ss.label+(locked?' 🔒':'')+'</span></td>'
      +'<td style="padding:8px 10px;font-size:12px;font-weight:700;white-space:nowrap;">'+amount+'</td>'
      +'<td style="padding:8px 10px;font-size:11px;"><button onclick="udpOpenSowDocument(\''+esc(unitId)+'\',\''+pn+'\')" style="background:none;border:none;color:var(--text);padding:0;font-family:ui-monospace,Menlo,Monaco,\'Courier New\',monospace;font-size:11px;font-weight:600;cursor:pointer;text-decoration:underline;text-decoration-color:var(--border);text-underline-offset:2px;" title="Open full SOW document">'+pn+'</button></td>'
      +'<td style="padding:8px 10px;font-size:10px;">'+progressCell+'</td>'
      +'<td style="padding:6px 8px;white-space:nowrap;text-align:right;">'
        +editBtn
        +archiveBtn
        +'<button onclick="udpPrintWorkOrder(\''+esc(unitId)+'\',\''+pn+'\')" title="Print work order" style="background:var(--yellow);border:none;color:var(--dark);padding:4px 9px;border-radius:5px;cursor:pointer;font-size:10px;font-weight:700;font-family:DM Sans,sans-serif;">Work Order</button>'
        +((typeof moduleOn !== 'function' || moduleOn('rfq')) && typeof _sowMeetsRfqThreshold === 'function' && _sowMeetsRfqThreshold(sow)
          ? '<a href="rfq.html?unit='+esc(unitId)+'&sow='+esc(pn)+'" style="margin-left:4px;background:#1d4ed8;border:none;color:#fff;padding:4px 9px;border-radius:5px;cursor:pointer;font-size:10px;font-weight:700;font-family:DM Sans,sans-serif;text-decoration:none;display:inline-block;">RFQ</a>'
          : '')
      +'</td>'
      +'</tr>';
  }).join('');

  // "Show archived" toggle — only rendered if at least one archived SOW
  // exists, to avoid clutter when there's nothing to reveal.
  var archivedToggle = '';
  if(_archivedTotal > 0){
    archivedToggle = '<div style="display:flex;justify-content:flex-end;align-items:center;gap:6px;font-size:11px;color:var(--muted);margin-bottom:6px;">'
      +'<label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">'
      +'<input type="checkbox" '+(window._udpShowArchived?'checked':'')+' onchange="window._udpShowArchived=this.checked;udpRenderSowTable(\''+esc(unitId)+'\')" style="margin:0;cursor:pointer;accent-color:var(--yellow);"/>'
      +'Show archived ('+_archivedTotal+')'
      +'</label></div>';
  }
  wrap.innerHTML = archivedToggle
    +'<div class="overflow-x"><table style="width:100%;border-collapse:collapse;font-family:DM Sans,sans-serif;">'
    +'<thead><tr style="background:var(--bg);"><th style="padding:7px 10px;font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);text-align:left;">Date</th>'
    +'<th style="padding:7px 10px;font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);text-align:left;">Status</th>'
    +'<th style="padding:7px 10px;font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);text-align:left;">Amount</th>'
    +'<th style="padding:7px 10px;font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);text-align:left;">Project #</th>'
    +'<th style="padding:7px 10px;font-size:9px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--muted);text-align:left;">Progress</th>'
    +'<th style="padding:7px 10px;"></th></tr></thead>'
    +'<tbody>'+rows+'</tbody></table></div>';
}

// ── udpArchiveSow / udpUnarchiveSow ─────────────────────────────────────
// Confirm + persist + re-render. archiveSow flips the per-SOW flag and
// (if no other active SOWs remain) reverts the unit's status. Restoring
// an archived SOW does NOT auto-flip the unit back to under_repair —
// that requires a fresh approval (matches the lifecycle direction).
window.udpArchiveSow = function(unitId, projectNumber){
  if(!unitId || !projectNumber) return;
  showConfirm({
    title:       'Archive this Request?',
    message:     'Project ' + projectNumber + ' will be hidden from the active list. This is reversible — use the "Show archived" toggle to find it again.',
    confirmText: 'Archive'
  }).then(function(ok){
    if(!ok) return;
    var role = window.currentRole || 'staff';
    if(typeof archiveSow !== 'function'){ showToast('Archive helper missing.'); return; }
    var sow = archiveSow(unitId, projectNumber, role);
    if(!sow){ showToast('Request not found'); return; }
    auditEntry('SOW:'+unitId, 'sow_archived', 'SOW '+projectNumber+' archived', role);
    // If archiving emptied the active-SOW set on this unit, revert the
    // unit's status back to its prior state.
    try {
      var allUnits = (typeof housingUnits !== 'undefined' && housingUnits.length) ? housingUnits : [];
      var u = allUnits.find(function(x){ return x.id === unitId; });
      if(u && typeof hasActiveSows === 'function' && !hasActiveSows(unitId)
         && typeof revertUnitFromRepair === 'function' && revertUnitFromRepair(u)){
        saveUnitWithDraftFallback(u);
        auditEntry('UNIT:'+unitId, 'unit_status_auto', (u.num+' '+u.street).trim()+' → '+(u.status||'updated')+' (last active SOW archived)', role);
      }
    } catch(e){ console.warn('[SOW archive] revert threw:', e); }
    udpRenderSowTable(unitId);
    showToast('✓ Request '+projectNumber+' archived');
  });
};
window.udpUnarchiveSow = function(unitId, projectNumber){
  if(!unitId || !projectNumber) return;
  if(typeof unarchiveSow !== 'function'){ showToast('Unarchive helper missing.'); return; }
  var sow = unarchiveSow(unitId, projectNumber);
  if(!sow){ showToast('Request not found'); return; }
  auditEntry('SOW:'+unitId, 'sow_unarchived', 'SOW '+projectNumber+' restored', window.currentRole || 'staff');
  udpRenderSowTable(unitId);
  showToast('✓ Request '+projectNumber+' restored');
};

// archiveCurrentSow — invoked by the 🗄 Archive button in the SOW modal
// header. Archives the SOW currently open in the modal (uses _sowUnitId +
// window._sowEditingProjectNumber), reverts the unit's status if no other
// active SOWs remain, closes the modal, and refreshes whichever upstream
// view rendered the row (Reno Approvals, Unit Detail Panel SOW table).
window.archiveCurrentSow = function(){
  var unitId = _sowUnitId;
  var projectNumber = window._sowEditingProjectNumber;
  if(!unitId || !projectNumber){ showToast('No request to archive.'); return; }
  // Permission: anyone with the SOW modal open can archive an initiated SOW.
  // The audit-log entry below records who archived it for accountability.
  var role = window.currentRole || 'staff';
  showConfirm({
    title:       'Archive this Request?',
    message:     'Project ' + projectNumber + ' will be hidden from the active list. This is reversible — use the "Show archived" toggle on the Unit Detail Panel to restore it.',
    confirmText: 'Archive'
  }).then(function(ok){
    if(!ok) return;
    if(typeof archiveSow !== 'function'){ showToast('Archive helper missing.'); return; }
    var sow = archiveSow(unitId, projectNumber, role);
    if(!sow){ showToast('Request not found'); return; }
    auditEntry('SOW:'+unitId, 'sow_archived', 'SOW '+projectNumber+' archived from SOW modal', role);
    // If this was the last active SOW, revert the unit's status.
    try {
      var allUnits = (typeof housingUnits !== 'undefined' && housingUnits.length) ? housingUnits : [];
      var u = allUnits.find(function(x){ return x.id === unitId; });
      if(u && typeof hasActiveSows === 'function' && !hasActiveSows(unitId)
         && typeof revertUnitFromRepair === 'function' && revertUnitFromRepair(u)){
        saveUnitWithDraftFallback(u);
        auditEntry('UNIT:'+unitId, 'unit_status_auto', (u.num+' '+u.street).trim()+' → '+(u.status||'updated')+' (last active SOW archived)', role);
      }
    } catch(e){ console.warn('[SOW archive modal] revert threw:', e); }
    closeSowModal();
    showToast('✓ Request '+projectNumber+' archived');
    // Refresh whichever upstream view is in the DOM.
    if(typeof renderRenoApprovalsView === 'function' && document.getElementById('ra_tbody')) renderRenoApprovalsView();
    if(typeof udpRenderSowTable === 'function' && document.getElementById('udp_sow_table_wrap')) udpRenderSowTable(unitId);
    if(typeof renderWorklist === 'function' && document.getElementById('worklist_body')) renderWorklist();
  });
};

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
  if(!sow){ showToast('Request not found'); return; }
  closeUnitDetail();
  openSowModal(unitId, projectNumber);
  // Give the modal a tick to populate before printing.
  setTimeout(function(){ if(true) printSOW(); }, 250);
}

function udpPrintWorkOrder(unitId, projectNumber){
  // Prints a work order for the specific SOW. Loads the SOW into the modal briefly so
  // the existing printWorkOrder() (which reads from modal state) produces the right output.
  var sow = getSowByProjectNumber(unitId, projectNumber);
  if(!sow){ showToast('Request not found'); return; }
  closeUnitDetail();
  openSowModal(unitId, projectNumber);
  setTimeout(function(){ if(true) printWorkOrder(); }, 250);
}














// Submit-confirmation gate for the save button. In draft mode we just save
// — no prompt, no tenant copy. In submit mode we look up the tenant email
// and, if one is on file, show an inline "Email a copy to the tenant"
// checkbox on the confirm modal. Mirror of housing-app.js openSubmitModal /
// finalSubmit. Called only via the #sow_save_btn onclick; programmatic
// saveSOW() callers (printSOW, etc.) skip this entirely.
async function sowSaveClicked() {
  var btn = document.getElementById('sow_save_btn');
  var mode = (btn && btn.dataset) ? btn.dataset.mode : 'draft';
  if (mode !== 'submit') { saveSOW(); return; }

  var unitId = _sowUnitId;
  var allUnits = (typeof housingUnits !== 'undefined' && housingUnits.length) ? housingUnits : (window.HOUSING_UNITS_DATA || []);
  var unit = unitId ? allUnits.find(function(x){ return x.id === unitId; }) : null;

  // Tenant email lookup is best-effort. If the helper is missing (older
  // notifications.js) OR the lookup throws OR no email comes back, we
  // submit without the copy prompt — the SOW still saves normally.
  var tenantEmail = '';
  if (unit && typeof _resolveTenantEmailForUnit === 'function') {
    try { tenantEmail = await _resolveTenantEmailForUnit(unit); }
    catch (e) { tenantEmail = ''; }
  }

  if (!tenantEmail || typeof showConfirm !== 'function') { saveSOW(); return; }

  var tenantName = (unit && unit.assignedName) || 'the tenant';
  showConfirm({
    title:       'Submit Maintenance Request?',
    message:     'This will submit the request for review. You can still edit it later if you have approval authority.',
    confirmText: 'Confirm Submit',
    checkbox:    { label: 'Email a PDF copy of this request to ' + tenantName + ' (' + tenantEmail + ')', defaultChecked: true }
  }).then(function(result){
    var ok       = (typeof result === 'object' && result !== null) ? !!result.ok      : !!result;
    var sendCopy = (typeof result === 'object' && result !== null) ? !!result.checked : false;
    if (!ok) return;
    saveSOW({ sendTenantCopy: sendCopy });
  });
}

function saveSOW(opts){
  opts = opts || {};
  var sendTenantCopy = opts.sendTenantCopy === true;
  var get=function(id){ var el=document.getElementById(id); return el?el.value.trim():''; };
  var chk=function(id){ var el=document.getElementById(id); return el?el.checked:false; };
  var data = {
    unitId:_sowUnitId, address:get('sow_address'), date:get('sow_date'),
    tenantName:get('sow_tenant_name'),
    preparedBy:get('sow_prepared_by'), contractor:get('sow_contractor'), contractorId:(document.getElementById('sow_contractor_id')||{}).value||'',
    poNumber:get('sow_po_number'),
    condition:get('sow_condition'), fundSource:get('sow_fund_source'), totalCost:get('sow_total_cost'),
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

  // Review-all-tabs gate. The Save button switches between data-mode="draft"
  // (some tabs unvisited) and data-mode="submit" (all 8 tabs clicked). In
  // draft mode we override the auto-computed status back to 'draft' so the
  // SOW can't accidentally advance into the approval workflow before the
  // user has walked every section. Edits to an existing saved SOW open
  // with every tab pre-marked visited, so this gate is effectively skipped
  // for re-edits — only first-time authoring is forced through the walk.
  var _saveBtn = document.getElementById('sow_save_btn');
  var _saveMode = _saveBtn && _saveBtn.dataset ? _saveBtn.dataset.mode : null;
  if (_saveMode !== 'submit' && data.approval_status !== 'completed') {
    data.approval_status = 'draft';
  }

  if(_sowUnitId) upsertSowInList(_sowUnitId, data);

  // ── Unit status auto-flip ────────────────────────────────────────────────
  // When this save took the SOW into its first HM/ED-approved state, flip
  // the unit to 'under_repair' so it surfaces in the Renovations view. When
  // it took the SOW to 'completed' AND no other SOWs on the unit are still
  // active, revert the unit to its prior status. See maybeAutoFlipUnitForSow
  // in shared-sow.js for the transition rules.
  if(_sowUnitId){
    try {
      var _allUnits = (typeof housingUnits !== 'undefined' && housingUnits.length) ? housingUnits : [];
      var _u = _allUnits.find(function(x){ return x.id === _sowUnitId; });
      var _prev = existingForStatus ? existingForStatus.approval_status : null;
      if(_u && typeof maybeAutoFlipUnitForSow === 'function' && maybeAutoFlipUnitForSow(_u, data, _prev)){
        saveUnitWithDraftFallback(_u);
        var _newStatus = _u.status === 'under_repair' ? 'Under Repair' : (_u.status || 'updated');
        auditEntry('UNIT:'+_sowUnitId, 'unit_status_auto', (_u.num+' '+_u.street).trim()+' → '+_newStatus+' (SOW '+(data.project_number||'')+' '+(data.approval_status==='completed'?'completed':'approved')+')', _saveRole);
      }
    } catch(e){ console.warn('[SOW] auto-flip threw:', e); }
  }

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

  // Notify approvers on FIRST save only — subsequent edits don't re-fire
  // so the SOW reviewers don't get spammed during iteration. Fire-and-
  // forget; UI never blocks on delivery.
  if (isNew && typeof notifySowCreated === 'function') {
    notifySowCreated(data, _sowUnitId);
  }

  // Tenant copy email (PDF attached) — only fires when the preparer
  // opted in via the inline checkbox on the submit confirmation. Looked
  // up against the tenants table; silent skip if no email on file. Same
  // fire-and-forget pattern as notifyApplicationConfirmation in
  // housing-app.js finalSubmit.
  if (sendTenantCopy && typeof notifySowTenantCopy === 'function') {
    var _allUnitsT = (typeof housingUnits !== 'undefined' && housingUnits.length) ? housingUnits : (window.HOUSING_UNITS_DATA || []);
    var _unitT = _sowUnitId ? _allUnitsT.find(function(x){ return x.id === _sowUnitId; }) : null;
    notifySowTenantCopy(data, _unitT);
  }

  // Work Order email to contractor — fires when THIS save transitioned the
  // SOW into an approved state (hm_approved or ed_approved). Detached
  // async: looks up the contractor, shows a confirm dialog with an
  // opt-in checkbox, and only sends if the approver ticks it. Silent
  // skip when there's no assigned contractor / no email on file.
  var _prevApproved = existingForStatus && (
    existingForStatus.approval_status === 'hm_approved'
    || existingForStatus.approval_status === 'ed_approved'
    || existingForStatus.approval_status === 'completed'
  );
  var _nowApproved = data.approval_status === 'hm_approved' || data.approval_status === 'ed_approved';
  if (_nowApproved && !_prevApproved && data.contractorId
      && typeof notifyWorkOrderToContractor === 'function'
      && typeof _resolveContractorForEmail === 'function') {
    var _allUnitsW = (typeof housingUnits !== 'undefined' && housingUnits.length) ? housingUnits : (window.HOUSING_UNITS_DATA || []);
    var _unitW = _sowUnitId ? _allUnitsW.find(function(x){ return x.id === _sowUnitId; }) : null;
    var _sowSnapshot = data;
    (async function(){
      try {
        var ct = await _resolveContractorForEmail(_sowSnapshot.contractorId);
        if (!ct || !ct.email) return;
        if (typeof showConfirm !== 'function') return;
        var _esc = function(s){ return String(s||'').replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); };
        var result = await showConfirm({
          title:   'Send Work Order Email?',
          message: 'The Maintenance Request has been approved. Confirm the contractor details below before sending the Work Order PDF.',
          detail:  '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:8px;">Contractor</div>'
                 + '<div style="font-size:14px;font-weight:700;color:var(--text);">' + _esc(ct.name) + '</div>'
                 + '<div style="font-size:12px;color:var(--muted);margin-top:3px;">&#128231; ' + _esc(ct.email) + '</div>',
          confirmText: 'Send Email',
          cancelText:  'Skip',
          checkbox:    { label: 'Send work order email to this contractor', defaultChecked: true }
        });
        var ok     = (typeof result === 'object' && result !== null) ? !!result.ok      : !!result;
        var sendIt = (typeof result === 'object' && result !== null) ? !!result.checked : false;
        if (!ok || !sendIt) return;
        notifyWorkOrderToContractor(_sowSnapshot, _unitW, ct);
      } catch (e) {
        console.warn('[notify] work-order prompt threw:', e);
      }
    })();
  }

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

  // Close the SOW modal, then show a centered branded confirmation.
  // Dismissing the confirmation routes the user to the Renovation Approvals
  if(typeof closeSowModal === 'function') closeSowModal();

  var _msg = isNew ? '✓ Maintenance request submitted' : '✓ Request saved';
  if(typeof showToast === 'function') showToast(_msg);

  // Return to whichever page opened the SOW modal:
  //   • Landing page (housing.html) → refresh worklist in-place, stay here
  //   • Renos approvals page        → refresh the approvals table in-place
  //   • Any other page              → just the toast; no navigation
  if (document.getElementById('worklist_body') && typeof renderWorklist === 'function') {
    renderWorklist();
  } else if (typeof showRenoApprovals === 'function' && document.getElementById('renoApprovalsView')) {
    showRenoApprovals();
  }
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
    var cost = it.cost ? formatCurrency(parseFloat(it.cost)||0) : '—';
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
    +'<title>Maintenance Request — '+_natShort+' Housing</title>'
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
        +'<div class="doc-type">MAINTENANCE REQUEST</div>'
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
      +'<div class="section-title">Work Items</div>'
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

    /* Terms & Conditions — rendered from Settings → Terms & Conditions (ED-editable) */
    +(function(){
      var _tp = (typeof _termsParseHtml === 'function' && typeof getTermsBody === 'function')
              ? _termsParseHtml(getTermsBody('sow_reno_request'))
              : { introHtml: '', itemsHtml: [] };
      var introHtml = _tp.introHtml
        ? '<p style="margin:0 0 8px;">' + _tp.introHtml + '</p>'
        : '';
      var liHtml = _tp.itemsHtml.length
        ? _tp.itemsHtml.map(function(h){ return '<li>' + h + '</li>'; }).join('')
        : ('<li><strong>Prioritization of Requests.</strong> Renovation requests are assessed and prioritized based on urgency of need, health and safety risk to occupants, and overall unit condition.</li>'
          +'<li><strong>Funding Eligibility.</strong> Approval is subject to available funding and the qualifying criteria of the unit under its applicable program.</li>'
          +'<li><strong>Budget Authority.</strong> Requests within the HM\'s budget authority may be approved by the HM. Requests exceeding that threshold require Executive Director approval before work commences.</li>'
          +'<li><strong>Tenant Responsibilities.</strong> The tenant must provide timely access to the unit for inspection and work.</li>'
          +'<li><strong>No Guarantee of Approval or Timeline.</strong> Submission does not guarantee approval or a specific completion date.</li>'
          +'<li><strong>Accuracy of Information.</strong> All information must be accurate and complete.</li>');
      return '<div class="section">'
           + '<div class="section-title">Terms &amp; Conditions</div>'
           + '<div class="section-body" style="font-size:9.5px;color:var(--text);line-height:1.65;">'
           + '<p style="font-size:8.5px;font-weight:bold;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:10px;">' + _natDisp + ' &mdash; Housing Department</p>'
           + introHtml
           + '<ol style="margin:0;padding-left:16px;">' + liHtml + '</ol>'
           + '</div>'
           + '</div>';
    })()
    /* Acknowledgement & Signatures */
    +'<div class="section">'
      +'<div class="section-title">Signatures &amp; Acknowledgement</div>'
      +'<div class="section-body">'
        /* Declaration text */
        +'<div style="font-size:9.5px;color:var(--text);line-height:1.6;margin-bottom:14px;padding:10px 12px;background:var(--bg);border-left:3px solid var(--yellow);">'
          +'By signing below, the tenant acknowledges the scope of work described in this document and grants access to the unit for the purpose of completing the renovation. '
          +'The Housing Staff member confirms this Maintenance Request is accurate and complete.'
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

  showPrintPanel(html, 'Maintenance Request');
}
