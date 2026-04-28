/* ============================================================
 * housing-init.js — CLFN Housing Suite
 * Auth, session, data loading, page initialisation
 *
 * Load order: ... housing-app.js → THIS FILE (last before inline)
 *
 * Covers: showDashboard, login/logout, session restore,
 *   loadAppDataFromSupabase, loadHousingData, initHousingPage,
 *   staff management modal, email notifications, sign-in flow
 * ============================================================ */

'use strict';

// ── ROLE safety fallback — if shared-config.js fails to load ─────────────────
if (typeof ROLE === 'undefined') {
  window.ROLE = {
    ED:              'ed',
    HOUSING_MANAGER: 'housing_manager',
    HE_L2:           'housing_employee_l2',
    HE_L1:           'housing_employee_l1',
    isManagement: function(r) { return r === 'ed' || r === 'housing_manager'; }
  };
  console.warn('[CLFN] ROLE fallback — shared-config.js may not have loaded');
}

// ── Build marker ──────────────────────────────────────────────────────────────
console.log('%c[CLFN HOUSING] Build: F1-2026-04-21', 'background:#F8E41A;color:#111;font-weight:700;padding:4px 8px;');

// ── Supabase client ───────────────────────────────────────────────────────────
window._sb = null;
document.addEventListener('DOMContentLoaded', function() {
  try {
    if (window.supabase && window.supabase.createClient) {
      window._sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
      console.log('[CLFN] Supabase client ready');
    }
  } catch(e) { console.warn('[CLFN] Supabase init failed:', e.message); }
});



function showDashboard(){
  // If we're on a sub-page (inventory.html, etc.), the dashView DOM element
  // doesn't exist here — navigate back to housing.html instead of trying to
  // render into a non-existent element (which would leave the page blank).
  if (!document.getElementById('dashView')) {
    if (!window.location.pathname.includes('housing.html') &&
        !window.location.pathname.endsWith('/') &&
        window.location.pathname !== '/') {
      window.location.href = 'housing.html';
      return;
    }
  }
  // The actual applications dashboard — HM and ED only
  var role = window.currentRole || 'housing_employee_l1';
  if(role !== ROLE.HOUSING_MANAGER && role !== ROLE.ED) { showToast('Dashboard access requires Housing Manager or Executive Director role.'); return; }
  if(!window._navSkipPush) pushNav('dashboard');
  var _dv = document.getElementById('dashView');
  if(_dv){ _dv.style.display='flex'; _dv.style.width='100%'; }
  hideAllViews('dashView');
  if(_dv){ _dv.style.display='flex'; _dv.style.width='100%'; }
  setNavActive('tab_dash');
  window._userSetDashFilter = false;
  var fs = document.getElementById('dashFilterStatus');
  if(fs) fs.value = '';
  document.getElementById('dashView').style.display='flex';
  updateDashStats();renderDashTable();wireDashTable();
}

function saveTenantFiles(unitId, files){ /* legacy no-op — files saved via DocLibrary */ }


// ── Legacy compat wrappers ──────────────────────────────────────────
// Older code paths (and the Unit Detail Panel preview) may still call
// these. They now delegate to the DocLibrary-backed flow. If you're
// reading this in Phase D cleanup: these can go away once every caller
// uses DocLibrary directly.
async function deleteTenantFile(path){
  // Still present because Turn 3 Item 2's authorized scope was tenantFiles*
  // + udp* wrappers only. This one has no external callers in housing.html
  // today but it's left for a future cleanup pass to delete explicitly.
  if(!confirm('Remove this file?')) return;
  var entityId = _tenantFilesUnitId || (typeof _currentDetailUnitId !== 'undefined' ? _currentDetailUnitId : '');
  try {
    await sbDeleteFile(path);
    if (entityId) {
      await fetch(SUPABASE_URL+'/rest/v1/housing_audit_log',{
        method:'POST',
        headers:Object.assign({},HOUSING_HEADERS,{'Prefer':'return=minimal'}),
        body:JSON.stringify({entity_type:'tenant',entity_id:String(entityId),
          action:'file_deleted',details:JSON.stringify({path:path}),
          actor:window.currentRole||'staff',created_at:new Date().toISOString()})
      });
    }
    showToast('File removed');
    if (_tenantFilesLib) _tenantFilesLib.refresh();
    if (typeof _currentDetailUnitId !== 'undefined') {
      udpRenderFilePreviews(_currentDetailUnitId);
    }
  } catch(e){ showToast('Could not remove: '+e.message); }
}

// ══════════════════════════════════════════════════════
// AUTH FOUNDATION — Ready for Supabase integration
// ══════════════════════════════════════════════════════
/**
 * CLFN_AUTH is the single source of truth for the current session.
 *
 * When Supabase auth is wired up:
 *   1. On login success, call: CLFN_AUTH.setSession(supabaseUser, staffRow)
 *      where staffRow is the matching row from your staff/employees table.
 *   2. On logout, call: CLFN_AUTH.clearSession()
 *   3. All role checks in the app already read from window.currentRole,
 *      which setSession() sets automatically.
 *
 * staffRow shape (from your existing employees table):
 *   { id, name, email, role }
 *   role values: 'employee' | 'housing_manager' | 'ed'
 */




// ── Page-specific role switch hook ────────────────────────────────────────────
// shared-ui.js switchRole() calls this after updating window.currentRole,
// the header, and nav visibility. Housing-page-specific logic goes here.
window._onSwitchRole = function(role) {
  approvalRole = role;
  var rbSel = document.getElementById('rb_select');
  if (rbSel) rbSel.value = role;
  var hud = document.getElementById('header_user_display');
  if (hud) hud.textContent = (window.CLFN_PERMS && window.CLFN_PERMS.roleLabel)
    ? window.CLFN_PERMS.roleLabel(role) : role;
  if (window._currentScorecardApp && typeof renderScorecardActions === 'function')
    renderScorecardActions(window._currentScorecardApp);
  if (typeof applyTenancyFieldRoles === 'function') applyTenancyFieldRoles();
  // Only navigate home if no view is currently visible (i.e. during boot)
  // Not on every role switch — that causes the worklist flash
  var anyVisible = ['worklistView','dashView','inventoryView','matchView',
    'tenantsView','settingsView','scorecardView','appLayout'].some(function(id) {
    var el = document.getElementById(id);
    return el && el.style.display !== 'none' && el.style.display !== '';
  });
  if (!anyVisible && typeof showEmployeeHome === 'function') showEmployeeHome();
};

// ── Page-specific logout hook ─────────────────────────────────────────────────
// shared-auth.js doLogout() calls this after clearing all state.
window._onLogout = function() {
  applications = []; housingUnits = [];
  if (typeof showLoginScreen === 'function') showLoginScreen();
};

// ── Page-specific nav map (used by shared-ui.js goBack()) ─────────────────────
// Registered after page functions are defined (see bottom of script block).


function _saveToggleStates(){
  try{
    var states={};
    document.querySelectorAll('input[type="checkbox"][id$="Toggle"]').forEach(function(el){
      states[el.id]=el.checked;
    });
    sessionStorage.setItem('_toggleStates',JSON.stringify(states));
  }catch(e){}
}

// saveApplicant stub removed — see below

function submitApplication(){ if(typeof openSubmitModal==="function") openSubmitModal(); }

function syncAccessibility(){
  // Update accessibility field from checkboxes
  var checks = document.querySelectorAll('input[data-acc]');
  var vals = [];
  checks.forEach(function(el){ if(el.checked) vals.push(el.getAttribute('data-acc')); });
  var field = document.getElementById('f_accessibility');
  if(field) field.value = vals.join(', ') || 'None';
}

function clearCurrentUnit(){
  var idEl  = document.getElementById('currentUnitId');      if(idEl)  idEl.value  = '';
  var adEl  = document.getElementById('currentUnitAddress'); if(adEl)  adEl.value  = '';
  var srEl  = document.getElementById('currentUnitSearch');  if(srEl)  srEl.value  = '';
  var dd    = document.getElementById('currentUnitDropdown');if(dd)    dd.style.display = 'none';
  var sel   = document.getElementById('currentUnitSelected');if(sel)   sel.style.display = 'none';
}

function searchCurrentUnit(q){
  var dd = document.getElementById('currentUnitDropdown');
  if(!dd) return;
  if(!q || q.length < 2){ dd.style.display='none'; dd.innerHTML=''; return; }
  var allUnits = [];
  try {
    var _s = JSON.stringify(housingUnits);
    allUnits = _s ? JSON.parse(_s) : [];
  } catch(e) {}
  if(!allUnits.length) allUnits = (typeof housingUnits!=='undefined'&&housingUnits.length)?housingUnits:(window.HOUSING_UNITS_DATA||[]);
  // For "current house on reserve" search: show occupied, under_repair, condemned — the unit the person lives in
  var matches = allUnits.filter(function(u){
    return (u.num+' '+u.street).toLowerCase().includes(q.toLowerCase());
  }).slice(0,8);
  if(!matches.length){
    dd.innerHTML='<div style="padding:8px 12px;color:var(--muted);font-size:13px;">No units found</div>';
    dd.style.display='block'; return;
  }
  dd.innerHTML = matches.map(function(u){
    var addr = u.num+' '+u.street;
    var statusLabel = {occupied:'Occupied',vacant:'Vacant',under_repair:'Under Repair',condemned:'Condemned',reserved:'Reserved'}[u.status]||u.status;
    return '<div style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px;" '
      +'data-uid="'+u.id+'" data-label="'+addr+'" onmousedown="selectCurrentUnit(this)">'
      +'<span style="font-weight:600;">'+addr+'</span>'
      +' <span style="font-size:11px;color:var(--muted);">('+u.bedrooms+'-bed · '+statusLabel+')</span>'
      +'</div>';
  }).join('');
  dd.style.display='block';
}

function selectCurrentUnit(el){
  var id    = el.getAttribute('data-uid');
  var label = el.getAttribute('data-label');
  var idEl  = document.getElementById('currentUnitId');      if(idEl)  idEl.value  = id;
  var adEl  = document.getElementById('currentUnitAddress'); if(adEl)  adEl.value  = label;
  var srEl  = document.getElementById('currentUnitSearch');  if(srEl)  srEl.value  = label;
  var dd    = document.getElementById('currentUnitDropdown');if(dd)    { dd.style.display='none'; dd.innerHTML=''; }
  // Show the selected card
  var sel   = document.getElementById('currentUnitSelected');
  var nm    = document.getElementById('currentUnitSelectedName');
  var det   = document.getElementById('currentUnitSelectedDetail');
  if(nm)  nm.textContent  = label;
  // Find unit detail
  var allUnits = (typeof housingUnits!=='undefined'&&housingUnits.length)?housingUnits:(window.HOUSING_UNITS_DATA||[]);
  var u = allUnits.find(function(x){ return x.id===id; });
  if(det) det.textContent = u ? u.bedrooms+'-bedroom · '+u.type : '';
  if(sel) sel.style.display='block';
  if(typeof calcPersonsOverStandard === "function") { calcPersonsOverStandard(); triggerV2Score(); }
}
function saveApplicant(){ /* auto-save stub - data saved on submit */ }
function nextStep(){ if(typeof goTo==='function'){ var c=document.getElementById('cur'); goTo((parseInt((c&&c.value)||0)+1)); } }
function prevStep(){ if(typeof goTo==='function'){ var c=document.getElementById('cur'); goTo((parseInt((c&&c.value)||1)-1)); } }

function closeApplicationForm(){
  // Hide the form
  var al = document.getElementById('appLayout'); if(al) al.style.display='none';
  var spb = document.getElementById('stepProgressBar'); if(spb) spb.style.display='none';
  var apf = document.getElementById('appProgressFoot'); if(apf) apf.style.display='none';
  var em = document.getElementById('editModal'); if(em) em.classList.remove('on');

  // Use nav stack to go back to wherever user came from
  var stack = window._navStack || [];
  // Pop the 'app' entry if it's on top
  if(stack.length && stack[stack.length-1] === 'app') stack.pop();

  var prev = stack.length ? stack[stack.length-1] : null;
  var navMap = {
    'home':        showEmployeeHome,
    'dashboard':   showDashboard,
    'inventory':   showInventory,
    'match':       showMatch,
    'tenants':     showTenants,
    'renos':       showRenos,
    'contractors': showContractors,
    'settings':    showSettings,
  };
  window._navSkipPush = true;
  if(prev && navMap[prev]) {
    navMap[prev]();
  } else {
    showEmployeeHome();
  }
  window._navSkipPush = false;
}

