/* ============================================================
 * housing-app.js — CLFN Housing Suite
 * Application form: steps, validation, submission, scoring
 *
 * Load order: ... housing-modals.js → THIS FILE
 *
 * Covers: application form steps (goTo, validateStep*),
 *   income/household/reference/pet forms, file uploads,
 *   approval flow, submit modal, print preview,
 *   dashboard table (renderDashTable, updateDashStats, wireDashTable),
 *   assign unit modal, reno approvals view
 * ============================================================ */

'use strict';

// ── Preview from Dash ──


let cur = 0;
const STEPS = 9; // 7 visible steps (0-6) + review (8) = 8 total
const DRAFT_KEY = 'clfn_housing_draft';
let currentAppId = null;

// ── Helpers ──



function setText(id,val){var e=document.getElementById(id);if(e)e.textContent=val;}

// ── Arrears payment-plan duration calculation ──
// Reads Amount Owed and Monthly Payment, computes ceil(amount / monthly) as
// integer months, writes that into the (readonly) #arrPlanMonths input so
// downstream save logic and V2 scoring still find an integer there. Also
// renders a "X yr Y mo" hint underneath. Triggers V2 rescore on change.
function _calcArrearsMonths(){
  function toNum(id){
    var el = document.getElementById(id);
    if(!el) return 0;
    var n = parseFloat(String(el.value||'').replace(/[^0-9.]/g,''));
    return isFinite(n) ? n : 0;
  }
  var owed     = toNum('arrBalAmt');
  var monthly  = toNum('arrMonthlyPayment');
  var monthsEl = document.getElementById('arrPlanMonths');
  var hintEl   = document.getElementById('arrPlanMonthsHint');
  var months   = (owed > 0 && monthly > 0) ? Math.ceil(owed / monthly) : 0;
  if(monthsEl) monthsEl.value = months || '';
  if(hintEl){
    if(months > 0){
      var yrs = Math.floor(months / 12);
      var mo  = months % 12;
      var parts = [];
      if(yrs) parts.push(yrs + ' yr' + (yrs !== 1 ? 's' : ''));
      if(mo)  parts.push(mo  + ' mo');
      if(!parts.length) parts.push('—');
      hintEl.textContent = months + ' months  (' + parts.join(' ') + ')';
    } else {
      hintEl.textContent = '';
    }
  }
  if(typeof triggerV2Score === 'function') triggerV2Score();
}

// ── Co-applicant arrears payment-plan duration ──
// Mirrors _calcArrearsMonths but reads/writes the coArr* field ids. Lives next
// to its applicant counterpart so future tweaks land on both sides together.
function _calcCoArrearsMonths(){
  function toNum(id){
    var el = document.getElementById(id);
    if(!el) return 0;
    var n = parseFloat(String(el.value||'').replace(/[^0-9.]/g,''));
    return isFinite(n) ? n : 0;
  }
  var owed     = toNum('coArrBalAmt');
  var monthly  = toNum('coArrMonthlyPayment');
  var monthsEl = document.getElementById('coArrPlanMonths');
  var hintEl   = document.getElementById('coArrPlanMonthsHint');
  var months   = (owed > 0 && monthly > 0) ? Math.ceil(owed / monthly) : 0;
  if(monthsEl) monthsEl.value = months || '';
  if(hintEl){
    if(months > 0){
      var yrs = Math.floor(months / 12);
      var mo  = months % 12;
      var parts = [];
      if(yrs) parts.push(yrs + ' yr' + (yrs !== 1 ? 's' : ''));
      if(mo)  parts.push(mo  + ' mo');
      if(!parts.length) parts.push('—');
      hintEl.textContent = months + ' months  (' + parts.join(' ') + ')';
    } else {
      hintEl.textContent = '';
    }
  }
  if(typeof triggerV2Score === 'function') triggerV2Score();
}

// ── Phone formatter ──
// Now a thin wrapper around the shared window.formatPhone — single source
// of truth for "(705)-000-0000" canonical formatting (parens + dashes).
function fmtPhone(input){
  if (!input) return;
  input.value = (typeof formatPhone === 'function')
    ? formatPhone(input.value)
    : input.value;
}

// ── App ID ──
function generateAppId(){
  try {
    const stored=applications.slice();
    const pool=(typeof applications!=='undefined'?applications:[]).concat(stored);
    const existing=pool.map(function(a){return parseInt((a.id||'').replace('APP-',''));}) || [];
    const max=existing.length?Math.max(...existing):184;
    return 'APP-'+String(max+1).padStart(6,'0');
  } catch(e) { return 'APP-000185'; }
}
function initAppId(){
  if(!currentAppId)currentAppId=generateAppId();
  const el=document.getElementById('appNumCard');
  if(el)el.textContent=currentAppId;
}

function showStepErrors(step, errs, bannerId) {
  // Clear previous field highlights in this step
  var stepEl = document.getElementById(step);
  if (stepEl) {
    stepEl.querySelectorAll('.field-error').forEach(function(el){ el.classList.remove('field-error'); });
  }
  var b = document.getElementById(bannerId);
  if (!b) return;
  if (!errs || !errs.length) { b.style.display = 'none'; return; }
  // Render as a list
  var items = errs.map(function(e){ return '<li>' + e + '</li>'; }).join('');
  b.innerHTML = '<div class="err-title"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
    + (errs.length === 1 ? 'Please fix the following:' : errs.length + ' fields need attention:')
    + '</div><ul>' + items + '</ul>';
  b.style.display = 'block';
  // Scroll banner into view
  b.scrollIntoView({ behavior: 'smooth', block: 'start' });
  window.scrollTo({ top: 0, behavior: 'smooth' });
  // Shake
  b.style.animation = 'none';
  b.offsetHeight; // reflow
  b.style.animation = 'shake .35s ease';
  // Highlight invalid fields — match error messages to field IDs.
  // Only matches static field errors; dynamic-row errors (Reference 1: …,
  // Household member 2: …, Pet 3: …, Income record 1: …) are skipped so
  // their inner phrasing doesn't accidentally highlight a same-named static
  // field on a different step.
  var fieldMap = {
    'First name': 'fn', 'Last name': 'ln', 'Date of birth': 'dob',
    'On Reserve': 'reserve', 'Marital status': 'marital', 'Marital Status': 'marital',
    'Cell phone': 'phone', 'Phone': 'phone', 'Email': 'email',
    'Classification': 'classification', 'Housing Classification': 'classification',
    'Street': 'street', 'City': 'city', 'Province': 'prov', 'Postal': 'postal',
    'Expected occupancy': 'occDate', 'Arrears amount': 'arrBalAmt',
    'Home condition': 'homeCondition',
    'Co-applicant first': 'co_fn', 'Co-applicant last': 'co_ln',
    'Co-applicant date': 'co_dob', 'Co-applicant reserve': 'co_reserve',
    'Co-applicant cell': 'co_cell', 'Co-applicant email': 'co_email'
  };
  var ROW_PREFIX_RE = /^(Reference |Household member |Pet |Income record |Row )/i;
  errs.forEach(function(err) {
    if (ROW_PREFIX_RE.test(err)) return; // dynamic-row error — handled at the row level
    Object.keys(fieldMap).forEach(function(key) {
      if (err.toLowerCase().includes(key.toLowerCase())) {
        var el = document.getElementById(fieldMap[key]);
        if (el) el.classList.add('field-error');
      }
    });
  });
}
function clearStepErrors(step, bannerId) {
  var b = document.getElementById(bannerId);
  if (b) { b.innerHTML = ''; b.style.display = 'none'; }
  // Remove field highlights
  var stepEl = document.getElementById(step);
  if (stepEl) {
    stepEl.querySelectorAll('.field-error').forEach(function(el){ el.classList.remove('field-error'); });
  }
}
function showStep0Errors(errs, bannerId) { showStepErrors('step0', errs, bannerId || 'step0_error_banner'); }
function clearStep0Errors() { clearStepErrors('step0', 'step0_error_banner'); }

function validateStep0() {
  var errs = [];
  function fld(id){ var e=document.getElementById(id); return e?e.value.trim():''; }
  // Drive required-field checks off the configurable registry so the ED's
  // Settings → App Settings → Required Fields choices are respected.
  // SCOPE: only step-0 static fields. Other steps have their own validators
  // (validateStep1/2/3/4/5) — pulling them in here would treat dynamic-row
  // fields as static IDs (they aren't) and step-2 co-applicant fields as
  // unconditional (they're gated by the co_status toggle).
  (window.APP_REQ_FIELDS || [])
    .filter(function(f){ return f.step === 0 && !f.rowOf; })
    .forEach(function(f){
      if (typeof isFieldRequired === 'function' && !isFieldRequired(f.id)) return;
      if (!fld(f.id)) errs.push(f.errorLabel || (f.label + ' is required.'));
    });
  // Conditional fields — always required when their toggle is on, regardless
  // of the global config.
  var arrTog = document.getElementById('arrToggle');
  if(arrTog && arrTog.checked) {
    if(!fld('arrBalAmt')) errs.push('Arrears amount is required when arrears are selected.');
  }
  var houseTog = document.getElementById('hasHouseToggle');
  if(houseTog && houseTog.checked) {
    if(!fld('homeCondition')) errs.push('Home condition is required when a current unit is selected.');
  }
  return errs;
}
function validateStep2() {
  var errs = [];
  var coSel = document.getElementById('co_status');
  if(!coSel || coSel.value !== 'yes') return errs;
  function fld(id){ var e=document.getElementById(id); return e?e.value.trim():''; }
  (window.APP_REQ_FIELDS || []).filter(function(f){ return f.step === 2; }).forEach(function(f){
    if (typeof isFieldRequired === 'function' && !isFieldRequired(f.id)) return;
    if (!fld(f.id)) errs.push(f.errorLabel || (f.label + ' is required.'));
  });
  return errs;
}
// Generic dynamic-row validator — used by steps 1, 3, 4, 5. A row counts as
// "started" when ANY tracked field has a value; only started rows are
// validated, plus the section-required toggle blocks empty sections.
function _validateDynamicStep(stepNum, sectionId) {
  var errs = [];
  var fields = (window.APP_REQ_FIELDS || []).filter(function(f){ return f.step === stepNum && f.rowOf; });
  if (!fields.length) return errs;
  var container = document.querySelector(fields[0].rowOf);
  var rows = container ? container.querySelectorAll('.rrow') : [];
  var startedRows = 0;
  rows.forEach(function(row, i){
    // A row is "started" if any tracked field is filled
    var anyFilled = fields.some(function(f){
      var input = row.querySelector('[data-role="' + f.dataRole + '"]');
      return input && (input.value || '').trim();
    });
    if (!anyFilled) return;
    startedRows++;
    fields.forEach(function(f){
      if (typeof isFieldRequired === 'function' && !isFieldRequired(f.id)) return;
      var input = row.querySelector('[data-role="' + f.dataRole + '"]');
      var v = input ? (input.value || '').trim() : '';
      if (!v) errs.push(_rowErrorLabel(f, i + 1));
    });
  });
  if (sectionId && typeof isSectionRequired === 'function' && isSectionRequired(sectionId) && startedRows === 0) {
    var sec = (window.APP_REQ_SECTIONS || []).find(function(s){ return s.id === sectionId; });
    errs.unshift((sec && sec.errorLabel) || 'At least one entry is required.');
  }
  return errs;
}
function _rowErrorLabel(field, rowIdx) {
  // Customize the row prefix per step for clearer messages
  var prefix = field.rowOf === '#habList' ? 'Household member ' + rowIdx
            : field.rowOf === '#refList' ? 'Reference ' + rowIdx
            : field.rowOf === '#petList' ? 'Pet ' + rowIdx
            : field.rowOf === '#incomeList' ? 'Income record ' + rowIdx
            : 'Row ' + rowIdx;
  return prefix + ': ' + field.label.replace(/^Pet\s+|^Reference:\s*|^Household.*?:\s*|^Income.*?:\s*/i, '').toLowerCase() + ' is required.';
}
function validateStep1() { return _validateDynamicStep(1, 'sec_step1'); }
function validateStep3() { return _validateDynamicStep(3, 'sec_step3'); }
function validateStep4() { return _validateDynamicStep(4, 'sec_step4'); }
function validateStep5() {
  return _validateDynamicStep(5, 'sec_step5');
}
// setNavActive defined below (comprehensive version handles all tabs)

document.addEventListener('DOMContentLoaded',initAppId);

// ── Role-aware step nav for the staff-only steps 9 (Housing Needs) and
//    10 (Tenancy History). They sit between Pets (5) and Documents (6) in
//    the visible flow for HM/ED, but applicants skip them entirely.
function _isHmOrEdRole(){
  var r = window.currentRole || '';
  return r === ROLE.HOUSING_MANAGER || r === ROLE.ED || r === ROLE.SUPER_USER;
}
function _goAfterPets(){ goTo(_isHmOrEdRole() ? 9 : 6); }
function _goBeforeDocuments(){ goTo(_isHmOrEdRole() ? 10 : 5); }

// Internal-notes step is a side panel, not part of the wizard flow. We skip
// the validation/auto-save/progress-bar machinery for it.
function _isStaffSession(){
  var s = window.HOUSING_SESSION || {};
  return !!(s.email && s.role);
}

