/* ============================================================
 * housing-settings.js — CLFN Housing Suite
 * Settings panel, approval authority, audit log, contacts
 *
 * Load order: ... housing-views.js → THIS FILE
 * ============================================================ */

'use strict';

// ── Settings section tabs ──
// ══════════════════════════════════════════════════════════════
// APPROVAL AUTHORITY SETTINGS PANEL
// Reads groups / labels / defaults from approval-authority.js
// ══════════════════════════════════════════════════════════════

function renderApprovalAuthorityPanel() {
  var el = document.getElementById('approval_authority_panel_body');
  if(!el) return;
  if(typeof APPROVAL_AUTHORITY === 'undefined') {
    el.innerHTML = '<div style="padding:24px;text-align:center;color:#b91c1c;font-size:13px;">approval-authority.js not loaded.</div>';
    return;
  }
  if(!APPROVAL_AUTHORITY.can('editApprovalAuthority', window.currentRole)) {
    el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px;">Only the Executive Director can configure approval authorities.</div>';
    return;
  }

  // Only show housing-relevant roles — exclude finance-only roles (cfo, finance_l1)
  var housingRoles = ['ed', 'housing_manager', 'housing_employee_l2', 'housing_employee_l1'];
  var allRolesRaw  = APPROVAL_AUTHORITY.allRoles(); // [{value, label}]
  var allRoles     = allRolesRaw.filter(function(r) {
    return housingRoles.indexOf(r.value || r) !== -1;
  });

  var groups   = APPROVAL_AUTHORITY.groups;
  var labels   = APPROVAL_AUTHORITY.labels;
  var defaults = APPROVAL_AUTHORITY.defaults;

  var html = '';
  Object.keys(groups).forEach(function(groupName) {
    var keys = groups[groupName];
    html += '<div style="margin-bottom:24px;">';
    html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;'
          + 'color:var(--yellow);padding-bottom:8px;border-bottom:1px solid var(--border);margin-bottom:4px;">'
          + groupName + '</div>';

    keys.forEach(function(key) {
      var cur = APPROVAL_AUTHORITY.get(key);
      var def = defaults[key];
      var isThreshold = (typeof cur === 'number');
      var isModified  = JSON.stringify(cur) !== JSON.stringify(def);

      // Tighten / loosen / modified badge
      var badgeHtml = '';
      if(!isThreshold && Array.isArray(cur) && Array.isArray(def)) {
        if(cur.length < def.length)
          badgeHtml = ' <span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:10px;'
            + 'background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;">Tighter</span>';
        else if(cur.length > def.length)
          badgeHtml = ' <span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:10px;'
            + 'background:#f0fdf4;color:#15803d;border:1px solid #86efac;">Looser</span>';
      }
      if(isModified && !badgeHtml)
        badgeHtml = ' <span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:10px;'
                  + 'background:#fffbeb;color:#d97706;border:1px solid #fde68a;">Modified</span>';

      // Single-row layout: label | pills ... | reset
      html += '<div style="display:grid;grid-template-columns:220px 1fr auto;align-items:center;'
            + 'gap:16px;padding:10px 0;border-bottom:1px solid var(--border);">';

      // Label column
      html += '<div style="font-size:13px;font-weight:600;color:var(--text);">'
            + (labels[key] || key) + badgeHtml + '</div>';

      // Pills / threshold column
      if(isThreshold) {
        html += '<div><input type="number" data-aa-key="' + key + '" value="' + cur + '" min="0" step="1000"'
          + ' style="width:130px;padding:6px 10px;border:1.5px solid var(--border);border-radius:7px;'
          + 'font-size:13px;font-weight:700;color:var(--text);font-family:DM Sans,sans-serif;'
          + 'background:var(--surface);text-align:right;"'
          + ' oninput="APPROVAL_AUTHORITY.update(\'' + key + '\', parseFloat(this.value)||0)"/></div>';
      } else {
        html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
        allRoles.forEach(function(r) {
          var rVal   = r.value || r;
          var rLabel = r.label || rVal;
          var active = Array.isArray(cur) && cur.indexOf(rVal) !== -1;
          html += '<button data-aa-key="' + key + '" data-aa-role="' + rVal + '" onclick="aaToggleRole(this)"'
            + ' style="padding:5px 14px;border-radius:20px;font-size:12px;font-weight:700;cursor:pointer;'
            + 'font-family:DM Sans,sans-serif;transition:all .12s;white-space:nowrap;'
            + 'background:' + (active ? 'var(--yellow)' : 'var(--surface)') + ';'
            + 'color:'       + (active ? '#111'          : 'var(--muted)')   + ';'
            + 'border:1.5px solid ' + (active ? 'var(--yellow)' : 'var(--border)') + ';">'
            + rLabel + '</button>';
        });
        html += '</div>';
      }

      // Reset column
      html += '<button onclick="aaResetAction(\'' + key + '\')" title="Reset to default"'
        + ' style="background:none;border:1px solid var(--border);color:var(--muted);border-radius:6px;'
        + 'padding:3px 10px;font-size:11px;cursor:pointer;font-family:DM Sans,sans-serif;white-space:nowrap;">'
        + '↺ Default</button>';

      html += '</div>'; // grid row
    });
    html += '</div>'; // group
  });

  html += '<div style="padding:10px 14px;background:var(--bg);border-radius:8px;font-size:12px;'
        + 'color:var(--muted);margin-top:8px;">'
        + '⚠ Changes apply immediately in memory. Click <strong>Save Changes</strong> to persist.</div>';

  el.innerHTML = html;
}