function newApp(){
  // Reset editing state
  currentAppId = null;
  window._appFormReturnTo = null;
  _step6DocLib = null; // reset so DocLibrary re-mounts for new app ID

  // Clear all form fields
  document.querySelectorAll('#appLayout input[type="text"], #appLayout input[type="email"], #appLayout input[type="tel"], #appLayout input[type="number"], #appLayout input[type="date"], #appLayout textarea').forEach(function(el){
    el.value = '';
  });
  document.querySelectorAll('#appLayout select').forEach(function(el){
    el.selectedIndex = 0;
  });
  document.querySelectorAll('#appLayout input[type="checkbox"], #appLayout input[type="radio"]').forEach(function(el){
    el.checked = false;
  });

  // Clear draft from localStorage
  try{ localStorage.removeItem(DRAFT_KEY); }catch(e){}

  // Clear the editing banner
  var secHdr = document.querySelector('#step0 .sec-hdr p');
  if(secHdr) secHdr.textContent = 'Primary applicant\'s personal details, contact, address, utilities, and CLFN arrears.';

  // Reset appType toggle to New Housing
  var newRadio = document.getElementById('apptype_new');
  var exRadio  = document.getElementById('apptype_existing');
  if(newRadio){ newRadio.checked = true; }
  if(exRadio) { exRadio.checked  = false; }
  if(typeof onAppTypeChange === 'function') onAppTypeChange();

  // Generate fresh app ID
  if(typeof initAppId === 'function') initAppId();

  // Update page header
  var t = document.getElementById('appLayout_title');
  var s = document.getElementById('appLayout_subtitle');
  var ctx = document.getElementById('appLayout_ctx_bar');
  if(t) t.textContent = '';
  if(s) s.textContent = '';
  if(ctx) ctx.style.display = 'none';

  // Show the form at step 0
  showApp();
  if(typeof goTo === 'function') goTo(0);

  // Apply role-based field locks and run initial V2 score
  applyTenancyFieldRoles();
  buildV2FormSelects();
  triggerV2Score();
}




// ══════════════════════════════════════════════════════
// SIGNATURE PAD — clearSig, getSigDataURL, initSignaturePads
// ══════════════════════════════════════════════════════
var _sigPads = {};





// Switch signature method tabs


function initSignaturePads() {
  ['sig_canvas_app','sig_canvas_co','sig_canvas_staff'].forEach(_initSigPad);
}
// Auto-init when step 8 is reached — signature pads are initialized inside goTo()

// ══════════════════════════════════════════════════════
// MISSING CLOSE FUNCTIONS
// ══════════════════════════════════════════════════════
function closeContractorDetail() {
  var p = document.getElementById('contractorDetailPanel');
  if (p) p.style.display = 'none';
  document.body.classList.remove('modal-open');
}
// closePrintPanel defined above
function closeAddUnitModal() {
  var m = document.getElementById('addUnitModal');
  if (m) m.style.display = 'none';
  window._auStagedPhotos = [];
}
function handleAddUnitPhotoUpload(input) {
  if (!window._auStagedPhotos) window._auStagedPhotos = [];
  var files = Array.from(input.files || []);
  files.forEach(function(f) {
    var reader = new FileReader();
    reader.onload = function(e) {
      window._auStagedPhotos.push({ data: e.target.result, name: f.name });
      renderAddUnitPhotoPreview();
    };
    reader.readAsDataURL(f);
  });
}
// Edit-unit photo upload: unit already exists, so upload straight to Supabase Storage
// and append the returned path to the unit's photo list (which persists across sessions).
async function handleEditUnitPhotoUpload(input) {
  var unitId = window._editingUnitId;
  if (!unitId) { showToast('No unit being edited'); return; }
  var files = Array.from(input.files || []).filter(function(f){ return f.type && f.type.startsWith('image/'); });
  if (!files.length) { input.value = ''; return; }
  var zone = document.getElementById('ue_drop_zone');
  if (zone) zone.style.borderColor = 'var(--yellow)';
  try {
    var existing = getUnitPhotos(unitId) || [];
    for (var i = 0; i < files.length; i++) {
      var rec = await sbUploadAndSave('unit', unitId, files[i], 'units/' + unitId + '/photos');
      existing.push(rec.path);
    }
    saveUnitPhotos(unitId, existing);
    renderEditUnitPhotoPreview(unitId);
    showToast('✓ ' + files.length + ' photo' + (files.length > 1 ? 's' : '') + ' uploaded');
  } catch (e) {
    console.warn('[EDIT UNIT PHOTO] upload failed:', e);
    showToast('Photo upload failed: ' + (e.message || 'unknown error'));
  }
  if (zone) zone.style.borderColor = 'var(--border)';
  input.value = '';
}
function renderAddUnitPhotoPreview() {
  var el = document.getElementById('au_photo_preview');
  if (!el) return;
  var photos = window._auStagedPhotos || [];
  if (!photos.length) { el.innerHTML = ''; return; }
  el.innerHTML = photos.map(function(p, i) {
    return '<div style="position:relative;flex-shrink:0;">'
      + '<img src="' + p.data + '" style="width:70px;height:55px;object-fit:cover;border-radius:6px;border:1px solid var(--border);"/>'
      + '<button type="button" onclick="(function(){window._auStagedPhotos.splice(' + i + ',1);renderAddUnitPhotoPreview();})()" style="position:absolute;top:-5px;right:-5px;background:var(--danger);border:none;color:#fff;width:16px;height:16px;border-radius:50%;cursor:pointer;font-size:9px;">✕</button>'
      + '</div>';
  }).join('');
}

// ══════════════════════════════════════════════════════
// MISSING HEADER ELEMENT — header_user_display
// ══════════════════════════════════════════════════════


// ══════════════════════════════════════════════════════
// PHOTO DRAG/DROP HELPERS (addUnitModal)
// ══════════════════════════════════════════════════════
function photoDragOver(e, zoneId) {
  e.preventDefault();
  var z = document.getElementById(zoneId);
  if (z) { z.style.borderColor = 'var(--yellow)'; z.style.background = 'var(--yellow-light)'; }
}
function photoDragLeave(zoneId) {
  var z = document.getElementById(zoneId);
  if (z) { z.style.borderColor = 'var(--border)'; z.style.background = 'var(--bg)'; }
}
function photoDrop(e, mode) {
  e.preventDefault();
  var zoneId = mode === 'add' ? 'au_drop_zone' : 'ue_drop_zone';
  photoDragLeave(zoneId);
  var files = Array.from(e.dataTransfer.files || []);
  if (mode === 'add') {
    if (!window._auStagedPhotos) window._auStagedPhotos = [];
    files.forEach(function(f) {
      if (!f.type.startsWith('image/')) return;
      var r = new FileReader();
      r.onload = function(ev) {
        window._auStagedPhotos.push({ data: ev.target.result, name: f.name });
        renderAddUnitPhotoPreview();
      };
      r.readAsDataURL(f);
    });
  } else if (mode === 'edit') {
    if (typeof handleEditUnitPhotoUpload === 'function') {
      var dt = new DataTransfer();
      files.forEach(function(f) { dt.items.add(f); });
      var inp = document.getElementById('ue_photo_input');
      if (inp) { Object.defineProperty(inp, 'files', { value: dt.files }); handleEditUnitPhotoUpload(inp); }
    }
  }
}

// ══════════════════════════════════════════════════════
// INIT ON LOAD
// ══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
  // Clear field-error highlight when user starts editing a field
  var appLayout = document.getElementById('appLayout');
  if (appLayout) {
    appLayout.addEventListener('input', function(e) {
      if (e.target.classList.contains('field-error')) {
        e.target.classList.remove('field-error');
      }
    });
    appLayout.addEventListener('change', function(e) {
      if (e.target.classList.contains('field-error')) {
        e.target.classList.remove('field-error');
      }
    });
  }
  // Init sig pads when step 8 becomes visible
  var origGoTo = window.goTo;
  if (typeof origGoTo === 'function') {
    window.goTo = function(s) {
      origGoTo(s);
      if (s === 8) setTimeout(initSignaturePads, 100);
    };
  }
  // Init staged photos array
  window._auStagedPhotos = [];
});


// ═══════════════════════════════════════════════════════════════
// APPROVAL WORKFLOW ENGINE
// ═══════════════════════════════════════════════════════════════

// ── Contact settings helpers ──
function renderScorecardActions(app) {
  var bar  = document.getElementById('sc_action_bar');
  var btns = document.getElementById('sc_action_buttons');
  if(!bar || !btns || !app) return;

  var role   = window.currentRole || 'housing_employee_l1';
  var status = app.status || 'draft';
  var isFileUpdate = (app.appType === 'existing_tenant');
  var actions = [];

  // ── Housing Manager actions ──
  if(role === ROLE.HOUSING_MANAGER) {
    if(status === APP_STATUS.SUBMITTED) {
      // New housing app — HM recommends to ED
      actions.push({ label: '✅ Recommend to ED', cls: 'btn-green',   action: 'mgr_approved',  confirmLabel: 'Recommend to Executive Director' });
      actions.push({ label: '↩️ Return for Info',  cls: 'btn-sec',    action: 'returned',       confirmLabel: 'Return to Submitter' });
      actions.push({ label: '❌ Decline',           cls: 'btn-ghost',  action: 'declined',       confirmLabel: 'Decline Application', needsNotes: true });
    }
    if(status === APP_STATUS.FILE_UPDATE) {
      // File update — HM is final approver
      actions.push({ label: '✅ Approve File Update', cls: 'btn-green', action: 'hm_approved', confirmLabel: 'Approve File Update' });
      actions.push({ label: '↩️ Return for Info',     cls: 'btn-sec',   action: 'returned',    confirmLabel: 'Return to Submitter' });
    }
    if(status === 'returned') {
      actions.push({ label: '📋 Move to Review Queue', cls: 'btn-primary', action: 'submitted', confirmLabel: 'Send Back to Review Queue' });
    }
  }

  // ── Executive Director actions ──
  if(role === ROLE.ED) {
    if(status === APP_STATUS.MGR_APPROVED) {
      actions.push({ label: '✅ Final Approval',  cls: 'btn-green',  action: 'ed_approved', confirmLabel: 'Grant Final Approval' });
      actions.push({ label: '↩️ Return to HM',    cls: 'btn-sec',    action: 'returned',    confirmLabel: 'Return to Housing Manager' });
      actions.push({ label: '❌ Decline',          cls: 'btn-ghost',  action: 'declined',    confirmLabel: 'Decline Application', needsNotes: true });
    }
    if(status === APP_STATUS.SUBMITTED) {
      // ED can also act directly on submitted apps
      actions.push({ label: '✅ Final Approval',  cls: 'btn-green',  action: 'ed_approved', confirmLabel: 'Grant Final Approval' });
      actions.push({ label: '↩️ Return for Info', cls: 'btn-sec',    action: 'returned',    confirmLabel: 'Return for More Info' });
      actions.push({ label: '❌ Decline',          cls: 'btn-ghost',  action: 'declined',    confirmLabel: 'Decline Application', needsNotes: true });
    }
  }

  if(!actions.length) { bar.style.display = 'none'; return; }

  bar.style.display = 'block';
  btns.innerHTML = actions.map(function(a) {
    return '<button class="btn ' + a.cls + '" style="font-size:13px;" '
      + 'onclick="openApprovalModal(\'' + a.action + '\',\'' + (a.confirmLabel||a.label) + '\',' + (a.needsNotes?'true':'false') + ')">'
      + a.label + '</button>';
  }).join('');
}

// ── EmailJS workflow notifications ──
function sendWorkflowEmail(event, app) {
  if(!window.emailjs) { console.warn('EmailJS not loaded'); return; }

  var contacts = getContactSettings();
  var hmName   = contacts.hm_name  || 'Housing Manager';
  var hmEmail  = contacts.hm_email || '';
  var edName   = contacts.ed_name  || 'Executive Director';
  var edEmail  = contacts.ed_email || '';

  if(!hmEmail && !edEmail) {
    console.warn('No contact emails configured in Settings → Contacts');
    return;
  }

  var appName  = app ? ((app.fn||'') + ' ' + (app.ln||'')).trim() : '—';
  var appId    = app ? (app.id || '—') : '—';
  var appScore = app ? (app.score !== undefined ? app.score + ' pts' : '—') : '—';
  var appTier  = app ? (app.tier || '—') : '—';
  var notes    = app ? (app.lastActionNotes || '') : '';
  var isFileUpdate = app && app.appType === 'existing_tenant';

  // Configure each workflow event: who gets notified and what message
  var configs = {
    submit: {
      to_name:  hmName,
      to_email: hmEmail,
      subject:  isFileUpdate
        ? 'CLFN Housing — File Update Requires Your Review: ' + appName
        : 'CLFN Housing — New Application Submitted: ' + appName,
      message:  isFileUpdate
        ? 'A file update has been submitted for ' + appName + ' (' + appId + ') and requires your review and approval in the CLFN Housing App.'
        : 'A new housing application has been submitted by ' + appName + ' (' + appId + ', Score: ' + appScore + ', ' + appTier + '). Please log in to the CLFN Housing App to review and recommend to the Executive Director.'
    },
    mgr_approved: {
      to_name:  edName,
      to_email: edEmail,
      subject:  'CLFN Housing — Application Recommended for Final Approval: ' + appName,
      message:  'The Housing Manager has reviewed and recommended the application for ' + appName + ' (' + appId + ', Score: ' + appScore + ', ' + appTier + '). Your final approval is required. Please log in to the CLFN Housing App.'
    },
    hm_approved: {
      to_name:  hmName,
      to_email: hmEmail,
      subject:  'CLFN Housing — File Update Approved: ' + appName,
      message:  'The file update for ' + appName + ' (' + appId + ') has been approved by the Housing Manager.' + (notes ? ' Notes: ' + notes : '')
    },
    ed_approved: {
      to_name:  hmName,
      to_email: hmEmail,
      subject:  'CLFN Housing — Final Approval Granted: ' + appName,
      message:  'Executive Director has granted final approval for ' + appName + ' (' + appId + '). The application is now fully approved. ' + (notes ? 'Notes: ' + notes : '')
    },
    declined: {
      to_name:  hmName,
      to_email: hmEmail,
      subject:  'CLFN Housing — Application Declined: ' + appName,
      message:  'The application for ' + appName + ' (' + appId + ') has been declined.' + (notes ? ' Reason: ' + notes : '')
    },
    returned: {
      to_name:  hmName,
      to_email: hmEmail,
      subject:  'CLFN Housing — Application Returned for More Information: ' + appName,
      message:  'The application for ' + appName + ' (' + appId + ') has been returned and requires additional information before it can proceed.' + (notes ? ' Notes: ' + notes : '')
    }
  };

  var cfg = configs[event];
  if(!cfg || !cfg.to_email) {
    console.warn('No email config for event:', event, '— check contact settings');
    return;
  }

  var templateParams = {
    to_name:    cfg.to_name,
    to_email:   cfg.to_email,
    from_name:  'CLFN Housing App',
    subject:    cfg.subject,
    message:    cfg.message,
    app_name:   appName,
    app_id:     appId,
    app_score:  appScore,
    app_tier:   appTier,
    notes:      notes,
    action_url: window.location.href
  };

  emailjs.send('service_35sybq2', 'template_d0wynda', templateParams)
    .then(function(){ console.log('Workflow email sent:', event, '->', cfg.to_email); })
    .catch(function(err){ console.error('EmailJS error:', err); });
}