// ── Step navigation ──
function goTo(s){
  // Internal-notes tab — side panel, bypass wizard flow entirely.
  if (s === 11) { _openAppNotesStep(); return; }

  // Applicants never visit the staff-only steps. If they somehow target one
  // (saved-state restore, deep link, programmatic), forward them to the next
  // visible step in the flow.
  if((s === 9 || s === 10) && !_isHmOrEdRole()) { return goTo(6); }

  // ── Run validation BEFORE any DOM changes ──
  if(cur===0 && s>0){
    var errs=validateStep0 ? validateStep0() : [];
    if(errs.length){ showStep0Errors(errs); return; }
    clearStepErrors('step0', 'step0_error_banner');
  }
  if(cur===1 && s>1){
    var incErrs=validateStep1 ? validateStep1() : [];
    if(incErrs.length){ showStepErrors('step1',incErrs,'step1_error_banner'); return; }
    clearStepErrors('step1','step1_error_banner');
  }
  if(cur===2 && s>2){
    var coErrs=validateStep2 ? validateStep2() : [];
    if(coErrs.length){ showStepErrors('step2',coErrs,'step2_error_banner'); return; }
    clearStepErrors('step2','step2_error_banner');
  }
  if(cur===3 && s>3){
    var habErrs=validateStep3 ? validateStep3() : [];
    if(habErrs.length){ showStepErrors('step3',habErrs,'step3_error_banner'); return; }
    clearStepErrors('step3','step3_error_banner');
  }
  if(cur===4 && s>4){
    var refErrs=validateStep4 ? validateStep4() : [];
    if(refErrs.length){ showStepErrors('step4',refErrs,'step4_error_banner'); return; }
    clearStepErrors('step4','step4_error_banner');
  }
  if(cur===5 && s>5){
    var petErrs=validateStep5 ? validateStep5() : [];
    if(petErrs.length){ showStepErrors('step5',petErrs,'step5_error_banner'); return; }
    clearStepErrors('step5','step5_error_banner');
  }

  // Auto-save draft on every forward step. saveApplicationRecord now routes
  // through the local-first wrapper internally, so we don't need to re-queue
  // here — just trigger the save and refresh the Notes tab.
  if(s > cur) {
    var _ds = saveApplicationRecord({draft: true});
    if(_ds) {
      // Application now exists in-memory → enable the Internal Notes tab.
      if (typeof _refreshAppNotesTabVisibility === 'function') _refreshAppNotesTabVisibility();
    }
  }

  // ── All validation passed — now switch steps ──
  var _stepCur=document.getElementById('step'+cur); if(_stepCur) _stepCur.classList.remove('on');
  var _stepS=document.getElementById('step'+s); if(_stepS) _stepS.classList.add('on');

  // Map step numbers to sidebar nav indices (step 7 is hidden scoring, step 8 = nav index 7)
  var _stepToNav = {0:0,1:1,2:2,3:3,4:4,5:5,6:6,7:7,8:7};
  var _navSteps  = [0,1,2,3,4,5,6,8]; // step number at each nav index
  const nav=document.querySelectorAll('#stepNav li');
  var curNavIdx = _stepToNav[cur] !== undefined ? _stepToNav[cur] : cur;
  var sNavIdx   = _stepToNav[s]   !== undefined ? _stepToNav[s]   : s;
  if(nav[curNavIdx]) nav[curNavIdx].classList.remove('active');
  if(nav[curNavIdx] && s > cur) nav[curNavIdx].classList.add('done');
  if(nav[sNavIdx])  { nav[sNavIdx].classList.add('active'); nav[sNavIdx].classList.remove('done'); }
  for(let i=0; i<_navSteps.length; i++){
    if(_navSteps[i] < s){
      if(nav[i]) nav[i].classList.add('done');
      const sn=document.getElementById('sn'+i);
      if(sn) sn.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
    }
  }
  const pct=Math.round((s/(STEPS-1))*100);
  const pf=document.getElementById('pfill');if(pf)pf.style.width=pct+'%';
  const pp=document.getElementById('pPct');if(pp)pp.textContent=pct+'%';

  cur=s;
  window.scrollTo(0,0);
  // Init DocLibrary when user reaches step 6 (Documents)
  if(s === 6) _initStep6DocLib();
  // Restore toggle states for new step

  // Sync step progress bar — fill bar + step states
  var _spbSteps = [0,1,2,3,4,5,6,8];
  var _totalSteps = 8;
  var _activeIdx = _spbSteps.indexOf(s);
  if(_activeIdx < 0) _activeIdx = 0;
  var _fill = document.getElementById('spb_fill');
  if(_fill) _fill.style.width = Math.round((_activeIdx / (_totalSteps - 1)) * 100) + '%';

  for(var _si=0; _si<8; _si++) {
    var _btn = document.getElementById('spb_'+_si);
    var _num = document.getElementById('spb_num_'+_si);
    var _lbl = document.getElementById('spb_lbl_'+_si);
    if(!_btn) continue;
    var _stepNum = _spbSteps[_si];
    var _done    = _stepNum < s && s !== 0;
    var _active  = _stepNum === s;
    _btn.style.borderTopColor = _active ? '#000' : _done ? '#000' : 'transparent';
    _btn.style.background     = 'transparent';
    if(_num) {
      _num.style.background = _active ? 'var(--yellow)' : _done ? '#000' : '#e5e5e5';
      _num.style.color      = _active ? '#111' : _done ? 'var(--yellow)' : '#999';
      _num.innerHTML = _done
        ? '<svg viewBox="0 0 10 10" width="10" height="10"><polyline points="1,5 4,8 9,2" stroke="currentColor" stroke-width="2" fill="none"/></svg>'
        : String(_si+1);
    }
    if(_lbl) {
      _lbl.style.color      = _active ? '#111' : _done ? '#555' : '#aaa';
      _lbl.style.fontWeight = _active ? '700' : '600';
    }
  }

  // Leaving the Internal Notes side tab — reset its highlight.
  var _notesBtn = document.getElementById('spb_11');
  if (_notesBtn) {
    _notesBtn.style.borderTopColor = 'transparent';
    var _notesLbl = document.getElementById('spb_lbl_11');
    if (_notesLbl) _notesLbl.style.color = 'var(--dark)';
  }

  if(s===7){ goTo(8); return; }
  if(s===8){
    setTimeout(function(){
      triggerV2Score();
      // Populate review summary + approval flow
      if(typeof popReview === 'function') popReview();
      // Show/hide co-applicant signature block based on current co_status
      var _coSel   = document.getElementById('co_status');
      var _coBlock = document.getElementById('sig_coapplicant_block');
      if(_coBlock) _coBlock.style.display = (_coSel && _coSel.value==='yes') ? 'block' : 'none';
      // Init signature pads
      if(typeof initSignaturePads === 'function') initSignaturePads();
      // Restore signature drawings if editing an existing application
      if(window._pendingSigRestore) {
        var _sr = window._pendingSigRestore;
        setTimeout(function(){
          _restoreSigCanvas('sig_canvas_app',   _sr.applicant   && _sr.applicant.image);
          _restoreSigCanvas('sig_canvas_co',    _sr.coApplicant && _sr.coApplicant.image);
          _restoreSigCanvas('sig_canvas_staff', _sr.staff       && _sr.staff.image);
          window._pendingSigRestore = null;
        }, 200);
      }
      // ── Auto-populate staff name and today's date ──
      var _today = new Date().toISOString().slice(0,10);
      var _staffNameEl = document.getElementById('sig_staff');
      var _staffDateEl = document.getElementById('sig_recv');
      var _sessionName = (window.HOUSING_SESSION && window.HOUSING_SESSION.name) ? window.HOUSING_SESSION.name : (window.currentUser && window.currentUser.name ? window.currentUser.name : '');
      if(_staffNameEl && !_staffNameEl.value && _sessionName) _staffNameEl.value = _sessionName;
      if(_staffDateEl && !_staffDateEl.value) _staffDateEl.value = _today;
      // ── Role-based unlock + auto-populate for HM/ED audit fields ──
      var _role = window.currentRole || '';
      var _hmNameEl = document.getElementById('sig_hm_name');
      var _hmDateEl = document.getElementById('sig_hm_date');
      var _edNameEl = document.getElementById('sig_ed_name');
      var _edDateEl = document.getElementById('sig_ed_date');
      if(ROLE.isManagement(_role)) {
        // Unlock HM fields for HM and ED
        if(_hmNameEl) { _hmNameEl.removeAttribute('readonly'); _hmNameEl.style.borderBottom = '1px solid var(--yellow)'; }
        if(_hmDateEl) { _hmDateEl.removeAttribute('readonly'); _hmDateEl.style.borderBottom = '1px solid var(--yellow)'; }
        if(APPROVAL_AUTHORITY.can('reviewApplication', _role) && _sessionName) {
          if(_hmNameEl && !_hmNameEl.value) _hmNameEl.value = _sessionName;
          if(_hmDateEl && !_hmDateEl.value) _hmDateEl.value = _today;
        }
      }
      if(APPROVAL_AUTHORITY.can('finalApproveApp', _role)) {
        // Unlock ED fields for ED only
        if(_edNameEl) { _edNameEl.removeAttribute('readonly'); _edNameEl.style.borderBottom = '1px solid var(--yellow)'; }
        if(_edDateEl) { _edDateEl.removeAttribute('readonly'); _edDateEl.style.borderBottom = '1px solid var(--yellow)'; }
        if(_sessionName) {
          if(_edNameEl && !_edNameEl.value) _edNameEl.value = _sessionName;
          if(_edDateEl && !_edDateEl.value) _edDateEl.value = _today;
        }
      }
    },150);
  }
}

// ── Dynamic rows ──
function addIncome(){
  var list=document.getElementById('incomeList');
  var n=list.querySelectorAll('.rrow').length+1;
  var div=document.createElement('div');div.className='rrow';
  div.innerHTML=''
    +'<div class="rhdr"><span class="rlbl">Record '+n+'</span><button class="btn-rm" onclick="rmRow(this)">Remove</button></div>'
    +'<div class="fg c3">'
    +'<div class="f"><label>Person <span class="r">*</span></label>'
    +'<select data-role="person" onchange="onIncomePersonChange(this)">'
    +'<option value="">Select person</option>'
    +'<option value="Applicant">Applicant</option>'
    +'<option value="Co-Applicant">Co-Applicant</option>'
    +'</select></div>'
    +'<div class="f"><label data-lbl="incType">Income Type</label>'
    +'<select data-role="incType" onchange="onIncomeTypeChange(this)" disabled style="opacity:.5">'
    +'<option value="">Select type</option>'
    +'<option value="Employed">Employed</option>'
    +'<option value="Self-Employment">Self-Employment</option>'
    +'<option value="OW">OW (Ontario Works)</option>'
    +'<option value="ODSP">ODSP</option>'
    +'<option value="CPP">CPP</option>'
    +'<option value="EI">EI (Employment Insurance)</option>'
    +'<option value="Pension">Pension</option>'
    +'<option value="Other">Other</option>'
    +'</select></div>'
    +'<div class="f"><label data-lbl="empStatus">Employment Status</label>'
    +'<select data-role="empStatus" disabled style="opacity:.5">'
    +'<option value="">Select</option>'
    +'<option value="Full-Time">Full-Time</option>'
    +'<option value="Part-Time">Part-Time</option>'
    +'<option value="Seasonal">Seasonal</option>'
    +'<option value="Contract">Contract</option>'
    +'<option value="Unemployed">Unemployed</option>'
    +'</select></div>'
    +'</div>'
    +'<div data-grp="employer_grp">'
    +'<div class="js-lbl-muted" style="margin:10px 0 6px;">Employer Details</div>'
    +'<div class="fg c3">'
    +'<div class="f"><label>Employer Name <span class="r">*</span></label><input data-role="empName" type="text" placeholder="Employer or N/A"/></div>'
    +'<div class="f"><label>Employer Phone <span class="r">*</span></label><input data-role="empPhone" type="tel" placeholder="(705)-555-0100" oninput="fmtPhone(this)"/></div>'
    +'<div class="f"><label>Manager / Supervisor <span class="r">*</span></label><input data-role="mgr" type="text"/></div>'
    +'<div class="f"><label>Start / Hire Date <span class="r">*</span></label><input data-role="startDate" type="date" onchange="calcDuration(this)"/></div>'
    +'<div class="f"><label>Duration</label><input type="text" data-role="duration" readonly placeholder="Calculated from start date" style="background:var(--bg);color:var(--muted);cursor:default;"/></div>'
    +'<div class="f"><label>Employer Address <span class="r">*</span></label><input data-role="empAddr" type="text" placeholder="Address"/></div>'
    +'</div></div>'
    +'<div data-grp="employer_optional_grp">'
    +'<div class="js-lbl-muted" style="margin:10px 0 6px;">Employer / Source Details</div>'
    +'<div class="fg c3">'
    +'<div class="f"><label>Employer / Source Name</label><input type="text" placeholder="Employer or source"/></div>'
    +'<div class="f"><label>Phone</label><input type="tel" placeholder="(705)-555-0100" oninput="fmtPhone(this)"/></div>'
    +'<div class="f"><label>Manager / Supervisor</label><input type="text"/></div>'
    +'<div class="f"><label>Start / Hire Date</label><input data-role="startDate" type="date" onchange="calcDuration(this)"/></div>'
    +'<div class="f"><label>Duration</label><input type="text" data-role="duration" readonly placeholder="Calculated from start date" style="background:var(--bg);color:var(--muted);cursor:default;"/></div>'
    +'<div class="f"><label>Address</label><input type="text" placeholder="Address"/></div>'
    +'</div></div>'
    +'<div data-grp="amount_grp">'
    +'<div class="js-lbl-muted" style="margin:10px 0 6px;">Income Amount</div>'
    +'<div class="fg c2">'
    +'<div class="f"><label>Primary Income &amp; Period <span class="r">*</span></label>'
    +'<div style="display:flex;gap:6px;align-items:center;">'
    +'<input type="text" placeholder="$0" oninput="fmtCurrency(this)" inputmode="numeric" style="flex:1;"/>'
    +'<select data-role="incPeriod" required style="width:110px;padding:8px 6px;border:1px solid var(--border);background:var(--bg);color:var(--text);border-radius:6px;"><option value="">— Period * —</option><option value="month">/ Month</option><option value="annual">/ Year</option></select>'
    +'</div></div>'
    +'<div class="f"><label>Other / Additional Income</label>'
    +'<div style="display:flex;gap:6px;align-items:center;">'
    +'<input type="text" placeholder="$0" oninput="fmtCurrency(this)" inputmode="numeric" style="flex:1;"/>'
    +'<select style="width:110px;padding:8px 6px;"><option value="month">/ Month</option><option value="annual">/ Year</option></select>'
    +'</div></div>'
    +'<div class="f"><label>Other Income Source</label><input type="text" placeholder="e.g. rental, child support"/></div>'
    +'<div class="f"><label>If Unemployed — Source</label><input type="text" placeholder="Describe source"/></div>'
    +'</div></div>'
    +'<div data-grp="notes_grp">'
    +'<div class="f" style="margin-top:8px;"><label>Notes</label>'
    +'<textarea rows="2" placeholder="Notes..." style="width:100%;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;resize:vertical;"></textarea>'
    +'</div></div>';
  list.appendChild(div);
  if (typeof applyRequiredFields === 'function') applyRequiredFields();
}

function onIncomePersonChange(sel) {
  var row = sel.closest('.rrow');
  var hasPerson = sel.value !== '';
  var typeSel   = row.querySelector('[data-role="incType"]');
  var statusSel = row.querySelector('[data-role="empStatus"]');
  var typeLbl   = row.querySelector('[data-lbl="incType"]');
  var statusLbl = row.querySelector('[data-lbl="empStatus"]');
  if(typeSel)   { typeSel.disabled = !hasPerson; typeSel.style.opacity = hasPerson ? '1' : '.5'; if(!hasPerson) typeSel.value = ''; }
  if(statusSel) { statusSel.disabled = !hasPerson; statusSel.style.opacity = hasPerson ? '1' : '.5'; if(!hasPerson) statusSel.value = ''; }
  if(typeLbl)   typeLbl.innerHTML   = hasPerson ? 'Income Type <span class="r">*</span>' : 'Income Type';
  if(statusLbl) statusLbl.innerHTML = hasPerson ? 'Employment Status <span class="r">*</span>' : 'Employment Status';
  if(typeSel) onIncomeTypeChange(typeSel);
}

function onIncomeTypeChange(sel) {
  if(!sel) return;
  var row  = sel.closest('.rrow');
  if(!row) return;
  var type = sel.value;
  var isEmployed = (type === 'Employed');
  var hasType    = (type !== '');
  var empGrp    = row.querySelector('[data-grp="employer_grp"]');
  var empOpt    = row.querySelector('[data-grp="employer_optional_grp"]');
  var amtGrp    = row.querySelector('[data-grp="amount_grp"]');
  var notesGrp  = row.querySelector('[data-grp="notes_grp"]');
  if(empGrp)   empGrp.style.display   = isEmployed ? 'block' : 'none';
  if(empOpt)   empOpt.style.display   = (!isEmployed && hasType) ? 'block' : 'none';
  if(amtGrp)   amtGrp.style.display   = hasType ? 'block' : 'none';
  if(notesGrp) notesGrp.style.display = hasType ? 'block' : 'none';
}

