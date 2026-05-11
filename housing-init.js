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
  if(!APPROVAL_AUTHORITY.can('accessDashboard', role)) { showToast('Dashboard access requires Housing Manager or Executive Director role.'); return; }
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
  var ok = await showConfirm({
    title:       'Remove this file?',
    message:     'The file will be deleted from storage. This cannot be undone.',
    confirmText: 'Remove',
    danger:      true
  });
  if (!ok) return;
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
  if (window._currentScorecardApp && typeof renderScorecardActions === 'function')
    renderScorecardActions(window._currentScorecardApp);
  if (typeof applyTenancyFieldRoles === 'function') applyTenancyFieldRoles();
  // Only navigate home if no view is currently visible (i.e. during boot).
  // Includes landingView so role switches on the landing page don't trigger a
  // redundant re-render via showEmployeeHome (which already handles landing).
  var anyVisible = ['landingView','worklistView','dashView','inventoryView','matchView',
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
  // Read every checked acc_* checkbox by its visible value, write to the
  // hidden #accessibility field that the save path reads.
  var checks = document.querySelectorAll('input[id^="acc_"]:checked');
  var vals = [];
  checks.forEach(function(el){ vals.push(el.value); });
  var field = document.getElementById('accessibility');
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
  if(secHdr) secHdr.textContent = 'Primary applicant\'s personal details, contact, address, utilities, and ' + (window.NATION_CONFIG && NATION_CONFIG.short || '') + ' arrears.';

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
  if(APPROVAL_AUTHORITY.can('reviewApplication', role)) {
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
  if(APPROVAL_AUTHORITY.can('finalApproveApp', role)) {
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
  var hmName   = contacts.hm_name  || CLFN_PERMS.roleLabel(ROLE.HOUSING_MANAGER);
  var hmEmail  = contacts.hm_email || '';
  var edName   = contacts.ed_name  || CLFN_PERMS.roleLabel(ROLE.ED);
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
  var _natShort = (window.NATION_CONFIG && NATION_CONFIG.short) || '';
  var _hmLbl = CLFN_PERMS.roleLabel(ROLE.HOUSING_MANAGER);
  var _edLbl = CLFN_PERMS.roleLabel(ROLE.ED);
  var _appName = _natShort + ' Housing';
  var configs = {
    submit: {
      to_name:  hmName,
      to_email: hmEmail,
      subject:  isFileUpdate
        ? _appName + ' — File Update Requires Your Review: ' + appName
        : _appName + ' — New Application Submitted: ' + appName,
      message:  isFileUpdate
        ? 'A file update has been submitted for ' + appName + ' (' + appId + ') and requires your review and approval in the ' + _appName + ' App.'
        : 'A new housing application has been submitted by ' + appName + ' (' + appId + ', Score: ' + appScore + ', ' + appTier + '). Please log in to the ' + _appName + ' App to review and recommend to the ' + _edLbl + '.'
    },
    mgr_approved: {
      to_name:  edName,
      to_email: edEmail,
      subject:  _appName + ' — Application Recommended for Final Approval: ' + appName,
      message:  'The ' + _hmLbl + ' has reviewed and recommended the application for ' + appName + ' (' + appId + ', Score: ' + appScore + ', ' + appTier + '). Your final approval is required. Please log in to the ' + _appName + ' App.'
    },
    hm_approved: {
      to_name:  hmName,
      to_email: hmEmail,
      subject:  _appName + ' — File Update Approved: ' + appName,
      message:  'The file update for ' + appName + ' (' + appId + ') has been approved by the ' + _hmLbl + '.' + (notes ? ' Notes: ' + notes : '')
    },
    ed_approved: {
      to_name:  hmName,
      to_email: hmEmail,
      subject:  _appName + ' — Final Approval Granted: ' + appName,
      message:  _edLbl + ' has granted final approval for ' + appName + ' (' + appId + '). The application is now fully approved. ' + (notes ? 'Notes: ' + notes : '')
    },
    declined: {
      to_name:  hmName,
      to_email: hmEmail,
      subject:  _appName + ' — Application Declined: ' + appName,
      message:  'The application for ' + appName + ' (' + appId + ') has been declined.' + (notes ? ' Reason: ' + notes : '')
    },
    returned: {
      to_name:  hmName,
      to_email: hmEmail,
      subject:  _appName + ' — Application Returned for More Information: ' + appName,
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
    from_name:  _appName + ' App',
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
  var _short = (window.NATION_CONFIG && NATION_CONFIG.short) || '';
  var params = {
    to_name: contacts.hm_name || CLFN_PERMS.roleLabel(ROLE.HOUSING_MANAGER),
    to_email: contacts.hm_email,
    from_name: _short + ' Housing App',
    subject: _short + ' Housing — Email Test',
    message: 'This is a test notification from the ' + (window.NATION_CONFIG ? NATION_CONFIG.display_name : '') + ' Housing Application. Workflow email notifications are configured correctly.',
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

  // Reset override notes + warning. For override-authority users (ED), keep
  // the notes textarea visible from the start — required only when they pick
  // a unit below the top tied band, but always reachable to type into.
  var ow=document.getElementById('am_override_wrap');
  var preShowNotes = (typeof APPROVAL_AUTHORITY !== 'undefined') && APPROVAL_AUTHORITY.can('overrideMatch', role);
  // Set an explicit 'block' value rather than '' — the CSS has #am_override_wrap
  // { display:none } as the default, so '' would let that rule re-apply.
  if(ow) ow.style.display = preShowNotes ? 'block' : 'none';
  var on=document.getElementById('am_override_notes'); if(on) on.value='';
  var preLabel = document.getElementById('am_notes_label');
  if(preLabel && preShowNotes) {
    preLabel.textContent = 'Selection Notes (optional) — why this unit for this applicant?';
    preLabel.style.color = 'var(--text)';
  }
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
  var canOverride  = APPROVAL_AUTHORITY.can('overrideMatch', role);
  var canAssignTie = APPROVAL_AUTHORITY.can('assignTiedBand', role);
  var isEdOverride = canOverride && !isTied; // override-authority user picking below the tied band

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

  if(canAssignTie && !canOverride) {
    if(isTied) {
      // Tied — assign-tied-band user can select, notes required
      if(ow) ow.style.display = 'block';
      if(onLabel) { onLabel.textContent = 'Selection Notes (required) — why this unit for this applicant?'; onLabel.style.color = 'var(--text)'; }
      if(onReq)   onReq.style.display = '';
      if(onPlaceholder) onPlaceholder.placeholder = 'e.g. Closest to family, applicant requested this street, accessibility needs met…';
      var cb = document.getElementById('am_confirm_btn');
      if(cb){ cb.textContent='✓ Confirm Selection'; cb.disabled=false; cb.style.opacity='1'; cb.style.cursor='pointer'; cb.style.background='var(--yellow)'; cb.style.color='#111'; }
    } else {
      // Below tied band — user can't override, ED approval required
      if(ow) ow.style.display = 'none';
      var cb = document.getElementById('am_confirm_btn');
      if(cb){ cb.textContent='⛔ ED Approval Required'; cb.disabled=true; cb.style.opacity='1'; cb.style.cursor='not-allowed'; cb.style.background='#fef2f2'; cb.style.color='#b91c1c'; }
    }
  } else if(canOverride) {
    // Always show the notes wrap for override-authority users so the field is
    // visible whether the pick is the top match (notes optional) or below the
    // tied band (notes required). 'block' explicitly overrides the CSS rule
    // #am_override_wrap { display:none } that hides it by default.
    if(ow) ow.style.display = 'block';
    if(onLabel) {
      onLabel.textContent = isEdOverride
        ? 'Override Notes (required) — this unit scores below the top match band.'
        : 'Selection Notes (optional) — why this unit for this applicant?';
      onLabel.style.color = isEdOverride ? '#d97706' : 'var(--text)';
    }
    if(onReq) onReq.style.display = isEdOverride ? '' : 'none';
    if(onPlaceholder) onPlaceholder.placeholder = isEdOverride
      ? 'Reason for overriding the recommended match…'
      : 'e.g. Closest to family, applicant requested this street, accessibility needs met…';
  } else {
    if(ow) ow.style.display = 'none';
  }

  // Accessibility warning (shown alongside whatever state the button is in)
  var warn=document.getElementById('am_warn');
  if(warn && u){
    var warnMsgs = [];
    if(needsAccess && !u.accessible) warnMsgs.push('⚠ Applicant requires accessible unit — this unit is not accessible');
    if(canAssignTie && !canOverride && !isTied) warnMsgs.push('⛔ This unit scores below the recommended match band — only the Executive Director can assign a lower-scored unit');
    if(warnMsgs.length){
      warn.style.display='block'; warn.style.background='#fef2f2'; warn.style.color='#b91c1c';
      warn.textContent = warnMsgs.join(' · ');
    } else { warn.style.display='none'; }
  }

  // Confirm button for override-authority users (assign-tied button already set in branch above)
  if(canOverride) {
    var cb = document.getElementById('am_confirm_btn');
    if(cb){
      cb.textContent = isEdOverride ? '✓ Override & Assign' : '✓ Confirm Selection';
      cb.disabled = false; cb.style.opacity = '1'; cb.style.cursor = 'pointer';
      cb.style.background = 'var(--yellow)'; cb.style.color = '#111';
    }
  }

  // Make sure the notes textarea is actually on screen — on shorter viewports
  // the unit list can push it below the visible area inside the scrollable
  // modal body. Scroll it into view whenever it's shown.
  if(ow && ow.style.display !== 'none'){
    try { ow.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch(_){}
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
  var canOverride2  = APPROVAL_AUTHORITY.can('overrideMatch', role);
  var canAssignTie2 = APPROVAL_AUTHORITY.can('assignTiedBand', role);
  var isEdOverride2 = canOverride2 && !isTied2;

  // Hard gate: assign-tied-only users cannot assign outside the tied score band — overrideMatch only
  if(!canOverride2 && !isTied2) {
    showToast('This unit requires Executive Director approval to assign');
    return;
  }

  // assign-tied users always require notes; override users require notes only when overriding below tied band
  var overrideNotes = ((document.getElementById('am_override_notes')||{}).value||'').trim();
  var needsNotes = (canAssignTie2 && !canOverride2 && isTied2) || isEdOverride2;
  if(needsNotes && !overrideNotes){
    showToast((canAssignTie2 && !canOverride2) ? 'Please add selection notes before confirming' : 'Please add override notes explaining your selection');
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
  u.tenantApprovedBy=CLFN_PERMS.roleLabel(role=== ROLE.ED ? ROLE.ED : ROLE.HOUSING_MANAGER);
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

  sbSaveUnit(allUnits.find(function(x){return x.id===unitId;})||{}).catch(function(e){
    console.warn('[assign] sbSaveUnit failed:', e);
    showToast('Could not save unit assignment to server', { type:'error' });
  });
  sbSaveApplication(allApps[appIdx]).catch(function(e){
    console.warn('[assign] sbSaveApplication failed:', e);
    showToast('Could not save application assignment to server', { type:'error' });
  });
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

    // Inline approve button — role gated via SOW approval authorities
    var approveBtn = '';
    if(APPROVAL_AUTHORITY.can('approveSowUnderThreshold', role) && appr.key==='pending_hm')
      approveBtn = '<button data-ra-approve="'+uid+'" data-ra-role="hm" style="background:var(--yellow);border:none;color:var(--dark);padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;white-space:nowrap;">✓ Approve</button>';
    else if(APPROVAL_AUTHORITY.can('approveSowOverThreshold', role) && (appr.key==='pending_ed'||appr.key==='pending_hm'))
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
  // Defense-in-depth: even though the inline approve button is gated by the
  // approval-authority for this row's status, re-check here so callers cannot
  // shortcut by clicking via a stale/mutated DOM.
  var _qaRole = window.currentRole || 'staff';
  var _needAuthority = approver === 'ed' ? 'approveSowOverThreshold' : 'approveSowUnderThreshold';
  if(!APPROVAL_AUTHORITY.can(_needAuthority, _qaRole)){
    showToast('You do not have authority to approve this SOW.');
    return;
  }
  var units=[];
  units = housingUnits.slice();
  if(!units.length)units=(typeof housingUnits!=='undefined'&&housingUnits.length)?housingUnits:(window.HOUSING_UNITS_DATA||[]);
  var idx=units.findIndex(function(u){return u.id===unitId;});
  if(idx<0){showToast('Unit not found');return;}
  var u=units[idx]; var role=window.currentRole||'staff'; var today=new Date().toISOString().split('T')[0];
  var addr=u.num+' '+u.street;
  var label=CLFN_PERMS.roleLabel(approver==='hm' ? ROLE.HOUSING_MANAGER : ROLE.ED);
  showConfirm({
    title:       'Approve SOW?',
    message:     addr + ' &mdash; <strong>' + label + '</strong> approval',
    confirmText: 'Approve'
  }).then(function(ok){
    if (!ok) return;
    if(approver==='hm') {
      u.unitHmSig={name:role,date:today,decision:'approved',savedAt:today};
      auditEntry('UNIT:'+unitId,'sow_hm_approval',addr+' SOW approved by Housing Manager',role);
    } else {
      u.unitEdSig={name:role,date:today,decision:'approved',savedAt:today};
      auditEntry('UNIT:'+unitId,'sow_ed_approval',addr+' SOW approved by Executive Director',role);
    }
    // Auto-flip unit status to under_repair on the FIRST approval (mirrors
    // the saveSOW path, but for the inline quick-approve button on the Reno
    // Approvals row). Idempotent: no-op if the unit is already under_repair
    // or condemned. Captures priorStatus so the lifecycle can revert it
    // when the last SOW on this unit completes / is archived.
    if(typeof flipUnitToUnderRepair === 'function' && flipUnitToUnderRepair(u)){
      auditEntry('UNIT:'+unitId,'unit_status_auto',addr+' → Under Repair (quick-approved by '+(approver==='hm'?'HM':'ED')+')',role);
    }
    units[idx]=u;
    sbSaveUnit(u).catch(function(e){ console.warn('SOW approval unit save:',e); });
    if(typeof housingUnits!=='undefined') housingUnits.splice(0,housingUnits.length,...units);
    showToast('✓ '+addr+' SOW approved');
    renderRenoApprovalsView();
  });
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

  var _natDisp  = (window.NATION_CONFIG && (NATION_CONFIG.display_name || NATION_CONFIG.name)) || '';
  var _natShort = (window.NATION_CONFIG && NATION_CONFIG.short) || '';
  var html='<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Reno Approvals — '+_natShort+'</title>'
    +'<style>'+_printThemeStyles()+'*{box-sizing:border-box;margin:0;padding:0;}@page{size:letter landscape;margin:12mm 14mm;}body{font-family:Arial,sans-serif;font-size:11px;color:var(--text);}</style>'
    +'</head><body>'
    +'<div style="background:var(--dark);padding:12px 18px;display:flex;align-items:center;justify-content:space-between;">'
      +(logoSrc?'<img src="'+logoSrc+'" style="height:34px;" alt="'+_natShort+'"/>':'<span style="color:var(--yellow);font-weight:700;font-size:14px;">'+_natShort+'</span>')
      +'<div style="text-align:center;">'
        +'<div style="font-size:8px;color:var(--yellow);font-weight:700;letter-spacing:.1em;text-transform:uppercase;">'+_natDisp+' — Housing</div>'
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
      +'<span>'+escapeHtml(buildNationFooterStrip())+'</span>'
      +'<span>Printed: '+today+'</span>'
    +'</div>'
    +'</body></html>';

  var w=window.open('','_blank','width=1100,height=780,toolbar=0,menubar=0');
  if(!w){showToast('Allow popups to export PDF');return;}
  w.document.open(); w.document.write(html); w.document.close();
  setTimeout(function(){w.focus();w.print();},400);
}


// ══════════════════════════════════════════════════════════════
// LOGIN — auth flow now lives in auth-login.js (loaded only by
// index.html). Other pages restore the session from sessionStorage
// via shared-auth.js; if that fails, _onLogout sends them back to
// index.html where the real sign-in screen lives.
// ══════════════════════════════════════════════════════════════

// On non-index pages an expired session should send the user back to the
// login page rather than try to reuse local sign-in markup that doesn't
// exist here.
function showLoginScreen() {
  try { window.location.href = 'index.html'; } catch(e) {}
}
function hidLoginScreen() { /* no-op on module pages — no login screen present */ }

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

    // Reconcile any drift between unit.assignedTo and app.assignedUnit so
    // older records pre-dating the saveUnitEdit status-flip fix surface
    // correctly on Match / Tenants / Inventory views.
    if(typeof reconcileAssignments === 'function') reconcileAssignments();

    // Settings
    var setR = await fetch(SUPABASE_URL+'/rest/v1/housing_settings?select=*',{headers:HOUSING_HEADERS});
    if(setR.ok){
      var setData=await setR.json();
      setData.forEach(function(row){ if(!window._appSettings) window._appSettings={}; window._appSettings[row.key]=row.value; });
    }
    // Apply saved brand theme (Settings → Admin → Themes)
    if (typeof _applyTheme === 'function') _applyTheme((window._appSettings||{}).theme || {});
    // Apply saved nation overrides (Settings → Nation) — display name, short, logo
    if (typeof applyNationOverrides === 'function') applyNationOverrides();
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
    // Apply saved nation overrides (Settings → Nation) — display name, short, logo
    if (typeof applyNationOverrides === 'function') applyNationOverrides();
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
    // Initialise module enable/license state from loaded settings
    if(typeof initModuleEnablement === 'function') initModuleEnablement();

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
    // Re-render worklist if its section is currently expanded on the landing.
    // (The standalone worklistView is gone — Phase B folded it into landingView.)
    var sec = document.getElementById('sec-worklist');
    if(sec && !sec.classList.contains('collapsed')) {
      if(typeof renderWorklist === 'function') renderWorklist();
    }
    if(typeof _renderWorklistCountPills === 'function') _renderWorklistCountPills();
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
  var isED = APPROVAL_AUTHORITY.can('manageAllStaffRoles', window.currentRole);
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
    + '&#128274; A login account is created automatically. Default password: <strong>' + (window.NATION_CONFIG && NATION_CONFIG.short || '') + ' + FirstName + 2026!</strong>'
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

  // Role-based add-staff gate. Only roles with manageAllStaffRoles can assign
  // anything other than HE-L1 / HE-L2. (HM is constrained to HE-L1/L2 by default.)
  if(!APPROVAL_AUTHORITY.can('manageAllStaffRoles', window.currentRole)){
    var allowedForLimited = ['housing_employee_l1','housing_employee_l2'];
    if(allowedForLimited.indexOf(role) === -1){
      showToast('Housing managers can only add Housing Employees. Only the ED can add other roles.');
      return;
    }
  }

  if(btn){ btn.disabled=true; btn.textContent='Adding…'; }

  try {
    // Check staff table without filtering on is_active so we can also flag
    // deactivated records (the renderHousingUserTable view hides them, but
    // the row still exists in the DB and would 409 on insert).
    var checkR = await fetch(SUPABASE_URL+'/rest/v1/staff?select=id,is_active&email=eq.'+encodeURIComponent(email),{headers:HOUSING_HEADERS});
    var existing = await checkR.json();
    if(existing && existing.length){
      var existRow = existing[0];
      var msg = existRow.is_active === false
        ? email + ' is a deactivated staff member. Use the Inactive tab → Reactivate.'
        : email + ' is already in the staff directory';
      showToast(msg);
      if(btn){btn.disabled=false;btn.textContent='+ Add to Staff Directory';}
      return;
    }

    var firstName = name.split(' ')[0];
    // Default password format includes the nation short code so it's recognizable
    // to staff but rotated per-nation when shipping to a new tenant.
    var defaultPassword = (window.NATION_CONFIG && NATION_CONFIG.short || 'CLFN')+firstName+'2026!';

    // Step 1: Create Supabase Auth account
    var signupR = await fetch(SUPABASE_URL+'/auth/v1/signup',{
      method:'POST', headers:HOUSING_HEADERS,
      body:JSON.stringify({email:email, password:defaultPassword, data:{full_name:name}})
    });
    var signupData = await signupR.json();
    var authCreated = signupR.ok && signupData.user && signupData.user.id;
    // Detect "already in auth" robustly. Supabase has used several wordings
    // here over time — "already registered", "already been registered",
    // "User already registered" — plus the newer structured `code` field
    // (e.g. user_already_exists). Match any of them so we can adopt the
    // orphan auth user instead of failing.
    var sdMsg = (signupData.msg || '') + ' ' + (signupData.error_description || '') + ' ' + (signupData.error || '');
    var alreadyInAuth = signupData.code === 'user_already_exists'
                     || /already.*registered/i.test(sdMsg)
                     || /already.*exists/i.test(sdMsg);
    var signupsDisabled = signupData.code === 'signup_disabled'
                       || /signups?\s+not\s+allowed/i.test(sdMsg)
                       || /signups?\s+disabled/i.test(sdMsg);

    if(!authCreated && !alreadyInAuth) {
      // Auth failed and not an "already exists" case. Surface what Supabase
      // actually said + targeted dashboard guidance when we recognise the
      // signups-disabled error specifically (the older copy here told the
      // admin to toggle "Confirm email" — that's a different setting and
      // doesn't address this error at all).
      var errMsg = signupData.msg || signupData.error_description || signupData.error || JSON.stringify(signupData);
      if(res){
        res.style.background='#fef2f2'; res.style.border='1px solid #fecaca'; res.style.color='#b91c1c';
        var html = '<strong>Could not create login account.</strong><br>'
          + '<span style="font-size:11px;">'+errMsg+'</span>';
        if(signupsDisabled){
          html += '<br><br>To fix: in the <strong>Supabase dashboard → Authentication → Sign In / Providers → Email</strong>, '
                + 'turn <strong>ON</strong> "<strong>Allow new users to sign up</strong>" and Save. Then try again.';
        }
        res.innerHTML = html;
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

    // Both succeeded. When we adopted an existing auth user (alreadyInAuth)
    // we don't know their current password, so suppress the default-password
    // hint and tell the admin to use Send Reset on the row instead.
    if(res){
      res.style.background='var(--success-bg)'; res.style.border='1px solid var(--success-border)'; res.style.color='var(--success)';
      var head = '<strong>&#10003; '+escapeHtml(name)+' added successfully!</strong><br>'
        + 'Email: <code style="background:var(--success-border);padding:2px 6px;border-radius:4px;">'+escapeHtml(email)+'</code><br>';
      if(alreadyInAuth) {
        res.innerHTML = head
          + '<span style="font-size:11px;opacity:.8;">A login account for this email already existed — it has been linked to the new staff record. Use <strong>Send Reset</strong> on their row to issue a fresh password.</span>';
      } else {
        res.innerHTML = head
          + 'Password: <code style="background:var(--success-border);padding:2px 6px;border-radius:4px;font-weight:700;">'+escapeHtml(defaultPassword)+'</code><br>'
          + '<span style="font-size:11px;opacity:.8;">Share these credentials directly. They can change their password after signing in.</span>';
      }
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












// reconcileAssignments — repairs assignment-side drift between housing_units
// and housing_applications. Run after both arrays are loaded. For every unit
// that has assignedTo set, ensure the matching application's assignedUnit /
// assignedAddress / status / assignedAt fields agree. Persists fixes back to
// Supabase so the drift is fixed permanently.
//
// Drift sources:
//   - Old saveUnitEdit (pre-2026-05-04) saved unit.assignedTo + application.assignedUnit
//     but did not flip application.status to 'assigned'. Tenants stuck in
//     ed_approved show up in the Match queue with an Assign button.
//   - In rare cases (failed network call), one side persisted and the other
//     didn't. Re-syncing is a safe no-op when both sides agree.
function reconcileAssignments(){
  if(typeof housingUnits === 'undefined' || typeof applications === 'undefined') return;
  if(!housingUnits.length || !applications.length) return;
  var fixed = 0;
  housingUnits.forEach(function(u){
    if(!u || u.archived) return;
    if(!u.assignedTo) return;
    var app = applications.find(function(a){ return a && a.id === u.assignedTo; });
    if(!app) return;
    var addr = ((u.num||'')+' '+(u.street||'')).trim();
    var changed = false;
    if(app.assignedUnit !== u.id){      app.assignedUnit    = u.id;  changed = true; }
    if(app.assignedAddress !== addr){    app.assignedAddress = addr;  changed = true; }
    if(app.status !== APP_STATUS.ASSIGNED){
      app.status   = APP_STATUS.ASSIGNED;
      app.assignedAt = app.assignedAt || (u.assignedDate || new Date().toISOString());
      changed = true;
    }
    if(changed){
      fixed++;
      if(typeof sbSaveApplication === 'function'){
        sbSaveApplication(app).catch(function(e){ console.warn('[reconcile] save app failed:', e); });
      }
    }
  });
  if(fixed){
    console.info('[CLFN] Reconciled assignment drift on '+fixed+' application(s).');
  }
}

async function loadHousingData() {
  try {
    var appsData = await sbLoadApplications();
    if(appsData) applications = appsData;
    var unitsData = await sbLoadUnits();
    if(unitsData) housingUnits = unitsData;
    if(typeof reconcileAssignments === 'function') reconcileAssignments();
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
    // Apply theme + nation-name overrides + required-field config now that
    // _appSettings is hydrated. Sub-pages (inventory / match / renos /
    // contractors / tenants) call loadHousingData on boot — without these
    // the shared header (rendered by renderAppHeader) keeps the build-time
    // default logo and "Constance Lake" placeholder strings instead of the
    // customer-saved values from Settings → Admin → Themes / Nation.
    // _applyTheme rewrites every img.hlogo src; applyBrandingToHeader (called
    // from inside applyNationOverrides) updates [data-nation*] text nodes.
    if (typeof _applyTheme === 'function')           _applyTheme((window._appSettings||{}).theme || {});
    if (typeof applyNationOverrides === 'function')  applyNationOverrides();
    if (typeof applyRequiredFields === 'function')   applyRequiredFields();
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
    e.style.display=APPROVAL_AUTHORITY.can('editApprovalAuthority', role)?'':'none';
  });
  // Step-progress numbering. HM/ED see steps 9 (Housing Needs) and 10
  // (Tenancy History) inserted between Pets (6) and Documents — so the
  // visible sequence becomes 1..10. Applicants skip 9/10 and the numbers
  // 7,8 (Documents, Review) stay as the HTML defaults.
  (function _renumberProgressBar(){
    var docNum  = document.getElementById('spb_num_6');
    var revNum  = document.getElementById('spb_num_7');
    if (!docNum || !revNum) return;
    if (ROLE.isManagement(role)) { docNum.textContent='9'; revNum.textContent='10'; }
    else                          { docNum.textContent='7'; revNum.textContent='8';  }
  })();

  // Update header
  if(true) updateHeaderUser(role);
  if(true) updateRoleSwitcherVisibility();
  // Re-render the header nav + role-vis pass now that the resolved role is in.
  // _onSwitchRole is suppressed during boot, so do it directly here.
  if(typeof renderHeaderNav      === 'function') renderHeaderNav();
  if(typeof applyRoleVisibility  === 'function') applyRoleVisibility(role);
  if(typeof _renderWorklistCountPills === 'function') _renderWorklistCountPills();

  // Navigate to requested view from URL param
  var params = new URLSearchParams(window.location.search);
  // ?openApp=APP_ID — cross-page handoff (e.g. from match.html applicant click)
  var openAppId = params.get('openApp');
  if(openAppId && typeof window.openEditModal === 'function'){
    window.openEditModal(openAppId);
    return;
  }
  // Landing is the default for housing.html — old worklistView + employeeHomeView
  // collapsed into landingView. Sub-pages still default to their own views.
  var defaultView = document.getElementById('landingView') ? 'home' : 'dashboard';
  var view = params.get('view') || defaultView;
  if(view==='home')             { if(typeof showLanding==='function') showLanding(); else if(typeof showEmployeeHome==='function') showEmployeeHome(); }
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
// LANDING PAGE WIRING (Stop B) — header nav, role-vis,
// quick lookup, sections, quick actions, deep-links
// ══════════════════════════════════════════════════════
// CLFN brand logo — base64 data URL. Single source of truth shared by
// renderAppHeader() across every page. Per-nation overrides will eventually
// come from NATION_CONFIG.logo (Phase A multi-nation work).
var CLFN_LOGO_DATA_URL = "data:image/png;base64,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";

// renderAppHeader — builds the .app-header-v2 markup into #app_header_host.
// Centralized so every page (housing.html + sub-pages) renders the identical
// header. No-op if the placeholder isn't present (the page still has its own
// markup, e.g. sign-in, or hasn't been migrated yet).
//
// Stop C migrates inventory/renos/contractors/tenants/match.html to use this.
function renderAppHeader(){
  var host = document.getElementById('app_header_host');
  if(!host) return;
  if(host.getAttribute('data-rendered') === '1') return; // idempotent
  host.outerHTML = ''
    + '<header class="app-header app-header-v2">'
    +   '<div class="hbrand" id="app_hbrand" title="Return to Home">'
    +     '<img src="'+CLFN_LOGO_DATA_URL+'" alt="CLFN" class="hlogo hlogo-v2"/>'
    +     '<div>'
    +       '<strong class="hbrand-title">CLFN Housing</strong>'
    +       '<span class="hbrand-sub" data-nation="display_name">Constance Lake First Nation</span>'
    +     '</div>'
    +   '</div>'
    +   '<button class="nav-toggle" id="nav_toggle" aria-label="Toggle navigation">'
    +     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>'
    +   '</button>'
    +   '<nav class="app-nav" id="app_nav"></nav>'
    +   '<div class="header-actions">'
    +     '<div class="export-wrap" id="header_export_wrap_v2" style="display:none;">'
    +       '<button id="header_export_btn_v2" class="btn-export-v2" type="button">'
    +         '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
    +         '<span>Export</span>'
    +         '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>'
    +       '</button>'
    +       '<div class="export-menu-v2" id="header_export_menu_v2" role="menu">'
    +         '<button class="export-menu-item-v2" data-export="csv"><span>CSV</span></button>'
    +         '<button class="export-menu-item-v2" data-export="excel"><span>Excel (.xlsx)</span></button>'
    +         '<button class="export-menu-item-v2" data-export="pdf"><span>PDF</span></button>'
    +       '</div>'
    +     '</div>'
    +     '<button id="header_settings_btn" class="header-settings" data-roles="ed,housing_manager">'
    +       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
    +       '<span>Settings</span>'
    +     '</button>'
    +     '<div class="create-wrap">'
    +       '<button class="btn-create" id="header_create_btn" type="button">'
    +         '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>'
    +         '<span class="btn-create-label">Create</span>'
    +         '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>'
    +       '</button>'
    +       '<div class="create-menu" id="create_menu" role="menu">'
    +         '<button class="create-menu-item" data-create="application"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg> New Application <span class="role-gate">All</span></button>'
    +         '<button class="create-menu-item" data-create="unit" data-roles="ed,housing_manager"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/></svg> New Unit <span class="role-gate">ED &middot; HM</span></button>'
    +         '<button class="create-menu-item" data-create="contractor" data-roles="ed,housing_manager"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> New Contractor <span class="role-gate">ED &middot; HM</span></button>'
    +         '<button class="create-menu-item" data-create="tenant" data-roles="ed,housing_manager,housing_employee_l2"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg> New Tenant <span class="role-gate">ED &middot; HM &middot; L2</span></button>'
    +       '</div>'
    +     '</div>'
    +     '<div class="avatar-wrap" id="header_user_pill" title="Account">'
    +       '<div id="header_avatar" class="header-avatar">&mdash;</div>'
    +       '<span id="header_role_badge" class="avatar-role-pill">&mdash;</span>'
    +       '<span id="header_user_name" class="visually-hidden"></span>'
    +     '</div>'
    +   '</div>'
    + '</header>';
  // Mark home click — bounce to housing.html on sub-pages, in-page showLanding on housing.html
  var hb = document.getElementById('app_hbrand');
  if(hb){
    hb.addEventListener('click', function(){
      if(typeof showLanding === 'function' && document.getElementById('landingView')) showLanding();
      else window.location.href = 'housing.html';
    });
  }
  // Apply nation branding now that markup exists.
  if(typeof applyBrandingToHeader === 'function') applyBrandingToHeader();
}

// HEADER_NAV — single source of truth for the primary nav strip.
// Each entry: { key, label, svg, run, module?, drawerOnly? }
//   key        — data-nav attribute (matches landingView active marking)
//   module     — optional CLFN_MODULES key; tab is omitted if not enabled
//   drawerOnly — only shown inside the hamburger drawer (≤1200px)
//   run        — function called on click (returns nothing)
window.HEADER_NAV = [
  { key:'home',         label:'Home',         module:null,           svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/></svg>',                                                                                                                                                                                                                run:function(){ if(typeof showLanding==='function') showLanding(); else if(typeof showEmployeeHome==='function') showEmployeeHome(); } },
  { key:'applications', label:'Applications', module:'applications', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/></svg>',                                                                                                                                                                                                run:function(){ if(typeof showDashboard==='function') showDashboard(); } },
  { key:'inventory',    label:'Inventory',    module:'inventory',    svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>',                                                                                                                                            run:function(){ if(typeof showInventory==='function') showInventory(); } },
  { key:'match',        label:'Match',        module:'match',        svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',                                                                                                                       run:function(){ if(typeof showMatch==='function') showMatch(); } },
  { key:'renovations',  label:'Renovations',  module:'renovations',  svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',                                                                                              run:function(){ if(typeof showRenos==='function') showRenos(); } },
  { key:'contractors',  label:'Contractors',  module:'contractors',  svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',                                                                                                                                                                                  run:function(){ if(typeof showContractorsForRole==='function') showContractorsForRole(); else if(typeof showContractors==='function') showContractors(); } },
  { key:'tenants',      label:'Tenants',      module:'tenants',      svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',                                                                                                       run:function(){ if(typeof showTenants==='function') showTenants(); } },
  { key:'settings',     label:'Settings',     module:null,           drawerOnly:true, roles:'ed,housing_manager', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>', run:function(){ if(typeof showSettings==='function') showSettings(); } }
];

// renderHeaderNav — rebuilds #app_nav from HEADER_NAV. Skips items whose
// module is disabled. data-roles is only honoured for drawer-only items
// here; in-strip items use module gating + applyRoleVisibility().
function renderHeaderNav(){
  var nav = document.getElementById('app_nav');
  if(!nav) return;
  var html = '';
  var hadDivider = false;
  HEADER_NAV.forEach(function(item){
    if(item.module && window.CLFN_MODULES && !CLFN_MODULES.isEnabled(item.module)) return;
    if(item.drawerOnly && !hadDivider){
      html += '<div class="nav-divider"></div>';
      hadDivider = true;
    }
    var cls = 'app-nav-item' + (item.drawerOnly ? ' in-drawer-only' : '');
    var roles = item.roles ? ' data-roles="'+item.roles+'"' : '';
    html += '<button class="'+cls+'" data-nav="'+item.key+'"'+roles+'>'+item.svg+' '+item.label+'</button>';
  });
  nav.innerHTML = html;
  setHeaderNavActive(_currentNavKey());
}

// _currentNavKey — best-effort detection of which nav tab should be active
// based on currently visible view. Used after a re-render or role switch.
function _currentNavKey(){
  function vis(id){ var e=document.getElementById(id); return e && e.style.display !== 'none' && e.style.display !== ''; }
  if(vis('landingView'))      return 'home';
  if(vis('dashView'))         return 'applications';
  if(vis('worklistView'))     return 'worklist';
  if(vis('inventoryView'))    return 'inventory';
  if(vis('matchView'))        return 'match';
  if(vis('renosView'))        return 'renovations';
  if(vis('contractorsView'))  return 'contractors';
  if(vis('tenantsView'))      return 'tenants';
  if(vis('settingsView'))     return 'settings';
  return 'home';
}

function setHeaderNavActive(key){
  var all = document.querySelectorAll('.app-header-v2 .app-nav-item');
  for(var i=0;i<all.length;i++){
    var btn = all[i];
    if(btn.getAttribute('data-nav') === key) btn.classList.add('active');
    else btn.classList.remove('active');
  }
}

// applyRoleVisibility — show/hide every [data-roles] element based on the
// current effective role. Empty/missing data-roles means "visible to all".
function applyRoleVisibility(role){
  role = role || window.currentRole || 'housing_employee_l1';
  var els = document.querySelectorAll('[data-roles]');
  for(var i=0;i<els.length;i++){
    var el = els[i];
    var allowed = (el.getAttribute('data-roles')||'').split(',').map(function(s){return s.trim();}).filter(Boolean);
    if(allowed.length && allowed.indexOf(role) === -1) el.style.display = 'none';
    else el.style.display = '';
  }
}

// _debounce — minimal debouncer for the lookup input.
function _debounce(fn, ms){
  var t=null;
  return function(){
    var args=arguments, ctx=this;
    if(t) clearTimeout(t);
    t = setTimeout(function(){ fn.apply(ctx,args); }, ms);
  };
}

// ── Quick Lookup ─────────────────────────────────────────────────────────
// Lookup state lives on window so the tab filter and recently-viewed list
// can read it without re-querying.
window._lookupState = window._lookupState || { tab:'all', q:'', results:{tenants:[],units:[],sows:[]} };
var LOOKUP_RECENT_KEY = 'clfn_landing_recent_lookups';

function _lookupReadRecent(){
  try { return JSON.parse(localStorage.getItem(LOOKUP_RECENT_KEY) || '[]'); } catch(e){ return []; }
}
// Defensive: an earlier version of the chip design saved labels with a
// leading single-letter type prefix ("T John Smith", "U 12 Maple St").
// Strip it on both save and render so cached entries clean themselves up
// the next time the recent list is touched. Regex requires a single
// uppercase T/U/S followed by whitespace — safe against real names like
// "Tom Smith" or "Sara Lee".
function _lookupStripTypePrefix(s){
  var str = String(s == null ? '' : s);
  var stripped = str.replace(/^[TUS]\s+/, '');
  if (stripped !== str && typeof console !== 'undefined') {
    console.warn('[lookup recent] stripped legacy type prefix:', JSON.stringify(str));
  }
  return stripped;
}
function _lookupPushRecent(entry){
  if(!entry || !entry.id) return;
  // Sanitize before persisting so further saves can't carry the bad prefix.
  if(entry.label) entry.label = _lookupStripTypePrefix(entry.label);
  var list = _lookupReadRecent().filter(function(r){ return !(r.id===entry.id && r.kind===entry.kind); });
  list.unshift(entry);
  if(list.length > 8) list.length = 8;
  try { localStorage.setItem(LOOKUP_RECENT_KEY, JSON.stringify(list)); } catch(e){}
  _renderLookupRecent();
}
function _renderLookupRecent(){
  var host = document.getElementById('lookup_recent');
  if(!host) return;
  var list = _lookupReadRecent();
  if(!list.length){ host.innerHTML = ''; return; } // CSS :empty pseudo handles the empty-state copy
  // Type info is preserved on the data attribute for the click handler — the
  // visible chip just shows the name. The kind class lets CSS tint the chip
  // border/background subtly per type without dropping a letter on the user.
  host.innerHTML = list.map(function(r){
    var lbl = _lookupStripTypePrefix(r.label || r.id);
    return '<button type="button" class="lookup-chip lookup-chip--'+_esc(r.kind)+'" data-recent-kind="'+_esc(r.kind)+'" data-recent-id="'+_esc(r.id)+'">'
        + _esc(lbl) + '</button>';
  }).join('');
}

function _runLookup(q){
  q = (q||'').trim();
  window._lookupState.q = q;
  var results = { tenants:[], units:[], sows:[] };
  if(q.length >= 1){
    if(typeof sbLookupTenants === 'function') results.tenants = sbLookupTenants(q) || [];
    if(typeof sbLookupUnits   === 'function') results.units   = sbLookupUnits(q)   || [];
    if(typeof sbLookupSOWs    === 'function') results.sows    = sbLookupSOWs(q)    || [];
  }
  window._lookupState.results = results;
  _renderLookupCounts();
  _renderLookupResults();
}

function _renderLookupCounts(){
  var r = window._lookupState.results || {tenants:[],units:[],sows:[]};
  var total = r.tenants.length + r.units.length + r.sows.length;
  function set(id,n){ var el=document.getElementById(id); if(el) el.textContent = n; }
  set('lookup_tab_count_all',     total);
  set('lookup_tab_count_tenants', r.tenants.length);
  set('lookup_tab_count_units',   r.units.length);
  set('lookup_tab_count_sows',    r.sows.length);
}

function _renderLookupResults(){
  var host = document.getElementById('lookup_results');
  if(!host) return;
  var st = window._lookupState;
  if(!st.q){ host.classList.remove('open'); host.innerHTML=''; return; }
  var r = st.results || {tenants:[],units:[],sows:[]};
  var rows = [];
  if(st.tab==='all' || st.tab==='tenants') r.tenants.forEach(function(x){ rows.push(_lookupRow('tenant', x)); });
  if(st.tab==='all' || st.tab==='units')   r.units  .forEach(function(x){ rows.push(_lookupRow('unit',   x)); });
  if(st.tab==='all' || st.tab==='sows')    r.sows   .forEach(function(x){ rows.push(_lookupRow('sow',    x)); });
  host.classList.add('open');
  host.innerHTML = rows.length
    ? rows.join('')
    : '<div class="lookup-empty">No matches for &ldquo;'+_esc(st.q)+'&rdquo;</div>';
}

function _lookupRow(kind, x){
  var label = _esc(x.label || x.id || '');
  var meta  = _esc(x.meta  || '');
  var initial = kind === 'tenant' ? 'T' : (kind === 'unit' ? 'U' : 'S');
  return '<div class="lookup-result" data-lookup-kind="'+kind+'" data-lookup-id="'+_esc(x.id||'')+'">'
       + '<span class="lookup-result-icon type-'+kind+'">'+initial+'</span>'
       + '<span class="lookup-result-main">'
       +   '<div class="lookup-result-title">'+label+'</div>'
       +   (meta ? '<div class="lookup-result-sub">'+meta+'</div>' : '')
       + '</span>'
       + '<span class="lookup-result-badge badge-'+kind+'">'+kind+'</span>'
       + '</div>';
}
function _esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

function _lookupOpen(kind, id, label){
  if(!id) return;
  _lookupPushRecent({ kind:kind, id:id, label:label });
  if(kind==='tenant'){
    // Tenant lookup → open the Tenant Information Card. The TIC keys off a
    // unit id (it resolves the tenant via housing_units.assigned_name) or a
    // tenant UUID. Our lookup gives us an application id, so map it to the
    // assigned unit first. If the applicant has no unit yet, fall back to the
    // application form — the TIC has no record to show until they're housed.
    var apps = (typeof applications !== 'undefined') ? applications : [];
    var app  = null;
    for(var i=0;i<apps.length;i++){ if(apps[i] && apps[i].id === id){ app = apps[i]; break; } }
    var unitId = app && app.assignedUnit;
    if(unitId){
      if(typeof window.openTenantCard === 'function' && document.getElementById('ticModal')){
        window.openTenantCard(unitId);
      } else {
        window.location.href = 'tenants.html?tic=' + encodeURIComponent(unitId);
      }
    } else {
      // No unit assigned yet — open the application instead.
      if(typeof window.openEditModal === 'function') window.openEditModal(id);
      else window.location.href = 'housing.html?openApp=' + encodeURIComponent(id);
    }
  } else if(kind==='unit'){
    window.location.href = 'inventory.html?unit=' + encodeURIComponent(id);
  } else if(kind==='sow'){
    window.location.href = 'renos.html?sow=' + encodeURIComponent(id);
  }
}

// ── Section toggles (Worklist / Recent activity) ────────────────────────
function _sectionStorageKey(id){ return 'clfn_landing_sec_' + id + '_collapsed'; }
function _sectionSyncAria(sec){
  if(!sec) return;
  var hdr = sec.querySelector('[data-section-toggle]');
  if(hdr) hdr.setAttribute('aria-expanded', sec.classList.contains('collapsed') ? 'false' : 'true');
}
function _sectionApplyState(id){
  var sec = document.getElementById(id);
  if(!sec) return;
  var stored = null;
  try { stored = localStorage.getItem(_sectionStorageKey(id)); } catch(e){}
  var collapsed = (stored === null) ? sec.classList.contains('collapsed') : (stored === '1');
  sec.classList.toggle('collapsed', collapsed);
  _sectionSyncAria(sec);
  if(!collapsed) _sectionOnExpand(id);
}
function _sectionToggle(id){
  var sec = document.getElementById(id);
  if(!sec) return;
  var nowCollapsed = !sec.classList.contains('collapsed');
  sec.classList.toggle('collapsed', nowCollapsed);
  _sectionSyncAria(sec);
  try { localStorage.setItem(_sectionStorageKey(id), nowCollapsed ? '1' : '0'); } catch(e){}
  if(!nowCollapsed) _sectionOnExpand(id);
}
function _sectionOnExpand(id){
  if(id === 'sec-worklist'){
    if(typeof renderWorklist === 'function') renderWorklist();
    _renderWorklistCountPills();
  } else if(id === 'sec-recent'){
    // Use the role-aware version in housing-views.js — it pulls from Supabase
    // when the in-memory auditLog is empty, applies role-scoped filtering,
    // and renders icons. (The local _renderRecentActivity stub was a no-data
    // shim and has been removed.)
    var _role = window._viewAsRole || window.currentRole || 'housing_employee_l1';
    if(typeof renderRecentActivity === 'function') renderRecentActivity(_role);
  }
}
function _renderWorklistCountPills(){
  var apps  = (typeof applications !== 'undefined' && applications) ? applications : [];
  var STATUS = (typeof APP_STATUS !== 'undefined') ? APP_STATUS : { SUBMITTED:'submitted', MGR_APPROVED:'mgr_approved', FILE_UPDATE:'file_update', ED_APPROVED:'ed_approved' };
  var role = window.currentRole || 'housing_employee_l1';
  var email = (typeof HOUSING_SESSION !== 'undefined' && HOUSING_SESSION) ? HOUSING_SESSION.email : '';
  // Use the shared role-scoped queue so the pill, the View-all label, and
  // renderWorklist all agree on what "awaiting your approval" means.
  var queue = (typeof getWorkQueueForRole === 'function') ? getWorkQueueForRole(role, email) : [];
  var pending = queue.length;
  var p = document.getElementById('worklist_count_pill'); if(p) p.textContent = pending;
  var qa = document.getElementById('qa_pending_count');   if(qa) qa.textContent = pending;
  // "Ready to match" KPI — applicants approved with no unit yet.
  var ready = apps.filter(function(a){
    return a && !a.archived && (a.status===STATUS.ED_APPROVED || a.status===STATUS.MGR_APPROVED) && !a.assignedUnit;
  }).length;
  var qr = document.getElementById('qa_ready_count'); if(qr) qr.textContent = ready;
}
// ── Quick Action handlers ────────────────────────────────────────────────
function _runQuickAction(action){
  if(action === 'new-app'){
    if(typeof newApp === 'function') newApp();
  } else if(action === 'approve-queue'){
    if(typeof showWorklist === 'function') showWorklist();
  } else if(action === 'run-match'){
    if(typeof showMatch === 'function') showMatch();
  } else if(action === 'rent-payment'){
    showToast('Coming soon — Finance module.');
  }
}

// ── Create menu handlers ─────────────────────────────────────────────────
function _runCreateAction(action){
  _closeCreateMenu();
  // Element-based check (not `typeof X === 'function'`): the modal-opening
  // helpers are loaded on every page via shared-data.js, but the modal
  // *markup* lives only on its home page. Probing for the modal DOM tells us
  // whether we can open in-place or need to navigate.
  if(action === 'application'){
    if(document.getElementById('appLayout') && typeof newApp === 'function') newApp();
    else window.location.href = 'housing.html?view=newapp';
  } else if(action === 'unit'){
    if(document.getElementById('addUnitModal') && typeof openAddUnitModal === 'function') openAddUnitModal();
    else window.location.href = 'inventory.html?action=newUnit';
  } else if(action === 'contractor'){
    if(document.getElementById('addContractorModal') && typeof openAddContractorModal === 'function') openAddContractorModal();
    else window.location.href = 'contractors.html?action=newContractor';
  } else if(action === 'tenant'){
    if(document.getElementById('addTenantModal') && typeof openAddTenantModal === 'function') openAddTenantModal();
    else window.location.href = 'tenants.html?action=newTenant';
  }
}
function _toggleCreateMenu(){
  var m = document.getElementById('create_menu');
  if(!m) return;
  m.classList.toggle('open');
}
function _closeCreateMenu(){
  var m = document.getElementById('create_menu');
  if(m) m.classList.remove('open');
}
function _toggleNavDrawer(){
  var n = document.getElementById('app_nav');
  if(n) n.classList.toggle('open');
}
function _closeNavDrawer(){
  var n = document.getElementById('app_nav');
  if(n) n.classList.remove('open');
}

// ── Avatar popover (sign out / view-as) ─────────────────────────────────
function _toggleAvatarPopover(){
  var existing = document.getElementById('header_avatar_pop');
  if(existing){ existing.remove(); return; }
  var anchor = document.getElementById('header_user_pill');
  if(!anchor) return;
  var role = window.currentRole || 'housing_employee_l1';
  var realRole = window._realRole || role;
  var name = (typeof HOUSING_SESSION !== 'undefined' && HOUSING_SESSION.name) ? HOUSING_SESSION.name : 'Staff';
  var label = (window.CLFN_PERMS && CLFN_PERMS.roleLabel) ? CLFN_PERMS.roleLabel(role) : role;
  var pop = document.createElement('div');
  pop.id = 'header_avatar_pop';
  pop.className = 'header-avatar-pop';
  // ED gets view-as switcher; everyone gets sign out
  var viewAs = '';
  if(window.CLFN_PERMS && realRole === 'ed'){
    var opts = CLFN_PERMS.getViewAsOptions('ed') || [];
    if(opts.length){
      viewAs = '<div class="hap-section"><div class="hap-section-label">View as</div>'
             + '<select id="hap_view_as">'
             + '<option value="">My role (ED)</option>'
             + opts.map(function(k){ return '<option value="'+k+'"'+(k===role?' selected':'')+'>'+CLFN_PERMS.roleLabel(k)+'</option>'; }).join('')
             + '</select></div>';
    }
  }
  pop.innerHTML = '<div class="hap-head"><div class="hap-name">'+_esc(name)+'</div><div class="hap-role">'+_esc(label)+'</div></div>'
                + viewAs
                + '<button type="button" class="hap-action" data-hap="signout">Sign out</button>';
  document.body.appendChild(pop);
  var rect = anchor.getBoundingClientRect();
  pop.style.position = 'fixed';
  pop.style.top = (rect.bottom + 8) + 'px';
  pop.style.right = (window.innerWidth - rect.right) + 'px';
}
function _closeAvatarPopover(){
  var p = document.getElementById('header_avatar_pop');
  if(p) p.remove();
}

// ── Delegated event listener ─────────────────────────────────────────────
// One listener on document handles every header / landing interaction.
// Header bits run on any page that has .app-header-v2; landing bits
// (lookup, sections, recent activity) only run on housing.html.
document.addEventListener('DOMContentLoaded', function(){
  // First, render the shared header into #app_header_host if the page uses it.
  // No-op on pages that still ship their own static header markup.
  if(typeof renderAppHeader === 'function') renderAppHeader();

  var hasHeader  = !!document.querySelector('.app-header-v2');
  var hasLanding = !!document.getElementById('landingView');
  if(!hasHeader && !hasLanding) return;

  // Initial render of the dynamic nav + visibility pass (header pages only).
  if(hasHeader){
    if(typeof renderHeaderNav === 'function') renderHeaderNav();
    if(typeof applyRoleVisibility === 'function') applyRoleVisibility(window.currentRole);
  }

  // Landing-only state hydrate.
  if(hasLanding){
    _sectionApplyState('sec-worklist');
    _sectionApplyState('sec-recent');
    _renderLookupRecent();
    _renderWorklistCountPills();

    var lookupInput = document.getElementById('lookup_input');
    if(lookupInput){
      var debounced = _debounce(function(e){ _runLookup(e.target.value); }, 200);
      lookupInput.addEventListener('input', debounced);
      lookupInput.addEventListener('focus', function(){ if(lookupInput.value) _renderLookupResults(); });
    }
  }

  // One delegated click handler for everything else.
  document.addEventListener('click', function(e){
    var t = e.target;
    if(!t || !t.closest) return;

    // Hamburger
    if(t.closest('#nav_toggle')){ e.preventDefault(); _toggleNavDrawer(); return; }

    // Nav item click
    var navBtn = t.closest('.app-header-v2 .app-nav-item[data-nav]');
    if(navBtn){
      e.preventDefault();
      var key = navBtn.getAttribute('data-nav');
      var item = HEADER_NAV.filter(function(x){ return x.key===key; })[0];
      _closeNavDrawer();
      if(item && typeof item.run === 'function') item.run();
      setHeaderNavActive(key);
      return;
    }

    // Header settings button (right-side)
    if(t.closest('#header_settings_btn')){ e.preventDefault(); if(typeof showSettings==='function') showSettings(); setHeaderNavActive('settings'); return; }

    // Export button (header-v2)
    if(t.closest('#header_export_btn_v2')){
      e.preventDefault();
      var menu = document.getElementById('header_export_menu_v2');
      if(menu) menu.classList.toggle('open');
      return;
    }
    var expItem = t.closest('.export-menu-item-v2[data-export]');
    if(expItem){
      e.preventDefault();
      var fmt = expItem.getAttribute('data-export');
      var menu2 = document.getElementById('header_export_menu_v2');
      if(menu2) menu2.classList.remove('open');
      if(typeof headerExport === 'function') headerExport(fmt);
      return;
    }

    // Create menu open/close
    if(t.closest('#header_create_btn')){ e.preventDefault(); _toggleCreateMenu(); return; }
    var createItem = t.closest('.create-menu-item[data-create]');
    if(createItem){ e.preventDefault(); _runCreateAction(createItem.getAttribute('data-create')); return; }

    // Worklist view-all — must be checked before the section-toggle catch-all
    // since the link sits inside the section header [data-section-toggle].
    if(t.closest('#worklist_view_all')){ e.preventDefault(); if(typeof showDashboard==='function') showDashboard(); return; }

    // Section toggles — only when clicking the toggle row itself, not a child
    // button/link inside it that has its own behaviour (e.g. wlOpenApp on a row,
    // wlSetChip on a chip, the search input, etc.).
    var secHdr = t.closest('[data-section-toggle]');
    if(secHdr){
      // If the click landed on an interactive child (button/a/input/select),
      // don't hijack it — let the inline handler run.
      var interactive = t.closest('button, a, input, select, textarea, [data-wl-id], [data-wl-edit], [data-wlchip]');
      if(!interactive || !secHdr.contains(interactive)){
        e.preventDefault(); _sectionToggle(secHdr.getAttribute('data-section-toggle')); return;
      }
    }

    // Quick actions
    var qa = t.closest('.qa-btn[data-qa]');
    if(qa){ if(qa.disabled) return; e.preventDefault(); _runQuickAction(qa.getAttribute('data-qa')); return; }

    // Lookup tab
    var ltab = t.closest('.lookup-tab[data-lookup-tab]');
    if(ltab){
      e.preventDefault();
      var tab = ltab.getAttribute('data-lookup-tab');
      window._lookupState.tab = tab;
      var allTabs = document.querySelectorAll('.lookup-tab');
      for(var i=0;i<allTabs.length;i++) allTabs[i].classList.toggle('active', allTabs[i] === ltab);
      _renderLookupResults();
      return;
    }

    // Lookup result row
    var lrow = t.closest('.lookup-result[data-lookup-kind]');
    if(lrow){
      e.preventDefault();
      var kind = lrow.getAttribute('data-lookup-kind');
      var id   = lrow.getAttribute('data-lookup-id');
      var titleEl = lrow.querySelector('.lookup-result-title');
      var label = (titleEl && titleEl.textContent.trim()) || id;
      _lookupOpen(kind, id, label);
      return;
    }

    // Recently-viewed chip
    var chip = t.closest('[data-recent-kind][data-recent-id]');
    if(chip){
      e.preventDefault();
      _lookupOpen(chip.getAttribute('data-recent-kind'), chip.getAttribute('data-recent-id'), (chip.textContent||'').trim());
      return;
    }

    // (Worklist view-all handled earlier — before the section-toggle catch-all.)

    // Recent-activity row → open application
    var rapp = t.closest('[data-recent-app]');
    if(rapp){ e.preventDefault(); if(typeof window.openEditModal==='function') window.openEditModal(rapp.getAttribute('data-recent-app')); return; }

    // Avatar popover
    if(t.closest('#header_user_pill')){ e.preventDefault(); _toggleAvatarPopover(); return; }
    var hap = t.closest('[data-hap]');
    if(hap){
      e.preventDefault();
      if(hap.getAttribute('data-hap')==='signout'){ _closeAvatarPopover(); if(typeof headerSignOut==='function') headerSignOut(); else if(typeof doLogout==='function') doLogout(); }
      return;
    }

    // Outside-click closers (run last)
    if(!t.closest('#create_menu') && !t.closest('#header_create_btn')) _closeCreateMenu();
    if(!t.closest('#header_export_menu_v2') && !t.closest('#header_export_btn_v2')){
      var em = document.getElementById('header_export_menu_v2');
      if(em) em.classList.remove('open');
    }
    if(!t.closest('#header_avatar_pop') && !t.closest('#header_user_pill')) _closeAvatarPopover();
    if(!t.closest('#lookup_input') && !t.closest('#lookup_results')){
      var lr = document.getElementById('lookup_results');
      if(lr){ lr.classList.remove('open'); }
    }
  });

  // ED view-as (delegated change event)
  document.addEventListener('change', function(e){
    if(e.target && e.target.id === 'hap_view_as'){
      var newRole = e.target.value || (window._realRole || 'ed');
      window._viewAsRole = e.target.value || null;
      if(typeof switchRole === 'function') switchRole(newRole);
      _closeAvatarPopover();
      // Belt-and-suspenders: directly retally and re-render the worklist in
      // case any earlier _onSwitchRole hook short-circuited (prev() may bail
      // before our wrap runs in some edge cases). Idempotent when already done.
      window._wlActiveChip = 'mine';
      if(typeof _renderWorklistCountPills === 'function') _renderWorklistCountPills();
      var sec = document.getElementById('sec-worklist');
      if(sec && !sec.classList.contains('collapsed') && typeof renderWorklist === 'function'){
        renderWorklist();
      }
    }
  });
});

// Refresh dynamic header bits whenever role changes (boot or view-as).
(function(){
  var prev = window._onSwitchRole;
  window._onSwitchRole = function(role){
    try { if(typeof prev === 'function') prev(role); } catch(_){}
    if(typeof renderHeaderNav === 'function') renderHeaderNav();
    if(typeof applyRoleVisibility === 'function') applyRoleVisibility(role);
    // Reset the worklist chip selection so the new role lands on their own
    // queue (otherwise an HM user view-as ED keeps showing HM's chip choice).
    window._wlActiveChip = 'mine';
    _renderWorklistCountPills();
    // Re-render the worklist body if the section is currently expanded.
    var sec = document.getElementById('sec-worklist');
    if(sec && !sec.classList.contains('collapsed') && typeof renderWorklist === 'function'){
      renderWorklist();
    }
  };
})();

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
  // Accept both `/housing.html` (Azure Static Web Apps) and `/housing` (static
  // servers like `npx serve` that strip the .html extension via clean URLs).
  var isHousingHome =
    path.endsWith('/housing.html') ||
    path === '/housing.html' ||
    path.endsWith('/housing') ||
    path === '/housing' ||
    path.endsWith('/') ||
    path === '';
  if (!isHousingHome) {
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