function aaToggleRole(btn) {
  var key  = btn.getAttribute('data-aa-key');
  var role = btn.getAttribute('data-aa-role');
  var cur  = APPROVAL_AUTHORITY.get(key);
  if(!Array.isArray(cur)) return;
  var next = cur.indexOf(role) === -1
    ? cur.concat([role])
    : cur.filter(function(r){ return r !== role; });
  APPROVAL_AUTHORITY.update(key, next);
  renderApprovalAuthorityPanel();
}

function aaResetAction(key) {
  APPROVAL_AUTHORITY.reset(key);
  renderApprovalAuthorityPanel();
}

function saveApprovalAuthoritySettings() {
  if(typeof APPROVAL_AUTHORITY === 'undefined' || !APPROVAL_AUTHORITY.can('editApprovalAuthority', window.currentRole)) {
    showToast('Only the Executive Director can save approval authority settings.');
    return;
  }
  var data = APPROVAL_AUTHORITY.serialize();
  if(!window._appSettings) window._appSettings = {};
  window._appSettings['approval_authority'] = data;
  sbSaveSetting('approval_authority', data).then(function(ok) {
    if(ok) {
      showToast('✓ Approval authority saved');
      if(typeof auditEntry === 'function') auditEntry('SETTINGS', 'approval_authority_save', 'Approval authority configuration updated', window.currentRole || 'ed');
    } else {
      showToast('Save failed — check connection');
    }
  });
}

function showSettingsSection(section) {
  var sections = ['sec_users','sec_app_scoring','sec_unit_match','sec_reno_score','sec_budget','sec_contacts','sec_nation','sec_approval_authority','sec_audit','sec_occupancy'];
  sections.forEach(function(id){
    var el=document.getElementById(id);
    if(el) el.style.display=(id===section)?'block':'none';
  });
  document.querySelectorAll('.settings-tab').forEach(function(t){
    var tabSec='sec_'+t.id.replace('stab_','');
    t.classList.toggle('active', tabSec===section);
  });
  if(section==='sec_users'       && typeof renderHousingUserTable==='function') renderHousingUserTable();
  if(section==='sec_nation'      && typeof renderNationPanel==='function') renderNationPanel();
  if(section==='sec_app_scoring') {
    // ED sees the V2 editor (object-based model with tier threshold controls).
    // Other roles see a read-only message (populateSettings handles that on initial load).
    if(window.currentRole === ROLE.ED && typeof renderV2ScoringEditor === 'function') {
      renderV2ScoringEditor();
    } else {
      var wrap = document.getElementById('scoring_model_table_wrap');
      if(wrap) wrap.innerHTML = '<div style="padding:24px;text-align:center;color:var(--muted);font-style:italic;">Scoring model configuration is only available to the Executive Director.</div>';
    }
  }
  if(section==='sec_unit_match'  && typeof renderUnitScoreTable==='function') renderUnitScoreTable();
  if(section==='sec_reno_score'  && typeof renderRenoScoreTable==='function') renderRenoScoreTable();
  if(section==='sec_budget'      && typeof renderBudgetPools==='function') renderBudgetPools();
  if(section==='sec_contacts'    && typeof populateContactSettings==='function') populateContactSettings();
  if(section==='sec_audit'       && typeof renderAuditLog==='function') renderAuditLog();
  if(section==='sec_occupancy'   && typeof renderNosTable==='function') renderNosTable();
  if(section==='sec_approval_authority' && typeof renderApprovalAuthorityPanel==='function') renderApprovalAuthorityPanel();
}