function addHab(){
  const list=document.getElementById('habList');
  const n=list.querySelectorAll('.rrow').length+1;
  const div=document.createElement('div');div.className='rrow';
  div.innerHTML=''
    +'<div class="rhdr"><span class="rlbl">Member '+n+'</span><button class="btn-rm" onclick="rmRow(this)">Remove</button></div>'
    +'<div class="fg c3">'
    +'<div class="f"><label>First Name <span class="r">*</span></label><input type="text" data-role="habFn"/></div>'
    +'<div class="f"><label>Last Name <span class="r">*</span></label><input type="text" data-role="habLn"/></div>'
    +'<div class="f"><label>Date of Birth <span class="r">*</span></label><input type="date" data-role="habDob" onchange="triggerV2Score()"/></div>'
    +'<div class="f"><label>Relationship <span class="r">*</span></label>'
    +'<select data-role="habRel"><option value="">Select</option><option>Spouse</option><option>Child</option><option>Parent</option><option>Sibling</option><option>Other</option></select></div>'
    +'<div class="f"><label>Band Member #</label><input type="number"/></div>'
    +'<div class="f"><label>Accessibility</label>'
    +'<select><option>None</option><option>Wheelchair Accessible</option><option>Visual Impairment</option><option>Hearing Impairment</option><option>Other</option></select></div>'
    +'</div>'
    +'<div class="js-lbl-muted" style="margin:10px 0 6px;">Income</div>'
    +'<div class="fg c3">'
    +'<div class="f"><label>Income Source</label>'
    +'<select>'
    +'<option value="">Select (optional)</option>'
    +'<option value="Employed">Employed</option>'
    +'<option value="Self-Employment">Self-Employment</option>'
    +'<option value="OW">OW (Ontario Works)</option>'
    +'<option value="ODSP">ODSP</option>'
    +'<option value="CPP">CPP</option>'
    +'<option value="EI">EI (Employment Insurance)</option>'
    +'<option value="Pension">Pension</option>'
    +'<option value="Other">Other</option>'
    +'</select></div>'
    +'<div class="f"><label>Income Amount ($)</label>'
    +'<input type="text" placeholder="$0" oninput="fmtCurrency(this)" inputmode="numeric"/></div>'
    +'<div class="f"><label>Frequency</label>'
    +'<select>'
    +'<option value="">— Select —</option>'
    +'<option value="monthly">Monthly</option>'
    +'<option value="biweekly">Bi-Weekly</option>'
    +'<option value="weekly">Weekly</option>'
    +'<option value="annual">Annual</option>'
    +'</select></div>'
    +'</div>';
  list.appendChild(div);
  if (typeof applyRequiredFields === 'function') applyRequiredFields();
  if(typeof calcPersonsOverStandard === "function") calcPersonsOverStandard();
  if(typeof triggerV2Score === "function") triggerV2Score();
}
function addRef(){
  var list=document.getElementById('refList');
  var n=list.querySelectorAll('.rrow').length+1;
  var div=document.createElement('div');div.className='rrow';
  div.innerHTML=''
    +'<div class="rhdr"><span class="rlbl">Emergency Contact '+n+'</span><button class="btn-rm" onclick="rmRow(this)">Remove</button></div>'
    +'<div class="fg c3">'
    +'<div class="f"><label>First Name <span class="r">*</span></label><input type="text" data-role="refFn"/></div>'
    +'<div class="f"><label>Last Name <span class="r">*</span></label><input type="text" data-role="refLn"/></div>'
    +'<div class="f"><label>Relationship <span class="r">*</span></label>'
    +'<select data-role="refRel">'
    +'<option value="">Select</option>'
    +'<option value="Personal">Personal</option>'
    +'<option value="Professional">Professional</option>'
    +'<option value="Community Member">Community Member</option>'
    +'<option value="Former Landlord">Former Landlord</option>'
    +'<option value="Other">Other</option>'
    +'</select></div>'
    +'<div class="f"><label>Phone <span class="r">*</span></label><input type="tel" data-role="refPhone" oninput="fmtPhone(this)"/></div>'
    +'<div class="f"><label>Email <span class="r hidden">*</span></label><input type="email" data-role="refEmail"/></div>'
    +'</div>';
  list.appendChild(div);
  if (typeof applyRequiredFields === 'function') applyRequiredFields();
}
function addPet(){
  var list=document.getElementById('petList');
  var n=list.querySelectorAll('.rrow').length+1;
  var div=document.createElement('div');div.className='rrow';
  div.innerHTML=''
    +'<div class="rhdr"><span class="rlbl">Pet '+n+'</span><button class="btn-rm" onclick="rmRow(this)">Remove</button></div>'
    +'<div class="fg c3">'
    +'<div class="f"><label>Pet Name <span class="r">*</span></label><input type="text" data-role="petName" placeholder="Pet name"/></div>'
    +'<div class="f"><label>Pet Type <span class="r">*</span></label>'
    +'<select data-role="petType">'
    +'<option value="">Select</option>'
    +'<option value="Dog">Dog</option>'
    +'<option value="Cat">Cat</option>'
    +'<option value="Bird">Bird</option>'
    +'<option value="Fish">Fish</option>'
    +'<option value="Reptile">Reptile</option>'
    +'<option value="Other">Other</option>'
    +'</select></div>'
    +'<div class="f"><label>Size <span class="r">*</span></label>'
    +'<select data-role="petSize">'
    +'<option value="">Select</option>'
    +'<option value="Small">Small</option>'
    +'<option value="Medium">Medium</option>'
    +'<option value="Large">Large</option>'
    +'</select></div>'
    +'<div class="f s3"><label>Description</label><textarea rows="2" style="width:100%;padding:8px 10px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;resize:vertical;"></textarea></div>'
    +'</div>';
  list.appendChild(div);
  if (typeof applyRequiredFields === 'function') applyRequiredFields();
}
function rmRow(btn){const row=btn.closest('.rrow');if(row)row.remove();}

// ── File upload ──
function handleFiles(files){
  if(!window._pendingAppFiles) window._pendingAppFiles = [];
  Array.from(files).forEach(function(f){
    window._pendingAppFiles.push(f);
    var li=document.createElement('div');li.className='file-item';
    li.innerHTML='<span class="file-name">'+escapeHtml(f.name)+'</span><span class="file-size">'+(f.size/1024).toFixed(0)+' KB</span>';
    document.getElementById('fileList').appendChild(li);
  });
}

// Called after application is submitted — uploads staged files to Supabase Storage
async function uploadPendingAppFiles(appId){
  var files = window._pendingAppFiles || [];
  if(!files.length) return;
  for(var i=0;i<files.length;i++){
    try {
      await sbUploadAndSave('application', appId, files[i], 'applications/'+appId);
    } catch(e){ console.warn('App file upload failed:', e); }
  }
  window._pendingAppFiles = [];
}

// ── Housing Classification ──
function getHousingClassification(){
  var el = document.getElementById('classification');
  if(el && el.value) return el.value;
  return 'Undetermined';
}

// ── Scoring rubric ──
const SCORING_RUBRIC={
  renos:[{max:2500,score:0},{max:5000,score:-1},{max:10000,score:-2},{max:20000,score:-3},{max:Infinity,score:-5}],
  arrears:[{max:500,score:0},{max:1500,score:-1},{max:3000,score:-2},{max:5000,score:-3},{max:Infinity,score:-5}],
  payment:[{max:12,score:5},{max:36,score:4},{max:60,score:3},{max:120,score:2},{max:180,score:1},{max:Infinity,score:0}],
  housingSizes:{1:{bedrooms:'Bachelor / 1-Bedroom'},2:{bedrooms:'1-Bedroom'},3:{bedrooms:'2-Bedroom'},4:{bedrooms:'3-Bedroom'},5:{bedrooms:'3-Bedroom'},6:{bedrooms:'4-Bedroom'},7:{bedrooms:'4+ Bedroom'}}
};
// ── Live Scoring Model (editable, stored in localStorage) ──
// ── Dashboard ──
function updateDashStats(){
  var total=applications.length;
  var pending=applications.filter(function(a){return a.status===APP_STATUS.SUBMITTED||a.status===APP_STATUS.FILE_UPDATE;}).length;
  var awaitingED=applications.filter(function(a){return a.status===APP_STATUS.MGR_APPROVED;}).length;
  var approved=applications.filter(function(a){return a.status===APP_STATUS.ED_APPROVED;}).length;
  var declined=applications.filter(function(a){return a.status==='declined';}).length;
  var scored=applications.filter(function(a){return typeof a.score==='number';});
  var avgScore=scored.length?Math.round(scored.reduce(function(s,a){return s+(a.score||0);},0)/scored.length):0;
  var urgent=applications.filter(function(a){return a.tier==='Critical Priority';}).length;
  var archived=applications.filter(function(a){return a.archived;}).length;
  setText('ds_total',total);setText('ds_pending',pending);setText('ds_approved',approved);
  setText('ds_declined',declined);setText('ds_avg_score',avgScore);setText('ds_urgent',urgent);setText('ds_archived',archived);
  // Alert banner
  var banner=document.getElementById('dashAlertBanner');
  var bannerMsg=document.getElementById('dashAlertMsg');
  if(banner){
    if(awaitingED>0){
      banner.style.display='flex';
      if(bannerMsg)bannerMsg.textContent=awaitingED+' application'+(awaitingED!==1?'s':'')+' awaiting your final approval';
      var btn=document.getElementById('dashViewQueueBtn');
      if(btn)btn.onclick=function(){filterDash('mgr_approved');};
    } else if(pending>0){
      banner.style.display='flex';
      if(bannerMsg)bannerMsg.textContent=pending+' application'+(pending!==1?'s':'')+' awaiting Housing Manager review';
      var btn2=document.getElementById('dashViewQueueBtn');
      if(btn2)btn2.onclick=function(){filterDash('submitted');};
    } else {
      banner.style.display='none';
    }
  }
  var sb=document.getElementById('ds_score_bar');if(sb)sb.style.width=Math.min(100,Math.round((avgScore/20)*100))+'%';

  // ── Housing match stats ──
  if(typeof housingUnits !== 'undefined' && housingUnits.length) {
    var vacant   = housingUnits.filter(function(u){ return u.status==='vacant' && !u.archived; }).length;
    var assigned = applications.filter(function(a){ return a.assignedUnit; }).length;
    var ready    = applications.filter(function(a){
      return (a.status===APP_STATUS.ED_APPROVED||a.status===APP_STATUS.MGR_APPROVED)&&!a.assignedUnit&&!a.archived;
    }).length;
    var unhoused = applications.filter(function(a){
      return !a.assignedUnit&&!a.archived&&a.status!=='declined';
    }).length;
    var se=function(id,v){var e=document.getElementById(id);if(e)e.textContent=v;};
    se('ds_vacant_count',vacant);
    se('ds_ready_count',ready);
    se('ds_matched_count',assigned);
    se('ds_unhoused_count',unhoused);
  }
}

function renderDashTable(){
  // showDashboard() resets the filter when the user navigates to the dashboard.
  // Once they're on it, render off whatever the dropdown currently holds —
  // the previous reset-on-every-render logic wiped the value before reading
  // it, so the status filter never had any effect.
  var search=(document.getElementById('dashSearch')?document.getElementById('dashSearch').value:'').toLowerCase();
  var fStatus=document.getElementById('dashFilterStatus')?document.getElementById('dashFilterStatus').value:'';
  var fReserve=document.getElementById('dashFilterReserve')?document.getElementById('dashFilterReserve').value:'';
  var fTier=document.getElementById('dashFilterTier')?document.getElementById('dashFilterTier').value:'';
  var sortBy=document.getElementById('dashSortBy')?document.getElementById('dashSortBy').value:'date';
  // "Archived" is a flag (a.archived), not a status value. So the filter is:
  //   - showArchived = true  → only archived rows; ignore status equality
  //   - showArchived = false → only non-archived rows; status filter applies normally
  var showArchived = fStatus === APP_STATUS.ARCHIVED;
  var filtered=applications.filter(function(a){
    if (showArchived ? !a.archived : a.archived) return false;
    var name=((a.fn||'')+' '+(a.ln||'')).toLowerCase();
    return(!search||name.includes(search)||(a.id||'').toLowerCase().includes(search))
      &&(showArchived||!fStatus||a.status===fStatus)
      &&(!fReserve||a.reserve===fReserve)
      &&(!fTier||a.tier===fTier);
  });
  filtered.sort(function(a,b){
    if(sortBy==='score_desc')return(b.score||0)-(a.score||0);
    if(sortBy==='score_asc')return(a.score||0)-(b.score||0);
    if(sortBy==='name')return((a.fn||'')+(a.ln||'')).localeCompare((b.fn||'')+(b.ln||''));
    return(b.appDate||'').localeCompare(a.appDate||'');
  });
  var tbody=document.getElementById('dashTableBody');if(!tbody)return;
  if(!filtered.length){tbody.innerHTML='<tr><td colspan="8" class="empty-state"><div class="empty-icon">📋</div><p>No applications match.</p></td></tr>';return;}
  tbody.innerHTML=filtered.map(function(a){
    var hasScore=typeof a.score==='number';
    var tc=tierColor(a.tier);
    var _clsMap={'Section 95 — Social Housing':['#e8eef5','#1e3a5f'],'Section 95 — Rent to Own':['#eff6ff','#1d4ed8'],'Section 10':['#fdf4ff','#7c3aed'],'Social Housing':['#e8eef5','#1e3a5f'],'Rent to Own':['#eff6ff','#1d4ed8'],'Band House':['#faf5ff','#7c3aed'],'Employee Housing':['#fef9ec','#7a6000'],'Owned':['#f0fdf4','#15803d'],'Rental':['#f4f4f0','#444'],'Non-Social Housing':['#f0fdf4','#15803d']};
    var _clsStyle=_clsMap[a.classification]||['#f4f4f0','#888'];
    var clsBg=_clsStyle[0]; var clsColor=_clsStyle[1];
    var statusMap={draft:['Draft','pill-draft'],submitted:['Awaiting HM Review','pill-submitted'],file_update:['File Update — Awaiting HM','pill-submitted'],mgr_approved:['Awaiting ED Approval','pill-mgr'],hm_recommended:['HM Recommended','pill-mgr'],hm_approved:['File Update Approved','pill-approved'],ed_approved:['ED Approved','pill-approved'],declined:['Declined','pill-declined'],returned:['Returned for Info','pill-returned'],housed:['Housed','pill-approved'],assigned:['Assigned','pill-assigned']};
    var sp=statusMap[a.status]||['—','pill-draft'];
    var role=window.currentRole||'housing_employee_l1';
    var canReviewFromDash = (APPROVAL_AUTHORITY.can('reviewApplication', role) && (a.status===APP_STATUS.SUBMITTED||a.status==='returned'||a.status===APP_STATUS.FILE_UPDATE))
      || (APPROVAL_AUTHORITY.can('finalApproveApp', role) && (a.status===APP_STATUS.MGR_APPROVED||a.status===APP_STATUS.SUBMITTED));
    // Assign is suppressed when Review is also available so a single row
    // never shows both — the application must be reviewed/approved first.
    var canAssignFromDash = (ROLE.isManagement(role))
      && (a.status===APP_STATUS.ED_APPROVED||a.status===APP_STATUS.MGR_APPROVED)
      && !a.assignedUnit && !a.archived
      && !canReviewFromDash;
    var aIdEsc = escapeHtml(a.id);
    return '<tr>'
      +'<td style="cursor:pointer;" data-sc-id="'+aIdEsc+'">'
      +'<div class="appl-name" style="text-decoration:underline;text-decoration-color:var(--border);text-underline-offset:2px;">'+escapeHtml(a.fn||'—')+' '+escapeHtml(a.ln||'')+'</div>'
      +'<div class="appl-id">'+aIdEsc+' · '+escapeHtml(a.appDate||'—')+'</div></td>'
      +'<td class="col-date col-hide-mobile" class="js-txt-muted-sm">'+escapeHtml(a.appDate||'—')+'</td>'
      +'<td class="col-cls col-hide-mobile"><span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;background:'+clsBg+';color:'+clsColor+';white-space:nowrap;">'+escapeHtml((a.classification||'—').replace(' Housing',''))+'</span></td>'
      +'<td class="col-res col-hide-mobile" class="empty-sub">'+escapeHtml(a.reserve||'—')+'</td>'
      +'<td class="col-arr col-hide-mobile" style="font-size:12px;color:'+(a.hasArrears?'var(--danger)':'var(--muted)')+';font-weight:600;">'+(a.hasArrears?'Yes':'—')+'</td>'
      +'<td><span class="pill '+sp[1]+'"><span class="pill-dot"></span>'+sp[0]+'</span></td>'
      +'<td class="col-score">'+(a.appType==='existing_tenant'?'<span style="font-size:10px;font-weight:700;padding:3px 9px;border-radius:8px;background:var(--bg);color:var(--muted);white-space:nowrap;">File Update</span>':(hasScore?'<button class="score-cell-btn" data-score-id="'+aIdEsc+'" onclick="window._openScoreByEl(this)" title="Click to see score breakdown"><span class="score-num">'+a.score+'</span><div class="score-right"><span class="score-tier-badge" style="background:'+tc.bg+';color:'+tc.c+';font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;">'+escapeHtml((a.tier||'').replace(' Priority',''))+'</span>'+scoreMiniBar(a.score)+'</div></button>':'<span class="js-txt-muted-sm">—</span>'))+'</td>'
      +'<td style="white-space:nowrap;"><div style="display:flex;gap:4px;align-items:center;">'
      +'<button class="dash-action-btn edit-app-btn" data-id="'+aIdEsc+'" title="Edit" style="padding:5px 8px;">'
      +'<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7\"/><path d=\"M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z\"/></svg>'
      +'</button>'
      +'<button class="dash-action-btn preview-app-btn" data-id="'+aIdEsc+'" title="Print Preview" style="padding:5px 8px;">'
      +'<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"6 9 6 2 18 2 18 9\"/><path d=\"M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2\"/><rect x=\"6\" y=\"14\" width=\"12\" height=\"8\"/></svg>'
      +'</button>'
      +'<button class="dash-action-btn app-menu-btn" data-id="'+aIdEsc+'" title="More options" style="padding:5px 7px;font-size:14px;line-height:1;">⋮</button>'
      +(canReviewFromDash?'<button class="dash-action-btn review-app-btn" data-id="'+aIdEsc+'" style="padding:4px 10px;background:var(--info-blue);color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;white-space:nowrap;margin-left:2px;">Review →</button>':'')
      +(canAssignFromDash?'<button class="dash-action-btn assign-app-btn" data-id="'+aIdEsc+'" title="Assign Unit" style="padding:4px 10px;background:var(--yellow);color:var(--dark);border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;white-space:nowrap;margin-left:2px;">Assign →</button>':'')
      +'</div></td>'
      +'</tr>';
  }).join('');
}