// Send test email to HM
function sendTestEmail() {
  var contacts = getContactSettings();
  if(!contacts.hm_email) { showToast('Enter HM email first and save'); return; }
  if(!window.emailjs) { showToast('EmailJS not loaded'); return; }
  var params = {
    to_name: contacts.hm_name || 'Housing Manager',
    to_email: contacts.hm_email,
    from_name: 'CLFN Housing App',
    subject: 'CLFN Housing — Email Test',
    message: 'This is a test notification from the CLFN Housing Application. Workflow email notifications are configured correctly.',
    app_name: 'Test', app_id: 'TEST-001', app_score: '—', app_tier: '—', notes: '', action_url: window.location.href
  };
  emailjs.send('service_35sybq2', 'template_d0wynda', params)
    .then(function(){ showToast('✓ Test email sent to ' + contacts.hm_email); })
    .catch(function(err){ showToast('Email failed — check EmailJS template config'); console.error(err); });
}


// ══════════════════════════════════════════════════════════════
// CONTRACTOR AGREEMENT — Print & Email
// ══════════════════════════════════════════════════════════════












// ══════════════════════════════════════════════════════════════
// CONTRACTOR APPROVAL WORKFLOW
// ══════════════════════════════════════════════════════════════

var _ctApprovalIdx = -1;
var _ctPendingAction = null;






















// ══════════════════════════════════════════════════════════════
// ASSIGN UNIT — Direct from match view
// ══════════════════════════════════════════════════════════════

var _amAppId = null;
var _amBestUnitId = null;
var _amSelectedUnitId = null;
var _amAllScored = [];
// Search/filter state for the assign-unit modal — kept module-level so
// amFilterUnits() can re-render with the captured role/needsAccess context.
var _amSearchQuery = '';
var _amCurrentRole = '';
var _amCurrentNeedsAccess = false;

function _scoreUnit(u, needsBeds, needsAccess, isElders) {
  var sc = 0;
  if(u.bedrooms === needsBeds)        sc += 10;
  else if(u.bedrooms > needsBeds)     sc += 5;
  else if(u.bedrooms === needsBeds-1) sc += 3;
  if(needsAccess && u.accessible)     sc += 8;
  if(needsAccess && !u.accessible)    sc -= 4;
  if(isElders && u.isElders)          sc += 6;
  if(!isElders && u.isElders)         sc -= 2;
  return sc;
}

function openAssignModal(appId, suggestedUnitId) {
  _amAppId = appId; _amBestUnitId = suggestedUnitId || ''; _amSelectedUnitId = null;
  var allApps  = (typeof applications !== 'undefined' ? applications : []);
  var allUnits = [];
  allUnits = housingUnits.slice();
  if(!allUnits.length) allUnits=(typeof housingUnits!=='undefined'&&housingUnits.length)?housingUnits:(window.HOUSING_UNITS_DATA||[]);
  var app = allApps.find(function(a){ return a.id===appId; });
  if(!app){ showToast('Application not found'); return; }
  var role = window.currentRole || 'housing_employee_l1';

  var vacantUnits = allUnits.filter(function(u){ return u.status==='vacant' && !u.archived; });
  var name = ((app.fn||'')+' '+(app.ln||'')).trim();
  var needsBeds   = Math.max(1,1+(app.coApp?1:0)+((app.habitants||[]).length));
  var needsAccess = app.accessibility&&app.accessibility!=='None'&&app.accessibility!=='0'&&app.accessibility!==0;
  var age = app.dob?Math.floor((new Date()-new Date(app.dob))/(365.25*24*3600*1000)):0;
  var isElders = age >= 55;

  // Populate applicant strip
  document.getElementById('am_app_name').textContent  = name;
  document.getElementById('am_app_id').textContent    = app.id;
  var scoreEl = document.getElementById('am_app_score');
  if(scoreEl) scoreEl.textContent = (app.score||0)+' pts · '+(app.tier||'—').replace(' Priority','');
  var statusLabels={ed_approved:'ED Approved',mgr_approved:'HM Recommended',submitted:'Pending HM Review'};
  var statusColors={ed_approved:'#15803d',mgr_approved:'#1d4ed8',submitted:'#92400e'};
  var statusEl=document.getElementById('am_app_status');
  if(statusEl){ statusEl.textContent=statusLabels[app.status]||app.status; statusEl.style.color=statusColors[app.status]||'#888'; }
  var reqs=[needsBeds+' bed'+(needsBeds!==1?'s':'')+' needed'];
  if(needsAccess) reqs.push('Accessible');
  if(isElders)    reqs.push('Elders eligible');
  document.getElementById('am_app_reqs').textContent = reqs.join(' · ');

  // Role badge
  var roleBadge = document.getElementById('am_role_badge');
  if(roleBadge){
    roleBadge.textContent = role=== ROLE.ED ? 'Executive Director — can override' : role=== ROLE.HOUSING_MANAGER ? 'Housing Manager — notes required' : 'Staff';
  }

  // Score and rank all vacant units
  _amAllScored = vacantUnits.map(function(u){
    return { unit:u, score:_scoreUnit(u, needsBeds, needsAccess, isElders), maxPossible:24 };
  }).sort(function(a,b){ return b.score-a.score; });

  // Capture context for filter re-renders + reset search input
  _amCurrentRole = role;
  _amCurrentNeedsAccess = needsAccess;
  _amSearchQuery = '';
  var searchEl = document.getElementById('am_search_input');
  if(searchEl) searchEl.value = '';

  // Render the unit card list
  amRenderUnitList(role, needsAccess);

  // Default move-in to today
  var mi=document.getElementById('am_movein_date'); if(mi) mi.value=new Date().toISOString().split('T')[0];

  // Reset override notes + warning
  var ow=document.getElementById('am_override_wrap'); if(ow) ow.style.display='none';
  var on=document.getElementById('am_override_notes'); if(on) on.value='';
  var warn=document.getElementById('am_warn'); if(warn) warn.style.display='none';

  // Reset confirm button
  var cb=document.getElementById('am_confirm_btn');
  if(cb){ cb.textContent='Select a unit above'; cb.disabled=true; cb.style.opacity='.45'; cb.style.cursor='not-allowed'; }

  // Show modal
  var modal=document.getElementById('assignUnitModal');
  if(modal){ modal.style.removeProperty('display'); modal.style.setProperty('display','flex','important'); }
}

// Filter the visible units in the assign-unit modal by address/street.
// Re-renders with captured role/needsAccess context.
function amFilterUnits(q) {
  _amSearchQuery = (q || '').toLowerCase();
  amRenderUnitList(_amCurrentRole, _amCurrentNeedsAccess);
}

function amRenderUnitList(role, needsAccess) {
  var list = document.getElementById('am_unit_list');
  if(!list) return;
  if(!_amAllScored.length){
    list.innerHTML='<div class="empty-state-ctr">No vacant units available.</div>';
    return;
  }
  // Determine recommendation context from the FULL ranked list so badges
  // attach to the absolute-top units regardless of what's filtered out.
  var topUnitId = _amAllScored[0].unit.id;
  var topScore  = _amAllScored[0].score;
  // Filter view by search query (matches num + street)
  var q = _amSearchQuery;
  var visible = q
    ? _amAllScored.filter(function(obj){
        var hay = (obj.unit.num + ' ' + obj.unit.street).toLowerCase();
        return hay.indexOf(q) !== -1;
      })
    : _amAllScored;
  if(!visible.length){
    list.innerHTML='<div class="empty-state-ctr">No units match your search.</div>';
    return;
  }
  list.innerHTML = visible.map(function(obj){
    var u = obj.unit;
    var pct = Math.round(Math.max(0, obj.score) / obj.maxPossible * 100);
    var isTop = u.id === topUnitId;
    var isAccMismatch = needsAccess && !u.accessible;
    var barColor = isAccMismatch ? 'var(--danger)' : pct >= 70 ? 'var(--success)' : pct >= 40 ? 'var(--warn-amber)' : 'var(--muted)';
    var badges = [];
    var isTiedUnit = obj.score >= topScore - 1;
    if(isTop) badges.push('<span style="font-size:9px;font-weight:800;padding:1px 7px;border-radius:10px;background:var(--yellow);color:var(--dark);">★ RECOMMENDED</span>');
    else if(isTiedUnit) badges.push('<span style="font-size:9px;font-weight:700;padding:1px 7px;border-radius:10px;background:rgba(248,228,26,0.15);color:var(--warn-amber);border:1px solid var(--yellow);">≈ TIED MATCH</span>');
    if(isAccMismatch) badges.push('<span style="font-size:9px;font-weight:700;padding:1px 7px;border-radius:10px;background:var(--danger-bg);color:var(--danger);">⚠ Not accessible</span>');
    if(u.accessible && !isAccMismatch) badges.push('<span style="font-size:9px;font-weight:700;padding:1px 7px;border-radius:10px;background:var(--info-blue-bg);color:var(--info-blue);">♿ Accessible</span>');
    if(u.isElders) badges.push('<span style="font-size:9px;font-weight:700;padding:1px 7px;border-radius:10px;background:var(--warn-amber-bg);color:var(--warn-amber);">Elders Unit</span>');
    return '<div data-unit-id="'+u.id+'" style="padding:14px 16px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .1s;">'
      +'<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px;">'
        +'<div>'
          +'<div style="font-size:13px;font-weight:700;color:var(--text);">'+u.num+' '+u.street+'</div>'
          +'<div style="font-size:11px;color:var(--muted);margin-top:1px;">'+u.bedrooms+' bed · '+(u.type||'—')+(u.funder?' · '+u.funder:'')+'</div>'
        +'</div>'
        +'<div style="text-align:right;flex-shrink:0;">'
          +'<div style="font-size:16px;font-weight:800;color:'+barColor+';">'+pct+'%</div>'
          +'<div class="js-lbl-xs">match</div>'
        +'</div>'
      +'</div>'
      +'<div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden;margin-bottom:6px;">'
        +'<div style="height:100%;width:'+pct+'%;background:'+barColor+';border-radius:2px;transition:width .3s;"></div>'
      +'</div>'
      +(badges.length?'<div style="display:flex;gap:4px;flex-wrap:wrap;">'+badges.join('')+'</div>':'')
      +'</div>';
  }).join('');
  // Wire click events
  list.querySelectorAll('[data-unit-id]').forEach(function(el){
    el.addEventListener('click', function(){
      amSelectUnit(el.getAttribute('data-unit-id'));
    });
    el.addEventListener('mouseover', function(){ if(!el.classList.contains('am-selected')) el.style.background='var(--bg)'; });
    el.addEventListener('mouseout',  function(){ if(!el.classList.contains('am-selected')) el.style.background=''; });
  });
}

