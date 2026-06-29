/* ============================================================
 * commercial-app.js — CLFN Housing Suite (Phase CM2)
 * Simple, NON-SCORED application for a business or department to
 * request a commercial / admin / band building. Self-contained,
 * self-injecting modal (mirrors the reno-questionnaire / TIC pattern).
 *
 * Stored in the existing housing_applications table: app_type='commercial',
 * all fields in the data jsonb (sbSaveApplication writes data: app). Not
 * scored, not on the residential Match. Admin reviews and approves/declines.
 *
 * Globals: openCommercialApp(idOrNull), submitCommercialApp(),
 *          commercialAppDecision('approve'|'decline')
 * ============================================================ */
'use strict';

var _caEditId = null;      // id when reviewing/editing an existing commercial app

var _CA_SPACE_TYPES = [
  ['office',    'Office'],
  ['retail',    'Retail / Storefront'],
  ['storage',   'Storage / Warehouse'],
  ['community', 'Community / Program Space'],
  ['other',     'Other']
];

function _caEsc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

function _caIsMgmt(){
  var r = window.currentRole || '';
  if (window.ROLE && typeof ROLE.isManagement === 'function') return ROLE.isManagement(r);
  return ['ed','housing_manager','housing_employee_l2','super_user'].indexOf(r) !== -1;
}

// Vacant commercial/admin/band buildings, for the "preferred building" picker.
function _caCommercialUnits(){
  var src = (typeof housingUnits !== 'undefined' && housingUnits.length) ? housingUnits : (window.HOUSING_UNITS_DATA || []);
  var sec = (window._SECONDARY_TYPES) || ['commercial_building','admin_building','band_building'];
  return src.filter(function(u){ return u && !u.archived && sec.indexOf(u.type) !== -1; });
}

function _caEnsureModal(){
  if (document.getElementById('commercialAppModal')) return;
  if (!document.body) return;
  var wrap = document.createElement('div');
  wrap.id = 'commercialAppModal';
  wrap.className = 'modal-overlay modal-z-1100';
  wrap.style.cssText = 'display:none;align-items:center;justify-content:center;padding:16px;';
  wrap.innerHTML =
      '<div style="background:var(--surface);border-radius:14px;width:100%;max-width:640px;max-height:94vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,0.4);overflow:hidden;">'
    +   '<div class="modal-hdr spacious">'
    +     '<div><div class="lbl-uppercase-sm">Commercial Tenancy</div>'
    +       '<div class="panel-title" id="ca_title">Business / Department Application</div></div>'
    +     '<button type="button" onclick="closeCommercialApp()" class="btn-close-sm">&times;</button>'
    +   '</div>'
    +   '<div style="overflow-y:auto;padding:18px 22px;flex:1;" id="ca_body"></div>'
    +   '<div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px;flex-shrink:0;" id="ca_footer"></div>'
    + '</div>';
  document.body.appendChild(wrap);
  wrap.addEventListener('click', function(e){ if (e.target === wrap) closeCommercialApp(); });
}

function _caField(label, inner, req){
  return '<div class="tic-field" style="margin-bottom:12px;"><label class="tic-field-lbl">' + label
       + (req ? ' <span style="color:var(--danger);">*</span>' : '') + '</label>' + inner + '</div>';
}
function _caInput(id, val, ph, type){
  return '<input id="' + id + '" type="' + (type||'text') + '" value="' + _caEsc(val||'') + '" placeholder="' + _caEsc(ph||'') + '"'
       + ' style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;font-family:DM Sans,sans-serif;background:var(--surface);color:var(--text);"/>';
}
function _caTextarea(id, val, ph){
  return '<textarea id="' + id + '" rows="2" placeholder="' + _caEsc(ph||'') + '"'
       + ' style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;font-family:DM Sans,sans-serif;background:var(--surface);color:var(--text);resize:vertical;">' + _caEsc(val||'') + '</textarea>';
}