function ctRemovePerson(idx) {
  var people = ctGetPeople();
  people.splice(idx, 1);
  ctRenderPeople(people);
}



// ══════════════════════════════════════════════════════════════
// WORKLIST VIEW
// Role-aware worklist — employees see their own apps (no score)
// HM sees action queue, ED sees approval queue
// ══════════════════════════════════════════════════════════════













function renderWlTable(apps, showScore, showReview) {
  if(!apps||!apps.length) return wlEmpty('None', '');
  var sorted = apps.slice().sort(function(a,b){ return (b.score||0)-(a.score||0); });
  var rows = sorted.map(function(a){
    var name = ((a.fn||'')+' '+(a.ln||'')).trim()||'—';
    var tier = a.tier||'';
    var tc = tier==='Critical Priority'?'#b91c1c':tier==='High Priority'?'#1d4ed8':tier==='Medium Priority'?'#7a6000':'#888';
    return '<tr style="border-bottom:1px solid var(--border);">'
      + '<td style="padding:10px 14px;font-weight:600;font-size:13px;">'+name+'</td>'
      + '<td style="padding:10px 14px;font-size:12px;color:var(--muted);">'+a.id+'</td>'
      + '<td style="padding:10px 14px;font-size:12px;color:var(--muted);">'+(a.appDate||'—')+'</td>'
      + (showScore ? '<td style="padding:10px 14px;"><span style="font-size:18px;font-weight:800;color:var(--text);">'+(typeof a.score==='number'?a.score:'—')+'</span>'
          +(tier?'<span style="font-size:10px;font-weight:700;margin-left:6px;color:'+tc+';">'+tier.replace(' Priority','')+'</span>':'')+'</td>' : '')
      + '<td style="padding:10px 14px;text-align:right;">'
      + (showReview ? '<button data-wl-id="'+a.id+'" onclick="wlOpenApp(this)" style="background:#1d4ed8;border:none;color:#fff;padding:4px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;">Review →</button>' : '')
      + '</td>'
      + '</tr>';
  }).join('');

  return '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">'
    + '<thead><tr style="background:var(--dark);">'
    + '<th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#888;">Applicant</th>'
    + '<th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#888;">ID</th>'
    + '<th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#888;">Date</th>'
    + (showScore ? '<th style="padding:9px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#888;">Score</th>' : '')
    + '<th></th>'
    + '</tr></thead><tbody>'+rows+'</tbody></table></div>';
}





function prefillTransferFromTenant() {
  // When a tenant selects "Transfer Request", pre-populate their info
  // from their existing assigned application
  var apps = (typeof applications !== 'undefined') ? applications : [];
  var units = (typeof housingUnits !== 'undefined') ? housingUnits : [];

  // Find an existing assigned application matching the current form data
  // Try to match by first/last name already in the form
  var fn = (document.getElementById('fn')||{}).value||'';
  var ln = (document.getElementById('ln')||{}).value||'';

  // If form is already filled (editing), don't overwrite
  if(fn || ln) return;

  // Find the currently logged-in user's existing application
  var email = window.HOUSING_SESSION && window.HOUSING_SESSION.email || '';
  var existingApp = apps.find(function(a){
    return (a.status === 'assigned' || a.status === APP_STATUS.ED_APPROVED) && !a.archived;
  });

  if(!existingApp) return;

  // Pre-populate fields from existing application
  var fields = {
    'fn': existingApp.fn, 'ln': existingApp.ln,
    'email': existingApp.email, 'phone': existingApp.phone,
    'address': existingApp.address, 'city': existingApp.city,
    'postal': existingApp.postal, 'band': existingApp.band,
    'reserve': existingApp.reserve
  };
  Object.keys(fields).forEach(function(id) {
    var el = document.getElementById(id);
    if(el && fields[id]) el.value = fields[id];
  });
  // Pre-populate checkboxes
  if(existingApp.band !== undefined) {
    var bandEl = document.getElementById('band');
    if(bandEl) bandEl.checked = !!existingApp.band;
  }
  showToast('Profile pre-filled from existing application');
}