function wireDashTable(){
  var wrap=document.querySelector('#dashTable')?.closest('.doclib-table-wrap') || document.querySelector('.doclib-table-wrap');
  if(!wrap) return;
  if(wrap._wired) return; // already delegated — event delegation handles new rows automatically
  wrap._wired=true;
  wrap.addEventListener('click',function(e){
    // Applicant name td click — opens the application form for editing.
    // (Score breakdown lives on the score cell itself via _openScoreByEl.)
    var scTd=e.target.closest('[data-sc-id]');
    if(scTd && !e.target.closest('button')){
      var scId=scTd.getAttribute('data-sc-id');
      if(scId && typeof window.openEditModal === 'function') window.openEditModal(scId);
      return;
    }
    // Preview button
    var pvBtn=e.target.closest('.preview-app-btn');
    if(pvBtn){
      var pvApp=(typeof applications!=='undefined'?applications:[]).find(function(a){return a.id===pvBtn.getAttribute('data-id');});
      if(pvApp) previewFromDash(pvApp);
      return;
    }
    // Review button — opens scorecard directly for approval
    var rvBtn=e.target.closest('.review-app-btn');
    if(rvBtn){
      var rvApp=(typeof applications!=='undefined'?applications:[]).find(function(a){return a.id===rvBtn.getAttribute('data-id');});
      if(rvApp) showScorecard(rvApp);
      return;
    }
    var aBtn=e.target.closest('.assign-app-btn');
    if(aBtn){
      var aid=aBtn.getAttribute('data-id');
      if(aid) {
        // Find best matching vacant unit for this applicant
        var _dashApp=(typeof applications!=='undefined'?applications:[]).find(function(a){return a.id===aid;});
        var _dashBest='';
        if(_dashApp){
          var _allU=[];
          _allU = housingUnits.slice();
          if(!_allU.length)_allU=(typeof housingUnits!=='undefined'&&housingUnits.length)?housingUnits:(window.HOUSING_UNITS_DATA||[]);
          var _vac=_allU.filter(function(u){return u.status==='vacant'&&!u.archived;});
          var _nb=Math.max(1,1+(_dashApp.coApp?1:0)+((_dashApp.habitants||[]).length));
          var _na=_dashApp.accessibility&&_dashApp.accessibility!=='None'&&_dashApp.accessibility!=='0'&&_dashApp.accessibility!==0;
          var _age=_dashApp.dob?Math.floor((new Date()-new Date(_dashApp.dob))/(365.25*24*3600*1000)):0;
          var _scored=_vac.map(function(u){
            var sc=0;
            if(u.bedrooms===_nb)sc+=10;else if(u.bedrooms>_nb)sc+=5;else if(u.bedrooms===_nb-1)sc+=3;
            if(_na&&u.accessible)sc+=8;if(_na&&!u.accessible)sc-=4;
            if(_age>=55&&u.isElders)sc+=6;if(_age<55&&u.isElders)sc-=2;
            return{u:u,sc:sc};
          }).sort(function(a,b){return b.sc-a.sc;});
          if(_scored.length)_dashBest=_scored[0].u.id;
        }
        openAssignModal(aid, _dashBest);
      }
      return;
    }
    var eBtn=e.target.closest('.edit-app-btn');
    if(eBtn){var id=eBtn.getAttribute('data-id');if(id)window.openEditModal(id);}
    var mBtn=e.target.closest('.app-menu-btn');
    if(mBtn){
      var mid=mBtn.getAttribute('data-id');
      if(mid){
        var proxyE = {stopPropagation:function(){e.stopPropagation();},currentTarget:mBtn};
        window.openAppMenu(proxyE, mid);
      }
    }
  });
}


// ── Dashboard row context menu (⋮) ──────────────────────────────────────────

window.openAppMenu = function(e, appId) {
  e.stopPropagation();

  // Remove any existing menu
  var existing = document.getElementById('_appContextMenu');
  if (existing) { existing.remove(); if (window._appMenuId === appId) { window._appMenuId = null; return; } }
  window._appMenuId = appId;

  var app = applications.find(function(a){ return a.id === appId; });
  if (!app) return;

  var role = window.currentRole || 'housing_employee_l1';
  var isArchived = !!app.archived;
  var isDeclined = app.status === 'declined';

  // Build menu items
  var items = [];

  // Archive / Unarchive — HM and ED only
  if (ROLE.isManagement(role)) {
    if (isArchived) {
      items.push({ icon: '📤', label: 'Unarchive', action: 'unarchive', color: '#1d4ed8' });
    } else {
      items.push({ icon: '📦', label: 'Archive', action: 'archive', color: '#d97706' });
    }
  }

  // Decline — HM and ED only, not already declined
  if ((ROLE.isManagement(role)) && !isDeclined && !isArchived) {
    items.push({ icon: '✕', label: 'Decline Application', action: 'decline', color: '#b91c1c' });
  }

  // Restore declined
  if (isDeclined && (ROLE.isManagement(role))) {
    items.push({ icon: '↩', label: 'Restore to Submitted', action: 'restore', color: '#15803d' });
  }

  // View scorecard — always
  items.push({ icon: '👁', label: 'View Scorecard', action: 'scorecard', color: 'var(--text)' });

  if (!items.length) return;

  // Build dropdown DOM
  var menu = document.createElement('div');
  menu.id = '_appContextMenu';
  menu.style.cssText = [
    'position:fixed',
    'z-index:9999',
    'background:var(--surface)',
    'border:1px solid var(--border)',
    'border-radius:10px',
    'box-shadow:0 8px 30px rgba(0,0,0,0.25)',
    'min-width:190px',
    'overflow:hidden',
    'font-family:DM Sans,sans-serif'
  ].join(';');

  // Header — applicant name
  var appName = ((app.fn||'') + ' ' + (app.ln||'')).trim() || app.id;
  var header = document.createElement('div');
  header.style.cssText = 'padding:10px 14px;background:var(--dark);border-bottom:1px solid var(--border);';
  header.innerHTML = '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--muted);">'
    + app.id + '</div>'
    + '<div style="font-size:13px;font-weight:700;color:#fff;margin-top:1px;">' + appName + '</div>';
  menu.appendChild(header);

  items.forEach(function(item) {
    var btn = document.createElement('button');
    btn.style.cssText = 'width:100%;background:none;border:none;padding:10px 14px;text-align:left;'
      + 'font-size:13px;font-weight:600;font-family:DM Sans,sans-serif;cursor:pointer;'
      + 'display:flex;align-items:center;gap:10px;color:' + item.color + ';'
      + 'border-bottom:1px solid var(--border);';
    btn.innerHTML = '<span style="font-size:15px;width:20px;text-align:center;">' + item.icon + '</span>'
      + '<span>' + item.label + '</span>';
    btn.onmouseover = function(){ this.style.background = 'var(--bg)'; };
    btn.onmouseout  = function(){ this.style.background = 'none'; };
    btn.onclick = function(ev) {
      ev.stopPropagation();
      menu.remove();
      window._appMenuId = null;
      _handleAppMenuAction(item.action, appId);
    };
    menu.appendChild(btn);
  });
  // Remove last border
  var lastBtn = menu.querySelector('button:last-child');
  if (lastBtn) lastBtn.style.borderBottom = 'none';

  document.body.appendChild(menu);

  // Position near the button
  var btn = e.currentTarget;
  var rect = btn.getBoundingClientRect();
  var menuW = 200, menuH = items.length * 42 + 52;
  var left = rect.right - menuW;
  var top  = rect.bottom + 4;

  // Keep on screen
  if (left < 8) left = 8;
  if (top + menuH > window.innerHeight - 8) top = rect.top - menuH - 4;

  menu.style.left = left + 'px';
  menu.style.top  = top  + 'px';

  // Close on outside click
  function onOutside(ev) {
    if (!menu.contains(ev.target)) {
      menu.remove();
      window._appMenuId = null;
      document.removeEventListener('click', onOutside, true);
    }
  }
  setTimeout(function(){
    document.addEventListener('click', onOutside, true);
  }, 0);
};

// Completes the decline action once the user has typed (or skipped) a
// reason in the styled showPrompt dialog. Pulled out of the menu-action
// switch so the prompt's .then() callback can call it cleanly. Handles
// the unit-unwind, status flip, audit rows, persistence, and post-action
// re-renders all in one place.
function _finishDeclineApp(appId, reason, role) {
  var idx = applications.findIndex(function(a){ return a.id === appId; });
  if (idx === -1) { showToast('Application not found'); return; }

  // If the applicant had a unit assigned, unwind that first. Without this,
  // declining an already-assigned applicant left the unit stuck as
  // occupied/reserved with no live tenancy. We flip the unit back to
  // vacant, clear its assignment fields, audit the unit row, and clear
  // the assignment from the app side too.
  var hadUnit = applications[idx].assignedUnit;
  if (hadUnit) {
    var allU = (typeof housingUnits !== 'undefined') ? housingUnits : [];
    var uIdx = allU.findIndex(function(u){ return u.id === hadUnit; });
    if (uIdx >= 0) {
      var u = allU[uIdx];
      var prevAddr = ((u.num||'')+' '+(u.street||'')).trim() || hadUnit;
      u.assignedTo = '';
      u.assignedName = '';
      u.assignedDate = '';
      u.tenantApprovedBy = '';
      u.tenantApprovedAt = '';
      u.transferPending = false;
      u.status = 'vacant';
      allU[uIdx] = u;
      saveUnitWithDraftFallback(u).then(function(ok){
        if(!ok) showToast('Unit unassignment saved locally — will sync when network is available.', { type:'info', duration:3500 });
      });
      auditEntry(u.id, 'unit_unassigned',
        prevAddr + ' returned to vacant — applicant declined' + (reason ? ' (' + reason + ')' : ''),
        role);
    }
    applications[idx].assignedUnit = '';
    applications[idx].assignedAddress = '';
    applications[idx].assignmentOverrideNotes = '';
    applications[idx].transferPending = false;
  }

  applications[idx].status = 'declined';
  applications[idx].declinedAt  = new Date().toISOString().split('T')[0];
  applications[idx].declinedBy  = role;
  if (reason) applications[idx].declinedReason = reason;
  saveApplicationWithDraftFallback(applications[idx]).then(function(ok){
    if(!ok) showToast('Decline saved locally — will sync when network is available.', { type:'info', duration:3500 });
  });
  auditEntry(appId, 'status',
    'Application declined' + (hadUnit ? ' (and unit assignment unwound)' : '') + (reason ? ' — ' + reason : ''),
    role);
  if (typeof updateDashStats === 'function') updateDashStats();
  if (typeof renderDashTable === 'function') renderDashTable();
  if (typeof renderWorklist === 'function') renderWorklist();
  showToast('Application declined' + (hadUnit ? ' — unit returned to vacant' : ''));
}

function _handleAppMenuAction(action, appId) {
  var idx = applications.findIndex(function(a){ return a.id === appId; });
  if (idx === -1) { showToast('Application not found'); return; }
  var app = applications[idx];
  var role = window.currentRole || 'housing_employee_l1';

  if (action === 'archive') {
    showConfirm({
      title:       'Archive this application?',
      message:     'It will be hidden from the main list. All supporting documents will be preserved in the archive record.',
      confirmText: 'Archive',
      danger:      true
    }).then(function(ok){ if (ok) archiveApplication(appId); });

  } else if (action === 'unarchive') {
    applications[idx].archived = false;
    applications[idx].archivedAt = null;
    applications[idx].archivedBy = null;
    saveApplicationWithDraftFallback(applications[idx]).then(function(ok){
      if(!ok) showToast('Unarchive saved locally — will sync when network is available.', { type:'info', duration:3500 });
    });
    auditEntry(appId, 'unarchived', 'Application restored from archive', role);
    updateDashStats(); renderDashTable();
    if (typeof renderWorklist === 'function') renderWorklist();
    showToast('📤 Application unarchived');

  } else if (action === 'decline') {
    // Styled prompt (showPrompt in shared.js) — replaces the native
    // browser prompt() that dropped from the top of the viewport.
    showPrompt({
      title:       'Decline application',
      message:     'Reason for declining (optional):',
      placeholder: 'e.g. duplicate submission, applicant withdrew, …',
      confirmText: 'Decline',
      cancelText:  'Cancel',
      danger:      true,
      multiline:   true
    }).then(function(reason){
      if (reason === null) return; // cancelled
      _finishDeclineApp(appId, reason, role);
    });

  } else if (action === 'restore') {
    applications[idx].status = APP_STATUS.SUBMITTED;
    applications[idx].declinedAt = null;
    applications[idx].declinedBy = null;
    applications[idx].declinedReason = null;
    // Single save AFTER all metadata is cleared — earlier code saved twice,
    // and the first save fired before the declined* fields were nulled.
    saveApplicationWithDraftFallback(applications[idx]).then(function(ok){
      if(!ok) showToast('Restore saved locally — will sync when network is available.', { type:'info', duration:3500 });
    });
    auditEntry(appId, 'status', 'Application restored to submitted', role);
    updateDashStats(); renderDashTable();
    if (typeof renderWorklist === 'function') renderWorklist();
    showToast('↩ Application restored to submitted');

  } else if (action === 'scorecard') {
    var a = applications[idx];
    if(true) showScorecard(a);
  }
}



function filterDash(status){
  var el=document.getElementById('dashFilterStatus');
  if(el){el.value=status;renderDashTable();}
}

// ── View switchers ──
// ── Inventory view ──


// ── Match view ──


// ── Tenants view ──


// ── Renovations view ──

// ── Contractors view ──




// ══ RESTORED APP FORM FUNCTIONS ══

function updateRenosHint(){
  // Updates any UI hint related to the reno cost field — currently a no-op placeholder
}

function liveSync(){
  var cls=getHousingClassification();
  var el=document.getElementById('classificationCard');
  if(el)el.textContent=cls;
}