function amSelectUnit(unitId) {
  _amSelectedUnitId = unitId;
  var role = window.currentRole || 'housing_employee_l1';

  // Tie detection: units within 1 point of the top score are "tied" / equally recommended
  var topScore = _amAllScored.length > 0 ? _amAllScored[0].score : 0;
  var selectedObj = _amAllScored.find(function(o){ return o.unit.id === unitId; });
  var selectedScore = selectedObj ? selectedObj.score : 0;
  var isTied = selectedScore >= topScore - 1; // within 1 pt of top = tied/recommended
  var isEdOverride = role === ROLE.ED && !isTied; // ED picking below the tied band

  var allApps=(typeof applications!=='undefined'?applications:[]);
  var app=allApps.find(function(a){return a.id===_amAppId;});
  var needsAccess = app&&app.accessibility&&app.accessibility!=='None'&&app.accessibility!=='0'&&app.accessibility!==0;

  var allUnits=[];
  allUnits = housingUnits.slice();
  if(!allUnits.length)allUnits=(typeof housingUnits!=='undefined'&&housingUnits.length)?housingUnits:(window.HOUSING_UNITS_DATA||[]);
  var u=allUnits.find(function(x){return x.id===unitId;});

  // Highlight selected card
  document.querySelectorAll('[data-unit-id]').forEach(function(el){
    var isThis = el.getAttribute('data-unit-id') === unitId;
    el.classList.toggle('am-selected', isThis);
    el.style.background = isThis ? 'rgba(248,228,26,0.08)' : '';
    el.style.outline = isThis ? '2px solid var(--yellow)' : '';
    el.style.outlineOffset = isThis ? '-2px' : '';
  });

  // Notes field:
  //   HM — always required, label reflects whether tied or not
  //   ED — only required when overriding below the tied score band
  var ow = document.getElementById('am_override_wrap');
  var onLabel = document.getElementById('am_notes_label');
  var onReq   = document.getElementById('am_notes_req_star');
  var onPlaceholder = document.getElementById('am_override_notes');

  if(role === ROLE.HOUSING_MANAGER) {
    if(isTied) {
      // Tied — HM can select, notes required
      if(ow) ow.style.display = '';
      if(onLabel) { onLabel.textContent = 'Selection Notes (required) — why this unit for this applicant?'; onLabel.style.color = 'var(--text)'; }
      if(onReq)   onReq.style.display = '';
      if(onPlaceholder) onPlaceholder.placeholder = 'e.g. Closest to family, applicant requested this street, accessibility needs met…';
      var cb = document.getElementById('am_confirm_btn');
      if(cb){ cb.textContent='✓ Confirm Selection'; cb.disabled=false; cb.style.opacity='1'; cb.style.cursor='pointer'; cb.style.background='var(--yellow)'; cb.style.color='#111'; }
    } else {
      // Below tied band — HM cannot override, ED approval required
      if(ow) ow.style.display = 'none';
      var cb = document.getElementById('am_confirm_btn');
      if(cb){ cb.textContent='⛔ ED Approval Required'; cb.disabled=true; cb.style.opacity='1'; cb.style.cursor='not-allowed'; cb.style.background='#fef2f2'; cb.style.color='#b91c1c'; }
    }
  } else if(role === ROLE.ED) {
    if(ow) ow.style.display = isEdOverride ? '' : 'none';
    if(onLabel) onLabel.textContent = 'Override Notes (required) — this unit scores below the top match band.';
    if(onLabel) onLabel.style.color = '#d97706';
    if(onReq)   onReq.style.display = isEdOverride ? '' : 'none';
    if(onPlaceholder) onPlaceholder.placeholder = 'Reason for overriding the recommended match…';
  } else {
    if(ow) ow.style.display = 'none';
  }

  // Accessibility warning (shown alongside whatever state the button is in)
  var warn=document.getElementById('am_warn');
  if(warn && u){
    var warnMsgs = [];
    if(needsAccess && !u.accessible) warnMsgs.push('⚠ Applicant requires accessible unit — this unit is not accessible');
    if(role=== ROLE.HOUSING_MANAGER && !isTied) warnMsgs.push('⛔ This unit scores below the recommended match band — only the Executive Director can assign a lower-scored unit');
    if(warnMsgs.length){
      warn.style.display=''; warn.style.background='#fef2f2'; warn.style.color='#b91c1c';
      warn.textContent = warnMsgs.join(' · ');
    } else { warn.style.display='none'; }
  }

  // Confirm button for ED (HM button already set in branch above)
  if(role !== ROLE.HOUSING_MANAGER) {
    var cb = document.getElementById('am_confirm_btn');
    if(cb){
      cb.textContent = isEdOverride ? '✓ Override & Assign' : '✓ Confirm Selection';
      cb.disabled = false; cb.style.opacity = '1'; cb.style.cursor = 'pointer';
      cb.style.background = 'var(--yellow)'; cb.style.color = '#111';
    }
  }
}

function amUnitChange() {} // stub kept for compat

function closeAssignModal() {
  var modal=document.getElementById('assignUnitModal'); if(modal)modal.style.display='none';
  _amAppId=null; _amBestUnitId=null; _amSelectedUnitId=null; _amAllScored=[];
}

function confirmAssignment() {
  var unitId = _amSelectedUnitId;
  var moveIn = (document.getElementById('am_movein_date')||{}).value||'';
  if(!unitId){ showToast('Please select a unit'); return; }
  if(!_amAppId){ showToast('No application selected'); return; }

  var role = window.currentRole||'staff';
  var isTopRec = _amAllScored.length>0 && _amAllScored[0].unit.id===unitId;
  var isOverride = !isTopRec && _amAllScored.length>0;

  // Tie detection (same as amSelectUnit)
  var topScore2 = _amAllScored.length > 0 ? _amAllScored[0].score : 0;
  var selectedObj2 = _amAllScored.find(function(o){ return o.unit.id === unitId; });
  var selectedScore2 = selectedObj2 ? selectedObj2.score : 0;
  var isTied2 = selectedScore2 >= topScore2 - 1;
  var isEdOverride2 = role=== ROLE.ED && !isTied2;

  // Hard gate: HM cannot assign outside the tied score band — ED only
  if(role === ROLE.HOUSING_MANAGER && !isTied2) {
    showToast('This unit requires Executive Director approval to assign');
    return;
  }

  // HM always requires notes; ED requires notes only when overriding below tied band
  var overrideNotes = ((document.getElementById('am_override_notes')||{}).value||'').trim();
  var needsNotes = (role=== ROLE.HOUSING_MANAGER && isTied2) || isEdOverride2;
  if(needsNotes && !overrideNotes){
    showToast(role=== ROLE.HOUSING_MANAGER ? 'Please add selection notes before confirming' : 'Please add override notes explaining your selection');
    var notesEl = document.getElementById('am_override_notes');
    if(notesEl) notesEl.focus();
    return;
  }

  var allApps=(typeof applications!=='undefined'?applications:[]);
  var allUnits=[];
  allUnits = housingUnits.slice();
  if(!allUnits.length)allUnits=(typeof housingUnits!=='undefined'&&housingUnits.length)?housingUnits:(window.HOUSING_UNITS_DATA||[]);

  var appIdx=allApps.findIndex(function(a){return a.id===_amAppId;});
  var unitIdx=allUnits.findIndex(function(u){return u.id===unitId;});
  if(appIdx<0){showToast('Application not found');return;}
  if(unitIdx<0){showToast('Unit not found');return;}

  var app=allApps[appIdx]; var u=allUnits[unitIdx];
  var name=((app.fn||'')+' '+(app.ln||'')).trim();

  // Role gate
  if(role=== ROLE.ED&&app.status!==APP_STATUS.ED_APPROVED){showToast('ED approval required — status: '+app.status.replace(/_/g,' '));return;}
  if(role=== ROLE.HOUSING_MANAGER&&app.status!==APP_STATUS.MGR_APPROVED&&app.status!==APP_STATUS.ED_APPROVED){showToast('HM recommendation required — status: '+app.status.replace(/_/g,' '));return;}

  // Write unit
  var isTransferReq = (app.appType === 'transfer_request');
  u.assignedTo=app.id; u.assignedName=name; u.assignedDate=moveIn;
  // For transfer requests: mark new unit as 'reserved' not 'occupied'
  // Tenant stays in current unit until physical move
  u.status = isTransferReq ? 'reserved' : 'occupied';
  u.tenantApprovedBy=role=== ROLE.ED?'Executive Director':'Housing Manager';
  u.tenantApprovedAt=new Date().toISOString().split('T')[0];
  if(overrideNotes) u.assignmentOverrideNotes = overrideNotes;
  if(isTransferReq) u.transferPending = true;
  allUnits[unitIdx]=u;

  // Write application
  allApps[appIdx].assignedUnit=unitId;
  allApps[appIdx].assignedAddress=(u.num+' '+u.street).trim();
  allApps[appIdx].status='assigned';
  if(isTransferReq) allApps[appIdx].transferPending = true;
  if(overrideNotes) allApps[appIdx].assignmentOverrideNotes = overrideNotes;

  sbSaveUnit(allUnits.find(function(x){return x.id===unitId;})||{}).catch(function(){});
  sbSaveApplication(allApps[appIdx]).catch(function(){});
  // Sync in-memory housingUnits array so all views reflect the change immediately
  if(typeof housingUnits!=='undefined') housingUnits.splice(0, housingUnits.length, ...allUnits);

  // Audit
  var auditDetail = name+' assigned to '+u.num+' '+u.street+(moveIn?' (move-in '+moveIn+')':'')
    +(isEdOverride2?' — OVERRIDE: '+overrideNotes:(overrideNotes?' — Notes: '+overrideNotes:''));
  auditEntry(app.id,'unit_assigned',auditDetail,role);
  auditEntry(u.id,  'unit_assigned',u.num+' '+u.street+' assigned to '+name+' ('+app.id+')'+(isEdOverride2?' — OVERRIDE':''),role);

  closeAssignModal();
  if(typeof renderMatchView === 'function') renderMatchView();
  if(typeof renderDashTable === 'function') renderDashTable();
  if(typeof updateDashStats === 'function') updateDashStats();
  showToast('✓ '+name+' assigned to '+u.num+' '+u.street+(isEdOverride2?' (override)':''));
}


// ══════════════════════════════════════════════════════════════
// RENO APPROVALS VIEW — HM & ED consolidated SOW queue
// ══════════════════════════════════════════════════════════════

var _raFilter = '';





function _getRaApprovalStatus(u, sow) {
  var hmLimit = _getHmLimit();
  if(!sow) return {key:'no_sow', label:'No SOW Filed', bg:'#f4f4f0', c:'#888'};
  var cost = parseFloat((sow.totalCost||'').toString().replace(/[^0-9.]/g,''))||0;
  var needsED = cost > hmLimit;
  var hmDec = (u.unitHmSig && u.unitHmSig.decision) || '';
  var edDec = (u.unitEdSig && u.unitEdSig.decision) || '';
  var prog = (window._renoProgress && window._renoProgress[u.id]) || null;
  var pct = prog ? (prog.overallPct||0) : 0;
  if(pct >= 100) return {key:'complete',    label:'Complete',        bg:'#f0fdf4', c:'#15803d'};
  if(pct > 0)    return {key:'in_progress', label:'In Progress',     bg:'#fffbeb', c:'#92400e'};
  if(edDec === 'approved')                  return {key:'approved',  label:'ED Approved',     bg:'#f0fdf4', c:'#15803d'};
  if(hmDec === 'approved' && !needsED)      return {key:'approved',  label:'HM Approved',     bg:'#f0fdf4', c:'#15803d'};
  if(hmDec === 'approved' && needsED)       return {key:'pending_ed',label:'Pending ED',       bg:'#eff6ff', c:'#1d4ed8'};
  if(hmDec === 'declined' || edDec === 'declined') return {key:'declined', label:'Declined',  bg:'#fef2f2', c:'#b91c1c'};
  return {key:'pending_hm', label:'Pending HM', bg:'#fffbeb', c:'#92400e'};
}