function onAppTypeChange() {
  var isExisting = !!(document.getElementById('apptype_existing') && document.getElementById('apptype_existing').checked);
  var isTransfer = !!(document.getElementById('apptype_transfer') && document.getElementById('apptype_transfer').checked);
  var isNew      = !isExisting && !isTransfer;
  var needsScoring = isNew || isTransfer;

  // Style all three labels
  function styleLabel(id, active) {
    var el = document.getElementById(id);
    if(!el) return;
    el.style.borderColor = active ? 'var(--yellow)' : 'var(--border)';
    el.style.background  = active ? 'var(--dark)'   : '';
    var title = el.querySelector('.appty-title');
    var desc  = el.querySelector('.appty-desc');
    if(title) title.style.color = active ? '#fff'        : 'var(--text)';
    if(desc)  desc.style.color  = active ? 'rgba(255,255,255,0.8)' : 'var(--muted)';
    var radio = el.querySelector('input[type="radio"]');
    if(radio) radio.style.accentColor = active ? 'var(--yellow)' : '';
  }
  styleLabel('apptype_new_label',      isNew);
  styleLabel('apptype_existing_label', isExisting);
  styleLabel('apptype_transfer_label', isTransfer);

  // Show/hide scoring sections
  var hnCard = document.getElementById('v2_housing_need_card');
  var thCard = document.getElementById('v2_tenancy_card');
  if(hnCard) hnCard.style.display = needsScoring ? '' : 'none';
  if(thCard) thCard.style.display = needsScoring ? '' : 'none';

  // For transfer: show tenant lookup panel
  var lookupPanel = document.getElementById('apptype_tenant_lookup');
  if(lookupPanel) lookupPanel.style.display = isTransfer ? 'block' : 'none';

  // Show/hide notices
  var exNotice = document.getElementById('apptype_existing_notice');
  if(exNotice) exNotice.style.display = isExisting ? 'block' : 'none';
  var trNotice = document.getElementById('apptype_transfer_notice');
  if(trNotice) trNotice.style.display = isTransfer ? 'block' : 'none';

  // Score panel
  if(needsScoring) {
    var sc2 = document.getElementById('scorecardPanel');
    if(sc2) sc2.style.opacity = '';
    var note2 = document.getElementById('apptype_score_note');
    if(note2) note2.style.display = 'none';
    if(typeof triggerV2Score === 'function') triggerV2Score();
  } else {
    var sc = document.getElementById('scorecardPanel');
    if(sc) sc.style.opacity = '0.4';
    var tier = document.getElementById('sc_score_tier');
    if(tier) { tier.textContent = 'File Update Only'; tier.style.color = '#888'; }
    var note = document.getElementById('apptype_score_note');
    if(note) note.style.display = 'block';
  }
}

