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
    el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--danger);font-size:13px;">approval-authority.js not loaded.</div>';
    return;
  }
  if(!APPROVAL_AUTHORITY.can('editApprovalAuthority', window.currentRole)) {
    el.innerHTML = '<div class="empty-state-ctr">Only the Executive Director can configure approval authorities.</div>';
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
      html += '<div class="js-txt-bold">'
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

// Map each section ID to its parent group, used by showSettingsSection to
// keep the top-tier group buttons + sub-tab row in sync when a section is
// opened programmatically.
var SETTINGS_SECTION_GROUPS = {
  sec_users:               'admin',
  sec_nation:              'admin',
  sec_themes:              'admin',
  sec_audit:               'admin',
  sec_approval_authority:  'admin',
  sec_app_scoring:         'app',
  sec_required_fields:     'app',
  sec_unit_match:          'app',
  sec_reno_score:          'app',
  sec_budget:              'app',
  sec_occupancy:           'app'
};

// First section opened when each group is activated by clicking the group pill.
var SETTINGS_GROUP_DEFAULT_SECTION = {
  admin: 'sec_users',
  app:   'sec_app_scoring'
};

function showSettingsGroup(groupId) {
  // Toggle group-bar pill state
  ['admin','app'].forEach(function(g){
    var btn = document.getElementById('sgroup_' + g);
    if (btn) btn.classList.toggle('active', g === groupId);
    var row = document.getElementById('settings_subtabs_' + g);
    if (row) row.classList.toggle('active', g === groupId);
  });
  // If the section currently visible doesn't belong to the new group, jump
  // to that group's first tab. Direct calls from showSettingsSection (after
  // the section was already chosen) skip this — guarded by _settingsSectionLock.
  if (window._settingsSectionLock) return;
  var defaultSec = SETTINGS_GROUP_DEFAULT_SECTION[groupId];
  if (!defaultSec) return;
  var current = document.querySelector('.settings-section[style*="block"]');
  var currentId = current ? current.id : null;
  if (!currentId || SETTINGS_SECTION_GROUPS[currentId] !== groupId) {
    showSettingsSection(defaultSec);
  }
}

function showSettingsSection(section) {
  var sections = ['sec_users','sec_app_scoring','sec_required_fields','sec_unit_match','sec_reno_score','sec_budget','sec_nation','sec_themes','sec_approval_authority','sec_audit','sec_occupancy'];
  sections.forEach(function(id){
    var el=document.getElementById(id);
    if(el) el.style.display=(id===section)?'block':'none';
  });
  // Activate the parent group so the right sub-tab row is visible.
  // Lock prevents showSettingsGroup from re-routing back to its default section.
  var parentGroup = SETTINGS_SECTION_GROUPS[section];
  if (parentGroup) {
    window._settingsSectionLock = true;
    try { showSettingsGroup(parentGroup); } finally { window._settingsSectionLock = false; }
  }
  // Sub-tab active state — scope to .settings-subtabs so the group buttons
  // (which carry their own active class) aren't toggled here.
  document.querySelectorAll('.settings-subtabs .tab-btn').forEach(function(t){
    var tabSec='sec_'+t.id.replace('stab_','');
    t.classList.toggle('active', tabSec===section);
  });
  if(section==='sec_users'       && typeof renderHousingUserTable==='function') renderHousingUserTable();
  if(section==='sec_nation'      && typeof renderNationPanel==='function') renderNationPanel();
  if(section==='sec_app_scoring') {
    if(APPROVAL_AUTHORITY.can('editScoreModel', window.currentRole) && typeof renderV2ScoringEditor === 'function') {
      renderV2ScoringEditor();
    } else {
      var wrap = document.getElementById('scoring_model_table_wrap');
      if(wrap) wrap.innerHTML = '<div class="empty-state-italic">Scoring model configuration is only available to the Executive Director.</div>';
    }
  }
  if(section==='sec_unit_match'  && typeof renderUnitScoreTable==='function') renderUnitScoreTable();
  if(section==='sec_reno_score'  && typeof renderRenoScoreTable==='function') renderRenoScoreTable();
  if(section==='sec_budget'      && typeof renderBudgetPools==='function') renderBudgetPools();
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
    return '<tr class="row-divider">'
      + '<td style="padding:10px 14px;font-weight:600;font-size:13px;">'+name+'</td>'
      + '<td style="padding:10px 14px;font-size:12px;color:var(--muted);">'+a.id+'</td>'
      + '<td style="padding:10px 14px;font-size:12px;color:var(--muted);">'+(a.appDate||'—')+'</td>'
      + (showScore ? '<td style="padding:10px 14px;"><span style="font-size:18px;font-weight:800;color:var(--text);">'+(typeof a.score==='number'?a.score:'—')+'</span>'
          +(tier?'<span style="font-size:10px;font-weight:700;margin-left:6px;color:'+tc+';">'+tier.replace(' Priority','')+'</span>':'')+'</td>' : '')
      + '<td style="padding:10px 14px;text-align:right;">'
      + (showReview ? '<button data-wl-id="'+a.id+'" onclick="wlOpenApp(this)" style="background:var(--info-blue);border:none;color:#fff;padding:4px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;">Review →</button>' : '')
      + '</td>'
      + '</tr>';
  }).join('');

  return '<div class="overflow-x"><table class="std-tbl">'
    + '<thead><tr style="background:var(--dark);">'
    + '<th class="js-th">Applicant</th>'
    + '<th class="js-th">ID</th>'
    + '<th class="js-th">Date</th>'
    + (showScore ? '<th class="js-th">Score</th>' : '')
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
      + '<strong>' + name + '</strong> <span class="js-lbl-xs">' + aid + '</span>'
      + '<div class="js-lbl-sm" class="mt-4">' + addr + '</div></div>';
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
  var role = window.currentRole || window._realRole || (typeof HOUSING_SESSION !== 'undefined' && HOUSING_SESSION.role) || '';
  var isED = APPROVAL_AUTHORITY.can('editScoreModel', role);
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
    '<div id="settings_lock_banner" style="display:flex;align-items:center;gap:8px;background:var(--warn-amber-bg);border:1px solid var(--warn-amber-border);border-radius:8px;padding:10px 14px;font-size:12px;color:var(--warn-amber);margin-bottom:14px;">'+
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
  if(!APPROVAL_AUTHORITY.can('editScoreModel', window.currentRole)) { showToast('Only the Executive Director can add scoring criteria.'); return; }
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
// Action label map — shared by renderer and CSV export.
var AUDIT_ACTION_LABELS = {
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

// Map an audit row's action to a row-tint class. Empty string = no tint.
function _auditRowClass(action) {
  if (action === 'application_submitted' || action === 'file_update_submitted') return 'audit-row-submit';
  if (action === 'status_change' || action === 'status')                         return 'audit-row-status';
  if (action === 'declined')                                                     return 'audit-row-declined';
  if (action && action.indexOf('sow_') === 0)                                    return 'audit-row-sow';
  return '';
}

async function renderAuditLog() {
  var tbody = document.getElementById('audit_log_tbody');
  if(!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" class="empty-state-italic">Loading…</td></tr>';

  // Load from Supabase (shared across all users). The DB column is `detail`
  // (singular) and stores JSON like {"detail":"...","name":"..."}; we parse
  // it here so the table can show plain text in the Detail column and the
  // user's full name in the By column.
  var log = [];
  try {
    var r = await fetch(
      SUPABASE_URL+'/rest/v1/housing_audit_log?order=created_at.desc&limit=500',
      { headers: HOUSING_HEADERS }
    );
    if(r.ok) {
      var rows = await r.json();
      log = rows.map(function(row) {
        var raw = row.detail || row.details || '';
        var parsed = null;
        if (typeof raw === 'string' && raw.length && raw.charAt(0) === '{') {
          try { parsed = JSON.parse(raw); } catch(e) { parsed = null; }
        } else if (raw && typeof raw === 'object') {
          parsed = raw;
        }
        var detailText = (parsed && parsed.detail) || (typeof raw === 'string' ? raw : '') || '';
        var name       = (parsed && parsed.name)   || row.actor_name || '';
        return {
          ts:     row.created_at || row.ts || '',
          appId:  row.entity_id  || row.app_id || '',
          action: row.action     || '',
          detail: detailText,
          role:   row.actor      || row.user_role || 'Staff',
          name:   name
        };
      });
    }
  } catch(e) { console.warn('Audit log load failed:', e); }

  // Cache for CSV export — built from whatever we just rendered.
  window._auditRows = log;

  if(!log.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state-italic">No audit entries yet.</td></tr>';
    return;
  }

  tbody.innerHTML = log.slice(0,300).map(function(e) {
    var d  = new Date(e.ts);
    var ds = d.toLocaleDateString('en-CA')+' '+d.toLocaleTimeString('en-CA',{hour:'2-digit',minute:'2-digit'});
    var lbl = AUDIT_ACTION_LABELS[e.action] || (e.action || '').replace(/_/g,' ');
    var rowCls = _auditRowClass(e.action);

    // Friendly appId display: surface SOW: / SETTINGS prefixes as compact pills.
    var appDisplay = e.appId || '—';
    if (appDisplay.indexOf('SOW:') === 0) {
      appDisplay = '<span class="audit-pill audit-pill-sow">SOW</span> ' + appDisplay.slice(4);
    } else if (appDisplay === 'SETTINGS') {
      appDisplay = '<span class="audit-pill audit-pill-sys">SYS</span>';
    }

    // By column: prefer full name; fall back to role for legacy rows that
    // were written before auditEntry started capturing the name.
    var byHtml = e.name
      ? '<span class="audit-by-name">'+e.name+'</span><span class="audit-by-role">'+(e.role||'')+'</span>'
      : '<span class="audit-by-name">'+(e.role||'—')+'</span>';

    return '<tr'+(rowCls?' class="'+rowCls+'"':'')+'>'
      +'<td class="audit-cell-date">'+ds+'</td>'
      +'<td class="audit-cell-ref">'+appDisplay+'</td>'
      +'<td class="audit-cell-event">'+lbl+'</td>'
      +'<td class="audit-cell-detail">'+(e.detail || '—')+'</td>'
      +'<td class="audit-cell-by">'+byHtml+'</td>'
      +'</tr>';
  }).join('');
}

// Export the currently-loaded audit rows. Dispatched from headerExport()
// when _currentExportView === 'audit_log'. Reuses the shared _doExport
// helper so download / toast / xlsx behaviour matches inventory + reno.
function exportAudit(format) {
  var rows = Array.isArray(window._auditRows) ? window._auditRows : [];
  if (!rows.length) {
    if (typeof showToast === 'function') showToast('No audit entries to export.');
    return;
  }
  var headers = ['Date / Time', 'ID / Ref', 'Event', 'Detail', 'Name', 'Role'];
  var data = rows.map(function(e) {
    var d  = new Date(e.ts);
    var ds = isNaN(d.getTime()) ? (e.ts || '') : (d.toLocaleDateString('en-CA')+' '+d.toLocaleTimeString('en-CA',{hour:'2-digit',minute:'2-digit'}));
    var lbl = AUDIT_ACTION_LABELS[e.action] || (e.action || '').replace(/_/g,' ');
    return [ds, e.appId || '', lbl, e.detail || '', e.name || '', e.role || ''];
  });
  var stamp = new Date().toISOString().slice(0,10);
  if (typeof _doExport === 'function') {
    _doExport(format || 'csv', headers, data, 'audit-log-'+stamp, [20, 18, 26, 60, 24, 18]);
  }
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

// ══════════════════════════════════════════════════════════════
// THEMES — brand color + logo customization (ED only)
// Persisted to housing_settings.theme as { yellow, dark, text, logo }
// Applied live via _applyTheme() (defined in shared.js)
// ══════════════════════════════════════════════════════════════
function _themeFieldRow(key, label, desc, currentVal, defaultVal) {
  var val = currentVal || defaultVal;
  return '<div class="theme-row">'
    + '<label for="theme_'+key+'">'+label+'</label>'
    + '<input type="color" id="theme_'+key+'" value="'+val+'" oninput="_themeOnPickerChange(\''+key+'\')"/>'
    + '<input type="text" class="theme-hex" id="theme_'+key+'_hex" value="'+val+'" oninput="_themeOnHexChange(\''+key+'\')" maxlength="7"/>'
    + '<span class="theme-desc">'+desc+'</span>'
    + '</div>';
}

function renderThemesPanel() {
  var body = document.getElementById('themes_panel_body');
  if(!body) return;
  var role = window.currentRole || 'housing_employee_l1';
  var isED = APPROVAL_AUTHORITY.can('editApprovalAuthority', role);
  if(!isED){
    body.innerHTML = '<div class="empty-state-ctr">Theme customization is restricted to the Executive Director.</div>';
    return;
  }
  var theme = (window._appSettings && window._appSettings.theme) || {};
  var defaults = window.THEME_DEFAULTS || { yellow:'#F8E41A', dark:'#111110', text:'#111110' };
  var hasLogo = !!theme.logo;
  body.innerHTML =
      _themeFieldRow('yellow', 'Brand Accent', 'Primary highlight — buttons, badges, links', theme.yellow, defaults.yellow)
    + _themeFieldRow('dark',   'Header / Dark Surface', 'App header, modal headers, print banners', theme.dark, defaults.dark)
    + _themeFieldRow('text',   'Body Text', 'Default text color across the app', theme.text, defaults.text)
    + '<div class="theme-logo-zone upload-zone p-16"'
    +   ' id="theme_logo_zone"'
    +   ' ondragover="photoDragOver(event,\'theme_logo_zone\')"'
    +   ' ondragleave="photoDragLeave(\'theme_logo_zone\')"'
    +   ' ondrop="_themeOnLogoDrop(event)"'
    +   ' onclick="if(event.target.tagName!==\'BUTTON\')document.getElementById(\'theme_logo_file\').click()">'
    +   '<div id="theme_logo_preview_wrap" class="theme-logo-preview-wrap"' + (hasLogo ? '' : ' style="display:none;"') + '>'
    +     '<div class="theme-logo-preview"><img id="theme_logo_preview" src="'+(theme.logo||'')+'" alt="Logo"/></div>'
    +     '<button type="button" onclick="event.stopPropagation();_themeClearLogo()" class="btn btn-ghost btn-sm">Remove logo</button>'
    +   '</div>'
    +   '<div id="theme_logo_empty"' + (hasLogo ? ' style="display:none;"' : '') + '>'
    +     '<svg class="upload-zone-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>'
    +     '<div class="upload-zone-title">Drag a logo here or <span class="link-yellow">browse</span></div>'
    +     '<div class="txt-muted-xs">PNG or SVG · transparent background recommended · max 200 KB</div>'
    +   '</div>'
    +   '<input type="file" id="theme_logo_file" accept="image/*" onchange="_themeOnLogoFile(this)"/>'
    + '</div>'
    + '<div id="theme_logo_msg" class="txt-fineprint"></div>'
    + '<label class="flex-row-mb" style="margin-top:10px;cursor:pointer;">'
    +   '<input type="checkbox" id="theme_logo_transparent"' + (theme.logoTransparent?' checked':'') + ' onchange="_themeOnTransparentChange()"/>'
    +   '<span class="txt-help m-0">Drop white background &mdash; useful when the logo image isn&rsquo;t saved with a transparent background. Best for clean white-on-dark logos.</span>'
    + '</label>'
    + '<div class="flex-end-10" style="margin-top:18px;">'
    +   '<button type="button" onclick="resetThemeSettings()" class="btn btn-ghost">Reset to Defaults</button>'
    +   '<button type="button" onclick="saveThemeSettings()" class="btn btn-primary">Save &amp; Apply</button>'
    + '</div>';
  // Stash a working copy for the file picker to write into
  window._themeDraftLogo = theme.logo || '';
  // Sync preview's transparency state with the saved setting (the just-rendered
  // <img> doesn't have the class yet — _applyTheme ran before the panel existed)
  _themeOnTransparentChange();
}

// Sync hex input → color picker, and apply preview live
function _themeOnPickerChange(key) {
  var picker = document.getElementById('theme_'+key);
  var hex    = document.getElementById('theme_'+key+'_hex');
  if(picker && hex) hex.value = picker.value;
  document.documentElement.style.setProperty('--'+key, picker.value);
}
function _themeOnHexChange(key) {
  var hex    = document.getElementById('theme_'+key+'_hex');
  var picker = document.getElementById('theme_'+key);
  if(!hex) return;
  var v = (hex.value||'').trim();
  if(!/^#[0-9a-fA-F]{6}$/.test(v)) return;       // wait for a valid hex
  if(picker) picker.value = v;
  document.documentElement.style.setProperty('--'+key, v);
}
function _themeApplyLogoFile(f) {
  var msg = document.getElementById('theme_logo_msg');
  if(!f) return;
  if(!/^image\//.test(f.type)) {
    if(msg) msg.textContent = 'That file type is not supported — pick an image.';
    return;
  }
  if(f.size > 200 * 1024) {
    if(msg) msg.textContent = 'File too large — keep logos under 200 KB.';
    return;
  }
  var rdr = new FileReader();
  rdr.onload = function(e){
    var dataUrl = e.target.result;
    window._themeDraftLogo = dataUrl;
    var img   = document.getElementById('theme_logo_preview');
    var wrap  = document.getElementById('theme_logo_preview_wrap');
    var empty = document.getElementById('theme_logo_empty');
    if(img)   img.src = dataUrl;
    if(wrap)  wrap.style.display  = '';
    if(empty) empty.style.display = 'none';
    if(msg) msg.textContent = 'Logo ready — click Save & Apply to publish.';
  };
  rdr.readAsDataURL(f);
}
function _themeOnLogoFile(input) {
  var f = input.files && input.files[0];
  _themeApplyLogoFile(f);
  input.value = '';  // allow re-selecting the same file
}
function _themeOnLogoDrop(e) {
  e.preventDefault();
  photoDragLeave('theme_logo_zone');
  var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  _themeApplyLogoFile(f);
}
function _themeOnTransparentChange() {
  var on = !!(document.getElementById('theme_logo_transparent')||{}).checked;
  document.querySelectorAll('img.hlogo, #login-logo, #theme_logo_preview').forEach(function(img){
    img.classList.toggle('logo-transparent', on);
  });
}
function _themeClearLogo() {
  window._themeDraftLogo = '';
  var img   = document.getElementById('theme_logo_preview');
  var wrap  = document.getElementById('theme_logo_preview_wrap');
  var empty = document.getElementById('theme_logo_empty');
  var msg   = document.getElementById('theme_logo_msg');
  if(img)   img.src = '';
  if(wrap)  wrap.style.display  = 'none';
  if(empty) empty.style.display = '';
  if(msg) msg.textContent = 'Logo cleared — click Save & Apply to publish.';
}

function _readThemeFromForm() {
  function v(id){ var el=document.getElementById(id); return el ? (el.value||'').trim() : ''; }
  function cb(id){ var el=document.getElementById(id); return !!(el && el.checked); }
  return {
    yellow:           v('theme_yellow_hex') || v('theme_yellow'),
    dark:             v('theme_dark_hex')   || v('theme_dark'),
    text:             v('theme_text_hex')   || v('theme_text'),
    logo:             window._themeDraftLogo || '',
    logoTransparent:  cb('theme_logo_transparent')
  };
}

function saveThemeSettings() {
  if((window.currentRole||'') !== ROLE.ED) { showToast('Only the Executive Director can change the theme.'); return; }
  var theme = _readThemeFromForm();
  if(typeof _applyTheme === 'function') _applyTheme(theme);
  if(!window._appSettings) window._appSettings = {};
  window._appSettings.theme = theme;
  sbSaveSetting('theme', theme).then(function(ok){
    if(ok){
      showToast('Theme saved and applied');
      if(typeof auditEntry === 'function') auditEntry('SETTINGS', 'theme_updated', 'Brand theme updated', window.currentRole||'staff');
    } else {
      showToast('Theme save failed — applied locally only');
    }
  });
}

function resetThemeSettings() {
  if((window.currentRole||'') !== ROLE.ED) { showToast('Only the Executive Director can change the theme.'); return; }
  showConfirm({
    title:       'Reset brand theme?',
    message:     'This clears any saved colors and logo and restores the default brand. This cannot be undone.',
    confirmText: 'Reset to Defaults',
    danger:      true
  }).then(function(ok){
    if(!ok) return;
    var empty = {};
    if(typeof _applyTheme === 'function') _applyTheme(empty);
    if(!window._appSettings) window._appSettings = {};
    window._appSettings.theme = empty;
    window._themeDraftLogo = '';
    sbSaveSetting('theme', empty).then(function(saved){
      if(saved){
        showToast('Theme reset to defaults');
        if(typeof auditEntry === 'function') auditEntry('SETTINGS', 'theme_reset', 'Brand theme reset to defaults', window.currentRole||'staff');
      }
      renderThemesPanel();
    });
  });
}

// ══════════════════════════════════════════════════════════════
// REQUIRED FIELDS — ED-only configuration of which application
// fields show a red * and block submission when blank.
// Persisted to housing_settings.required_fields = { fieldId: bool }.
// Drives applyRequiredFields() (form markers) + isFieldRequired()
// (validators). Registry lives in shared-config.js APP_REQ_FIELDS.
// ══════════════════════════════════════════════════════════════
function renderRequiredFieldsPanel() {
  var body = document.getElementById('required_fields_panel_body');
  if(!body) return;
  var role = window.currentRole || 'housing_employee_l1';
  var isED = APPROVAL_AUTHORITY.can('editApprovalAuthority', role);
  if(!isED){
    body.innerHTML = '<div class="empty-state-ctr">Required-field configuration is restricted to the Executive Director.</div>';
    return;
  }
  var registry = window.APP_REQ_FIELDS    || [];
  var sections = window.APP_REQ_SECTIONS  || [];
  var steps    = window.APP_REQ_STEPS     || [];
  var cfg      = (typeof getRequiredFieldsConfig === 'function') ? getRequiredFieldsConfig() : {};
  var activeStep = (typeof window._rfActiveStep === 'number') ? window._rfActiveStep : steps[0].step;

  // Sub-tab strip — one per step
  var tabsHtml = '<div class="rf-tabs">';
  steps.forEach(function(s){
    tabsHtml += '<button type="button" class="rf-tab' + (s.step === activeStep ? ' active' : '') + '" onclick="_rfShowStep(' + s.step + ')">' + s.label + '</button>';
  });
  tabsHtml += '</div>';

  // Active step's content
  var stepFields   = registry.filter(function(f){ return f.step === activeStep; });
  var stepSections = sections.filter(function(s){ return s.step === activeStep; });
  var stepDef      = steps.find(function(s){ return s.step === activeStep; });

  var html = tabsHtml + '<div class="rf-stage">';

  // Co-applicant note
  if (activeStep === 2) {
    html += '<div class="txt-help m-0" style="margin-bottom:12px;">These fields are only validated when the applicant adds a co-applicant on the form.</div>';
  }

  // Section toggle (for dynamic-row steps)
  if (stepSections.length) {
    html += '<div class="rf-section-row">';
    stepSections.forEach(function(s){
      var on = cfg[s.id] === true;
      html += '<label class="rf-row rf-section">'
        + '<input type="checkbox" data-rf-key="' + s.id + '"' + (on ? ' checked' : '') + ' onchange="_rfOnChange()"/>'
        + '<span class="rf-label">' + s.label + '</span>'
        + '</label>';
    });
    html += '</div>';
  }

  // Field list
  if (stepFields.length) {
    html += '<div class="lbl-uppercase-sm" style="margin-bottom:8px;">' +
      (stepDef && stepDef.step !== 0 && (stepFields[0].rowOf) ? 'Per-Row Required Fields' : 'Required Fields') +
      '</div><div class="rf-rows">';
    stepFields.forEach(function(f){
      var checked = cfg[f.id] !== false;
      html += '<label class="rf-row">'
        + '<input type="checkbox" data-rf-key="' + f.id + '"' + (checked ? ' checked' : '') + ' onchange="_rfOnChange()"/>'
        + '<span class="rf-label">' + f.label + '</span>'
        + '<span class="rf-id">' + f.id + '</span>'
        + '</label>';
    });
    html += '</div>';
    if (stepFields[0] && stepFields[0].rowOf) {
      html += '<div class="txt-fineprint" style="margin-top:8px;">Row-level fields are only enforced when the applicant has started filling that row.</div>';
    }
  } else {
    html += '<div class="empty-state-ctr">No configurable fields on this page.</div>';
  }

  html += '</div>'; // /rf-stage

  html += '<div class="flex-end-10" style="margin-top:18px;">'
    + '<button type="button" onclick="resetRequiredFieldsSettings()" class="btn btn-ghost">Reset to Defaults</button>'
    + '<button type="button" onclick="saveRequiredFieldsSettings()" class="btn btn-primary">Save &amp; Apply</button>'
    + '</div>';
  body.innerHTML = html;
}

// Switch the active step sub-tab — preserves any unsaved checkbox edits
// by merging the current form state into _appSettings before re-rendering.
function _rfShowStep(stepNum) {
  // Stash current form state so the user's unsaved edits persist across tabs
  var cfg = _rfReadFromForm();
  if (!window._appSettings) window._appSettings = {};
  // Merge — only overwrite keys present on the current sub-tab
  var merged = Object.assign({}, window._appSettings.required_fields || {}, cfg);
  window._appSettings.required_fields = merged;
  window._rfActiveStep = stepNum;
  renderRequiredFieldsPanel();
  if (typeof applyRequiredFields === 'function') applyRequiredFields();
}

// Live-toggle the form's red * markers as the ED ticks each checkbox.
// Merges the visible tab's edits with whatever's already stored so that
// switching sub-tabs doesn't lose state for the hidden fields.
function _rfOnChange() {
  var visible = _rfReadFromForm();
  if(!window._appSettings) window._appSettings = {};
  var merged = Object.assign({}, window._appSettings.required_fields || {}, visible);
  window._appSettings.required_fields = merged;
  if(typeof applyRequiredFields === 'function') applyRequiredFields();
}

// Reads only the checkboxes currently in the DOM (one sub-tab at a time).
function _rfReadFromForm() {
  var cfg = {};
  document.querySelectorAll('[data-rf-key]').forEach(function(el){
    cfg[el.getAttribute('data-rf-key')] = !!el.checked;
  });
  return cfg;
}

function saveRequiredFieldsSettings() {
  if((window.currentRole||'') !== ROLE.ED) { showToast('Only the Executive Director can change required fields.'); return; }
  // Merge visible-tab edits with stored config so we save the full picture
  var visible = _rfReadFromForm();
  if(!window._appSettings) window._appSettings = {};
  var cfg = Object.assign({}, window._appSettings.required_fields || {}, visible);
  window._appSettings.required_fields = cfg;
  if(typeof applyRequiredFields === 'function') applyRequiredFields();
  sbSaveSetting('required_fields', cfg).then(function(ok){
    if(ok){
      showToast('Required fields saved');
      if(typeof auditEntry === 'function') auditEntry('SETTINGS', 'required_fields_updated', 'Application required-field config updated', window.currentRole||'staff');
    } else {
      showToast('Save failed — applied locally only');
    }
  });
}

function resetRequiredFieldsSettings() {
  if((window.currentRole||'') !== ROLE.ED) { showToast('Only the Executive Director can change required fields.'); return; }
  showConfirm({
    title:       'Reset required fields?',
    message:     'This clears any saved overrides and restores the default required fields.',
    confirmText: 'Reset to Defaults',
    danger:      true
  }).then(function(ok){
    if(!ok) return;
    if(!window._appSettings) window._appSettings = {};
    window._appSettings.required_fields = {};
    if(typeof applyRequiredFields === 'function') applyRequiredFields();
    sbSaveSetting('required_fields', {}).then(function(saved){
      if(saved){
        showToast('Required fields reset to defaults');
        if(typeof auditEntry === 'function') auditEntry('SETTINGS', 'required_fields_reset', 'Required fields reset to defaults', window.currentRole||'staff');
      }
      renderRequiredFieldsPanel();
    });
  });
}