// ── Collect all form fields into an app object and save ──
// opts.draft: true → treat as autosave; status stays 'draft' until the user
//                    explicitly submits. Never downgrades an already-submitted
//                    or approved application back to draft.
function saveApplicationRecord(opts){
  var appType = typeof getAppType === 'function' ? getAppType() : 'new_housing';
  var isFileUpdate = (appType === 'existing_tenant');

  // Helpers
  function fv(id){ var e=document.getElementById(id); return e ? e.value.trim() : ''; }
  function fb(id){ var e=document.getElementById(id); return e ? e.checked : false; }
  function fsel(id){ var e=document.getElementById(id); return e ? e.value : ''; }

  // Collect incomes
  var incomes=[];
  document.querySelectorAll('#incomeList .rrow').forEach(function(row){
    var person=row.querySelector('[data-role="person"]');
    var type=row.querySelector('[data-role="incType"]');
    var empName=row.querySelector('[data-role="empName"]');
    var incAmt=row.querySelector('[data-role="incPeriod"]');
    // grab primary income amount — first currency input inside amount_grp
    var amtGrp=row.querySelector('[data-grp="amount_grp"]');
    var amt=amtGrp?amtGrp.querySelector('input[type="text"]'):null;
    if(person&&person.value){
      incomes.push({
        person:person.value||'Applicant',
        incomeType:(type&&type.value)||'',
        employer:(empName&&empName.value)||'',
        primaryAmt:amt?parseFloat((amt.value||'').replace(/[^0-9.]/g,''))||null:null
      });
    }
  });
  // Fallback: read from any income inputs
  if(!incomes.length){
    var incType=document.querySelector('#incomeList select');
    var incAmt=document.querySelector('#incomeList input[type="number"]');
    if(incType&&incType.value) incomes.push({person:'Applicant',incomeType:incType.value,employer:'',primaryAmt:incAmt?parseFloat(incAmt.value)||null:null});
  }

  // Collect habitants
  var habitants=[];
  document.querySelectorAll('#habList .rrow').forEach(function(row){
    var fn=row.querySelector('[data-role="habFn"]');
    var ln=row.querySelector('[data-role="habLn"]');
    var dob=row.querySelector('[data-role="habDob"]');
    var rel=row.querySelector('[data-role="habRel"]');
    if(fn&&fn.value) habitants.push({fn:fn.value,ln:(ln&&ln.value)||'',dob:(dob&&dob.value)||'',relationship:(rel&&rel.value)||''});
  });

  // Co-applicant
  var hasCoApp = fsel('co_status')==='yes';
  var coApp = hasCoApp ? {
    fn:fv('co_fn'), ln:fv('co_ln'), dob:fv('co_dob'),
    band:fv('co_band'), reserve:fsel('co_reserve'),
    cell:fv('co_cell'), home:fv('co_home'), email:fv('co_email'),
    occDate:fv('coOccDate'),
    sameAddr: fb('co_same_addr') ? 'True' : 'False',
    hasArrears:        fb('coArrToggle'),
    arrBalAmt:         fb('coArrToggle') ? parseFloat((fv('coArrBalAmt')||'').replace(/[^0-9.]/g,''))||null : null,
    arrMonthlyPayment: fb('coArrToggle') ? parseFloat((fv('coArrMonthlyPayment')||'').replace(/[^0-9.]/g,''))||null : null,
    arrFrequency:      fb('coArrToggle') ? fsel('coArrFrequency') : null,
    arrPlanMonths:     fv('coArrPlanMonths') ? parseInt(fv('coArrPlanMonths'))||null : null,
    arrAgreementDate:  fv('coArrAgreementDate') || null,
    arrFirstDueDate:   fv('coArrFirstDueDate') || null
  } : null;

  // Pets
  var pets=[];
  document.querySelectorAll('#petList .rrow').forEach(function(row){
    var name=row.querySelector('[data-role="petName"]');
    var type=row.querySelector('[data-role="petType"]');
    var size=row.querySelector('[data-role="petSize"]');
    var desc=row.querySelector('textarea');
    if(type&&type.value) pets.push({
      name:(name&&name.value)||'',
      type:type.value,
      size:(size&&size.value)||'',
      desc:(desc&&desc.value)||''
    });
  });

  // References
  var refs=[];
  document.querySelectorAll('#refList .rrow').forEach(function(row){
    var fn=row.querySelector('[data-role="refFn"]');
    var ln=row.querySelector('[data-role="refLn"]');
    var ph=row.querySelector('[data-role="refPhone"]');
    var rel=row.querySelector('[data-role="refRel"]');
    var em=row.querySelector('[data-role="refEmail"]');
    if(fn&&fn.value) refs.push({
      fn:fn.value,
      ln:(ln&&ln.value)||'',
      phone:(ph&&ph.value)||'',
      relationship:(rel&&rel.value)||'',
      email:(em&&em.value)||''
    });
  });

  // Score — only for new housing applications
  var scoreTotal = 0, scoreTier = 'Unscored';
  if(!isFileUpdate && typeof calcScore === 'function'){
    var scoreEl = document.getElementById('sc_score_total');
    var tierEl  = document.getElementById('sc_score_tier');
    scoreTotal = scoreEl ? (parseInt(scoreEl.textContent)||0) : 0;
    scoreTier  = tierEl  ? (tierEl.textContent||'Low Priority') : 'Low Priority';
  }

  // Accessibility
  var accVals=[];
  document.querySelectorAll('#accChecks input[type="checkbox"]:checked,[data-acc]:checked').forEach(function(el){
    accVals.push(el.getAttribute('data-acc')||el.value);
  });
  var accStr = accVals.join(', ') || fsel('accessibility') || '0';

  var appId = currentAppId || (typeof generateAppId==='function' ? generateAppId() : 'APP-000000');
  currentAppId = appId;

  var appObj = {
    id:          appId,
    appType:     appType,        // 'new_housing' | 'existing_tenant'
    fn:          fv('fn'),
    ln:          fv('ln'),
    dob:         fv('dob'),
    band:        fv('band'),
    reserve:     fsel('reserve'),
    marital:     fsel('marital'),
    phone:       fv('phone'),
    email:       fv('email'),
    street:      fv('street'),
    city:        fv('city'),
    province:    fsel('prov'),
    postal:      fv('postal'),
    occDate:     fv('occDate'),
    appDate:     fv('appDate') || new Date().toISOString().slice(0,10),
    accessibility: accStr,
    haveHouse:   fb('hasHouseToggle'),
    homeCondition: fb('hasHouseToggle') ? fsel('homeCondition') : null,
    hasArrears:  fb('arrToggle'),
    arrBalAmt:   fb('arrToggle') ? parseFloat((fv('arrBalAmt')||'').replace(/[^0-9.]/g,''))||null : null,
    arrMonthlyPayment: fb('arrToggle') ? parseFloat((fv('arrMonthlyPayment')||'').replace(/[^0-9.]/g,''))||null : null,
    arrFrequency: fb('arrToggle') ? fsel('arrFrequency') : null,
    arrPlanMonths: fv('arrPlanMonths') ? parseInt(fv('arrPlanMonths'))||null : null,
    // ── V2 scoring fields ──
    urgentNeed:          fsel('urgent_need') || 'none',
    healthRisk:          fsel('health_risk') || 'none',
    personsOverStandard: parseInt(fv('persons_over_standard'))||0,
    loneParent:          fb('lone_parent'),
    elderInHousehold:    fb('elder_in_household'),
    householdDisability: fb('household_disability'),
    incomeStability:     fsel('income_stability') || 'stable',
    noPriorTenancy:      (fsel('no_prior_tenancy') || 'true') === 'true',
    rentPaymentHistory:  fsel('rent_payment_history') || 'no_history',
    unitCondition:       fsel('unit_condition') || 'no_history',
    tenancyConduct:      fsel('tenancy_conduct') || 'no_history',
    arrearsStatus:       (function() {
      if (!fb('arrToggle')) return 'none';
      return (parseInt(fv('arrPlanMonths'))||0) > 0 ? 'repayment' : 'no_repayment';
    })(),
    hasCoApp:    hasCoApp,
    coApp:       coApp,
    incomes:     incomes,
    habitants:   habitants,
    pets:        pets.length ? pets : [{name:null,type:null,size:null,desc:null}],
    references:  refs.length ? refs : [{fn:null,ln:null,phone:null,email:null,relationship:null}],
    classification: (function(){ var v=(document.getElementById('classification')||{}).value||''; if(v) return v; var t=((document.getElementById('classificationCard')||{}).textContent||'').trim(); return (t&&t!=='—')?t:'Undetermined'; })(),
    // Consent to share with other CLFN programs (PIPEDA-aligned). Recorded but
    // not gated — applicants can submit either way; HM/ED can see the choice
    // when reviewing. Timestamp + capturing role tell us when/by-whom the box
    // was last toggled.
    consentShareCLFN:    fb('consent_share_programs'),
    consentShareCLFNAt:  (function(){
      var existing = applications.find(function(a){ return a.id === appId; });
      var checkedNow = fb('consent_share_programs');
      // Stamp on the first save that has the box checked; preserve existing stamp.
      if(checkedNow && existing && existing.consentShareCLFNAt) return existing.consentShareCLFNAt;
      if(checkedNow) return new Date().toISOString();
      return null;
    })(),
    consentShareCLFNBy:  (function(){
      var existing = applications.find(function(a){ return a.id === appId; });
      var checkedNow = fb('consent_share_programs');
      if(checkedNow && existing && existing.consentShareCLFNBy) return existing.consentShareCLFNBy;
      if(checkedNow) return (typeof HOUSING_SESSION !== 'undefined' && HOUSING_SESSION.email) || (window.currentRole || 'staff');
      return null;
    })(),
    status:      (function(){
      // Autosave path: stay in 'draft' until the user explicitly submits, but
      // never downgrade an already submitted/approved application.
      if (opts && opts.draft) {
        var existingApp = applications.find(function(a){ return a.id === appId; });
        var existingStatus = existingApp && existingApp.status;
        if (!existingStatus || existingStatus === APP_STATUS.DRAFT) {
          return APP_STATUS.DRAFT;
        }
        return existingStatus;
      }
      return isFileUpdate ? 'file_update' : 'submitted';
    })(),
    submittedAt: new Date().toISOString().slice(0,10),
    score:       isFileUpdate ? null : scoreTotal,
    // ── Ownership ──
    // On first create: set to the logged-in user.
    // On subsequent edits: carry forward the original owner so the
    // HE-L1 RLS rule (own-draft-only) keeps working correctly.
    created_by_email: (function() {
      var existing = applications.find(function(a){ return a.id === appId; });
      return (existing && existing.created_by_email)
        ? existing.created_by_email
        : (HOUSING_SESSION.email || null);
    })(),
    created_by_name: (function() {
      var existing = applications.find(function(a){ return a.id === appId; });
      return (existing && existing.created_by_name)
        ? existing.created_by_name
        : (HOUSING_SESSION.name || null);
    })(),
    tier:        isFileUpdate ? 'File Update' : scoreTier,
    scoreBreakdown: isFileUpdate ? {} : (window._lastScoreBreakdown || {}),

    // ── Signatures (applicant + co-applicant + staff) ──
    sig: {
      applicant: {
        name:  fv('sig_name'),
        date:  fv('sig_date'),
        image: (typeof getSigDataURL === 'function') ? getSigDataURL('sig_canvas_app') : ''
      },
      coApplicant: hasCoApp ? {
        name:  fv('sig_co_name'),
        date:  fv('sig_co_date'),
        image: (typeof getSigDataURL === 'function') ? getSigDataURL('sig_canvas_co') : ''
      } : null,
      staff: {
        name:  fv('sig_staff'),
        date:  fv('sig_recv'),
        image: (typeof getSigDataURL === 'function') ? getSigDataURL('sig_canvas_staff') : ''
      }
    },
    // Internal use fields (filled during approval process)
    hmSig: {
      name:     fv('sig_hm_name'),
      date:     fv('sig_hm_date'),
      decision: fv('sig_hm_decision') || (document.getElementById('sig_hm_decision') ? document.getElementById('sig_hm_decision').value : ''),
      notes:    fv('sig_hm_notes')
    },
    edSig: {
      name:     fv('sig_ed_name'),
      date:     fv('sig_ed_date'),
      decision: fv('sig_ed_decision') || (document.getElementById('sig_ed_decision') ? document.getElementById('sig_ed_decision').value : ''),
      notes:    fv('sig_ed_notes_sig')
    }
  };

  // Update or insert into applications array
  var idx = applications.findIndex(function(a){ return a.id === appId; });
  if(idx >= 0){
    applications[idx] = Object.assign({}, applications[idx], appObj);
  } else {
    applications.push(appObj);
  }

  // Persist via the local-first wrapper. The wrapper writes to the localStorage
  // draft queue synchronously before attempting the Supabase upsert, so a
  // PGRST303 / 401 / network blip cannot drop the row (including signature
  // images captured on the Review step). The next housing.html boot drains
  // the queue automatically.
  if (typeof saveApplicationWithDraftFallback === 'function') {
    saveApplicationWithDraftFallback(appObj).then(function(ok){
      if(!ok && typeof showToast === 'function') {
        showToast('Saved locally — will sync when network is available.', { type:'info', duration:3500 });
      }
    });
  } else {
    // Defensive fallback if shared-data.js hasn't loaded yet.
    sbSaveApplication(appObj).catch(function(e){
      console.warn('App save failed:', e);
      if (typeof showToast === 'function') {
        showToast('Could not save application — ' + ((e && e.message) || 'check your connection'), { type:'error', duration:5000 });
      }
    });
  }

  // Audit — log save/update events
  var _isNew = (idx < 0);  // idx was set before push
  var _appType = appObj.appType === 'existing_tenant' ? 'File Update' : 'New Housing';
  var _status  = appObj.status || 'draft';
  if(_status === APP_STATUS.DRAFT) {
    // Only log draft saves once (first time)
    if(_isNew) auditEntry(appId, 'draft_saved', _appType + ' — draft created', window.currentRole||'staff');
  }
  // Signature capture audit
  if(appObj.sig) {
    if(appObj.sig.applicant && appObj.sig.applicant.image)
      auditEntry(appId, 'signature_captured', 'Applicant signature recorded — ' + (appObj.sig.applicant.name||'name not provided'), window.currentRole||'staff');
    if(appObj.sig.coApplicant && appObj.sig.coApplicant.image)
      auditEntry(appId, 'signature_captured', 'Co-applicant signature recorded — ' + (appObj.sig.coApplicant.name||'name not provided'), window.currentRole||'staff');
    if(appObj.sig.staff && appObj.sig.staff.image)
      auditEntry(appId, 'signature_captured', 'Staff signature recorded — ' + (appObj.sig.staff.name||'name not provided'), window.currentRole||'staff');
  }

  // Upload any staged documents to Supabase Storage
  if(typeof uploadPendingAppFiles === 'function' && (appObj.status === APP_STATUS.SUBMITTED || appObj.status === APP_STATUS.FILE_UPDATE)) {
    uploadPendingAppFiles(appId).catch(function(e){ console.warn('App file upload error:', e); });
  }

  return appId;
}

function renderApprovalFlow(){
  var el = document.getElementById('approvalFlow');
  if(!el) return;
  var isFileUpdate = typeof getAppType === 'function' && getAppType() === 'existing_tenant';
  var _hmLbl = CLFN_PERMS.roleLabel(ROLE.HOUSING_MANAGER);
  var _edLbl = CLFN_PERMS.roleLabel(ROLE.ED);
  var steps = isFileUpdate
    ? [{label:'Employee',icon:'📝',done:true},{label:_hmLbl,icon:'✅',done:false}]
    : [{label:'Employee',icon:'📝',done:true},{label:_hmLbl,icon:'🔍',done:false},{label:_edLbl,icon:'✅',done:false}];
  el.innerHTML = steps.map(function(s,i){
    var circleStyle = s.done
      ? 'background:var(--yellow);color:var(--text);border:2px solid var(--yellow);'
      : 'background:var(--surface);color:var(--muted);border:2px solid var(--border);';
    var html = '<div style="display:flex;flex-direction:column;align-items:center;gap:4px;">'
      +'<div style="width:36px;height:36px;border-radius:50%;'+circleStyle+'display:flex;align-items:center;justify-content:center;font-size:14px;">'+s.icon+'</div>'
      +'<div style="font-size:10px;font-weight:600;color:'+(s.done?'var(--text)':'var(--muted)')+';">'+s.label+'</div>'
      +'</div>';
    if(i < steps.length-1) html += '<div style="flex:1;height:2px;background:var(--border);align-self:center;margin:0 6px;min-width:20px;"></div>';
    return html;
  }).join('');
}