function _caRenderBody(app){
  app = app || {};
  var kind = app.kind || 'business';
  var spaceOpts = _CA_SPACE_TYPES.map(function(o){
    return '<option value="' + o[0] + '"' + (app.spaceType === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
  }).join('');
  var unitOpts = '<option value="">— No preference —</option>' + _caCommercialUnits().map(function(u){
    var addr = ((u.num||'') + ' ' + (u.street||'')).trim() || u.id;
    return '<option value="' + _caEsc(u.id) + '"' + (app.preferredUnit === u.id ? ' selected' : '') + '>'
         + _caEsc(addr) + (u.status && u.status !== 'vacant' ? ' (' + _caEsc(u.status) + ')' : '') + '</option>';
  }).join('');

  return ''
    + '<div style="font-size:12px;color:var(--muted);margin-bottom:16px;line-height:1.5;">A short request for a business or department to occupy a commercial, admin, or band building. Not scored or waitlisted — reviewed by staff for availability and fit.</div>'
    + _caField('Applicant Type',
        '<div style="display:flex;gap:18px;">'
        + '<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;"><input type="radio" name="ca_kind" value="business" ' + (kind==='business'?'checked':'') + ' style="accent-color:var(--yellow);"/> Business</label>'
        + '<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;"><input type="radio" name="ca_kind" value="department" ' + (kind==='department'?'checked':'') + ' style="accent-color:var(--yellow);"/> Department</label>'
        + '</div>', true)
    + _caField('Business / Department Name', _caInput('ca_org', app.orgName, 'Legal or operating name'), true)
    + '<div class="tic-grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">'
    +   _caField('Contact Person', _caInput('ca_contact', app.contactPerson, 'Primary contact'), true)
    +   _caField('Contact Phone', _caInput('ca_phone', app.contactPhone, 'Phone', 'tel'))
    +   _caField('Contact Email', _caInput('ca_email', app.contactEmail, 'Email', 'email'))
    +   _caField('Space Type', '<select id="ca_space" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;font-family:DM Sans,sans-serif;background:var(--surface);color:var(--text);">' + spaceOpts + '</select>')
    +   _caField('Approx. Size Needed', _caInput('ca_size', app.sizeNeeded, 'e.g. 1,200 sq ft or 3 rooms'))
    +   _caField('Preferred Building', '<select id="ca_unit" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border);border-radius:7px;font-size:13px;font-family:DM Sans,sans-serif;background:var(--surface);color:var(--text);">' + unitOpts + '</select>')
    +   _caField('Desired Start', _caInput('ca_start', app.desiredStart, '', 'date'), true)
    +   _caField('Desired End (optional)', _caInput('ca_end', app.desiredEnd, 'Leave blank if ongoing', 'date'))
    + '</div>'
    + _caField('Intended Use', _caTextarea('ca_use', app.intendedUse, 'What the space will be used for'))
    + _caField('Notes', _caTextarea('ca_notes', app.notes, 'Anything else staff should know'));
}

function _caStatusLabel(s){
  return { submitted:'Submitted — Awaiting Review', ed_approved:'Approved', declined:'Declined' }[s] || (s || 'Draft');
}

function openCommercialApp(id){
  _caEnsureModal();
  var modal = document.getElementById('commercialAppModal');
  if (!modal) { if (typeof showToast==='function') showToast('Commercial application not available on this page.', { type:'error' }); return; }
  var existing = id
    ? (typeof applications !== 'undefined' ? applications : []).find(function(a){ return a.id === id && a.appType === 'commercial'; })
    : null;
  _caEditId = existing ? existing.id : null;

  document.getElementById('ca_title').textContent = existing
    ? ('Commercial Application — ' + (_caStatusLabel(existing.status)))
    : 'Business / Department Application';
  document.getElementById('ca_body').innerHTML = _caRenderBody(existing || {});

  // Footer: submit (new) OR review actions (existing, mgmt only).
  var footer = document.getElementById('ca_footer');
  var review = existing && existing.status !== 'declined' && existing.status !== 'ed_approved' && _caIsMgmt();
  footer.innerHTML =
      '<button type="button" onclick="closeCommercialApp()" class="btn btn-ghost">Close</button>'
    + (existing
        ? (review
            ? '<button type="button" onclick="commercialAppDecision(\'decline\')" class="btn btn-ghost" style="color:var(--danger);border-color:var(--danger);">Decline</button>'
              + '<button type="button" onclick="commercialAppDecision(\'approve\')" class="btn btn-primary">Approve</button>'
            : '<button type="button" onclick="submitCommercialApp()" class="btn btn-primary">Save Changes</button>')
        : '<button type="button" onclick="submitCommercialApp()" class="btn btn-primary">Submit Application</button>');

  modal.style.display = 'flex';
}

function closeCommercialApp(){
  var m = document.getElementById('commercialAppModal');
  if (m) m.style.display = 'none';
  _caEditId = null;
}

function _caCollect(){
  var v = function(id){ var e = document.getElementById(id); return e ? (e.value||'').trim() : ''; };
  var kindEl = document.querySelector('input[name="ca_kind"]:checked');
  return {
    kind:          kindEl ? kindEl.value : 'business',
    orgName:       v('ca_org'),
    contactPerson: v('ca_contact'),
    contactPhone:  v('ca_phone'),
    contactEmail:  v('ca_email'),
    spaceType:     v('ca_space'),
    sizeNeeded:    v('ca_size'),
    preferredUnit: v('ca_unit'),
    desiredStart:  v('ca_start'),
    desiredEnd:    v('ca_end'),
    intendedUse:   v('ca_use'),
    notes:         v('ca_notes')
  };
}

function submitCommercialApp(){
  var f = _caCollect();
  if (!f.orgName)       { if (typeof showToast==='function') showToast('Business / Department name is required.', { type:'error' }); return; }
  if (!f.contactPerson) { if (typeof showToast==='function') showToast('Contact person is required.', { type:'error' }); return; }
  if (!f.desiredStart)  { if (typeof showToast==='function') showToast('Desired start date is required.', { type:'error' }); return; }

  var existing = _caEditId
    ? (typeof applications !== 'undefined' ? applications : []).find(function(a){ return a.id === _caEditId; })
    : null;
  var nowIso = new Date().toISOString();
  var today  = nowIso.slice(0,10);

  var app = Object.assign({}, existing || {}, f, {
    id:        (existing && existing.id) || (typeof generateAppId === 'function' ? generateAppId() : 'APP-' + Date.now()),
    appType:   'commercial',
    status:    (existing && existing.status) || 'submitted',
    // Display name in the residential apps table (renders fn + ln).
    fn:        f.orgName,
    ln:        '',
    classification: f.kind === 'department' ? 'Department' : 'Business',
    appDate:   (existing && existing.appDate) || today,
    submittedAt: (existing && existing.submittedAt) || nowIso,
    score:     null,
    tier:      null,
    created_by_email: (existing && existing.created_by_email) || (window.HOUSING_SESSION && HOUSING_SESSION.email) || null
  });

  _caPersist(app, (existing ? 'Commercial application updated.' : 'Commercial application submitted.'),
    (existing ? 'commercial_app_updated' : 'commercial_app_submitted'));
}

function commercialAppDecision(decision){
  var existing = _caEditId
    ? (typeof applications !== 'undefined' ? applications : []).find(function(a){ return a.id === _caEditId; })
    : null;
  if (!existing) return;
  if (!_caIsMgmt()) { if (typeof showToast==='function') showToast('You do not have authority to approve commercial applications.', { type:'error' }); return; }
  var approve = decision === 'approve';
  if (typeof showConfirm !== 'function') return;
  showConfirm({
    title:   approve ? 'Approve commercial application?' : 'Decline commercial application?',
    message: approve
      ? 'This approves the request. It can then be matched to an available commercial building.'
      : 'This declines the request. The applicant will not be placed.',
    confirmText: approve ? 'Approve' : 'Decline',
    danger: !approve
  }).then(function(ok){
    if (!ok) return;
    var f = _caCollect();
    var app = Object.assign({}, existing, f, {
      fn: f.orgName || existing.fn, ln: '',
      status: approve ? 'ed_approved' : 'declined',
      decidedAt: new Date().toISOString(),
      decidedBy: (window.HOUSING_SESSION && HOUSING_SESSION.name) || window.currentRole || 'staff'
    });
    _caPersist(app, approve ? 'Commercial application approved.' : 'Commercial application declined.',
      approve ? 'commercial_app_approved' : 'commercial_app_declined');
  });
}

function _caPersist(app, okMsg, auditAction){
  var save = (typeof sbSaveApplication === 'function')
    ? sbSaveApplication(app)
    : Promise.reject(new Error('save unavailable'));
  save.then(function(){
    // Keep the in-memory applications array in sync.
    if (typeof applications !== 'undefined' && applications) {
      var idx = applications.findIndex(function(a){ return a.id === app.id; });
      if (idx >= 0) applications[idx] = app; else applications.unshift(app);
    }
    if (typeof auditEntry === 'function') {
      auditEntry(app.id, auditAction, (app.classification || 'Commercial') + ' — ' + (app.orgName||'') + ' (' + _caStatusLabel(app.status) + ')', window.currentRole || 'staff');
    }
    if (typeof showToast === 'function') showToast('✓ ' + okMsg);
    closeCommercialApp();
    if (typeof renderApplications === 'function') renderApplications();
    if (typeof renderWorklist === 'function') renderWorklist();
  }).catch(function(err){
    if (typeof showToast === 'function') showToast('Save failed: ' + (err && err.message || err), { type:'error' });
  });
}

window.openCommercialApp     = openCommercialApp;
window.closeCommercialApp    = closeCommercialApp;
window.submitCommercialApp   = submitCommercialApp;
window.commercialAppDecision = commercialAppDecision;