function renderRenoApprovalsView() {
  var role = window.currentRole || 'housing_employee_l1';
  var relevant = _getAllRenoUnits();

  var rows = relevant.map(function(u) {
    var sow=null; sow = getSowData(u.id);
    var prog = (window._renoProgress && window._renoProgress[u.id]) || null;
    var rs = calcRenoScore(u.id);
    var appr = _getRaApprovalStatus(u, sow);
    var cost = sow ? (parseFloat((sow.totalCost||'').toString().replace(/[^0-9.]/g,''))||0) : 0;
    return {u:u, sow:sow, prog:prog, rs:rs, appr:appr, cost:cost};
  });

  // Filter by status tab
  var filtered = _raFilter ? rows.filter(function(r){ return r.appr.key===_raFilter; }) : rows;

  // Sort by reno score desc
  filtered.sort(function(a,b){ return b.rs.score - a.rs.score; });

  // ── Stat chips ──────────────────────────────────────────────
  var chipsEl = document.getElementById('ra_chips');
  if(chipsEl) {
    var counts = {};
    rows.forEach(function(r){ counts[r.appr.key]=(counts[r.appr.key]||0)+1; });
    var chipDefs = [
      {key:'pending_hm', label:'Pending HM',  c:'#92400e', bg:'#fffbeb'},
      {key:'pending_ed', label:'Pending ED',  c:'#1d4ed8', bg:'#eff6ff'},
      {key:'approved',   label:'Approved',    c:'#15803d', bg:'#f0fdf4'},
      {key:'in_progress',label:'In Progress', c:'#92400e', bg:'#fffbeb'},
      {key:'complete',   label:'Complete',    c:'#15803d', bg:'#f0fdf4'},
      {key:'no_sow',     label:'No SOW',      c:'#888',    bg:'#f4f4f0'},
    ];
    chipsEl.innerHTML = chipDefs.map(function(d){
      var cnt = counts[d.key]||0; if(!cnt) return '';
      var active = _raFilter===d.key;
      return '<span data-ra-f="'+(active?'':d.key)+'" style="font-size:12px;font-weight:700;padding:5px 14px;border-radius:20px;background:'+(active?d.c:d.bg)+';color:'+(active?'#fff':d.c)+';border:2px solid '+d.c+';cursor:pointer;user-select:none;">'+d.label+' '+cnt+'</span>';
    }).join('');
  }

  // ── Tab active states ────────────────────────────────────────
  var tabMap={ra_tab_all:'',ra_tab_nosow:'no_sow',ra_tab_phm:'pending_hm',ra_tab_ped:'pending_ed',ra_tab_app:'approved',ra_tab_prog:'in_progress',ra_tab_done:'complete'};
  Object.keys(tabMap).forEach(function(id){
    var el=document.getElementById(id); if(!el) return;
    var active=_raFilter===tabMap[id];
    el.style.background=active?'var(--yellow)':''; el.style.color=active?'#111':''; el.style.fontWeight=active?'700':'';
  });

  // ── Table rows ───────────────────────────────────────────────
  var tbody = document.getElementById('ra_tbody');
  if(!tbody) return;

  if(!filtered.length) {
    tbody.innerHTML='<tr><td colspan="8" style="padding:40px;text-align:center;color:var(--muted);">No renovation records match this filter.</td></tr>';
    return;
  }

  var hmLimit = _getHmLimit();
  tbody.innerHTML = filtered.map(function(r) {
    var u=r.u; var sow=r.sow; var prog=r.prog; var rs=r.rs; var appr=r.appr;
    var tier = rs.score>=40?{l:'Critical',c:'#b91c1c',bg:'#fef2f2'}:rs.score>=25?{l:'High',c:'#7a6000',bg:'#fef9ec'}:rs.score>=12?{l:'Medium',c:'#1d4ed8',bg:'#eff6ff'}:{l:'Low',c:'#15803d',bg:'#f0fdf4'};
    var costStr = r.cost>0?('$'+r.cost.toLocaleString()):'—';
    var needsED = r.cost > hmLimit;
    var pct = prog?(prog.overallPct||0):0;
    var uid = u.id;

    // Inline approve button — role gated
    var approveBtn = '';
    if(role=== ROLE.HOUSING_MANAGER && appr.key==='pending_hm')
      approveBtn = '<button data-ra-approve="'+uid+'" data-ra-role="hm" style="background:var(--yellow);border:none;color:var(--dark);padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;white-space:nowrap;">✓ Approve</button>';
    else if(role=== ROLE.ED && (appr.key==='pending_ed'||appr.key==='pending_hm'))
      approveBtn = '<button data-ra-approve="'+uid+'" data-ra-role="ed" style="background:var(--yellow);border:none;color:var(--dark);padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;white-space:nowrap;">'+(appr.key==='pending_hm'?'Override →':'✓ Approve')+'</button>';

    return '<tr data-ra-uid="'+uid+'" style="border-bottom:1px solid var(--border);cursor:pointer;">'
      +'<td style="padding:10px 14px;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'
        +u.num+' '+u.street
        +(u.status==='condemned'?' <span style="font-size:9px;background:var(--danger-bg);color:var(--danger);padding:1px 6px;border-radius:6px;font-weight:700;">CONDEMNED</span>':'')
      +'</td>'
      +'<td style="padding:10px 10px;font-size:12px;color:var(--muted);white-space:nowrap;">'+u.bedrooms+'bd·'+(u.type&&u.type!=='0'&&u.type!=='nan'?u.type.replace(' unit','').replace('Detached','Det.').replace('Complex','Cplx'):'—')+'</td>'
      +'<td style="padding:10px 10px;white-space:nowrap;"><span style="font-size:14px;font-weight:800;color:var(--text);">'+rs.score+'</span> <span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:6px;background:'+tier.bg+';color:'+tier.c+';">'+tier.l+'</span></td>'
      +'<td style="padding:10px 10px;font-size:13px;font-weight:600;">'+costStr+(needsED&&r.cost>0?'<div class="txt-info-bold" style="font-size:9px;">ED auth</div>':'')+'</td>'
      +'<td class="pad-10"><span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:8px;background:'+appr.bg+';color:'+appr.c+';white-space:nowrap;">'+appr.label+'</span></td>'
      +'<td style="padding:10px 10px;font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+(sow&&sow.contractor?sow.contractor:'—')+'</td>'
      +'<td class="pad-10"><div style="display:flex;align-items:center;gap:6px;"><div style="width:56px;height:4px;background:var(--border);border-radius:2px;overflow:hidden;flex-shrink:0;"><div style="height:100%;width:'+pct+'%;background:'+(pct>=100?'var(--success)':'var(--yellow)')+';border-radius:2px;"></div></div><span class="js-lbl-sm">'+pct+'%</span></div></td>'
      +'<td style="padding:10px 14px;width:1%;white-space:nowrap;"><div style="display:flex;gap:5px;align-items:center;">'
        +approveBtn
        +'<button data-ra-sow="'+uid+'" style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 8px;cursor:pointer;font-size:11px;font-weight:600;font-family:DM Sans,sans-serif;color:var(--muted);">SOW</button>'
        +'<button data-ra-prog="'+uid+'" style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 8px;cursor:pointer;font-size:11px;font-family:DM Sans,sans-serif;color:var(--muted);">📊</button>'
      +'</div></td>'
      +'</tr>';
  }).join('');

  // Wire all events via delegation
  tbody.querySelectorAll('tr[data-ra-uid]').forEach(function(row) {
    var uid = row.getAttribute('data-ra-uid');
    row.addEventListener('click', function(){ openSowModal(uid); });
    var sowBtn  = row.querySelector('[data-ra-sow]');
    var progBtn = row.querySelector('[data-ra-prog]');
    var appBtn  = row.querySelector('[data-ra-approve]');
    if(sowBtn)  sowBtn.addEventListener('click',  function(e){e.stopPropagation(); openSowModal(uid);});
    if(progBtn) progBtn.addEventListener('click', function(e){e.stopPropagation(); openRenoProgress(uid);});
    if(appBtn)  appBtn.addEventListener('click',  function(e){e.stopPropagation(); raQuickApprove(uid, appBtn.getAttribute('data-ra-role'));});
  });
}

function raQuickApprove(unitId, approver) {
  var units=[];
  units = housingUnits.slice();
  if(!units.length)units=(typeof housingUnits!=='undefined'&&housingUnits.length)?housingUnits:(window.HOUSING_UNITS_DATA||[]);
  var idx=units.findIndex(function(u){return u.id===unitId;});
  if(idx<0){showToast('Unit not found');return;}
  var u=units[idx]; var role=window.currentRole||'staff'; var today=new Date().toISOString().split('T')[0];
  var addr=u.num+' '+u.street;
  var label=approver==='hm'?'Housing Manager':'Executive Director';
  if(!confirm('Approve SOW for '+addr+' — '+label+'?')) return;
  if(approver==='hm') {
    u.unitHmSig={name:role,date:today,decision:'approved',savedAt:today};
    auditEntry('UNIT:'+unitId,'sow_hm_approval',addr+' SOW approved by Housing Manager',role);
  } else {
    u.unitEdSig={name:role,date:today,decision:'approved',savedAt:today};
    auditEntry('UNIT:'+unitId,'sow_ed_approval',addr+' SOW approved by Executive Director',role);
  }
  units[idx]=u;
  sbSaveUnit(u).catch(function(e){ console.warn('SOW approval unit save:',e); });
  // Sync in-memory array
  if(typeof housingUnits!=='undefined') housingUnits.splice(0,housingUnits.length,...units);
  showToast('✓ '+addr+' SOW approved');
  renderRenoApprovalsView();
}