// ── Transfer request: search and pre-populate from existing tenant record ──
function transferTenantSearch(q) {
  var results = document.getElementById('transfer_tenant_results');
  if(!results) return;
  if(!q || q.length < 2) { results.innerHTML = ''; return; }
  var apps = (typeof applications !== 'undefined') ? applications : [];
  var qq = q.toLowerCase();
  // Search assigned tenants + all applicants with a unit
  var matches = apps.filter(function(a) {
    if(a.archived) return false;
    var name = ((a.fn||'') + ' ' + (a.ln||'')).toLowerCase();
    return name.includes(qq) || (a.id||'').toLowerCase().includes(qq) || (a.assignedAddress||'').toLowerCase().includes(qq);
  }).slice(0, 6);
  if(!matches.length) {
    results.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:6px 0;">No matching records found.</div>';
    return;
  }
  results.innerHTML = matches.map(function(a) {
    var name = ((a.fn||'') + ' ' + (a.ln||'')).trim() || '—';
    var addr = a.assignedAddress || 'No unit assigned';
    var aid = (a.id||'').replace(/"/g,'');
    return '<div data-tid="' + aid + '" style="padding:7px 10px;border-radius:6px;cursor:pointer;font-size:12px;margin-bottom:3px;background:var(--bg);border:1px solid var(--border);">'
      + '<strong>' + name + '</strong> <span style="color:var(--muted);">' + aid + '</span>'
      + '<div style="font-size:11px;color:var(--muted);margin-top:2px;">' + addr + '</div></div>';
  }).join('');
  // Click delegation
  results.onclick = function(e) {
    var el = e.target.closest('[data-tid]');
    if(el) applyTransferPrefill(el.getAttribute('data-tid'));
  };
}

function applyTransferPrefill(appId) {
  var apps = (typeof applications !== 'undefined') ? applications : [];
  var src = apps.find(function(a){ return a.id === appId; });
  if(!src) return;

  // Helper to set a form field value
  function set(id, val) {
    var el = document.getElementById(id);
    if(el && val !== undefined && val !== null) el.value = val;
  }
  function setChk(id, val) {
    var el = document.getElementById(id);
    if(el) el.checked = !!val;
  }

  // Personal info (step 0)
  set('fn', src.fn);
  set('ln', src.ln);
  set('dob', src.dob);
  set('phone', src.phone);
  set('email', src.email);
  set('address', src.address);
  set('city', src.city);
  set('province', src.province);
  set('postal', src.postal);

  // Classification / band
  set('classification', src.classification);
  setChk('band', src.band);
  set('reserve', src.reserve);
  set('bedNeed', src.bedNeed);

  // Mark the current unit as their existing address
  if(src.assignedAddress) {
    var currUnit = document.getElementById('currentUnitSearch');
    if(currUnit) currUnit.value = src.assignedAddress;
    var hasHouse = document.getElementById('hasHouseToggle');
    if(hasHouse) { hasHouse.checked = true; var b=document.getElementById('homeCondBlk'); if(b) b.style.display='block'; }
  }

  // Store source app ID for reference
  window._transferSourceAppId = appId;

  // Clear search and show badge
  var search = document.getElementById('transfer_tenant_search');
  if(search) search.value = ((src.fn||'') + ' ' + (src.ln||'')).trim();
  var results = document.getElementById('transfer_tenant_results');
  if(results) {
    results.innerHTML = '';
    results.addEventListener('click', function(e) {
      var el = e.target.closest('[data-transfer-appid]');
      if(el) applyTransferPrefill(el.getAttribute('data-transfer-appid'));
    });
  }
  var badge = document.getElementById('transfer_prefilled_badge');
  if(badge) badge.style.display = 'block';

  // Trigger score recalc
  if(typeof calcScore === 'function') setTimeout(calcScore, 100);
}

function clearTransferPrefill() {
  window._transferSourceAppId = null;
  var search = document.getElementById('transfer_tenant_search');
  if(search) search.value = '';
  var results = document.getElementById('transfer_tenant_results');
  if(results) results.innerHTML = '';
  var badge = document.getElementById('transfer_prefilled_badge');
  if(badge) badge.style.display = 'none';
}


function getAppType() {
  var exEl = document.getElementById('apptype_existing');
  var trEl = document.getElementById('apptype_transfer');
  if(exEl && exEl.checked) return 'existing_tenant';
  if(trEl && trEl.checked) return 'transfer_request';
  return 'new_housing';
}

// ── Settings role locks ──
function applySettingsRoleLocks() {
  var isED = (window.currentRole === ROLE.ED);
  var locked = !isED;

  // Selectors for all score/budget editable inputs
  var editableSelectors = [
    '#scoring_model_table_wrap input',
    '#scoring_model_table_wrap select',
    '[data-usm-id]',
    '[data-rsm-id]',
    '#budget_fiscal_year',
    '#budget_pools_tbody input',
    '#budget_pools_tbody textarea',
  ];
  editableSelectors.forEach(function(sel) {
    document.querySelectorAll(sel).forEach(function(el) {
      el.disabled = locked;
      el.style.opacity = locked ? '0.55' : '1';
      el.style.cursor = locked ? 'not-allowed' : '';
    });
  });

  // Show/hide ED-only action buttons
  var edOnlyBtns = [
    'settings_save_scoring_btn','settings_reset_scoring_btn','settings_add_criteria_btn',
    'settings_save_unit_btn','settings_save_reno_btn','settings_reset_reno_btn',
    'settings_save_budget_btn','settings_save_nos_btn',
  ];
  edOnlyBtns.forEach(function(id) {
    var el = document.getElementById(id);
    if(el) el.style.display = locked ? 'none' : '';
  });

  // Show lock banner on locked sections
  var lockMsg = locked ?
    '<div id="settings_lock_banner" style="display:flex;align-items:center;gap:8px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;font-size:12px;color:#92400e;margin-bottom:14px;">'+
    '<span style="font-size:16px;">🔒</span> These values are managed by the <strong>Executive Director</strong> only. You can view but not edit them.</div>' : '';

  ['sec_app_scoring','sec_unit_match','sec_reno_score','sec_budget'].forEach(function(secId) {
    var sec = document.getElementById(secId);
    if(!sec) return;
    var existing = sec.querySelector('#settings_lock_banner');
    if(existing) existing.remove();
    if(locked) sec.insertAdjacentHTML('afterbegin', lockMsg);
  });

  // Show/hide ED-only tabs
  var auditTab = document.getElementById('stab_audit');
  if(auditTab) auditTab.style.display = isED ? '' : 'none';
  var occTab = document.getElementById('stab_occupancy');
  if(occTab) occTab.style.display = isED ? '' : 'none';
  var aaTab = document.getElementById('stab_approval_authority');
  if(aaTab) aaTab.style.display = isED ? '' : 'none';

  // Lock NOS inputs for non-ED
  document.querySelectorAll('#nos_table_tbody input').forEach(function(el) {
    el.disabled = locked;
    el.style.opacity = locked ? '0.55' : '1';
    el.style.cursor = locked ? 'not-allowed' : '';
  });
  var nosBtn = document.getElementById('settings_save_nos_btn');
  if(nosBtn) nosBtn.style.display = locked ? 'none' : '';

  // Add lock banner to occupancy section
  var occSec = document.getElementById('sec_occupancy');
  if(occSec) {
    var existingOcc = occSec.querySelector('#settings_lock_banner');
    if(existingOcc) existingOcc.remove();
    if(locked) occSec.insertAdjacentHTML('afterbegin', lockMsg);
  }
}

function saveScoringModelED() {
  edGuard('Housing Application Scoring Model updated', function() {
    // Save scoring model to Supabase housing_settings
  fetch(SUPABASE_URL+'/rest/v1/housing_settings', {
    method: 'POST',
    headers: Object.assign({}, HOUSING_HEADERS, {'Prefer':'resolution=merge-duplicates,return=minimal'}),
    body: JSON.stringify({ key: 'scoring_model', value: liveScoreModel })
  }).catch(function(e){ console.warn('Scoring model save failed:',e); });
    rescoreAllApplications();
    if(document.getElementById('dashView') && document.getElementById('dashView').style.display !== 'none') {
      updateDashStats(); renderDashTable();
    }
    showToast('Application scoring model saved.');
  });
}
async function rescoreAndSave() {
  if(typeof rescoreAllApplications !== 'function') return;
  var btn = document.getElementById('settings_save_scoring_btn');
  if(btn) { btn.disabled = true; btn.textContent = 'Rescoring...'; }
  try {
    await rescoreAllApplications();
    showToast('✓ Rescored ' + applications.length + ' applications');
    // Reload data from Supabase to get fresh breakdowns, then refresh scorecard
    if(true) {
      sbLoadApplications().then(function(fresh) {
        if(fresh) {
          applications = fresh;
          if(window._currentScorecardApp) {
            var updated = applications.find(function(a){ return a.id === window._currentScorecardApp.id; });
            if(updated && typeof showScorecard === 'function') showScorecard(updated);
          }
          if(typeof renderMatchView === 'function' && document.getElementById('matchView') && document.getElementById('matchView').style.display !== 'none') renderMatchView();
        }
      });
    }
    if(typeof updateDashStats==='function') updateDashStats();
    if(typeof renderDashTable==='function') renderDashTable();
    if(typeof renderMatchView==='function') renderMatchView();
  } catch(e) {
    showToast('Rescore failed — check console');
    console.error('[SCORE] rescoreAndSave error:', e);
  } finally {
    if(btn) { btn.disabled = false; btn.textContent = '↺ Rescore All Applications'; }
  }
}

function confirmResetScoringModelED() {
  edGuard('Housing Application Scoring Model reset to defaults', function() {
    confirmResetScoringModel();
  });
}
function openAddCriteriaModalED() {
  if(window.currentRole !== ROLE.ED) { showToast('Only the Executive Director can add scoring criteria.'); return; }
  openAddCriteriaModal();
}

function saveRenoScoreModelED() {
  edGuard('Renovation Priority Scoring updated', function() {
    saveRenoScoreModel();
  });
}
function resetRenoScoreModelED() {
  edGuard('Renovation Priority Scoring reset to defaults', function() {
    resetRenoScoreModel();
  });
}
function saveBudgetPoolsED() {
  edGuard('Renovation Budget allocations updated', function() {
    saveBudgetPools();
  });
}

// ── Audit log viewer ──
async function renderAuditLog() {
  var tbody = document.getElementById('audit_log_tbody');
  if(!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" style="padding:24px;text-align:center;color:var(--muted);font-style:italic;">Loading…</td></tr>';

  // Load from Supabase (shared across all users)
  var log = [];
  try {
    var r = await fetch(
      SUPABASE_URL+'/rest/v1/housing_audit_log?order=created_at.desc&limit=500',
      { headers: HOUSING_HEADERS }
    );
    if(r.ok) {
      var rows = await r.json();
      log = rows.map(function(row) {
        // Handle both new columns and legacy column names
        var detailsStr = row.details || '';
        var d = {};
        try { d = JSON.parse(detailsStr); } catch(e) {}
        return {
          ts:     row.created_at || row.ts || '',
          appId:  row.entity_id  || row.app_id || '',
          action: row.action     || '',
          detail: d.detail       || row.detail || detailsStr || '',
          user:   row.actor      || row.user_role || 'Staff'
        };
      });
    }
  } catch(e) { console.warn('Audit log load failed:', e); }

  // Fall back to localStorage if Supabase is empty
  if(!log.length) {
    // audit log loaded from Supabase
  }

  // Action label map
  var actionLabels = {
    'application_submitted':    '📨 Submitted',
    'file_update_submitted':    '📨 File Update Submitted',
    'application_opened':       '📂 Opened for Edit',
    'draft_saved':              '💾 Draft Saved',
    'status_change':            '🔄 Status Changed',
    'status':                   '🔄 Status Changed',
    'signature_captured':       '✍️ Signature Captured',
    'archived':                 '📦 Archived',
    'unarchived':               '📤 Unarchived',
    'declined':                 '✕ Declined',
    'ed_adjustment':            '⭐ ED Score Adjustment',
    'unit_edit':                '🏠 Unit Saved',
    'sow_created':              '🔨 SOW Created',
    'sow_updated':              '🔨 SOW Updated',
    'sow_tenant_signed':        '✍️ Tenant Signed SOW',
    'sow_staff_signed':         '✍️ Staff Signed SOW',
    'sow_hm_approval':          '✅ HM Approved SOW',
    'sow_ed_approval':          '✅ ED Approved SOW',
    'sow_accountability':       '⚠️ Accountability Flagged',
    'settings_scoring_change':  '⚙️ Rubric Value Changed',
    'settings_scoring_add':     '⚙️ Rubric Criteria Added',
    'settings_scoring_delete':  '⚙️ Rubric Criteria Removed',
    'settings_scoring_reset':   '⚙️ Scoring Model Reset',
    'settings_unit_score_save': '⚙️ Unit Scoring Saved',
    'settings_reno_score_save': '⚙️ Reno Scoring Saved',
    'settings_budget_save':     '💰 Budget Saved',
    'settings_user_add':        '👤 User Added',
    'settings_user_remove':     '👤 User Removed',
    'settings_saved':           '⚙️ Settings Saved'
  };

  if(!log.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="padding:24px;text-align:center;color:var(--muted);font-style:italic;">No audit entries yet.</td></tr>';
    return;
  }

  tbody.innerHTML = log.slice(0,300).map(function(e) {
    var d  = new Date(e.ts);
    var ds = d.toLocaleDateString('en-CA')+' '+d.toLocaleTimeString('en-CA',{hour:'2-digit',minute:'2-digit'});
    var lbl = actionLabels[e.action] || e.action.replace(/_/g,' ');
    // Colour-code by category
    var rowBg = '';
    if(e.action==='application_submitted'||e.action==='file_update_submitted') rowBg='background:#f0fdf4;';
    else if(e.action==='status_change'||e.action==='status') rowBg='background:#eff6ff;';
    else if(e.action==='declined') rowBg='background:#fef2f2;';
    else if(e.action.startsWith('sow_')) rowBg='background:#fffbeb;';
    // Friendly appId display
    var appDisplay = e.appId || '—';
    if(appDisplay.startsWith('SOW:')) appDisplay = '<span style="font-size:10px;background:#fffbeb;color:#7a5c00;padding:1px 6px;border-radius:4px;font-weight:700;">SOW</span> ' + appDisplay.slice(4);
    else if(appDisplay === 'SETTINGS') appDisplay = '<span style="font-size:10px;background:#f0f0ec;color:#666;padding:1px 6px;border-radius:4px;font-weight:700;">SYS</span>';
    return '<tr style="border-bottom:1px solid var(--border);'+rowBg+'">'
      +'<td style="padding:8px 12px;font-size:11px;color:var(--muted);white-space:nowrap;">'+ds+'</td>'
      +'<td style="padding:8px 12px;font-size:11px;white-space:nowrap;">'+appDisplay+'</td>'
      +'<td style="padding:8px 12px;font-size:12px;font-weight:600;white-space:nowrap;">'+lbl+'</td>'
      +'<td style="padding:8px 12px;font-size:12px;color:var(--muted);">'+( e.detail||'—')+'</td>'
      +'<td style="padding:8px 12px;font-size:11px;color:var(--muted);white-space:nowrap;">'+( e.user||'—')+'</td>'
      +'</tr>';
  }).join('');
}

function showRenosForRole() {
  var role = window.currentRole || 'housing_employee_l1';
  if(ROLE.isManagement(role)) { showRenos(); } else { openRenoSearch(); }
}

function getContactSettings() {
  return window._contacts || {};
}
function saveContactSettings() {
  var s = {
    hm_name:  (document.getElementById('hm_name')  || {}).value || '',
    hm_email: (document.getElementById('hm_email') || {}).value || '',
    ed_name:  (document.getElementById('ed_name')  || {}).value || '',
    ed_email: (document.getElementById('ed_email') || {}).value || ''
  };
  window._contacts = s;
  fetch(SUPABASE_URL+'/rest/v1/housing_contacts', {
    method: 'POST',
    headers: Object.assign({}, HOUSING_HEADERS, {'Prefer':'resolution=merge-duplicates,return=minimal'}),
    body: JSON.stringify({ id: '00000000-0000-0000-0000-000000000001', data: s, updated_at: new Date().toISOString() })
  }).catch(function(e){ console.warn('Contacts save failed:',e); });
  var msg = document.getElementById('contacts_save_msg');
  if(msg) { msg.style.display = 'inline'; setTimeout(function(){ msg.style.display = 'none'; }, 2500); }
  showToast('Contact settings saved');
}
function populateContactSettings() {
  var s = getContactSettings();
  ['hm_name','hm_email','ed_name','ed_email'].forEach(function(id) {
    var el = document.getElementById(id);
    if(el && s[id]) el.value = s[id];
  });
}