function popReview(){
  // Populate the review summary card in step 8
  var rc = document.getElementById('reviewContent');
  if(!rc) return;
  function fld(id){ var e=document.getElementById(id); return (e&&e.value&&e.value.trim())?e.value.trim():'—'; }
  function chk(id){ var e=document.getElementById(id); return e?e.checked:false; }
  function sel(id){ var e=document.getElementById(id); return (e&&e.options&&e.selectedIndex>=0&&e.options[e.selectedIndex].text!=='— Select —')?e.options[e.selectedIndex].text:'—'; }

  var fn=fld('fn'), ln=fld('ln');
  var name = (fn!=='—'||ln!=='—') ? (fn+' '+ln).replace('— ','').replace(' —','').trim() : '—';
  var isFileUpdate = typeof getAppType==='function' && getAppType()==='existing_tenant';
  var appId = (document.getElementById('appNumCard')||{}).textContent || (typeof currentAppId!=='undefined'?currentAppId:'—');

  function row(k,v,highlight){
    var vColor = highlight ? 'color:#b91c1c;' : '';
    return '<div style="display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;">'
      +'<span style="color:var(--muted);flex-shrink:0;font-size:12px;">'+k+'</span>'
      +'<span style="font-weight:600;text-align:right;'+vColor+'">'+(v||'—')+'</span>'
      +'</div>';
  }
  function section(title, rowsHtml, icon){
    return '<div style="padding:16px 20px;border-bottom:1px solid var(--border);">'
      +'<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);margin-bottom:12px;display:flex;align-items:center;gap:6px;">'
      +(icon?'<span>'+icon+'</span>':'')+'<span>'+title+'</span></div>'
      + rowsHtml + '</div>';
  }

  var html = '';

  // ── Dark header bar ──────────────────────────────────────────────────────
  html += '<div style="padding:14px 20px;background:var(--dark);border-bottom:2px solid var(--yellow);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">'
    +'<div>'
    +'<div style="font-size:16px;font-weight:700;color:#fff;">'+name+'</div>'
    +'<div style="font-size:11px;color:var(--muted);margin-top:2px;">'+appId+'  ·  '+(isFileUpdate?'File Update':'New Housing Application')+'</div>'
    +'</div>';
  // Score badge (if calculated)
  var scoreEl = document.getElementById('totalScore');
  var score = scoreEl ? parseInt(scoreEl.textContent)||0 : 0;
  if(score){
    var tierEl = document.getElementById('priorityTier');
    var tier = tierEl ? tierEl.textContent : '';
    html += '<div style="text-align:right;">'
      +'<div style="font-size:22px;font-weight:800;color:var(--yellow);">'+score+'</div>'
      +'<div style="font-size:10px;color:var(--muted);">'+tier+'</div>'
      +'</div>';
  }
  html += '</div>';

  // ── Personal Information ──────────────────────────────────────────────────
  var band = fld('band');
  var access = fld('accessibility') || (chk('acc_wheelchair')?'Wheelchair':chk('acc_visual')?'Visual':chk('acc_hearing')?'Hearing':'None');
  html += section('Personal Information',
    row('Full Name', name) +
    row('Date of Birth', fld('dob')) +
    row('Band Number', band!=='—'?band:'') +
    row('Reserve Status', fld('reserve')) +
    row('Marital Status', fld('marital')) +
    row('Phone', fld('phone')) +
    row('Email', fld('email')) +
    (access && access!=='—'&&access!=='None' ? row('Accessibility Needs', access) : '')
  , '👤');

  // ── Current Address ───────────────────────────────────────────────────────
  var addrParts = [fld('street'), fld('city'), fld('prov')].filter(function(p){return p&&p!=='—';});
  html += section('Current Address',
    row('Address', addrParts.join(', ')||'—') +
    row('Postal Code', fld('postal')) +
    row('Application Date', fld('appDate')) +
    row('Expected Move-in', fld('occDate'))
  , '🏠');

  // ── Housing Needs ─────────────────────────────────────────────────────────
  var bedsEl = document.getElementById('f_bedrooms') || document.getElementById('f_bed') || document.getElementById('beds');
  var beds = bedsEl ? (bedsEl.value||'—') : '—';
  var classEl = document.getElementById('classificationCard');
  var classDropdown = document.getElementById('classification');
  var classification = (classDropdown && classDropdown.value) ? classDropdown.value : (classEl ? classEl.textContent : '—');
  var hasHouse = chk('hasHouseToggle');
  html += section('Housing Needs',
    row('Classification', classification!==''?classification:'—') +
    row('Bedrooms Requested', beds) +
    row('Currently Has a Unit', hasHouse?'Yes':'No') +
    (hasHouse ? row('Home Condition', fld('homeCondition')) : '')
  , '🔑');

  // ── Employment & Income ───────────────────────────────────────────────────
  var incomeRows = [];
  document.querySelectorAll('#incomeList .rrow').forEach(function(r){
    var sels = r.querySelectorAll('select');
    var inputs = r.querySelectorAll('input[type="text"],input[type="number"]');
    var person = sels[0]?sels[0].value:'';
    var type   = sels[1]?sels[1].value:'';
    var amt    = inputs[0]?inputs[0].value:'';
    if(person||type) incomeRows.push(row((person||'Income')+(type?' — '+type:''), amt||'On file'));
  });
  if(incomeRows.length) {
    html += section('Employment & Income', incomeRows.join(''), '💼');
  }

  // ── Nation arrears ───────────────────────────────────────────────────────
  if(chk('arrToggle')){
    html += section((window.NATION_CONFIG&&NATION_CONFIG.short||'')+' Arrears',
      row('Amount Owed', fld('arrBalAmt'), true) +
      row('Monthly Payment', fld('arrMonthAmt')) +
      row('Plan Duration', fld('arrPlanMonths')!=='—'?fld('arrPlanMonths')+' months':'—')
    , '⚠️');
  }

  // ── Co-Applicant ─────────────────────────────────────────────────────────
  if(fld('co_status')==='yes'){
    html += section('Co-Applicant',
      row('Name', (fld('co_fn')+' '+fld('co_ln')).trim().replace(/^—\s|—$/g,'')) +
      row('Date of Birth', fld('co_dob')) +
      row('Reserve Status', fld('co_reserve')) +
      row('Phone', fld('co_cell')) +
      row('Email', fld('co_email'))
    , '👥');
  }

  // ── Household Members ────────────────────────────────────────────────────
  var habRows = [];
  document.querySelectorAll('#habList .rrow').forEach(function(r){
    var txts = r.querySelectorAll('input[type="text"]');
    var relEl = r.querySelector('select');
    var fn2 = txts[0]?txts[0].value.trim():'';
    var ln2 = txts[1]?txts[1].value.trim():'';
    var rel = relEl?relEl.value:'';
    if(fn2||ln2) habRows.push(row((fn2+' '+ln2).trim(), rel||'—'));
  });
  if(habRows.length) html += section('Household Members ('+habRows.length+')', habRows.join(''), '👨‍👩‍👧');

  // ── References ───────────────────────────────────────────────────────────
  var refRows = [];
  document.querySelectorAll('#refList .rrow').forEach(function(r){
    var txts = r.querySelectorAll('input[type="text"]');
    var tels = r.querySelectorAll('input[type="tel"]');
    var fn3 = txts[0]?txts[0].value.trim():'';
    var ln3 = txts[1]?txts[1].value.trim():'';
    var ph  = tels[0]?tels[0].value.trim():'';
    if(fn3||ln3) refRows.push(row((fn3+' '+ln3).trim(), ph||'—'));
  });
  if(refRows.length) html += section('References ('+refRows.length+')', refRows.join(''), '📋');

  // ── Pets ─────────────────────────────────────────────────────────────────
  var petRows = [];
  document.querySelectorAll('#petList .rrow').forEach(function(r){
    var sels2 = r.querySelectorAll('select');
    var type2 = sels2[0]?sels2[0].value:'';
    var size  = sels2[1]?sels2[1].value:'';
    if(type2) petRows.push(row(type2, size||''));
  });
  if(petRows.length) html += section('Pets ('+petRows.length+')', petRows.join(''), '🐾');

  // ── Documents ────────────────────────────────────────────────────────────
  var docCount = document.querySelectorAll('#fileList .file-item').length;
  html += section('Documents',
    row('Files Attached', docCount > 0 ? docCount+' file'+(docCount!==1?'s':'') : 'None')
  , '📎');

  // ── Close ────────────────────────────────────────────────────────────────
  rc.innerHTML = html;
  // Render the approval flow diagram
  renderApprovalFlow();
}

// Confirm before submitting. Uses the branded showConfirm() helper from
// shared.js so we don't depend on per-page submitModal markup (which only
// existed on match.html — that's why the Submit button on housing.html
// silently did nothing before this fix).
function openSubmitModal(){
  popReview();
  var appType = (typeof getAppType==='function') ? getAppType() : 'new_housing';
  var isFileUpdate = (appType === 'existing_tenant');

  // If the applicant supplied an email, surface an inline opt-in to send
  // them a PDF copy along with the submit confirmation. Default ticked
  // because most applicants want their own record. If no email is on
  // file, skip the checkbox entirely (nothing to opt into).
  var emailEl       = document.getElementById('email');
  var coEmailEl     = document.getElementById('co_email');
  var applicantEmail = (emailEl && emailEl.value && emailEl.value.trim().toLowerCase()) || '';
  var coEmail        = (coEmailEl && coEmailEl.value && coEmailEl.value.trim().toLowerCase()) || '';
  var hasAnyEmail    = !!(applicantEmail || (coEmail && coEmail !== applicantEmail));

  var copyTarget = applicantEmail
    || coEmail
    || '';
  var copyLabel  = (applicantEmail && coEmail && coEmail !== applicantEmail)
    ? ('Email a PDF copy to ' + applicantEmail + ' and ' + coEmail)
    : ('Email a PDF copy to ' + copyTarget);

  var confirmOpts = {
    title:       isFileUpdate ? 'Submit file update?' : 'Submit application?',
    message:     'This will send the application to the Housing Manager for review. You will not be able to edit it after submission.',
    confirmText: 'Confirm Submit'
  };
  if (hasAnyEmail) {
    confirmOpts.checkbox = { label: copyLabel, defaultChecked: true };
  }

  showConfirm(confirmOpts).then(function(result){
    // showConfirm returns a plain boolean unless a checkbox was passed
    // in opts — then it returns { ok, checked }. Normalise.
    var ok       = (typeof result === 'object' && result !== null) ? !!result.ok      : !!result;
    var sendCopy = (typeof result === 'object' && result !== null) ? !!result.checked : false;
    if (!ok) return;
    finalSubmit({ sendApplicantCopy: sendCopy });
  });
}

function finalSubmit(opts){
  opts = opts || {};
  var sendApplicantCopy = opts.sendApplicantCopy === true;
  var appType = (typeof getAppType==='function') ? getAppType() : 'new_housing';
  var isFileUpdate = (appType === 'existing_tenant');
  var actionLabel = isFileUpdate ? 'file_update_submitted' : 'application_submitted';
  var detail = isFileUpdate
    ? 'File update submitted by applicant — awaiting Housing Manager review'
    : 'New housing application submitted by applicant — awaiting Housing Manager review';
  auditEntry(currentAppId||'new', actionLabel, detail, 'Applicant');
  renderApprovalFlow();
  triggerV2Score();
  var id=saveApplicationRecord();
  var submittedApp = applications.find(function(a){ return a.id === id; }) || null;
  // Lock the applicant-side signature panels immediately — the document is
  // now a submitted record and the canvases shouldn't be alterable.
  if (typeof _lockApplicantSignatures === 'function') _lockApplicantSignatures();
  auditEntry(id, 'signatures_locked', 'Applicant / Co-Applicant / Staff signature panels locked on submission', window.currentRole||'staff');
  // Microsoft Graph notification pipeline — emails every active Housing
  // Manager resolved from the staff table. Fire-and-forget; UI never
  // blocks on delivery.
  if(typeof notifyApplicationSubmitted === 'function') notifyApplicationSubmitted(submittedApp);
  // Confirmation email to the applicant (and co-applicant if a separate
  // address) with a PDF copy attached. Only fires when the applicant
  // opted in via the inline checkbox on openSubmitModal — keeps the
  // applicant in control and avoids sending when they don't want a copy.
  if(sendApplicantCopy && typeof notifyApplicationConfirmation === 'function') {
    notifyApplicationConfirmation(submittedApp);
  }
  showSubmissionConfirmation(id, isFileUpdate);
}

function showSubmissionConfirmation(appId, isFileUpdate) {
  // Remove any existing confirmation
  var existing = document.getElementById('submission_confirmation');
  if (existing) existing.remove();

  var applicantName = ((document.getElementById('fn')||{}).value||'') + ' ' + ((document.getElementById('ln')||{}).value||'');
  applicantName = applicantName.trim() || 'Applicant';
  var today = new Date().toLocaleDateString('en-CA', { year:'numeric', month:'long', day:'numeric' });

  var overlay = document.createElement('div');
  overlay.id = 'submission_confirmation';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;padding:20px;';

  overlay.innerHTML = '<div style="background:var(--surface);border-radius:16px;max-width:520px;width:100%;padding:0;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.5);">'
    // Header bar
    + '<div style="background:var(--dark);padding:20px 28px;border-bottom:3px solid var(--yellow);text-align:center;">'
    +   '<div style="font-size:36px;margin-bottom:8px;">✓</div>'
    +   '<div style="font-size:18px;font-weight:700;color:var(--yellow);">' + (isFileUpdate ? 'File Update Submitted' : 'Application Submitted') + '</div>'
    +   '<div style="font-size:12px;color:var(--txt-on-dark);margin-top:4px;">' + appId + '</div>'
    + '</div>'
    // Body
    + '<div style="padding:24px 28px;">'
    +   '<div style="font-size:14px;color:var(--text);margin-bottom:16px;">Thank you, <strong>' + applicantName + '</strong>. Your ' + (isFileUpdate ? 'file update' : 'housing application') + ' has been successfully submitted to the Housing Department.</div>'
    +   '<div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px 18px;margin-bottom:20px;">'
    +     '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:var(--muted);margin-bottom:10px;">Submission Details</div>'
    +     '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12px;">'
    +       '<div><div class="js-lbl-xs mb-4">Application ID</div><div style="font-weight:700;color:var(--yellow);">' + appId + '</div></div>'
    +       '<div><div class="js-lbl-xs mb-4">Date Submitted</div><div style="font-weight:600;">' + today + '</div></div>'
    +       '<div><div class="js-lbl-xs mb-4">Status</div><div style="font-weight:600;color:var(--success);">Submitted — Awaiting HM Review</div></div>'
    +       '<div><div class="js-lbl-xs mb-4">Next Step</div><div style="font-weight:600;">Housing Manager review</div></div>'
    +     '</div>'
    +   '</div>'
    +   '<div style="font-size:12px;color:var(--muted);margin-bottom:20px;line-height:1.6;">The Housing Manager will review your application and contact you if additional information is required. Please keep your application ID for your records.</div>'
    +   '<div style="display:flex;gap:10px;justify-content:flex-end;">'
    +     '<button onclick="closeSubmissionConfirmation(true);" style="padding:10px 20px;border-radius:8px;border:1px solid var(--border);background:none;color:var(--text);cursor:pointer;font-family:DM Sans,sans-serif;font-size:13px;font-weight:600;">Return Home</button>'
    +     '<button onclick="closeSubmissionConfirmation(false);" style="padding:10px 24px;border-radius:8px;border:none;background:var(--yellow);color:var(--dark);cursor:pointer;font-family:DM Sans,sans-serif;font-size:13px;font-weight:700;">Done</button>'
    +   '</div>'
    + '</div>'
    + '</div>';

  document.body.appendChild(overlay);

  // Close on backdrop click
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeSubmissionConfirmation(false);
  });
}

function closeSubmissionConfirmation(returnHome) {
  var el = document.getElementById('submission_confirmation');
  if (el) el.remove();
  if (returnHome && typeof closeApplicationForm === 'function') closeApplicationForm();
}