function exportRenoApprovalsCSV() {
  var units = _getAllRenoUnits();
  var hmLimit = _getHmLimit();
  var headers = ['Address','Unit Status','Beds','Type','Priority Score','Priority Tier','SOW Cost','ED Auth Required','Approval Status','HM Decision','HM Date','ED Decision','ED Date','Contractor','Progress %'];
  var csvRows = units.map(function(u) {
    var sow=null;sow = getSowData(u.id);
    var prog = (window._renoProgress && window._renoProgress[u.id]) || null;
    var rs=calcRenoScore(u.id);
    var tier=rs.score>=40?'Critical':rs.score>=25?'High':rs.score>=12?'Medium':'Low';
    var appr=_getRaApprovalStatus(u,sow);
    var cost=sow?(parseFloat((sow.totalCost||'').toString().replace(/[^0-9.]/g,''))||0):0;
    return [
      u.num+' '+u.street, u.status, u.bedrooms, u.type||'', rs.score, tier,
      cost||'', cost>hmLimit?'Yes':'No', appr.label,
      (u.unitHmSig&&u.unitHmSig.decision)||'', (u.unitHmSig&&u.unitHmSig.date)||'',
      (u.unitEdSig&&u.unitEdSig.decision)||'', (u.unitEdSig&&u.unitEdSig.date)||'',
      sow&&sow.contractor?sow.contractor:'', prog?(prog.overallPct||0):0
    ].map(function(v){return '"'+String(v).replace(/"/g,'""')+'"';}).join(',');
  });
  var csv = [headers.join(',')].concat(csvRows).join('\n');
  var a=document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download='CLFN_Reno_Approvals_'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

function exportRenoApprovalsExcel() { exportRenoApprovalsCSV(); } // alias — CSV opens in Excel

function exportRenoApprovalsPDF() {
  var units = _getAllRenoUnits();
  var hmLimit = _getHmLimit();
  var logoSrc=(document.querySelector('.app-logo img')||{}).src||'';
  var today=new Date().toLocaleDateString('en-CA');
  var relevant = _raFilter ? units.filter(function(u){
    var sow=null;sow = getSowData(u.id);
    return _getRaApprovalStatus(u,sow).key===_raFilter;
  }) : units;
  relevant.sort(function(a,b){return calcRenoScore(b.id).score-calcRenoScore(a.id).score;});

  var tableRows = relevant.map(function(u,i){
    var sow=null;sow = getSowData(u.id);
    var prog = (window._renoProgress && window._renoProgress[u.id]) || null;
    var rs=calcRenoScore(u.id);
    var tier=rs.score>=40?{l:'Critical',c:'#b91c1c'}:rs.score>=25?{l:'High',c:'#92400e'}:rs.score>=12?{l:'Medium',c:'#1d4ed8'}:{l:'Low',c:'#15803d'};
    var appr=_getRaApprovalStatus(u,sow);
    var cost=sow?(parseFloat((sow.totalCost||'').toString().replace(/[^0-9.]/g,''))||0):0;
    var pct=prog?(prog.overallPct||0):0;
    var bg=i%2===0?'#fff':'#f9f9f7';
    return '<tr style="background:'+bg+';border-bottom:1px solid var(--border);">'
      +'<td style="padding:7px 10px;font-size:11px;font-weight:600;">'+u.num+' '+u.street+(u.status==='condemned'?' <span class="txt-danger-bold" style="font-size:9px;">[CONDEMNED]</span>':'')+'</td>'
      +'<td style="padding:7px 8px;font-size:11px;text-align:center;font-weight:800;color:'+tier.c+';">'+rs.score+'<br/><span style="font-size:9px;font-weight:700;">'+tier.l+'</span></td>'
      +'<td style="padding:7px 8px;font-size:11px;">'+(cost>0?'$'+cost.toLocaleString():'—')+(cost>hmLimit?' <span style="font-size:9px;color:var(--info-blue);">ED</span>':'')+'</td>'
      +'<td style="padding:7px 8px;font-size:10px;font-weight:700;color:'+appr.c+';">'+appr.label+'</td>'
      +'<td style="padding:7px 8px;font-size:10px;color:var(--text);">'+(u.unitHmSig&&u.unitHmSig.decision?u.unitHmSig.decision+(u.unitHmSig.date?' ('+u.unitHmSig.date+')':''):'—')+'</td>'
      +'<td style="padding:7px 8px;font-size:10px;color:var(--text);">'+(u.unitEdSig&&u.unitEdSig.decision?u.unitEdSig.decision+(u.unitEdSig.date?' ('+u.unitEdSig.date+')':''):'—')+'</td>'
      +'<td style="padding:7px 8px;font-size:11px;color:var(--muted);">'+(sow&&sow.contractor?sow.contractor:'—')+'</td>'
      +'<td style="padding:7px 8px;font-size:11px;text-align:center;">'+pct+'%</td>'
      +'</tr>';
  }).join('');

  var html='<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Reno Approvals — CLFN</title>'
    +'<style>'+_printThemeStyles()+'*{box-sizing:border-box;margin:0;padding:0;}@page{size:letter landscape;margin:12mm 14mm;}body{font-family:Arial,sans-serif;font-size:11px;color:var(--text);}</style>'
    +'</head><body>'
    +'<div style="background:var(--dark);padding:12px 18px;display:flex;align-items:center;justify-content:space-between;">'
      +(logoSrc?'<img src="'+logoSrc+'" style="height:34px;" alt="CLFN"/>':'<span style="color:var(--yellow);font-weight:700;font-size:14px;">CLFN</span>')
      +'<div style="text-align:center;">'
        +'<div style="font-size:8px;color:var(--yellow);font-weight:700;letter-spacing:.1em;text-transform:uppercase;">Constance Lake First Nation — Housing</div>'
        +'<div style="font-size:15px;font-weight:700;color:#fff;margin-top:2px;">Renovation Approvals Report</div>'
      +'</div>'
      +'<div style="text-align:right;font-size:9px;color:var(--muted);">'+today+'<br/>'+relevant.length+' units<br/>Filter: '+(_raFilter||'All')+'</div>'
    +'</div>'
    +'<div style="background:var(--yellow);height:3px;margin-bottom:14px;"></div>'
    +'<table class="std-tbl">'
      +'<thead><tr style="background:var(--dark);">'
        +'<th style="padding:8px 10px;text-align:left;font-size:9px;color:var(--yellow);text-transform:uppercase;letter-spacing:.06em;">Address</th>'
        +'<th style="padding:8px 8px;text-align:center;font-size:9px;color:var(--yellow);text-transform:uppercase;letter-spacing:.06em;width:60px;">Score</th>'
        +'<th style="padding:8px 8px;font-size:9px;color:var(--yellow);text-transform:uppercase;letter-spacing:.06em;width:80px;">SOW Cost</th>'
        +'<th style="padding:8px 8px;font-size:9px;color:var(--yellow);text-transform:uppercase;letter-spacing:.06em;width:100px;">Status</th>'
        +'<th style="padding:8px 8px;font-size:9px;color:var(--yellow);text-transform:uppercase;letter-spacing:.06em;width:110px;">HM Decision</th>'
        +'<th style="padding:8px 8px;font-size:9px;color:var(--yellow);text-transform:uppercase;letter-spacing:.06em;width:110px;">ED Decision</th>'
        +'<th style="padding:8px 8px;font-size:9px;color:var(--yellow);text-transform:uppercase;letter-spacing:.06em;">Contractor</th>'
        +'<th style="padding:8px 8px;text-align:center;font-size:9px;color:var(--yellow);text-transform:uppercase;letter-spacing:.06em;width:55px;">Progress</th>'
      +'</tr></thead>'
      +'<tbody>'+tableRows+'</tbody>'
    +'</table>'
    +'<div style="margin-top:16px;border-top:2px solid var(--yellow);padding-top:6px;display:flex;justify-content:space-between;font-size:8px;color:var(--muted);">'
      +'<span>Constance Lake First Nation — Housing Department — Confidential</span>'
      +'<span>Printed: '+today+'</span>'
    +'</div>'
    +'</body></html>';

  var w=window.open('','_blank','width=1100,height=780,toolbar=0,menubar=0');
  if(!w){showToast('Allow popups to export PDF');return;}
  w.document.open(); w.document.write(html); w.document.close();
  setTimeout(function(){w.focus();w.print();},400);
}


// ══════════════════════════════════════════════════════════════
// LOGIN — matches expense claims app auth pattern exactly
// Uses fetch() to Supabase Auth REST API
// ══════════════════════════════════════════════════════════════


// ── Panel helpers ──────────────────────────────────────────────────────────
function showSignInPanel() {
  document.getElementById('signin-panel').style.display = '';
  document.getElementById('verify-panel').style.display = 'none';
  document.getElementById('forgot-panel').style.display = 'none';
}
function showForgotPassword() {
  var email = (document.getElementById('signin-email')||{}).value||'';
  if(email) { var fe=document.getElementById('forgot-email'); if(fe) fe.value=email.trim(); }
  document.getElementById('signin-panel').style.display = 'none';
  document.getElementById('forgot-panel').style.display = '';
  document.getElementById('verify-panel').style.display = 'none';
}

// ── Remember me ────────────────────────────────────────────────────────────
var HOUSING_REMEMBER_KEY = 'clfn_housing_email';
function hSetCookie(name,value,days){try{var exp=new Date(Date.now()+days*864e5).toUTCString();document.cookie=name+'='+encodeURIComponent(value)+';expires='+exp+';path=/;SameSite=Lax';}catch(e){}}
function hGetCookie(name){try{var m=document.cookie.match(new RegExp('(?:^|; )'+name+'=([^;]*)'));return m?decodeURIComponent(m[1]):null;}catch(e){return null;}}
function hDeleteCookie(name){try{document.cookie=name+'=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';}catch(e){}}
function loadRememberedEmail(){
  try{
    var saved=null;
    try{saved=localStorage.getItem(HOUSING_REMEMBER_KEY);}catch(e){}
    if(!saved) saved=hGetCookie(HOUSING_REMEMBER_KEY);
    if(saved){
      var emailEl=document.getElementById('signin-email');
      var remEl=document.getElementById('remember-me');
      if(emailEl) emailEl.value=saved;
      if(remEl) remEl.checked=true;
      setTimeout(function(){var p=document.getElementById('signin-password');if(p)p.focus();},150);
    }
  }catch(e){}
}
function saveRememberedEmail(email,remember){
  try{
    if(remember){
      try{localStorage.setItem(HOUSING_REMEMBER_KEY,email);}catch(e){}
      hSetCookie(HOUSING_REMEMBER_KEY,email,365);
    }else{
      try{localStorage.removeItem(HOUSING_REMEMBER_KEY);}catch(e){}
      hDeleteCookie(HOUSING_REMEMBER_KEY);
    }
  }catch(e){}
}

// ── Forgot password ────────────────────────────────────────────────────────
async function sendPasswordReset() {
  var email = ((document.getElementById('forgot-email')||{}).value||'').trim().toLowerCase();
  var msgEl = document.getElementById('forgot-msg');
  if(!email || !email.endsWith('@clfn.on.ca')) {
    if(msgEl){msgEl.textContent='Please enter your @clfn.on.ca email address.';msgEl.style.background='#3b0a0a';msgEl.style.color='#fca5a5';msgEl.style.display='block';}
    return;
  }
  try {
    await fetch(SUPABASE_URL+'/auth/v1/recover',{method:'POST',headers:HOUSING_HEADERS,body:JSON.stringify({email:email})});
    if(msgEl){msgEl.textContent='Password reset link sent to '+email+'. Check your inbox.';msgEl.style.background='#052e16';msgEl.style.color='#86efac';msgEl.style.display='block';}
  } catch(e) {
    if(msgEl){msgEl.textContent='Could not send reset email: '+e.message;msgEl.style.background='#3b0a0a';msgEl.style.color='#fca5a5';msgEl.style.display='block';}
  }
}

// ── Resend verification ────────────────────────────────────────────────────
async function resendVerification() {
  var email = (document.getElementById('verify-email-display')||{}).textContent||'';
  var msgEl = document.getElementById('verify-msg');
  try {
    await fetch(SUPABASE_URL+'/auth/v1/resend',{method:'POST',headers:HOUSING_HEADERS,body:JSON.stringify({type:'signup',email:email})});
    if(msgEl){msgEl.textContent='Verification email resent to '+email;msgEl.style.color='#86efac';msgEl.style.display='block';}
  } catch(e) {
    if(msgEl){msgEl.textContent='Could not resend: '+e.message;msgEl.style.color='#fca5a5';msgEl.style.display='block';}
  }
}

// ── Sign in ────────────────────────────────────────────────────────────────
async function startSignIn() {
  var email    = ((document.getElementById('signin-email')||{}).value||'').trim().toLowerCase();
  var password = (document.getElementById('signin-password')||{}).value||'';
  var remember = (document.getElementById('remember-me')||{}).checked||false;
  var errEl    = document.getElementById('signin-error');
  var btn      = document.getElementById('signin-btn');

  if(errEl) errEl.style.display='none';

  if(!email||!password){
    if(errEl){errEl.textContent='Please enter your email and password.';errEl.style.display='block';}
    return;
  }
  if(!email.endsWith('@clfn.on.ca')){
    if(errEl){errEl.textContent='Only @clfn.on.ca email addresses are permitted to sign in.';errEl.style.display='block';}
    return;
  }

  if(btn){btn.disabled=true;btn.textContent='Signing in…';}
  try {
    var r = await fetch(SUPABASE_URL+'/auth/v1/token?grant_type=password',{
      method:'POST', headers:HOUSING_HEADERS, body:JSON.stringify({email:email,password:password})
    });
    var data = await r.json();
    if(!r.ok) throw new Error(data.error_description||data.msg||'Sign-in failed');

    // Check email verification
    var emailConfirmed = data.user.email_confirmed_at||data.user.confirmed_at;
    if(!emailConfirmed){
      var dispEl=document.getElementById('verify-email-display');
      if(dispEl) dispEl.textContent=email;
      document.getElementById('signin-panel').style.display='none';
      document.getElementById('verify-panel').style.display='';
      if(btn){btn.disabled=false;btn.textContent='Sign in';}
      return;
    }

    // Save token and session
    saveRememberedEmail(email, remember);
    HOUSING_SESSION.email = email;
    HOUSING_SESSION.name  = (data.user.user_metadata&&data.user.user_metadata.full_name)||email;
    HOUSING_SESSION.accessToken = data.access_token;
    HOUSING_HEADERS['Authorization'] = 'Bearer '+data.access_token;
    try{sessionStorage.setItem('clfn_housing_token',data.access_token);}catch(e){}

    // Resolve housing role from staff table
    await resolveHousingRole();

    // Load data and launch app
    await loadAppDataFromSupabase();
    hidLoginScreen();
    showEmployeeHome();
    console.log('[CLFN] Welcome, '+HOUSING_SESSION.name+' ('+HOUSING_SESSION.role+')');

  } catch(e) {
    console.error('[HOUSING LOGIN]', e);
    if(errEl){errEl.textContent=e.message;errEl.style.display='block';}
  } finally {
    if(btn){btn.disabled=false;btn.textContent='Sign in';}
  }
}

function showLoginScreen() {
  var ls=document.getElementById('loginScreen');
  if(ls){ls.style.display='flex';}
  showSignInPanel();
  var p=document.getElementById('signin-password'); if(p) p.value='';
  var e=document.getElementById('signin-error'); if(e) e.style.display='none';
}
function hidLoginScreen() {
  var ls=document.getElementById('loginScreen');
  if(ls) ls.style.display='none';
  /* roleSwitcher managed by updateHeaderUser */
}

// ── Global in-memory caches for Supabase data ───────────────────────────────
window._contractors   = window._contractors   || [];
window._sowCache      = window._sowCache      || {};  // keyed by unit_id
window._renoProgress  = window._renoProgress  || {};  // keyed by unit_id
window._renoBudget    = window._renoBudget    || {};  // keyed by unit_id
window._unitPhotos    = window._unitPhotos    || {};  // keyed by unit_id
window._appSettings   = window._appSettings   || {};

// ── Load all data from Supabase into in-memory arrays ────────────────────────
async function loadAppDataFromSupabase() {
  try {
    // Applications
    // Fetch ALL applications using pagination (Supabase defaults to 100 rows per page)
    var allAppsData = [];
    var appsOffset = 0;
    var appsPageSize = 1000;
    while(true) {
      var appsR = await fetch(
        SUPABASE_URL+'/rest/v1/housing_applications?select=*&order=submitted_at.desc&limit='+appsPageSize+'&offset='+appsOffset,
        { headers: HOUSING_HEADERS }
      );
      if(!appsR.ok) break;
      var page = await appsR.json();
      if(!Array.isArray(page) || !page.length) break;
      allAppsData = allAppsData.concat(page);
      if(page.length < appsPageSize) break; // last page
      appsOffset += appsPageSize;
    }
    if(allAppsData.length) {
      applications = allAppsData.map(function(row){
        return Object.assign({},row.data||{},{
          id:row.id, status:row.status, score:row.score, tier:row.tier,
          classification:row.classification, reserve:row.reserve,
          archived:!!row.archived, assignedUnit:row.assigned_unit_id,
          assignedAddress:row.assigned_address, submittedAt:row.submitted_at,
          created_by_email: row.created_by_email || null
        });
      });
    } else {
      // Supabase returned no rows — fall back to localStorage so existing
      // data isn't lost during the transition period. Once apps are saved
      // to Supabase this branch won't be hit.
      try {
        var lsApps = JSON.parse(localStorage.getItem('clfn_applications')||'[]');
        if(lsApps.length) {
          applications = lsApps;
          console.log('[CLFN] Loaded '+lsApps.length+' applications from localStorage fallback');
        }
      } catch(e) { console.warn('[CLFN] localStorage fallback failed:', e); }
    }

    // Housing units
    // Fetch all units with pagination
    var allUnitsData = [];
    var unitsOffset = 0;
    while(true) {
      var unitsR = await fetch(
        SUPABASE_URL+'/rest/v1/housing_units?select=*&order=street,num&limit=1000&offset='+unitsOffset,
        { headers: HOUSING_HEADERS }
      );
      if(!unitsR.ok) break;
      var uPage = await unitsR.json();
      if(!Array.isArray(uPage) || !uPage.length) break;
      allUnitsData = allUnitsData.concat(uPage);
      if(uPage.length < 1000) break;
      unitsOffset += 1000;
    }
    var unitsR = { ok: allUnitsData.length > 0 }; // compatibility shim
    if(unitsR.ok){
      var unitsData=allUnitsData;
      housingUnits=unitsData.map(function(row){
        return Object.assign({},row.data||{},{
          id:row.id, num:row.num, street:row.street, bedrooms:row.bedrooms,
          bathrooms:row.bathrooms, type:row.type, foundation:row.foundation,
          funder:row.funder, status:row.status, accessible:!!row.accessible,
          isElders:!!row.is_elders, archived:!!row.archived,
          assignedTo:row.assigned_to, assignedName:row.assigned_name, assignedDate:row.assigned_date
        });
      });
    } else {
      // Fallback to localStorage during transition period
      try {
        var lsUnits = JSON.parse(localStorage.getItem('clfn_housing_units')||'[]');
        if(lsUnits.length) {
          housingUnits = lsUnits;
          console.log('[CLFN] Loaded '+lsUnits.length+' units from localStorage fallback');
        }
      } catch(e) { console.warn('[CLFN] localStorage units fallback failed:', e); }
    }

    // Settings
    var setR = await fetch(SUPABASE_URL+'/rest/v1/housing_settings?select=*',{headers:HOUSING_HEADERS});
    if(setR.ok){
      var setData=await setR.json();
      setData.forEach(function(row){ if(!window._appSettings) window._appSettings={}; window._appSettings[row.key]=row.value; });
    }
    // Apply saved brand theme (Settings → Admin → Themes)
    if (typeof _applyTheme === 'function') _applyTheme((window._appSettings||{}).theme || {});
    // Apply saved required-field config (Settings → App Settings → Required Fields)
    if (typeof applyRequiredFields === 'function') applyRequiredFields();

    // Load contractors
    try {
      var ctR = await fetch(SUPABASE_URL+'/rest/v1/housing_contractors?select=*&order=created_at',{headers:HOUSING_HEADERS});
      if(ctR.ok){var ctData=await ctR.json();window._contractors=ctData.map(function(r){return Object.assign({},r.data||{},{id:r.id,name:r.name,trade:r.trade,status:r.status});});}
    } catch(e){console.warn('Contractors load:',e);}
    // Load SOW cache
    try {
      var sowR=await fetch(SUPABASE_URL+'/rest/v1/housing_sow?select=unit_id,data',{headers:HOUSING_HEADERS});
      if(sowR.ok){var sd=await sowR.json();window._sowCache={};sd.forEach(function(r){window._sowCache[r.unit_id]=r.data;});}
    } catch(e){console.warn('SOW cache:',e);}
    // Load reno progress cache
    try {
      var rpR=await fetch(SUPABASE_URL+'/rest/v1/housing_reno_progress?select=unit_id,data',{headers:HOUSING_HEADERS});
      if(rpR.ok){var rpd=await rpR.json();window._renoProgress={};rpd.forEach(function(r){window._renoProgress[r.unit_id]=r.data;});}
    } catch(e){console.warn('Reno progress:',e);}
    // Load reno budget cache
    try {
      var rbR=await fetch(SUPABASE_URL+'/rest/v1/housing_reno_budget?select=unit_id,data',{headers:HOUSING_HEADERS});
      if(rbR.ok){var rbd=await rbR.json();window._renoBudget={};rbd.forEach(function(r){window._renoBudget[r.unit_id]=r.data;});}
    } catch(e){console.warn('Reno budget:',e);}
    // Load unit photos cache
    try {
      var upR=await fetch(SUPABASE_URL+'/rest/v1/housing_unit_photos?select=*&order=added_at',{headers:HOUSING_HEADERS});
      if(upR.ok){var upd=await upR.json();window._unitPhotos={};upd.forEach(function(r){if(!window._unitPhotos[r.unit_id])window._unitPhotos[r.unit_id]=[];window._unitPhotos[r.unit_id].push(r);});}
    } catch(e){console.warn('Unit photos:',e);}
    // Load settings cache
    try {
      var asR=await fetch(SUPABASE_URL+'/rest/v1/housing_settings?select=key,value',{headers:HOUSING_HEADERS});
      if(asR.ok){var asd=await asR.json();window._appSettings={};asd.forEach(function(r){window._appSettings[r.key]=r.value;});}
    } catch(e){console.warn('Settings:',e);}
    // Apply saved brand theme (Settings → Admin → Themes)
    if (typeof _applyTheme === 'function') _applyTheme((window._appSettings||{}).theme || {});
    // Apply saved required-field config (Settings → App Settings → Required Fields)
    if (typeof applyRequiredFields === 'function') applyRequiredFields();
    // Load contacts
    try {
      var conR=await fetch(SUPABASE_URL+'/rest/v1/housing_contacts?select=*&limit=1',{headers:HOUSING_HEADERS});
      if(conR.ok){var cond=await conR.json();window._contacts=cond.length?(cond[0].data||{}):{}}
    } catch(e){console.warn('Contacts:',e);}

    console.info('[CLFN] Loaded '+applications.length+' applications, '+housingUnits.length+' units');
    console.info('[CLFN Housing] Data loaded:',applications.length,'apps,',housingUnits.length,'units');

    // Refresh V2 scoring model and tiers from loaded settings
    try {
      if(window._appSettings && window._appSettings['scoring_model_v2']) {
        window.liveV2ScoreModel = window._appSettings['scoring_model_v2'];
      }
      if(window._appSettings && window._appSettings['scoring_tiers_v2']) {
        window.liveV2Tiers = window._appSettings['scoring_tiers_v2'];
      }
    } catch(e) {}

    // Initialise approval authority overrides from loaded settings
    if(typeof initApprovalAuthority === 'function') initApprovalAuthority();

    // Rescore all apps with live V2 model
    if(applications.length && typeof rescoreAllApplications === 'function') {
      rescoreAllApplications();
      console.log('[CLFN] Rescored '+applications.length+' applications on V2 model');
    }

    // Re-render dashboard if it's currently visible (fixes timing: data arrives after render)
    var dv = document.getElementById('dashView');
    if(dv && dv.style.display !== 'none') {
      if(typeof updateDashStats === 'function') updateDashStats();
      if(typeof renderDashTable === 'function') renderDashTable();
    }
    // Re-render worklist if visible
    var wv = document.getElementById('worklistView');
    if(wv && wv.style.display !== 'none') {
      if(typeof renderWorklist === 'function') renderWorklist();
    }
  } catch(e) {
    console.error('[CLFN Housing] loadAppData failed:',e);
    console.warn('[CLFN] Could not load data — using cached version');
  }
}

// ── Check for existing session on page load ────────────────────────────────
// (session restore handled by initHousing IIFE above)

// ══════════════════════════════════════════════════════════════
// STAFF MANAGEMENT — Add users from within the app
// Same pattern as expense claims app
// ══════════════════════════════════════════════════════════════

function showAddHousingStaff() {
  var isED = window.currentRole === ROLE.ED;
  var modal = document.getElementById('globalModal') || document.getElementById('approvalModal');
  // Use the existing showToast + a custom modal approach
  // Build inline modal
  var overlay = document.createElement('div');
  overlay.id = 'staffModal';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:20px;';

  var depts = ['Housing','Administration','Capital Projects & Infrastructure','Human Resources','Finance','Wellness','Medical Services','Choose Life','Ontario Works','Eagles Earth','Water Treatment Plant','Lands & Resources','Chief & Council','Band Reps'];
  var deptOptions = depts.map(function(d){ return '<option value="'+d+'">'+d+'</option>'; }).join('');
  // Role options — gated by the current user's role.
  // ED can assign any role. HM can assign only HE-L1 / HE-L2. Others shouldn't
  // reach this modal (the Add Staff button is gated earlier).
  var roleOptions = (function(){
    var perms = window.CLFN_PERMS;
    if(!perms){
      // Fallback if permissions module somehow didn't load — safe minimum.
      return '<option value="housing_employee_l1">Housing Employee L1</option>';
    }
    var all = Object.keys(perms.ROLE_LABELS);
    var allowed = isED
      ? all                                   // ED: any role
      : ['housing_employee_l1','housing_employee_l2'];  // HM: employee levels only
    return allowed.map(function(k){
      return '<option value="'+k+'">'+perms.roleLabel(k)+'</option>';
    }).join('');
  })();

  overlay.innerHTML = '<div style="background:var(--surface);border-radius:14px;width:100%;max-width:520px;box-shadow:0 24px 60px rgba(0,0,0,.5);overflow:hidden;">'
    + '<div style="background:var(--dark);border-bottom:3px solid var(--yellow);padding:16px 20px;display:flex;align-items:center;justify-content:space-between;">'
    + '<span style="font-size:15px;font-weight:700;color:#fff;">'+(isED?'Add Staff Member — ED':'Add Staff Member')+'</span>'
    + '<button onclick="closeStaffModal()" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;line-height:1;">&times;</button>'
    + '</div>'
    + '<div style="padding:22px;display:flex;flex-direction:column;gap:12px;">'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'
    + '<div><label style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">Full Name</label>'
    + '<input id="hs-name" placeholder="e.g. Edith Moore" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:7px;font-size:13px;font-family:DM Sans,sans-serif;box-sizing:border-box;"></div>'
    + '<div><label style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">Work Email</label>'
    + '<input id="hs-email" type="email" placeholder="edith.moore@clfn.on.ca" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:7px;font-size:13px;font-family:DM Sans,sans-serif;box-sizing:border-box;">'
    + '<div id="hs-email-hint" style="display:none;font-size:11px;color:var(--danger);margin-top:3px;">&#9888; Must be a @clfn.on.ca address</div></div>'
    + '</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'
    + '<div><label style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">Department</label>'
    + '<select id="hs-dept" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:7px;font-size:13px;font-family:DM Sans,sans-serif;box-sizing:border-box;">'+deptOptions+'</select></div>'
    + '<div><label style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">Role</label>'
    + '<select id="hs-role" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:7px;font-size:13px;font-family:DM Sans,sans-serif;box-sizing:border-box;">'+roleOptions+'</select></div>'
    + '</div>'
    + '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 14px;font-size:12px;color:var(--muted);">'
    + '&#128274; A login account is created automatically. Default password: <strong>CLFN + FirstName + 2026!</strong>'
    + '</div>'
    + '<div id="hs-result" style="display:none;border-radius:8px;padding:10px 14px;font-size:12px;"></div>'
    + '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px;">'
    + '<button onclick="closeStaffModal()" style="padding:8px 18px;border:1px solid var(--border);border-radius:7px;background:none;font-size:13px;font-weight:600;cursor:pointer;font-family:DM Sans,sans-serif;">Cancel</button>'
    + '<button id="hs-submit-btn" onclick="submitAddHousingStaff()" style="padding:8px 18px;background:var(--yellow);border:none;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;">+ Add to Staff Directory</button>'
    + '</div>'
    + '</div></div>';

  document.body.appendChild(overlay);

  // Wire email hint
  var emailEl = document.getElementById('hs-email');
  if(emailEl) emailEl.addEventListener('input', function(){
    var h = document.getElementById('hs-email-hint');
    if(h) h.style.display = (this.value && !this.value.endsWith('@clfn.on.ca')) ? 'block' : 'none';
  });
}

function editStaff(idOrObj) {
  var u = (typeof idOrObj === 'object') ? idOrObj : (window._staffCache && window._staffCache[idOrObj]);
  if(!u) { showToast('Staff record not found'); return; }
  var existing = document.getElementById('staffModal');
  if(existing) existing.remove();

  var depts = ['Housing','Administration','Capital Projects & Infrastructure','Human Resources','Finance','Wellness','Medical Services','Choose Life','Ontario Works','Eagles Earth','Water Treatment Plant','Lands & Resources','Chief & Council','Band Reps'];
  var currentRole = sbMapRole(u);
  var deptOptions = depts.map(function(d){ return '<option value="'+d+'"'+(u.department===d?' selected':'')+'>'+d+'</option>'; }).join('');
  var roleOptions = (function(){
    var perms = window.CLFN_PERMS;
    if(!perms){
      return '<option value="housing_employee_l1">Housing Employee L1</option>';
    }
    return Object.keys(perms.ROLE_LABELS).map(function(k){
      var selected = (currentRole === k) ? ' selected' : '';
      return '<option value="'+k+'"'+selected+'>'+perms.roleLabel(k)+'</option>';
    }).join('');
  })();

  var overlay = document.createElement('div');
  overlay.id = 'staffModal';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.innerHTML = '<div style="background:var(--surface);border-radius:14px;width:100%;max-width:480px;box-shadow:0 24px 60px rgba(0,0,0,.5);overflow:hidden;">'
    + '<div style="background:var(--dark);border-bottom:3px solid var(--yellow);padding:16px 20px;display:flex;align-items:center;justify-content:space-between;">'
    + '<span style="font-size:15px;font-weight:700;color:#fff;">Edit Staff Member</span>'
    + '<button onclick="closeStaffModal()" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;line-height:1;">&times;</button>'
    + '</div>'
    + '<div style="padding:22px;display:flex;flex-direction:column;gap:14px;">'
    // Name
    + '<div><label style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">Full Name</label>'
    + '<input id="es-name" value="'+u.name+'" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:7px;font-size:13px;font-family:DM Sans,sans-serif;box-sizing:border-box;"></div>'
    // Email (read-only)
    + '<div><label style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">Email (cannot change)</label>'
    + '<input value="'+u.email+'" readonly style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:7px;font-size:13px;font-family:DM Sans,sans-serif;box-sizing:border-box;background:var(--bg);color:var(--muted);"></div>'
    // Department + Role
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'
    + '<div><label style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">Department</label>'
    + '<select id="es-dept" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:7px;font-size:13px;font-family:DM Sans,sans-serif;box-sizing:border-box;">'+deptOptions+'</select></div>'
    + '<div><label style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px;">Housing Role</label>'
    + '<select id="es-role" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:7px;font-size:13px;font-family:DM Sans,sans-serif;box-sizing:border-box;">'+roleOptions+'</select></div>'
    + '</div>'
    + '<div id="es-result" style="display:none;border-radius:8px;padding:10px 14px;font-size:12px;"></div>'
    + '<div style="display:flex;gap:8px;justify-content:flex-end;">'
    + '<button onclick="closeStaffModal()" style="padding:8px 18px;border:1px solid var(--border);border-radius:7px;background:none;font-size:13px;font-weight:600;cursor:pointer;font-family:DM Sans,sans-serif;">Cancel</button>'
    + '<button id="es-submit-btn" onclick="submitEditStaff('+u.id+')" style="padding:8px 18px;background:var(--yellow);border:none;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;">Save Changes</button>'
    + '</div>'
    + '</div></div>';
  document.body.appendChild(overlay);
}

async function submitEditStaff(id) {
  var name = ((document.getElementById('es-name')||{}).value||'').trim();
  var dept = (document.getElementById('es-dept')||{}).value||'';
  var role = (document.getElementById('es-role')||{}).value||'housing_employee_l1';
  var btn  = document.getElementById('es-submit-btn');
  var res  = document.getElementById('es-result');

  if(!name) { showToast('Please enter a name'); return; }
  if(btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  // Role now stores canonical CLFN_PERMS value directly (no legacy re-mapping).
  var staffRole = role;
  // Housing Manager is always in Housing department — enforce it so it lines up
  // with what sbMapRole expects on read. Other roles keep the user's chosen dept.
  var staffDept = (role === ROLE.HOUSING_MANAGER) ? 'Housing' : dept;

  try {
    var r = await fetch(SUPABASE_URL+'/rest/v1/staff?id=eq.'+id, {
      method: 'PATCH',
      headers: Object.assign({}, HOUSING_HEADERS, {'Prefer':'return=minimal'}),
      body: JSON.stringify({ name: name, department: staffDept, role: staffRole })
    });
    if(r.ok) {
      auditEntry('SETTINGS', 'settings_user_edit', 'Staff updated: '+name+' — Role: '+staffRole, window.currentUser||'ed');
      closeStaffModal();
      showToast('✓ Staff member updated');
      renderHousingUserTable();
    } else {
      var err = await r.text();
      if(res){ res.style.display='block'; res.style.background='#fef2f2'; res.style.color='#b91c1c'; res.textContent='Error: '+err; }
      if(btn){ btn.disabled=false; btn.textContent='Save Changes'; }
    }
  } catch(e) {
    showToast('Error: '+e.message);
    if(btn){ btn.disabled=false; btn.textContent='Save Changes'; }
  }
}


function closeStaffModal() {
  var m = document.getElementById('staffModal');
  if(m) m.remove();
}

async function submitAddHousingStaff() {
  var name  = ((document.getElementById('hs-name')||{}).value||'').trim();
  var email = ((document.getElementById('hs-email')||{}).value||'').trim().toLowerCase();
  var dept  = (document.getElementById('hs-dept')||{}).value||'';
  var role  = (document.getElementById('hs-role')||{}).value||'housing_employee_l1';
  var btn   = document.getElementById('hs-submit-btn');
  var res   = document.getElementById('hs-result');

  if(!name)  { showToast("Please enter the employee's full name"); return; }
  if(!email||!email.includes('@')) { showToast('Please enter a valid email address'); return; }
  if(!email.endsWith('@clfn.on.ca')) { showToast('Only @clfn.on.ca email addresses can be registered'); return; }

  // Role-based add-staff gate. HM can only add HE-L1 or HE-L2. ED can add any role.
  if(window.currentRole === ROLE.HOUSING_MANAGER){
    var allowedForHm = ['housing_employee_l1','housing_employee_l2'];
    if(allowedForHm.indexOf(role) === -1){
      showToast('Housing managers can only add Housing Employees. Only the ED can add other roles.');
      return;
    }
  }

  if(btn){ btn.disabled=true; btn.textContent='Adding…'; }

  try {
    // Check if already in staff table
    var checkR = await fetch(SUPABASE_URL+'/rest/v1/staff?select=id&email=eq.'+encodeURIComponent(email),{headers:HOUSING_HEADERS});
    var existing = await checkR.json();
    if(existing&&existing.length){ showToast(email+' is already in the staff directory'); if(btn){btn.disabled=false;btn.textContent='+ Add to Staff Directory';} return; }

    var firstName = name.split(' ')[0];
    var defaultPassword = 'CLFN'+firstName+'2026!';

    // Step 1: Create Supabase Auth account
    var signupR = await fetch(SUPABASE_URL+'/auth/v1/signup',{
      method:'POST', headers:HOUSING_HEADERS,
      body:JSON.stringify({email:email, password:defaultPassword, data:{full_name:name}})
    });
    var signupData = await signupR.json();
    var authCreated = signupR.ok && signupData.user && signupData.user.id;
    var alreadyInAuth = (signupData.msg||'').includes('already registered') || (signupData.error_description||'').includes('already registered');

    if(!authCreated && !alreadyInAuth) {
      // Auth failed — show error, do NOT save staff record
      var errMsg = signupData.msg || signupData.error_description || signupData.error || JSON.stringify(signupData);
      if(res){
        res.style.background='#fef2f2'; res.style.border='1px solid #fecaca'; res.style.color='#b91c1c';
        res.innerHTML = '<strong>Could not create login account.</strong><br>'
          + '<span style="font-size:11px;">'+errMsg+'</span><br><br>'
          + 'To fix: Go to <strong>CLFN Housing Supabase → Authentication → Sign In / Providers</strong><br>'
          + 'Turn off <strong>"Confirm email"</strong> and click Save changes, then try again.';
        res.style.display='block';
      }
      if(btn){btn.disabled=false;btn.textContent='+ Add to Staff Directory';}
      return;
    }

    // Step 2: Add to staff table (only after auth succeeds)
    var staffR = await fetch(SUPABASE_URL+'/rest/v1/staff',{
      method:'POST',
      headers:Object.assign({},HOUSING_HEADERS,{'Prefer':'return=minimal'}),
      body:JSON.stringify({name:name, email:email, role:role, department:dept, is_active:true, manager_email:'kevin.proctor@clfn.on.ca'})
    });

    if(!staffR.ok){
      var staffErr = await staffR.text();
      if(res){
        res.style.background='#fef2f2'; res.style.border='1px solid #fecaca'; res.style.color='#b91c1c';
        res.innerHTML = '<strong>Auth account created but staff record failed.</strong><br><span style="font-size:11px;">'+staffErr+'</span>';
        res.style.display='block';
      }
      if(btn){btn.disabled=false;btn.textContent='+ Add to Staff Directory';}
      return;
    }

    // Both succeeded
    if(res){
      res.style.background='var(--success-bg)'; res.style.border='1px solid var(--success-border)'; res.style.color='var(--success)';
      res.innerHTML = '<strong>&#10003; '+name+' added successfully!</strong><br>'
        + 'Email: <code style="background:var(--success-border);padding:2px 6px;border-radius:4px;">'+email+'</code><br>'
        + 'Password: <code style="background:var(--success-border);padding:2px 6px;border-radius:4px;font-weight:700;">'+defaultPassword+'</code><br>'
        + '<span style="font-size:11px;opacity:.8;">Share these credentials directly. They can change their password after signing in.</span>';
      res.style.display='block';
      showToast('\u2713 '+name+' added successfully');
    }

    // Refresh user table if visible
    if(true) renderHousingUserTable();
    if(btn) btn.style.display='none';

  } catch(e) {
    showToast('Error: '+e.message);
    if(btn){btn.disabled=false;btn.textContent='+ Add to Staff Directory';}
  }
}












async function loadHousingData() {
  try {
    var appsData = await sbLoadApplications();
    if(appsData) applications = appsData;
    var unitsData = await sbLoadUnits();
    if(unitsData) housingUnits = unitsData;
    var cR = await sbLoadContractors(); if(cR) window._contractors = cR;
    var sowR = await fetch(SUPABASE_URL+'/rest/v1/housing_sow?select=*',{headers:HOUSING_HEADERS});
    if(sowR.ok){var sd=await sowR.json(); sd.forEach(function(r){window._sowCache[r.unit_id]=r.data;});}
    var stR = await fetch(SUPABASE_URL+'/rest/v1/housing_settings?select=key,value',{headers:HOUSING_HEADERS});
    if(stR.ok){var stD=await stR.json(); window._appSettings={};
      stD.forEach(function(r){window._appSettings[r.key]=r.value;});
      if(window._appSettings['scoring_model_v2']) window.liveV2ScoreModel=window._appSettings['scoring_model_v2'];
      // Also hydrate liveScoreModel (V1 array format) used by buildV2FormSelects dropdowns
      var _sm = window._appSettings['scoring_model_v2'] || window._appSettings['scoring_model'];
      if(_sm && Array.isArray(_sm) && _sm.length) window.liveScoreModel = _sm;
    }
    if(applications.length && typeof rescoreAllApplications==='function') rescoreAllApplications();
    console.log('[CLFN] Loaded '+applications.length+' apps, '+housingUnits.length+' units');
  } catch(e){ console.warn('[HOUSING] data load error:',e); console.warn('[CLFN] Could not load data'); }
}


function initHousingPage() {
  // Set up role view switcher
  initRoleSwitcher();

  // Show sidebar nav for HM/ED
  
  // Show settings button for HM/ED
  var settingsBtn = document.getElementById('tab_settings_btn');

  // Apply role-based visibility
  var role = window.currentRole || 'housing_employee_l1';
  if(settingsBtn) settingsBtn.style.display = (ROLE.isManagement(role)) ? '' : 'none';
  document.querySelectorAll('.hm-ed-only').forEach(function(e){
    e.style.display=(ROLE.isManagement(role))?'':'none';
  });
  document.querySelectorAll('.ed-only').forEach(function(e){
    e.style.display=(role=== ROLE.ED)?'':'none';
  });

  // Update header
  if(true) updateHeaderUser(role);
  if(true) updateRoleSwitcherVisibility();

  // Navigate to requested view from URL param
  var params = new URLSearchParams(window.location.search);
  // ?openApp=APP_ID — cross-page handoff (e.g. from match.html applicant click)
  var openAppId = params.get('openApp');
  if(openAppId && typeof window.openEditModal === 'function'){
    window.openEditModal(openAppId);
    return;
  }
  var view = params.get('view') || 'dashboard';
  if(view==='home')             { if(typeof showEmployeeHome==='function') showEmployeeHome(); }
  else if(view==='newapp')      { if(typeof newApp==='function') newApp(); }
  else if(view==='worklist')    { if(true) showWorklist(); }
  else if(view==='inventory')   { if(true) showInventory(); }
  else if(view==='match')       { if(true) showMatch(); }
  else if(view==='tenants')     { if(true) showTenants(); }
  else if(view==='settings')    { if(typeof showSettings==='function') showSettings(); }
  else if(view==='contractors') { if(true) showContractors(); }
  else                          { if(typeof showDashboard==='function') showDashboard(); else if(true) showWorklist(); }
}

// ══════════════════════════════════════════════════════
// PAGE BOOT — only on housing.html
// ══════════════════════════════════════════════════════
// housing-init.js is loaded by multiple pages in the suite (housing.html,
// inventory.html, etc.) because they share helpers like showDashboard,
// newApp, resolveHousingRole, etc. But only housing.html should run this
// page-level boot. On inventory.html (and other sub-pages), the page's
// own inline init block handles view dispatch against its own DOM —
// letting this IIFE run there would call initHousingPage(), which reads
// ?view= from the sub-page's URL and tries to render housing.html views
// (dashView, employeeHomeView) on a DOM that doesn't contain them. That
// either shows the wrong thing or, more commonly, a blank screen.
(function () {
  var path = window.location.pathname;
  var isHousingHome =
    path.endsWith('/housing.html') ||
    path === '/housing.html' ||
    path.endsWith('/') ||
    path === '';
  if (!isHousingHome) {
    console.log('[housing-init] Page boot skipped — not on housing.html (path=' + path + ')');
    return;
  }

  (async function initHousing() {
    var token=null, savedRole=null, savedName=null, savedEmail=null;
    try {
      token      = sessionStorage.getItem('clfn_housing_token');
      savedRole  = sessionStorage.getItem('clfn_housing_role') || 'housing_employee_l1';
      savedName  = sessionStorage.getItem('clfn_housing_name') || '';
      savedEmail = sessionStorage.getItem('clfn_housing_email_session') || '';
    } catch(e) {}
    if(!token) { window.location.href='index.html'; return; }
    HOUSING_HEADERS['Authorization'] = 'Bearer '+token;
    HOUSING_SESSION.accessToken=token; HOUSING_SESSION.role=savedRole;
    HOUSING_SESSION.name=savedName; HOUSING_SESSION.email=savedEmail;
    window.currentRole=savedRole;
    window.CLFN_AUTH = window.CLFN_AUTH||{};
    window.CLFN_AUTH.isAuthenticated=true; window.CLFN_AUTH.currentRole=savedRole;
    try {
      // Resolve the CURRENT role from the staff table before rendering anything.
      // The sessionStorage cache above is stale on every housing.html page load
      // because nothing writes to clfn_housing_role — it will always default to
      // 'employee', which renders the wrong tile grid and causes the Finance
      // tile to be hidden from ED/HM users on first load. This call queries
      // Supabase for the real role based on email, then updates
      // HOUSING_SESSION.role, window.currentRole, and window._realRole to match.
      if(HOUSING_SESSION.email && typeof resolveHousingRole === 'function') {
        await resolveHousingRole();
        console.log('[housing] initHousing: resolved role =', HOUSING_SESSION.role);
      }
      await loadHousingData();
      initHousingPage();
      document.body.style.opacity = '1';
    } catch(e) {
      console.error('[HOUSING] init failed:', e.message, e.stack);
      document.body.style.opacity = '1';
    }
  }());
}());