function printApplicationPreview() {
  try {
  popReview();
  var today   = new Date().toLocaleDateString('en-CA');
  var logoSrc = (document.querySelector('.app-logo img')||{}).src || '';
  var appId   = currentAppId || '—';

  // Read every field — fall back to dash so rows always show
  function fld(id) {
    var e = document.getElementById(id);
    return (e && e.value && e.value.trim()) ? e.value.trim() : '—';
  }
  function chk(id) {
    var e = document.getElementById(id); return e ? e.checked : false;
  }

  var fn2  = fld('fn'),  ln2  = fld('ln');
  var name = (fn2 !== '—' || ln2 !== '—') ? (fn2+' '+ln2).replace('— ','').replace(' —','').trim() : '—';
  var hasCoApp = document.getElementById('co_status') && document.getElementById('co_status').value === 'yes';
  var hasHouse = chk('hasHouseToggle');
  var hasArr   = chk('arrToggle');

  // ── Sig images ──
  var sigApp   = getSigDataURL('sig_canvas_app');
  var sigCo    = getSigDataURL('sig_canvas_co');
  var sigStaff = getSigDataURL('sig_canvas_staff');
  var sigHM    = getSigDataURL('sig_canvas_hm');
  var sigED    = getSigDataURL('sig_canvas_ed');
  var hmName   = fld('sig_hm_name');
  var hmDate   = fld('sig_hm_date') !== '—' ? fld('sig_hm_date') : today;
  var hmDec    = fld('sig_hm_decision');
  var edSigName= fld('sig_ed_name');
  var edDate   = fld('sig_ed_date') !== '—' ? fld('sig_ed_date') : today;
  var edDec    = fld('sig_ed_decision');
  var sigName  = fld('sig_name') !== '—' ? fld('sig_name') : name;
  var sigDate  = fld('sig_date') !== '—' ? fld('sig_date') : today;
  var coFn     = fld('co_fn'), coLn = fld('co_ln');
  var coSigName= fld('sig_co_name') !== '—' ? fld('sig_co_name')
               : (coFn !== '—' || coLn !== '—') ? (coFn+' '+coLn).trim() : '—';
  var staffName= fld('sig_staff');
  var staffDate= fld('sig_recv') !== '—' ? fld('sig_recv') : today;

  // ── Helpers ──
  function row(k, v) {
    var val = (v !== null && v !== undefined && v !== '') ? v : '—';
    return '<tr>'
      +'<td style="padding:4px 10px;color:var(--muted);font-size:10px;font-weight:600;width:34%;'
      +'border-bottom:1px solid var(--border);vertical-align:top;">'+k+'</td>'
      +'<td style="padding:4px 10px;font-size:10px;border-bottom:1px solid var(--border);">'+val+'</td>'
      +'</tr>';
  }
  function section(title, body) {
    return '<div style="margin-bottom:12px;page-break-inside:avoid;">'
      +'<div style="font-size:9.5px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;'
      +'color:var(--muted);border-bottom:2.5px solid #F8E41A;padding-bottom:3px;margin-bottom:0;">'
      +title+'</div>'
      +'<table class="std-tbl">'+body+'</table>'
      +'</div>';
  }
  function yn(v) { return v ? 'Yes' : 'No'; }
  function dollar(id) { var e=document.getElementById(id); return (e&&e.value) ? formatCurrency(parseCurrency(e.value)) : '—'; }
  function dollarQ(sel) { var e=document.querySelector(sel); return (e&&e.value) ? formatCurrency(parseCurrency(e.value)) : '—'; }

  // ── Income rows ──
  var incBody = '';
  document.querySelectorAll('#incomeList .rrow').forEach(function(r, i) {
    var sels = r.querySelectorAll('select');
    var nums = r.querySelectorAll('input[type="number"]');
    var txts = r.querySelectorAll('input[type="text"]');
    var person = sels[0] ? sels[0].value : '';
    var type   = sels[1] ? sels[1].value : '';
    var amt    = nums[0] && nums[0].value ? formatCurrency(parseCurrency(nums[0].value)) : '';
    var emp    = txts[0] ? txts[0].value : '';
    incBody += row(person || ('Income '+(i+1)), type+(amt?' — '+amt:'')+(emp?' · '+emp:''));
  });
  if(!incBody) incBody = row('Income / Employment', '—');

  // ── Household members ──
  var habBody = '';
  document.querySelectorAll('#habList .rrow').forEach(function(r, i) {
    var txts = r.querySelectorAll('input[type="text"]');
    var dt   = r.querySelector('input[type="date"]');
    var sel  = r.querySelector('select');
    var nm   = [(txts[0]?txts[0].value:''),(txts[1]?txts[1].value:'')].filter(Boolean).join(' ') || ('Member '+(i+1));
    habBody += row(nm, (sel?sel.value:'')+(dt&&dt.value?' · DOB: '+dt.value:''));
  });
  if(!habBody) habBody = row('Household Members', '—');

  // ── References ──
  var refBody = '';
  document.querySelectorAll('#refList .rrow').forEach(function(r, i) {
    var txts = r.querySelectorAll('input[type="text"]');
    var tels = r.querySelectorAll('input[type="tel"]');
    var ems  = r.querySelectorAll('input[type="email"]');
    var sel  = r.querySelector('select');
    var nm   = [(txts[0]?txts[0].value:''),(txts[1]?txts[1].value:'')].filter(Boolean).join(' ') || ('Reference '+(i+1));
    refBody += row(nm, (sel?sel.value:'')+(tels[0]&&tels[0].value?' · '+formatPhone(tels[0].value):'')+(ems[0]&&ems[0].value?' · '+ems[0].value:''));
  });
  if(!refBody) refBody = row('References', '—');

  // ── Pets ──
  var petBody = '';
  document.querySelectorAll('#petList .rrow').forEach(function(r, i) {
    var txts = r.querySelectorAll('input[type="text"]');
    var sels = r.querySelectorAll('select');
    var ta   = r.querySelector('textarea');
    var nm   = txts[0]?txts[0].value:'Pet '+(i+1);
    petBody += row(nm, [(sels[0]?sels[0].value:''),(sels[1]?sels[1].value:''),(ta?ta.value:'')].filter(Boolean).join(' · '));
  });

  // ── Arrears details ──
  var arrNums  = document.querySelectorAll('#arrBlk input[type="number"]');
  var arrDates = document.querySelectorAll('#arrBlk input[type="date"]');
  var arrSel   = document.querySelector('#arrBlk select');

  // ── Docs ──
  var docsBody = '';
  var docLabels = ['Government Issued Photo ID','Proof of Band Membership',
                   'Income / Employment Letter','Last 2 Pay Stubs',
                   'Utility Bills','Arrears Payment Agreement'];
  document.querySelectorAll('#step6 input[type="checkbox"]').forEach(function(cb, i) {
    docsBody += row(docLabels[i]||('Doc '+(i+1)), cb.checked ? '✓ Included' : '✗ Not included');
  });
  if(!docsBody) docsBody = row('Documents', '—');

  // ── Sig block (canvas) ──
  function sigBlock(label, pName, dt, imgSrc) {
    return '<div class="print-sec">'
      +'<div style="font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;'
      +     'color:var(--muted);margin-bottom:5px;padding-bottom:3px;border-bottom:1px solid #ddd;">'+label+'</div>'
      +'<div style="display:grid;grid-template-columns:1fr 90px;gap:8px;margin-bottom:6px;">'
      +  '<div><div class="sig-lbl">Full Name</div>'
      +       '<div style="font-size:10.5px;font-weight:600;border-bottom:1px solid var(--border);padding-bottom:2px;min-height:15px;">'+pName+'</div></div>'
      +  '<div><div class="sig-lbl">Date</div>'
      +       '<div style="font-size:10px;border-bottom:1px solid var(--border);padding-bottom:2px;min-height:15px;">'+dt+'</div></div>'
      +'</div>'
      +(imgSrc
        ? '<img src="'+imgSrc+'" style="width:100%;height:65px;border:1px solid var(--border);border-radius:3px;object-fit:contain;background:var(--bg);display:block;"/>'
        : '<div style="width:100%;height:65px;border:1px solid var(--border);border-radius:3px;background:var(--bg);'
        +      'display:flex;align-items:center;justify-content:center;">'
        +   '<span style="font-size:9px;color:var(--border);">Sign here</span></div>')
      +'</div>';
  }

  // ── Internal sig block (pen on paper) ──
  function internalSig(label) {
    return '<div class="print-sec">'
      +'<div style="font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;'
      +     'color:#7a5c00;margin-bottom:5px;padding-bottom:3px;border-bottom:1px solid #e8d87a;">'+label+'</div>'
      +'<div class="sig-lbl">Name &amp; Title</div>'
      +'<div style="border-bottom:1px solid var(--dark-border);height:16px;margin-bottom:8px;"></div>'
      +'<div class="sig-lbl">Signature</div>'
      +'<div style="border-bottom:1px solid var(--dark-border);height:52px;margin-bottom:8px;"></div>'
      +'<div style="display:grid;grid-template-columns:1fr 90px;gap:10px;">'
      +  '<div><div class="sig-lbl">Date</div>'
      +       '<div class="sig-line"></div></div>'
      +  '<div><div class="sig-lbl">Decision</div>'
      +       '<div class="sig-line"></div></div>'
      +'</div>'
      +'</div>';
  }

  // ── Sig columns: always show all 3, grey out co-app if none ──
  var sigCols = hasCoApp ? '1fr 1fr 1fr' : '1fr 1fr';

  // ════════════════════════════════
  var doc = '<!DOCTYPE html><html><head><meta charset="UTF-8"/>'
    +'<title>'+(window.NATION_CONFIG&&NATION_CONFIG.short||'')+' — '+name+'</title>'
    +'<style>'
    +_printThemeStyles()
    +'*{box-sizing:border-box;margin:0;padding:0;}'
    +'@page{size:letter;margin:14mm 13mm 22mm 13mm;}'
    +'body{font-family:Arial,Helvetica,sans-serif;font-size:10.5px;color:var(--text);background:var(--surface);line-height:1.4;counter-reset:page;}'
    +'@page{@bottom-right{content:"Page " counter(page) " of " counter(pages);font-family:Arial,sans-serif;font-size:8.5px;color:var(--muted);}}'
    +'.footer{position:fixed;bottom:7mm;left:0;right:0;padding:0 13mm;'
    +'display:flex;justify-content:space-between;font-size:8.5px;color:var(--muted);'
    +'border-top:1px solid #eee;padding-top:4px;}'
    +'.page-num{position:fixed;bottom:7mm;right:13mm;font-size:8.5px;color:var(--muted);'
    +'font-family:Arial,sans-serif;}'
    +'</style>'
    +'</head><body>'

    // HEADER
    +'<div style="display:flex;align-items:center;justify-content:space-between;'
    +     'border-bottom:3px solid #F8E41A;padding-bottom:10px;margin-bottom:14px;">'
    +  '<div class="flex-g10">'
    +    (logoSrc?'<img src="'+logoSrc+'" style="width:40px;height:40px;object-fit:contain;" alt="'+(window.NATION_CONFIG&&NATION_CONFIG.short||'')+'"/>'     :'')
    +    '<div><div class="js-txt-lg">'+(window.NATION_CONFIG&&NATION_CONFIG.short||'')+' Housing Application</div>'
    +         '<div style="font-size:9.5px;color:var(--muted);">'+(window.NATION_CONFIG&&(NATION_CONFIG.display_name||NATION_CONFIG.name)||'')+'</div></div>'
    +  '</div>'
    +  '<div style="text-align:right;font-size:9.5px;color:var(--muted);line-height:1.9;">'
    +    '<strong style="font-size:12px;color:var(--text);">'+name+'</strong><br/>'
    +    appId+'<br/>Date: '+today
    +  '</div>'
    +'</div>'

    // 1. APPLICANT
    +section('Applicant Information',
       row('First Name',           fld('fn'))
      +row('Last Name',            fld('ln'))
      +row('Date of Birth',        fld('dob'))
      +row('Band Number',          fld('band'))
      +row('On Reserve Status',    fld('reserve'))
      +row('Marital Status',       fld('marital'))
      +row('Cell Phone',           fld('phone'))
      +row('Email Address',        fld('email'))
      +row('Application Date',     fld('appDate'))
      +row('Accessibility Needs',  fld('accessibility'))
      +row('Housing Classification', getHousingClassification ? getHousingClassification() : '—')
    )

    // 2. CURRENT ADDRESS
    +section('Current Address',
       row('Street Address',       fld('street'))
      +row('City',                 fld('city'))
      +row('Province',             fld('prov'))
      +row('Postal Code',          fld('postal'))
      +row('Expected Occupancy Date', fld('occDate'))
    )

    // 3. HOUSING CONDITION & ARREARS
    +section('Current Housing & Arrears',
       row('Currently Has a House', yn(hasHouse))
      +(hasHouse ? row('Home Condition',          fld('homeCondition')) : '')
      +(hasHouse ? row('Est. Renovation Cost',    dollarQ('#homeCondBlk input[type="number"]')) : '')
      +row('Arrears Owed to '+(window.NATION_CONFIG&&NATION_CONFIG.short||''), yn(hasArr))
      +row('Amount Owed',          hasArr ? (arrNums[0]&&arrNums[0].value?formatCurrency(parseCurrency(arrNums[0].value)):'—') : 'N/A')
      +row('Monthly Payment',      hasArr ? (arrNums[1]&&arrNums[1].value?formatCurrency(parseCurrency(arrNums[1].value)):'—') : 'N/A')
      +row('Plan Duration',        hasArr ? (arrNums[3]&&arrNums[3].value?arrNums[3].value+' months':'—') : 'N/A')
      +row('Payment Frequency',    hasArr ? (arrSel?arrSel.value:'—') : 'N/A')
      +row('Agreement Date',       hasArr ? (arrDates[0]&&arrDates[0].value?arrDates[0].value:'—') : 'N/A')
    )

    // 4. EMPLOYMENT & INCOME
    +section('Employment &amp; Income', incBody)

    // 5. CO-APPLICANT
    +section('Co-Applicant',
       row('Co-Applicant', hasCoApp ? 'Yes' : 'No')
      +(hasCoApp ? row('First Name',   fld('co_fn'))  : '')
      +(hasCoApp ? row('Last Name',    fld('co_ln'))  : '')
      +(hasCoApp ? row('Date of Birth',fld('co_dob')) : '')
      +(hasCoApp ? row('Band Number',  fld('co_band'))    : '')
      +(hasCoApp ? row('Reserve Status',fld('co_reserve')): '')
      +(hasCoApp ? row('Cell Phone',   fld('co_cell'))    : '')
      +(hasCoApp ? row('Email',        fld('co_email'))   : '')
    )

    // 6. HOUSEHOLD MEMBERS
    +section('Household Members', habBody)

    // 7. REFERENCES
    +section('References', refBody)

    // 8. PETS
    +(petBody ? section('Pets', petBody) : '')

    // 9. DOCUMENTS
    +section('Supporting Documents Submitted', docsBody)

    // TERMS & CONDITIONS
    +'<div style="margin-top:14px;padding:10px 12px;border:1px solid var(--border);border-radius:4px;'
    +     'background:var(--bg);page-break-inside:avoid;">'
    +'<div style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;'
    +     'color:var(--muted);margin-bottom:7px;padding-bottom:4px;border-bottom:1.5px solid #F8E41A;">'
    +'Terms &amp; Conditions — Applicant Declaration</div>'
    +'<p style="font-size:9.5px;color:var(--text);line-height:1.6;margin-bottom:5px;">'
    +'By signing below, I hereby apply for housing assistance from the '+(window.NATION_CONFIG&&(NATION_CONFIG.display_name||NATION_CONFIG.name)||'')+' '
    +'('+(window.NATION_CONFIG&&NATION_CONFIG.short||'')+') Housing Program and declare the following:</p>'
    +'<ol style="font-size:9.5px;color:var(--text);line-height:1.7;padding-left:14px;">'
    +'<li>All information provided in this application is true, accurate, and complete to the best of my knowledge.</li>'
    +'<li>I understand that providing false or misleading information may result in immediate disqualification and removal from the housing waitlist.</li>'
    +'<li>I consent to '+(window.NATION_CONFIG&&NATION_CONFIG.short||'')+' collecting, using, and sharing my personal information for the purpose of assessing this application, in accordance with applicable privacy legislation (<a href="https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline;">PIPEDA</a>).</li>'
    // Item #4 — CLFN-program sharing consent. Only printed when the applicant
    // checked the "Consent to Share — CLFN Programs" box on Step 8. If they
    // didn't, this clause is omitted entirely so the printed declaration
    // matches what they actually agreed to. The <ol> auto-renumbers.
    +((document.getElementById('consent_share_programs')||{}).checked
      ? '<li>I consent to '+(window.NATION_CONFIG&&NATION_CONFIG.short||'')+' Housing sharing relevant information from this application with other '+(window.NATION_CONFIG&&(NATION_CONFIG.display_name||NATION_CONFIG.name)||'')+' programs and departments &mdash; including but not limited to Health, Education, Wellness, Ontario Works, and Finance &mdash; strictly for the purpose of supporting and coordinating services connected to my housing application. Sharing will occur only with authorized staff, on a need-to-know basis, in accordance with applicable privacy legislation (<a href="https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline;">PIPEDA</a>). I may withdraw this consent in writing to the Housing Manager at any time.</li>'
      : '')
    +'<li>I understand that my application will be scored according to the '+(window.NATION_CONFIG&&NATION_CONFIG.short||'')+' Housing Scoring Rubric and that priority is determined by score, not date of application alone.</li>'
    +'<li>I agree to notify the '+(window.NATION_CONFIG&&NATION_CONFIG.short||'')+' Housing Department within 30 days of any change in household composition, income, address, or contact information.</li>'
    +'<li>I understand that acceptance into '+(window.NATION_CONFIG&&NATION_CONFIG.short||'')+' housing is conditional upon satisfying all outstanding arrears or entering into a formal payment arrangement approved by '+(window.NATION_CONFIG&&NATION_CONFIG.short||'')+' prior to occupancy.</li>'
    +'<li>I agree to comply with all '+(window.NATION_CONFIG&&NATION_CONFIG.short||'')+' Housing policies, lease agreements, and community by-laws as a condition of tenancy.</li>'
    +'<li>I authorize '+(window.NATION_CONFIG&&NATION_CONFIG.short||'')+' to verify any information in this application with relevant third parties including employers, financial institutions, and utility providers.</li>'
    +'</ol>'
    +'</div>'

    // CONSENT ACKNOWLEDGMENT — visible confirmation block (only when ticked).
    // Mirrors the on-screen Step 8 consent box and stamps when/by whom the
    // box was confirmed so HM/ED have a clear paper trail in the printed PDF.
    +((document.getElementById('consent_share_programs')||{}).checked
      ? '<div style="margin-top:12px;padding:10px 12px;border:1.5px solid #15803d;border-radius:4px;background:#f0fdf4;page-break-inside:avoid;">'
        + '<div style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#15803d;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #bbf7d0;">'
        + '&#x2611; Consent to Share &mdash; '+(window.NATION_CONFIG&&NATION_CONFIG.short||'')+' Programs &middot; <span style="font-weight:700;">CONFIRMED</span></div>'
        + '<p style="font-size:9.5px;color:var(--text);line-height:1.55;margin:0 0 5px;">'
        + 'The applicant has consented to '+(window.NATION_CONFIG&&NATION_CONFIG.short||'')+' Housing sharing relevant information from this application with other '+(window.NATION_CONFIG&&(NATION_CONFIG.display_name||NATION_CONFIG.name)||'')+' programs and departments &mdash; including Health, Education, Wellness, Ontario Works, and Finance &mdash; in support of this housing application.'
        + '</p>'
        + '<p style="font-size:8.5px;color:var(--muted);margin:0;">'
        + 'Recorded: '+today
        + ((typeof HOUSING_SESSION !== 'undefined' && HOUSING_SESSION && HOUSING_SESSION.email) ? ' &middot; Captured by '+escapeHtml(HOUSING_SESSION.email) : '')
        + '</p>'
        + '</div>'
      : '')

    // SIGNATURES
    +'<div style="margin-top:14px;page-break-inside:avoid;">'
    +'<div style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;'
    +     'color:var(--muted);border-bottom:2.5px solid #F8E41A;padding-bottom:3px;margin-bottom:10px;">Signatures</div>'
    +'<div style="display:grid;grid-template-columns:'+sigCols+';gap:12px;">'
    +sigBlock('Applicant', sigName, sigDate, sigApp)
    +sigBlock('Co-Applicant', coSigName, sigDate, sigCo)
    +sigBlock('Received by — Housing Staff', staffName, staffDate, sigStaff)
    +'</div></div>'

    +'<div class="footer"><span>'+escapeHtml(buildNationFooterStrip())+'</span><span>Generated '+today+'</span></div>'
    +'<!-- print handled by panel -->'
    +'</body></html>';

  showPrintPanel(doc, 'Application Preview');
  } catch(err) {
    console.error('printApplicationPreview error:', err);
    showToast('Print error — see browser console (F12)');
  }
}

// ═══════════════════════════════════════════════════════════════
// INTERNAL APPLICATION NOTES (step 11) — staff-only side panel
// Append-only via DB (housing_application_notes). Never printed.
// ═══════════════════════════════════════════════════════════════

function _openAppNotesStep() {
  if (!_isStaffSession()) { showToast && showToast('Notes are staff-only.'); return; }
  if (!currentAppId) {
    showToast && showToast('Save the application first to add notes.');
    return;
  }

  var _stepCur = document.getElementById('step'+cur);
  if (_stepCur) _stepCur.classList.remove('on');
  var _stepN = document.getElementById('step11');
  if (_stepN) _stepN.classList.add('on');

  var btn = document.getElementById('spb_11');
  if (btn) {
    btn.style.borderTopColor = '#000';
    var lbl = document.getElementById('spb_lbl_11');
    if (lbl) lbl.style.color = '#111';
  }

  cur = 11;
  window.scrollTo(0, 0);
  _renderAppNoteAuthorHint();
  renderAppNotes();
}

function _renderAppNoteAuthorHint() {
  var sess = window.HOUSING_SESSION || {};
  var nm = document.getElementById('appNoteAuthorName');
  var rl = document.getElementById('appNoteAuthorRole');
  if (nm) nm.textContent = sess.name || sess.email || '—';
  if (rl) rl.textContent = sess.role || (window.currentRole || '—');
}

function _formatNoteTs(iso) {
  if (!iso) return '';
  try {
    var d = new Date(iso);
    return d.toLocaleDateString('en-CA') + ' ' + d.toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
  } catch(e) { return iso; }
}

function _roleLabel(r) {
  if (!r) return '';
  var map = {
    'ed':                   'Executive Director',
    'housing_manager':      'Housing Manager',
    'housing_employee_l2':  'Housing Employee (L2)',
    'housing_employee_l1':  'Housing Employee (L1)',
    'cfo':                  'CFO',
    'finance_l1':           'Finance (L1)'
  };
  return map[r] || r;
}

// ═══════════════════════════════════════════════════════════════
// SIGNATURE LOCKING — applicant-side panels only
// Locked on application submission (status !== 'draft'). HM/ED
// approval signatures are NOT touched; they're governed separately
// by the approval workflow gates.
// ═══════════════════════════════════════════════════════════════

function _shouldLockApplicantSignatures(app) {
  if (!app || !app.status) return false;
  return app.status !== 'draft';
}

function _lockSignaturePanel(canvasId) {
  var canvas = document.getElementById(canvasId);
  if (!canvas) return;
  var wrap = canvas.closest('.sig-canvas-wrap');
  if (!wrap) return;
  if (wrap.getAttribute('data-sig-locked') === '1') return; // idempotent
  wrap.setAttribute('data-sig-locked', '1');

  // Hide mode tabs.
  var tabs = wrap.querySelector('.tab-bar');
  if (tabs) tabs.style.display = 'none';

  // Canvas inert.
  canvas.style.pointerEvents = 'none';
  canvas.style.cursor = 'default';

  // Clear button hidden.
  var canvasPanel = document.getElementById(canvasId + '_panel_canvas');
  if (canvasPanel) {
    var clearBtn = canvasPanel.querySelector('button');
    if (clearBtn) clearBtn.style.display = 'none';
  }

  // Typed input readonly.
  var typed = document.getElementById(canvasId + '_typed');
  if (typed) { typed.readOnly = true; typed.style.opacity = '0.7'; typed.style.cursor = 'default'; }

  // Wet-ref input readonly.
  var wetRef = document.getElementById(canvasId + '_wet_ref');
  if (wetRef) { wetRef.readOnly = true; wetRef.style.opacity = '0.7'; wetRef.style.cursor = 'default'; }

  // "Locked" badge at the top of the wrap.
  if (!wrap.querySelector('.sig-locked-badge')) {
    var badge = document.createElement('div');
    badge.className = 'sig-locked-badge';
    badge.style.cssText = 'background:rgba(248,228,26,0.15);border:1px solid var(--yellow);color:var(--dark);padding:6px 12px;border-radius:6px;font-size:11px;font-weight:700;margin-bottom:10px;display:flex;align-items:center;gap:6px;';
    badge.innerHTML = '🔒 Signed — locked on submission';
    wrap.insertBefore(badge, wrap.firstChild);
  }
}

function _unlockSignaturePanel(canvasId) {
  var canvas = document.getElementById(canvasId);
  if (!canvas) return;
  var wrap = canvas.closest('.sig-canvas-wrap');
  if (!wrap) return;
  if (wrap.getAttribute('data-sig-locked') !== '1') return;
  wrap.removeAttribute('data-sig-locked');

  var badge = wrap.querySelector('.sig-locked-badge');
  if (badge) badge.remove();

  var tabs = wrap.querySelector('.tab-bar');
  if (tabs) tabs.style.display = '';

  canvas.style.pointerEvents = '';
  canvas.style.cursor = 'crosshair';

  var canvasPanel = document.getElementById(canvasId + '_panel_canvas');
  if (canvasPanel) {
    var clearBtn = canvasPanel.querySelector('button');
    if (clearBtn) clearBtn.style.display = '';
  }

  var typed = document.getElementById(canvasId + '_typed');
  if (typed) { typed.readOnly = false; typed.style.opacity = ''; typed.style.cursor = ''; }

  var wetRef = document.getElementById(canvasId + '_wet_ref');
  if (wetRef) { wetRef.readOnly = false; wetRef.style.opacity = ''; wetRef.style.cursor = ''; }
}

function _lockApplicantSignatures() {
  _lockSignaturePanel('sig_canvas_app');
  _lockSignaturePanel('sig_canvas_co');
  _lockSignaturePanel('sig_canvas_staff');
}

function _unlockApplicantSignatures() {
  _unlockSignaturePanel('sig_canvas_app');
  _unlockSignaturePanel('sig_canvas_co');
  _unlockSignaturePanel('sig_canvas_staff');
}

// Apply or remove the lock based on the application's current status. Safe to
// call on every step transition / modal open — both helpers are idempotent.
function _applySignatureLockState(app) {
  if (_shouldLockApplicantSignatures(app)) _lockApplicantSignatures();
  else _unlockApplicantSignatures();
}

function renderAppNotes() {
  var listEl  = document.getElementById('appNotesList');
  var countEl = document.getElementById('appNotesCount');
  if (!listEl) return;
  if (!currentAppId) {
    listEl.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:12px;">Save the application first to add notes.</div>';
    if (countEl) countEl.textContent = '0 notes';
    return;
  }
  listEl.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:12px;">Loading…</div>';
  sbLoadAppNotes(currentAppId).then(function(notes) {
    notes = notes || [];
    if (countEl) countEl.textContent = notes.length + (notes.length === 1 ? ' note' : ' notes');
    if (!notes.length) {
      listEl.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:12px;">No notes yet. Add the first one above.</div>';
      return;
    }
    var html = '';
    notes.forEach(function(n) {
      var author = n.author_name || n.author_email || 'Unknown';
      var role   = _roleLabel(n.author_role || '');
      var ts     = _formatNoteTs(n.created_at);
      var body   = escapeHtml(n.body || '');
      html += '<div style="padding:14px 18px;border-bottom:1px solid var(--border);">'
        +    '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:6px;">'
        +      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
        +        '<span style="font-size:12px;font-weight:700;color:var(--text);">'+escapeHtml(author)+'</span>'
        +        (role ? '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:var(--bg);border:1px solid var(--border);color:var(--muted);">'+escapeHtml(role)+'</span>' : '')
        +      '</div>'
        +      '<span style="font-size:11px;color:var(--muted);">'+escapeHtml(ts)+'</span>'
        +    '</div>'
        +    '<div style="font-size:13px;line-height:1.55;color:var(--text);white-space:pre-wrap;">'+body+'</div>'
        +  '</div>';
    });
    listEl.innerHTML = html;
  }).catch(function(e) {
    console.warn('[notes] render failed:', e);
    listEl.innerHTML = '<div style="padding:24px;text-align:center;color:#b91c1c;font-size:12px;">Failed to load notes. Try refreshing.</div>';
  });
}

function submitAppNote() {
  var ta   = document.getElementById('appNoteBody');
  var btn  = document.getElementById('appNoteSubmitBtn');
  var errE = document.getElementById('appNoteError');
  if (errE) { errE.style.display = 'none'; errE.textContent = ''; }
  if (!ta) return;
  var body = (ta.value || '').trim();
  if (!body) {
    if (errE) { errE.textContent = 'Enter a note before adding.'; errE.style.display = 'block'; }
    ta.focus();
    return;
  }
  if (!currentAppId) {
    if (errE) { errE.textContent = 'Save the application first.'; errE.style.display = 'block'; }
    return;
  }
  if (!_isStaffSession()) {
    if (errE) { errE.textContent = 'Sign in as staff to add notes.'; errE.style.display = 'block'; }
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
  // Local-first: queue the note immediately. Renders on success or queued-fail
  // both clear the textarea — the note will appear via the queue retry next
  // time if the cloud insert failed.
  saveAppNoteWithDraftFallback(currentAppId, body).then(function(ok) {
    ta.value = '';
    auditEntry && auditEntry(currentAppId, 'note_added', 'Internal note added (' + body.length + ' chars)');
    if(ok) {
      renderAppNotes();
      showToast && showToast('Note added.');
    } else {
      showToast && showToast('Note saved locally — will sync when network is available.', { type:'info', duration:3500 });
    }
  }).finally(function() {
    if (btn) { btn.disabled = false; btn.textContent = '+ Add Note'; }
  });
}

// Show or hide the Notes tab button. Visible only when (a) we have a staff
// session AND (b) the application has been saved at least once (has an id
// AND is in the in-memory applications array → matches a real DB row).
function _refreshAppNotesTabVisibility() {
  var btn = document.getElementById('spb_11');
  if (!btn) return;
  var staff = _isStaffSession();
  var saved = !!currentAppId
    && Array.isArray(typeof applications !== 'undefined' ? applications : null)
    && applications.some(function(a){ return a && a.id === currentAppId; });
  btn.style.display = (staff && saved) ? '' : 'none';
}

// ── Navigation history stack ──
window._navStack = [];

// ── Page nav map (used by shared-ui.js goBack) ─────────────────────────────
// Uses lazy lookups so this file can load before housing-init.js (which
// defines showDashboard). Functions are resolved at call time, not parse time.
window._navMap = {
  'home':        function(){ return showEmployeeHome.apply(this, arguments); },
  'inventory':   function(){ return showInventory.apply(this, arguments); },
  'match':       function(){ return showMatch.apply(this, arguments); },
  'tenants':     function(){ return showTenants.apply(this, arguments); },
  'renos':       function(){ return showRenos.apply(this, arguments); },
  'contractors': function(){ return showContractors.apply(this, arguments); },
  'settings':    function(){ return showSettings.apply(this, arguments); }
};


