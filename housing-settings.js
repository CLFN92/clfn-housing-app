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

  // Role pill sets per authority GROUP. Field Employees (maintenance crew) are
  // relevant to operational approvals — SOW/renovation, contractors, inspections —
  // and housing applications, but NOT to finance. Finance adds CFO + Finance Clerk.
  var _aaRoleLabel = function(v) {
    if (window.CLFN_PERMS && CLFN_PERMS.ROLE_LABELS && CLFN_PERMS.ROLE_LABELS[v]) return CLFN_PERMS.ROLE_LABELS[v];
    var fb = { ed:'Executive Director', housing_manager:'Housing Manager', housing_employee_l2:'Housing Employee L2',
               housing_employee_l1:'Housing Employee L1', field_employee:'Field Employee', cfo:'CFO', finance_l1:'Finance Clerk L1' };
    return fb[v] || v;
  };
  var _aaRoleSet = function(values) { return values.map(function(v){ return { value: v, label: _aaRoleLabel(v) }; }); };
  var MGMT_ROLES   = ['ed', 'housing_manager', 'housing_employee_l2', 'housing_employee_l1'];
  var rolesMgmt    = _aaRoleSet(MGMT_ROLES);
  var rolesFinance = _aaRoleSet(MGMT_ROLES.concat(['cfo', 'finance_l1']));
  var rolesField   = _aaRoleSet(MGMT_ROLES.concat(['field_employee']));
  // Groups where Field Employee is a selectable role.
  var FIELD_GROUPS = ['Housing Application', 'Maintenance Request & Renovation', 'Contractors', 'Inspections'];

  var groups   = APPROVAL_AUTHORITY.groups;
  var labels   = APPROVAL_AUTHORITY.labels;
  var defaults = APPROVAL_AUTHORITY.defaults;

  var html = '';

  // ── Approval threshold (HM budget limit) ─────────────────────────────────
  // The dollar threshold that controls HM-final vs ED-escalation routing for
  // maintenance requests (SOWs) and unit renovation budgets. Reads/writes the
  // single _appSettings.hmBudgetLimit setting (same value the Renovation Budget
  // panel uses); saved immediately on change.
  var _curLimit = (typeof _getHmLimit === 'function')
    ? _getHmLimit() : (((window._appSettings||{}).hmBudgetLimit) || 25000);
  html += '<div style="margin-bottom:24px;padding:14px 16px;background:var(--bg);border:1px solid var(--border);border-left:3px solid var(--yellow);border-radius:8px;">'
        + '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:var(--yellow);margin-bottom:8px;">Approval Threshold</div>'
        + '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">'
        +   '<div style="display:flex;align-items:center;gap:6px;">'
        +     '<span style="font-size:15px;font-weight:700;color:var(--text);">$</span>'
        +     '<input id="aa_hm_budget_limit" type="number" min="0" step="1000" value="' + _curLimit + '" onchange="aaSaveBudgetLimit(this)"'
        +       ' style="width:140px;padding:7px 10px;border:1.5px solid var(--border);border-radius:7px;font-size:14px;font-weight:700;color:var(--text);font-family:DM Sans,sans-serif;background:var(--surface);text-align:right;"/>'
        +   '</div>'
        +   '<div style="font-size:12px;color:var(--muted);flex:1;min-width:240px;line-height:1.5;">Maintenance requests and unit renovation budgets <strong>at or under</strong> this amount are approved by the Housing Manager (final). <strong>Over</strong> it, they require Executive Director final approval. Saved immediately.</div>'
        + '</div>'
        + '</div>';

  Object.keys(groups).forEach(function(groupName) {
    var keys = groups[groupName];
    // Pick the role pill set for this group.
    var rolesForGroup = groupName === 'Finance' ? rolesFinance
                      : (FIELD_GROUPS.indexOf(groupName) !== -1 ? rolesField : rolesMgmt);
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
                  + 'background:var(--warn-amber-bg);color:#d97706;border:1px solid #fde68a;">Modified</span>';

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
        var toggleable = (typeof APPROVAL_AUTHORITY.isToggleable === 'function') && APPROVAL_AUTHORITY.isToggleable(key);
        var reqd = !toggleable || APPROVAL_AUTHORITY.required(key);
        html += '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">';
        // On/off (auto-approve) switch for the sign-off gates.
        if (toggleable) {
          html += '<button onclick="aaToggleApproval(\'' + key + '\')" title="Turn this approval step on or off"'
            + ' style="padding:5px 12px;border-radius:20px;font-size:11px;font-weight:800;cursor:pointer;'
            + 'font-family:DM Sans,sans-serif;white-space:nowrap;margin-right:6px;'
            + 'background:' + (reqd ? '#f0fdf4' : '#fff7ed') + ';'
            + 'color:'      + (reqd ? '#15803d' : '#c2410c') + ';'
            + 'border:1.5px solid ' + (reqd ? '#86efac' : '#fdba74') + ';">'
            + (reqd ? '&#10003; Approval required' : '&#9889; Auto-approve (off)') + '</button>';
        }
        if (reqd) {
          var rolesForKey = rolesForGroup;
          rolesForKey.forEach(function(r) {
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
        } else {
          html += '<span style="font-size:11px;color:var(--muted);font-style:italic;">Auto-approved on submit &mdash; recorded as System.</span>';
        }
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

// ── Approval on/off toggle ──────────────────────────────────────────────
// Unlike the role pills (in-memory until "Save Changes"), flipping an
// approval on/off is a side-effecting action — turning it off auto-approves
// the current queue — so it confirms, persists immediately, sweeps, audits.
function aaToggleApproval(key) {
  if (typeof APPROVAL_AUTHORITY === 'undefined' || !APPROVAL_AUTHORITY.isToggleable(key)) return;
  var role = window._realRole || window.currentRole;
  if (!APPROVAL_AUTHORITY.can('editApprovalAuthority', role)) {
    if (typeof showToast === 'function') showToast('Only the Executive Director can change approvals.');
    return;
  }
  var label       = APPROVAL_AUTHORITY.labels[key] || key;
  var turningOff   = APPROVAL_AUTHORITY.required(key); // currently required → we're turning it off
  if (!turningOff) { _aaApplyApprovalToggle(key, true); return; } // turning back ON — no confirm/sweep

  var pending = (typeof approvalSweepCount === 'function') ? approvalSweepCount(key) : 0;
  var msg = 'Turn OFF "' + label + '"?\n\nFrom now on, matching items are approved automatically on submit (recorded as System — approval disabled).';
  if (pending > 0) msg += '\n\n' + pending + ' item(s) currently waiting for this approval will be auto-approved right now.';
  if (typeof showConfirm === 'function') {
    showConfirm({ title:'Turn off this approval?', message: msg, confirmText:'Turn off and auto-approve', danger:true }).then(function(r){
      var ok = (typeof r === 'object' && r !== null) ? !!r.ok : !!r;
      if (ok) _aaApplyApprovalToggle(key, false);
    });
  } else if (window.confirm(msg)) {
    _aaApplyApprovalToggle(key, false);
  }
}

function _aaApplyApprovalToggle(key, isRequired) {
  APPROVAL_AUTHORITY.setRequired(key, isRequired);
  _aaPersistApprovalAuthority();
  var role  = window._realRole || window.currentRole || 'ed';
  var label = APPROVAL_AUTHORITY.labels[key] || key;
  if (typeof auditEntry === 'function') {
    auditEntry('SETTINGS', 'approval_toggle',
      label + ' — approval ' + (isRequired ? 'turned ON (sign-off required)' : 'turned OFF (auto-approve)'),
      role);
  }
  if (!isRequired && typeof applyApprovalDisabledSweep === 'function') {
    applyApprovalDisabledSweep(key); // retroactively approve the current queue
  }
  if (typeof renderApprovalAuthorityPanel === 'function') renderApprovalAuthorityPanel();
  if (typeof renderWorklist === 'function') renderWorklist();
}

// Persist the full approval-authority blob INCLUDING the __disabled list.
function _aaPersistApprovalAuthority() {
  var data = Object.assign({}, APPROVAL_AUTHORITY.allRoleEntries(), APPROVAL_AUTHORITY.allThresholds());
  data.__disabled = APPROVAL_AUTHORITY.disabledList();
  if (!window._appSettings) window._appSettings = {};
  window._appSettings['approval_authority'] = data;
  if (typeof saveSettingWithDraftFallback === 'function') {
    saveSettingWithDraftFallback('approval_authority', data);
  }
}
window.aaToggleApproval = aaToggleApproval;

// Save the approval threshold (HM budget limit) from the Approval Authority
// panel. Writes the single _appSettings.hmBudgetLimit value, keeps the
// Renovation Budget panel input in sync, persists immediately, and audits.
function aaSaveBudgetLimit(el) {
  var v = parseFloat(el && el.value);
  if (isNaN(v) || v < 0) { v = 25000; if (el) el.value = v; }
  var s = window._appSettings || {};
  var prev = s.hmBudgetLimit;
  s.hmBudgetLimit = v;
  window._appSettings = s;
  var other = document.getElementById('settings_hm_budget_limit'); // Renovation Budget panel
  if (other) other.value = v;
  if (typeof saveSettingWithDraftFallback === 'function') {
    saveSettingWithDraftFallback('app_settings', s).then(function(ok){
      if (!ok) {
        s.hmBudgetLimit = prev; window._appSettings = s;
        if (typeof showToast === 'function') showToast('Could not save approval threshold — retry.', { type:'error' });
      } else if (typeof showToast === 'function') {
        showToast('Approval threshold saved: $' + v.toLocaleString());
      }
    });
  }
  if (typeof auditEntry === 'function') {
    auditEntry('SETTINGS', 'settings_budget_save', 'Approval threshold (HM budget limit) set to $' + v, window.currentRole || 'staff');
  }
}
window.aaSaveBudgetLimit = aaSaveBudgetLimit;

function aaResetAction(key) {
  APPROVAL_AUTHORITY.reset(key);
  renderApprovalAuthorityPanel();
}

function saveApprovalAuthoritySettings() {
  var effectiveRole = window._realRole || window.currentRole;
  if(typeof APPROVAL_AUTHORITY === 'undefined' || !APPROVAL_AUTHORITY.can('editApprovalAuthority', effectiveRole)) {
    showToast('Only the Executive Director can save approval authority settings.');
    return;
  }
  // Save the full live config (role arrays + numeric thresholds) so any
  // revert-to-default is also captured rather than relying on diffs.
  var data = Object.assign({}, APPROVAL_AUTHORITY.allRoleEntries(), APPROVAL_AUTHORITY.allThresholds());
  data.__disabled = APPROVAL_AUTHORITY.disabledList();
  console.log('[AA] saving approval_authority:', data);
  if(!window._appSettings) window._appSettings = {};
  window._appSettings['approval_authority'] = data;
  saveSettingWithDraftFallback('approval_authority', data).then(function(ok) {
    if(ok) {
      showToast('✓ Approval authority saved');
      if(typeof auditEntry === 'function') auditEntry('SETTINGS', 'approval_authority_save', 'Approval authority configuration updated', effectiveRole || 'ed');
    } else {
      showToast('Save failed — open browser console (F12) for details');
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
  sec_notifications:       'admin',
  sec_terms:               'admin',
  sec_contracts:           'admin',
  sec_config:              'admin',
  sec_maint_qr:            'admin',
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
  var sections = ['sec_users','sec_app_scoring','sec_required_fields','sec_unit_match','sec_reno_score','sec_budget','sec_nation','sec_themes','sec_approval_authority','sec_notifications','sec_terms','sec_contracts','sec_config','sec_maint_qr','sec_audit','sec_occupancy'];
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
    if(APPROVAL_AUTHORITY.can('editMatchPriority', window.currentRole) && typeof renderMatchPriorityEditor === 'function') {
      renderMatchPriorityEditor();
    } else {
      var mpWrap = document.getElementById('match_priority_wrap');
      if(mpWrap) mpWrap.innerHTML = '<div class="empty-state-italic">Match priority configuration is not available for your role.</div>';
    }
  }
  if(section==='sec_unit_match'  && typeof renderUnitScoreTable==='function') renderUnitScoreTable();
  if(section==='sec_reno_score'  && typeof renderRenoScoreTable==='function') renderRenoScoreTable();
  if(section==='sec_budget'      && typeof renderBudgetPools==='function') renderBudgetPools();
  if(section==='sec_audit'       && typeof renderAuditLog==='function') renderAuditLog();
  // Start/stop the audit log auto-refresh based on whether its tab is active.
  if(section==='sec_audit') { if(typeof _startAuditAutoRefresh==='function') _startAuditAutoRefresh(); }
  else                      { if(typeof _stopAuditAutoRefresh==='function')  _stopAuditAutoRefresh();  }
  if(section==='sec_occupancy'   && typeof renderNosTable==='function') renderNosTable();
  if(section==='sec_notifications' && typeof renderNotificationsTab==='function') renderNotificationsTab();
  if(section==='sec_terms'          && typeof renderTermsTab==='function')      renderTermsTab();
  if(section==='sec_contracts'      && typeof renderContractsTab==='function')  renderContractsTab();
  if(section==='sec_config'         && typeof renderConfigPanel==='function')   renderConfigPanel();
  if(section==='sec_maint_qr'       && typeof renderMaintenanceQrPanel==='function') renderMaintenanceQrPanel();
  if(section==='sec_approval_authority' && typeof renderApprovalAuthorityPanel==='function') renderApprovalAuthorityPanel();
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
  // Business / Department uses its own short, non-scored modal — not the
  // residential wizard. Launch it and revert the radio to New Housing so the
  // residential form is left in a valid state behind the modal.
  var commEl = document.getElementById('apptype_commercial');
  if (commEl && commEl.checked) {
    var newEl = document.getElementById('apptype_new');
    if (newEl) newEl.checked = true;
    if (typeof openCommercialApp === 'function') openCommercialApp();
    return onAppTypeChange();
  }
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
  styleLabel('apptype_commercial_label', false);

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
    if(tier) { tier.textContent = 'File Update Only'; tier.style.color = 'var(--gray)'; }
    var note = document.getElementById('apptype_score_note');
    if(note) note.style.display = 'block';
  }

  // File updates + transfers skip Income/References/Pets — sync the wizard
  // progress pills and forward-button labels to the chosen type.
  if(typeof _syncWizardNavFlow === 'function') _syncWizardNavFlow();
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
  set('phone', src.phone ? formatPhone(src.phone) : '');
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
  'sow_created':              '🔨 Request Created',
  'sow_updated':              '🔨 Request Updated',
  'sow_tenant_signed':        '✍️ Tenant Signed Request',
  'sow_staff_signed':         '✍️ Staff Signed Request',
  'sow_hm_approval':          '✅ HM Approved Request',
  'sow_ed_approval':          '✅ ED Approved Request',
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
  'settings_saved':           '⚙️ Settings Saved',
  'user_login':               '🔑 Signed In',
  'user_logout':              '🚪 Signed Out',
  'user_logout_timeout':      '⏱️ Idle Timeout Logout',
  'file_uploaded':            '📎 File Uploaded',
  'file_deleted':             '🗑️ File Deleted',
  'file_category_changed':    '🏷️ File Re-categorized',
  'unit_assigned':            '🏠 Unit Assigned',
  'tenant_vacated':           '📤 Tenant Vacated',
  'unit_status_auto':         '🔄 Unit Status Updated',
  'tic_overview_change':      '📝 Tenant Detail Edited',
  'module_toggle':            '🧩 Module Toggled',
  'nation_updated':           '🏛️ Nation Settings Updated',
  'approval_authority_save':  '🔐 Approval Authority Updated',
  'theme_updated':            '🎨 Theme Updated',
  'theme_reset':              '🎨 Theme Reset',
  'required_fields_updated':  '📋 Required Fields Updated',
  'email_template_save':      '✉️ Email Template Saved',
  'recipient_emailed':        '✉️ Email Sent',
  'created':                  '📄 RFQ Draft Saved',
  'issued':                   '📤 RFQ Issued',
  'awarded':                  '🏆 RFQ Awarded',
  // Application workflow + applicant portal + tenant requests
  'application_confirmation_to_applicant':    '✉️ Applicant Confirmation Email',
  'application_created_from_portal':          '📄 Application Created (Portal)',
  'application_updated_from_portal':          '📝 Application Updated (Portal)',
  'application_submission_changes_requested': '↩️ Portal Submission — Changes Requested',
  'application_submission_rejected':          '✕ Portal Submission Rejected',
  'application_mgr_recommended':              '👍 Manager Recommended',
  'application_hm_approved':                  '✅ HM Approved Application',
  'application_ed_approved':                  '✅ ED Approved Application',
  'application_declined':                     '✕ Application Declined',
  'application_returned':                     '↩️ Application Returned',
  'portal_invite_sent':                       '✉️ Portal Invite Sent',
  'tenant_mr_approved':                       '✅ Tenant Request Approved',
  'tenant_mr_rejected':                       '✕ Tenant Request Rejected',
  'contractor_approved':                      '🧰 Contractor Approved',
  'contractor_hm_recommended':                '🧰 Contractor Recommended',
  'contractor_declined':                      '✕ Contractor Declined',
  'maint_qr_tokens_minted':                   '🏷️ Maintenance QR Generated',
  'ai_query':                                 '✦ AI Assistant Query',
  'ai_draft':                                 '✦ AI Draft Note',
  // External (portal / QR) submissions
  'application_portal_submitted': '📨 Application Submitted (Portal)',
  'tenant_mr_submitted':          '🔧 Maintenance Reported (QR)',
  // Auto / system approvals
  'application_auto_approved':    '⚡ Application Auto-Approved',
  'file_update_auto_approved':    '⚡ File Update Auto-Approved',
  'contractor_auto_approved':     '⚡ Contractor Auto-Approved',
  'sow_auto_approved':            '⚡ Maintenance Request Auto-Approved',
  'inspection_auto_approved':     '⚡ Inspection Auto-Approved',
  'sow_system_approval':          '🤖 Maintenance Request System-Approved (RFQ)',
  'approval_toggle':              '🔐 Approval Requirement Toggled',
  // BCR registry
  'bcr_added':                    '⛔ BCR Added',
  'bcr_lifted':                   '✅ BCR Lifted',
  // Contractors
  'contractor_note_add':          '🧰 Contractor Note Added',
  'ct_archived':                  '📦 Contractor Archived',
  'ct_unarchived':                '📤 Contractor Unarchived',
  // Scoring / match priority / occupancy
  'match_priority_model':         '⚙️ Match Priority Saved',
  'match_priority_model_reset':   '⚙️ Match Priority Reset',
  'nos_table_save':               '🛏️ Occupancy Standard Saved',
  // Notes
  'note_added':                   '📝 Note Added',
  'tenant_note_add':              '📝 Tenant Note Added',
  'unit_note_add':                '📝 Unit Note Added',
  // Units
  'secondary_unit_assigned':      '🏠 Secondary Unit Assigned',
  'unit_archived':                '📦 Unit Archived',
  'unit_unarchived':              '📤 Unit Unarchived',
  'unit_unassigned':              '🏠 Unit Unassigned',
  'unit_location_set':            '📍 Unit Location Set',
  // Users
  'settings_user_edit':           '👤 User Edited',
  'settings_user_reactivate':     '👤 User Reactivated',
  'settings_user_send_reset':     '🔑 Password Reset Sent',
  // Signatures
  'sig_lock_override':            '🔓 Signature Lock Overridden',
  'signatures_locked':            '🔒 Signatures Locked',
  'unlocked':                     '🔓 Unlocked',
  // Maintenance request lifecycle
  'sow_archived':                 '📦 Maintenance Request Archived',
  'sow_unarchived':               '📤 Maintenance Request Unarchived',
  'sow_completed':                '✅ Maintenance Request Completed',
  'sow_reopened':                 '🔄 Maintenance Request Reopened',
  // Misc
  'tenants_merged':               '🔗 Tenant Records Merged',
  'archived_duplicate':           '📦 Duplicate Archived',
  'required_fields_reset':        '📋 Required Fields Reset'
};

// Compact codes for the on-screen Event column (the export keeps full labels).
// Anything not listed falls back to its full AUDIT_ACTION_LABELS text.
var AUDIT_ABBR = {
  'user_login':'🔑 Sign In', 'user_logout':'🚪 Sign Out', 'user_logout_timeout':'⏱️ Timeout',
  'application_submitted':'📨 App Sub', 'file_update_submitted':'📨 File Upd',
  'application_confirmation_to_applicant':'✉️ App Conf',
  'application_created_from_portal':'📄 App New', 'application_updated_from_portal':'📝 App Merge',
  'application_submission_changes_requested':'↩️ Sub Chg', 'application_submission_rejected':'✕ Sub Rej',
  'application_mgr_recommended':'👍 Mgr Rec', 'application_hm_approved':'✅ HM Appr',
  'application_ed_approved':'✅ ED Appr', 'application_declined':'✕ App Decl', 'application_returned':'↩️ App Ret',
  'portal_invite_sent':'✉️ Invite',
  'sow_created':'🔨 MR New', 'sow_updated':'🔨 MR Upd', 'sow_hm_approval':'✅ MR HM', 'sow_ed_approval':'✅ MR ED',
  'tenant_mr_approved':'✅ TReq OK', 'tenant_mr_rejected':'✕ TReq No',
  'contractor_approved':'🧰 Ctr Appr', 'contractor_hm_recommended':'🧰 Ctr Rec', 'contractor_declined':'✕ Ctr Decl',
  'file_uploaded':'📎 File +', 'file_deleted':'🗑️ File −', 'file_category_changed':'🏷️ File Cat',
  'unit_edit':'🏠 Unit', 'unit_assigned':'🏠 Assign', 'tenant_vacated':'📤 Vacated',
  'approval_authority_save':'🔐 Auth', 'settings_saved':'⚙️ Settings', 'module_toggle':'🧩 Module',
  'nation_updated':'🏛️ Nation', 'theme_updated':'🎨 Theme', 'email_template_save':'✉️ Tmpl',
  'recipient_emailed':'✉️ Email', 'maint_qr_tokens_minted':'🏷️ QR Gen',
  'ai_query':'✦ AI Ask', 'ai_draft':'✦ AI Draft',
  'created':'📄 RFQ New', 'issued':'📤 RFQ Iss', 'awarded':'🏆 RFQ Won',
  // External submissions
  'application_portal_submitted':'📨 Portal Sub', 'tenant_mr_submitted':'🔧 QR Report',
  'application_updated':'📝 App Upd', 'application_opened':'📂 Opened',
  // Contractor approval flow writes bare status actions (scoped by a CT: ref)
  'hm_recommended':'🧰 Ctr Rec', 'approved':'🧰 Ctr Appr', 'returned':'🧰 Ctr Ret', 'declined':'🧰 Ctr Decl',
  // Auto / system approvals
  'application_auto_approved':'⚡ App Auto', 'file_update_auto_approved':'⚡ FU Auto',
  'contractor_auto_approved':'⚡ Ctr Auto', 'sow_auto_approved':'⚡ MR Auto',
  'inspection_auto_approved':'⚡ Insp Auto', 'sow_system_approval':'🤖 MR Sys',
  'approval_toggle':'🔐 Appr Tgl',
  // BCR / contractors
  'bcr_added':'⛔ BCR Add', 'bcr_lifted':'✅ BCR Lift',
  'contractor_note_add':'🧰 Ctr Note', 'ct_archived':'📦 Ctr Arch', 'ct_unarchived':'📤 Ctr Unarch',
  // Scoring / occupancy
  'match_priority_model':'⚙️ Match Pri', 'match_priority_model_reset':'⚙️ Match Rst', 'nos_table_save':'🛏️ NOS Save',
  'settings_scoring_change':'⚙️ Rubric Chg', 'settings_scoring_add':'⚙️ Rubric +', 'settings_scoring_delete':'⚙️ Rubric −',
  'settings_scoring_reset':'⚙️ Score Rst', 'settings_unit_score_save':'⚙️ Unit Score', 'settings_reno_score_save':'⚙️ Reno Score',
  'settings_budget_save':'💰 Budget', 'ed_adjustment':'⭐ ED Adj',
  // Notes
  'note_added':'📝 Note', 'tenant_note_add':'📝 Ten Note', 'unit_note_add':'📝 Unit Note', 'tic_overview_change':'📝 Tenant Edit',
  // Units
  'secondary_unit_assigned':'🏠 2nd Assign', 'unit_archived':'📦 Unit Arch', 'unit_unarchived':'📤 Unit Unarch',
  'unit_unassigned':'🏠 Unassign', 'unit_location_set':'📍 Unit Loc', 'unit_status_auto':'🔄 Unit Auto',
  // Users
  'settings_user_add':'👤 User +', 'settings_user_remove':'👤 User −', 'settings_user_edit':'👤 User Edit',
  'settings_user_reactivate':'👤 User React', 'settings_user_send_reset':'🔑 Pwd Reset',
  // Signatures / locks
  'signature_captured':'✍️ Signed', 'sig_lock_override':'🔓 Sig Unlock', 'signatures_locked':'🔒 Sig Lock', 'unlocked':'🔓 Unlock',
  // MR lifecycle + signatures
  'sow_archived':'📦 MR Arch', 'sow_unarchived':'📤 MR Unarch', 'sow_completed':'✅ MR Done', 'sow_reopened':'🔄 MR Reopen',
  'sow_tenant_signed':'✍️ MR Tenant', 'sow_staff_signed':'✍️ MR Staff', 'sow_accountability':'⚠️ MR Flag',
  // App / status / files
  'application_opened':'📂 Opened', 'draft_saved':'💾 Draft', 'status_change':'🔄 Status', 'status':'🔄 Status',
  'declined':'✕ Declined', 'archived':'📦 Arch', 'unarchived':'📤 Unarch', 'archived_duplicate':'📦 Arch Dup',
  'tenants_merged':'🔗 Ten Merge', 'tenant_vacated':'📤 Vacated',
  // Settings misc
  'required_fields_updated':'📋 Req Flds', 'required_fields_reset':'📋 Req Rst', 'theme_reset':'🎨 Theme Rst',
  'settings_saved':'⚙️ Settings'
};

// Word-level abbreviation for the Event column — keeps it tight even for
// actions that aren't in AUDIT_ABBR (e.g. "application updated" -> "App Upd").
// Words <=4 letters are left alone; known long words map to short forms;
// unknown words longer than 6 letters are truncated. Names never appear in
// Event labels, so this is safe (the Detail column is left untouched).
var _AUDIT_WORD_ABBR = {
  application:'App', applications:'Apps', update:'Upd', updated:'Upd', confirmation:'Conf',
  approved:'Appr', approval:'Appr', submitted:'Sub', submission:'Sub', created:'New', create:'New',
  request:'Req', requests:'Reqs', maintenance:'Maint', signature:'Sig', signatures:'Sigs', signed:'Sign',
  opened:'Open', editing:'Edit', edited:'Edit', inspection:'Insp', contractor:'Ctr',
  assigned:'Asgn', assign:'Asgn', assignment:'Asgn', archived:'Arch', unarchived:'Unarch',
  declined:'Decl', returned:'Ret', recommended:'Rec', category:'Cat', changed:'Chg', change:'Chg',
  settings:'Set', reactivated:'React', password:'Pwd', location:'Loc', standard:'Std', duplicate:'Dup',
  vacated:'Vac', removed:'Rmv', reference:'Ref', received:"Rec'd", uploaded:'Up', deleted:'Del',
  housing:'Hsg', module:'Mod', toggled:'Tgl', authority:'Auth', scoring:'Score', criteria:'Crit',
  tenancy:'Tncy', merged:'Merge', records:'Recs', secondary:'2nd', priority:'Prio', overridden:'Ovr',
  locked:'Lock', unlocked:'Unlk', timeout:'TO', reset:'Rst', completed:'Done', reopened:'Reopen',
  current:'cur', required:'Req', fields:'Flds', applicant:'Applt', tenant:'Tnt', portal:'Portal'
};
function _abbrevWord(w){
  if(w.length <= 4) return w;
  var k = w.toLowerCase().replace(/[^a-z]/g,'');
  if(!k) return w;                       // pure emoji / symbol
  if(_AUDIT_WORD_ABBR[k]) return _AUDIT_WORD_ABBR[k];
  return w.length > 6 ? w.slice(0,6) : w;
}
function _abbrevPhrase(s){ return String(s == null ? '' : s).split(/\s+/).map(_abbrevWord).join(' '); }
function _auditEventLabel(action){
  return _abbrevPhrase(AUDIT_ABBR[action] || AUDIT_ACTION_LABELS[action] || (action || '').replace(/_/g,' '));
}

// Legend modal decoding the Event abbreviations (opened from the Audit header).
function openAuditLegend(){
  var ex = document.getElementById('audit_legend_modal'); if(ex) ex.remove();
  var rows = Object.keys(AUDIT_ABBR).map(function(a){
    var full = (AUDIT_ACTION_LABELS[a] || a.replace(/_/g,' ')).replace(/^[^A-Za-z0-9]+\s*/,'');
    return '<tr style="border-bottom:1px solid var(--border);">'
      + '<td style="padding:7px 12px;font-weight:700;white-space:nowrap;">'+_auditEventLabel(a)+'</td>'
      + '<td style="padding:7px 12px;color:var(--muted);">'+full+'</td></tr>';
  }).join('');
  var m = document.createElement('div'); m.id = 'audit_legend_modal';
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:10001;display:flex;align-items:center;justify-content:center;padding:16px;';
  m.innerHTML = '<div style="background:var(--surface);border-radius:12px;width:100%;max-width:520px;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 8px 40px rgba(0,0,0,.35);">'
    + '<div class="modal-hdr"><div class="lbl-yellow">📖 Event Legend</div>'
    +   '<button type="button" onclick="var x=document.getElementById(\'audit_legend_modal\');if(x)x.remove();" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--muted);">&times;</button></div>'
    + '<div style="overflow-y:auto;padding:6px 8px 12px;"><table style="width:100%;border-collapse:collapse;font-size:13px;">'+rows+'</table></div>'
    + '</div>';
  document.body.appendChild(m);
}
window.openAuditLegend = openAuditLegend;

// Map an audit row's action to a row-tint class. Empty string = no tint.
function _auditRowClass(action) {
  if (action === 'application_submitted' || action === 'file_update_submitted') return 'audit-row-submit';
  if (action === 'status_change' || action === 'status')                         return 'audit-row-status';
  if (action === 'declined')                                                     return 'audit-row-declined';
  if (action && action.indexOf('sow_') === 0)                                    return 'audit-row-sow';
  return '';
}

// Tidy + abbreviate an audit detail string for the compact table. Turns the
// verbose email-notification rows ("Email -> <to> | <Nation> Housing — <subj>")
// into "✉ <to> · <subj>" and applies a few space-saving abbreviations.
function _auditFmtDetail(s) {
  if (s == null || s === '') return '—';
  s = String(s).trim();
  var m = s.match(/^Email\s*->\s*([^|]+?)\s*\|\s*(.+)$/i);
  if (m) {
    var to = m[1].trim();
    var subj = m[2].trim().replace(/^.*?Housing\s*[—–-]\s*/i, '').trim(); // drop brand prefix
    s = '✉ ' + to + (subj ? ' · ' + subj : '');
  }
  return s.replace(/\bApplication\b/g, 'App')
          .replace(/\bMaintenance Request\b/gi, 'MR')
          .replace(/\bReceived\b/g, "Rec'd")
          .replace(/\bReference\b/gi, 'Ref')
          .replace(/\bNumber\b/gi, 'No.');
}

// Labels for the separate finance_audit_log (occurred_at / actor_* / summary).
var FIN_ACTION_LABELS = {
  approve_loan:  { a:'💰 Loan OK',  f:'Loan Approved' },
  post_payment:  { a:'💰 Payment',  f:'Payment Posted' },
  void_entry:    { a:'💰 Void',     f:'Entry Voided' },
  create_tenant: { a:'💰 Tnt New',  f:'Finance Tenant Created' },
  update_tenant: { a:'💰 Tnt Edit', f:'Finance Tenant Updated' }
};
function _finAuditLabels(row){
  var act = row.action || '';
  var ent = String(row.entity_type || '').replace(/_/g,' ').trim();
  if (FIN_ACTION_LABELS[act]) return { a: FIN_ACTION_LABELS[act].a, f: '💰 ' + FIN_ACTION_LABELS[act].f };
  if (act === 'create' || act === 'update') {
    var en = ent ? (ent.charAt(0).toUpperCase() + ent.slice(1)) : 'Record';
    return { a: '💰 ' + _abbrevPhrase(en) + (act === 'create' ? ' New' : ' Edit'),
             f: '💰 ' + en + (act === 'create' ? ' Created' : ' Updated') };
  }
  return { a: '💰 ' + _abbrevPhrase(act.replace(/_/g,' ')), f: '💰 ' + act.replace(/_/g,' ') };
}

// Resolve an actor email to the staff member's real name via the staff
// directory cache (window._staffCache, {id:{email,name,...}}). '' if unknown.
function _auditStaffNameByEmail(email){
  email = (email || '').toLowerCase();
  if (!email) return '';
  var cache = window._staffCache || {};
  for (var id in cache) {
    var u = cache[id];
    if (u && String(u.email || '').toLowerCase() === email) return (u.name || '').trim();
  }
  return '';
}

// BY column: employee name only. Prefer the row's captured name, else the real
// staff name looked up from the actor email, else a name derived from the email
// local-part (split on . _ - and title-cased).
function _auditByName(e){
  var n = ((e && e.name) || '').trim();
  if (n) return n;
  var v = ((e && e.role) || '').trim();   // usually the actor email for these rows
  if (v.indexOf('@') !== -1) {
    var staffName = _auditStaffNameByEmail(v);
    if (staffName) return staffName;
    return v.split('@')[0].split(/[._+-]+/).filter(Boolean)
      .map(function(p){ return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(); }).join(' ') || v;
  }
  return v || '—';
}

async function renderAuditLog(silent) {
  var tbody = document.getElementById('audit_log_tbody');
  if(!tbody) return;
  // `silent` is passed by the auto-refresh tick so the table doesn't flash a
  // "Loading…" placeholder every interval.
  if(!silent) tbody.innerHTML = '<tr><td colspan="5" class="empty-state-italic">Loading…</td></tr>';

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
        var isFileMeta = parsed && typeof parsed.path === 'string';
        var detailText = isFileMeta
            ? (parsed.name || parsed.path || '—')
            : ((parsed && parsed.detail) || (typeof raw === 'string' ? raw : '') || '');
        var name = isFileMeta
            ? (parsed.actor_name || row.actor_name || '')
            : ((parsed && parsed.name) || row.actor_name || '');
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

  // Finance activity is intentionally NOT merged here — it has its own separate
  // finance_audit_log + view in the Finance module.

  // Ensure the staff name lookup (for the BY column) is available even if the
  // Users tab hasn't populated window._staffCache yet.
  if (!window._staffCache || !Object.keys(window._staffCache).length) {
    try {
      var sr = await fetch(SUPABASE_URL + '/rest/v1/staff?select=id,email,name&is_active=eq.true', { headers: HOUSING_HEADERS });
      if (sr.ok) { window._staffCache = {}; (await sr.json()).forEach(function(u){ window._staffCache[u.id] = u; }); }
    } catch(e) { /* fall back to email-derived names */ }
  }

  // Cache for CSV export — built from whatever we just rendered.
  window._auditRows = log;

  if(!log.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state-italic">No audit entries yet.</td></tr>';
    return;
  }

  tbody.innerHTML = log.slice(0,300).map(function(e) {
    var d  = new Date(e.ts);
    var ds = d.toLocaleDateString('en-CA')+' '+d.toLocaleTimeString('en-CA',{hour:'2-digit',minute:'2-digit'});
    var full = e._full || AUDIT_ACTION_LABELS[e.action] || (e.action || '').replace(/_/g,' ');
    var lbl  = e._label ? _abbrevPhrase(e._label) : _auditEventLabel(e.action);   // tight code; full text on hover
    var rowCls = _auditRowClass(e.action);

    // Friendly appId display: surface SOW: / SETTINGS prefixes as compact pills.
    var appDisplay = e.appId || '—';
    if (appDisplay.indexOf('SOW:') === 0) {
      appDisplay = '<span class="audit-pill audit-pill-sow">REQ</span> ' + appDisplay.slice(4);
    } else if (appDisplay === 'SETTINGS') {
      appDisplay = '<span class="audit-pill audit-pill-sys">SYS</span>';
    } else if (appDisplay === 'LOGIN' || appDisplay === 'LOGOUT') {
      appDisplay = '<span class="audit-pill audit-pill-sys">AUTH</span>';
    }

    // By column: prefer full name; fall back to role for legacy rows that
    // were written before auditEntry started capturing the name.
    var byHtml = '<span class="audit-by-name">'+_auditByName(e)+'</span>';

    return '<tr'+(rowCls?' class="'+rowCls+'"':'')+'>'
      +'<td class="audit-cell-date">'+ds+'</td>'
      +'<td class="audit-cell-ref">'+appDisplay+'</td>'
      +'<td class="audit-cell-event" title="'+full.replace(/"/g,'')+'">'+lbl+'</td>'
      +'<td class="audit-cell-detail">'+_auditFmtDetail(e.detail)+'</td>'
      +'<td class="audit-cell-by">'+byHtml+'</td>'
      +'</tr>';
  }).join('');
}

// ── Audit log auto-refresh ("dynamic updating") ───────────────────────────────
// While the Audit Log tab is visible, silently re-pull the log every 15s so new
// activity (logins, approvals, settings changes from other users) appears
// without a manual refresh. The tick self-stops when the tab is no longer on
// screen (offsetParent === null when it or an ancestor is display:none), so the
// timer never leaks after the user navigates away.
var _auditAutoTimer = null;
function _startAuditAutoRefresh() {
  _stopAuditAutoRefresh();
  _auditAutoTimer = setInterval(function() {
    var sec = document.getElementById('sec_audit');
    if (!sec || sec.offsetParent === null) { _stopAuditAutoRefresh(); return; }
    if (typeof renderAuditLog === 'function') renderAuditLog(true);
  }, 15000);
}
function _stopAuditAutoRefresh() {
  if (_auditAutoTimer) { clearInterval(_auditAutoTimer); _auditAutoTimer = null; }
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
    var lbl = e._full || AUDIT_ACTION_LABELS[e.action] || (e.action || '').replace(/_/g,' ');
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

// ══════════════════════════════════════════════════════════════
// THEMES — brand color + logo customization (ED only)
// Persisted to housing_settings.theme as { yellow, dark, text, logo }
// Applied live via _applyTheme() (defined in shared.js)
// ══════════════════════════════════════════════════════════════
function _themeRangeRow(key, label, desc, min, max, currentVal, defaultVal) {
  var raw = parseInt(currentVal || defaultVal) || 0;
  return '<div class="theme-row">'
    + '<label for="theme_'+key+'">'+label+'</label>'
    + '<div class="theme-range">'
    +   '<input type="range" id="theme_'+key+'" min="'+min+'" max="'+max+'" value="'+raw+'" oninput="_themeOnRangeChange(\''+key+'\')"/>'
    +   '<span class="theme-range-val" id="theme_'+key+'_val">'+raw+'px</span>'
    + '</div>'
    + '<span class="theme-desc">'+desc+'</span>'
    + '</div>';
}
function _themeSelectRow(key, label, desc, options, currentVal, defaultVal) {
  var val = currentVal || defaultVal;
  var opts = options.map(function(o) {
    return '<option value="'+o.value+'"'+(o.value===val?' selected':'')+'>'+o.label+'</option>';
  }).join('');
  return '<div class="theme-row">'
    + '<label for="theme_'+key+'">'+label+'</label>'
    + '<select id="theme_'+key+'" class="theme-select" onchange="_themeOnFontChange(\''+key+'\')">'+opts+'</select>'
    + '<span class="theme-desc">'+desc+'</span>'
    + '</div>';
}
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
  // Effective brand accent: a saved theme override wins, else the nation's
  // registry colour (admin-set primary_color in NATION_CONFIG), else the stock
  // default. Without the registry fallback the editor showed the stock yellow
  // for every nation whose colour lives only in the registry (e.g. Demo's blue,
  // which is applied live at boot but never written into _appSettings.theme).
  var _nc = window.NATION_CONFIG || {};
  var _brandAccent = _nc.primary_color || defaults.yellow;
  // Header follows the brand accent automatically: when no explicit header colour
  // is saved, show the derived brand "ink" (accent mixed toward black) so the
  // picker matches what's on screen. Stash it so _readThemeFromForm can tell an
  // untouched auto value apart from a deliberate override.
  var _accent    = theme.yellow || _brandAccent;
  // Mirror _applyBrandDark: the platform-default accent keeps the curated
  // default ink; a distinct brand accent derives a matching deep ink.
  var _brandDark = (String(_accent).toLowerCase() === String(defaults.yellow).toLowerCase())
    ? defaults.dark
    : ((typeof _brandInk === 'function' ? _brandInk(_accent, 0.88) : '') || defaults.dark);
  window._themeAutoDark = _brandDark;
  body.innerHTML =
      _themeFieldRow('yellow',  'Brand Accent',       'On-card buttons, links, badges, focus',        theme.yellow,  _brandAccent)
    + _themeFieldRow('action',  'Action Button',       'Create / avatar / sign-in buttons on the dark header (white pops there)', theme.action, defaults.action || '#FFFFFF')
    + _themeFieldRow('tint',    'Tint / Highlight',    'Soft hover/highlight background (rows, chips, menus)', theme.tint, defaults.tint || '#F3E4D8')
    + _themeFieldRow('dark',    'Header / Dark Surface','Derived from the Brand Accent — override to pin a custom header colour',   theme.dark,    _brandDark)
    + _themeFieldRow('text',    'Body Text',            'Default text color across the app',           theme.text,    defaults.text)
    + _themeFieldRow('bg',      'Page Background',      'Main background behind all cards',            theme.bg,      defaults.bg)
    + _themeFieldRow('surface', 'Card Surface',         'Card and panel background color',             theme.surface, defaults.surface)
    + _themeFieldRow('border',  'Borders',              'Lines separating sections and cards',         theme.border,  defaults.border)
    + _themeFieldRow('muted',   'Muted Text',           'Secondary labels and helper text',            theme.muted,   defaults.muted)
    + _themeRangeRow('radius',  'Border Radius',        'Roundness of cards, buttons, and inputs (0–24 px)', 0, 24, theme.radius, defaults.radius)
    + _themeSelectRow('sans',  'Body Font',            'Used for all body copy, labels, and UI text',
        [{value:'DM Sans',label:'DM Sans (default)'},{value:'Inter',label:'Inter'},
         {value:'Roboto',label:'Roboto'},{value:'Open Sans',label:'Open Sans'},
         {value:'Nunito',label:'Nunito'},{value:'Source Sans 3',label:'Source Sans 3'},
         {value:'System Default',label:'System Default'}],
        theme.sans, defaults.sans)
    + _themeSelectRow('serif', 'Display Font',         'Used for headings and decorative titles',
        [{value:'DM Serif Display',label:'DM Serif Display (default)'},{value:'Playfair Display',label:'Playfair Display'},
         {value:'Lora',label:'Lora'},{value:'Merriweather',label:'Merriweather'},
         {value:'Georgia',label:'Georgia (system)'}],
        theme.serif, defaults.serif)
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

// Range slider → update live readout + apply CSS variable immediately
function _themeOnRangeChange(key) {
  var slider = document.getElementById('theme_' + key);
  var valEl  = document.getElementById('theme_' + key + '_val');
  if (!slider) return;
  var px = slider.value + 'px';
  if (valEl) valEl.textContent = px;
  document.documentElement.style.setProperty('--' + key, px);
}
// Font select → load font + apply CSS variable live for immediate preview
function _themeOnFontChange(key) {
  var sel = document.getElementById('theme_' + key);
  if (!sel) return;
  var name = sel.value;
  var def  = window.FONT_DEFS && window.FONT_DEFS[name];
  var css  = def ? def.css : ("'" + name + "', " + (key === 'serif' ? 'serif' : 'sans-serif'));
  if (def && def.google) window._loadGoogleFont(name);
  document.documentElement.style.setProperty('--' + key, css);
}
// Map a theme field key to the CSS custom property it drives (most are 1:1;
// 'tint' drives --yellow-light).
function _themeCssVar(key){ return key === 'tint' ? '--yellow-light' : '--' + key; }
// Sync hex input → color picker, and apply preview live
function _themeOnPickerChange(key) {
  var picker = document.getElementById('theme_'+key);
  var hex    = document.getElementById('theme_'+key+'_hex');
  if(picker && hex) hex.value = picker.value;
  document.documentElement.style.setProperty(_themeCssVar(key), picker.value);
}
function _themeOnHexChange(key) {
  var hex    = document.getElementById('theme_'+key+'_hex');
  var picker = document.getElementById('theme_'+key);
  if(!hex) return;
  var v = (hex.value||'').trim();
  if(!/^#[0-9a-fA-F]{6}$/.test(v)) return;       // wait for a valid hex
  if(picker) picker.value = v;
  document.documentElement.style.setProperty(_themeCssVar(key), v);
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
  // Header colour: if left at the auto-derived brand ink, store it empty so the
  // header keeps following the brand accent (re-derives if the accent changes).
  // A different value is a deliberate override and is persisted as-is.
  var darkVal = v('theme_dark_hex') || v('theme_dark');
  if (window._themeAutoDark && darkVal.toLowerCase() === String(window._themeAutoDark).toLowerCase()) darkVal = '';
  return {
    yellow:           v('theme_yellow_hex')  || v('theme_yellow'),
    action:           v('theme_action_hex')  || v('theme_action'),
    tint:             v('theme_tint_hex')    || v('theme_tint'),
    dark:             darkVal,
    text:             v('theme_text_hex')    || v('theme_text'),
    bg:               v('theme_bg_hex')      || v('theme_bg'),
    surface:          v('theme_surface_hex') || v('theme_surface'),
    border:           v('theme_border_hex')  || v('theme_border'),
    muted:            v('theme_muted_hex')   || v('theme_muted'),
    sans:             v('theme_sans'),
    serif:            v('theme_serif'),
    radius:           (function(){ var el=document.getElementById('theme_radius'); return el ? el.value+'px' : ''; })(),
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
  saveSettingWithDraftFallback('theme', theme).then(function(ok){
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
    saveSettingWithDraftFallback('theme', empty).then(function(saved){
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
  saveSettingWithDraftFallback('required_fields', cfg).then(function(ok){
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
    saveSettingWithDraftFallback('required_fields', {}).then(function(saved){
      if(saved){
        showToast('Required fields reset to defaults');
        if(typeof auditEntry === 'function') auditEntry('SETTINGS', 'required_fields_reset', 'Required fields reset to defaults', window.currentRole||'staff');
      }
      renderRequiredFieldsPanel();
    });
  });
}

// ── Maintenance QR labels (bulk generator) ───────────────────────────────────
// Generate a scan-to-report QR for every unit and print them onto labels.
// Reuses the per-unit token scheme + helpers (_qrLoadLib / _qresc live in
// housing-modals.js; both are defined well before this runs on click). The QR
// encodes report.html?u=<unitId>&t=<per-unit secret token>, which the tenant-mr
// Edge Function validates — the same contract the per-unit "Maintenance QR"
// button uses, so a label minted here works identically.

function _maintQrEnsureToken(u){
  if(u && !u.qrToken){
    u.qrToken = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : (Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
    return true; // newly minted -> needs persisting
  }
  return false;
}

function _maintQrUnits(occupiedOnly){
  var units = (typeof getAllUnits === 'function') ? getAllUnits().slice() : [];
  units = units.filter(function(u){ return u && u.id; });
  if(occupiedOnly) units = units.filter(function(u){ return (u.assignedName || u.assignedTo); });
  units.sort(function(a,b){
    var sa=(a.street||'').toLowerCase(), sb=(b.street||'').toLowerCase();
    if(sa!==sb) return sa<sb?-1:1;
    return (parseInt(a.num,10)||0)-(parseInt(b.num,10)||0);
  });
  return units;
}

function _maintQrToggleOcc(v){ window._maintQrOccupiedOnly = !!v; renderMaintenanceQrPanel(); }
window._maintQrToggleOcc = _maintQrToggleOcc;

// Short-QR URL for a unit. When the unit has a short slug (after the
// 20260818_qr_short_slug migration + assign), encode <host>/u/<slug> (no
// scheme -> short -> larger, more scannable QR modules); otherwise fall back to
// the existing long report.html?u=&t= link so labels still work pre-migration.
function _maintQrUrl(u){
  var base = (typeof nationPortalBase === 'function') ? nationPortalBase() : location.origin;
  if(u && u.label_slug != null){
    return String(base).replace(/^https?:\/\//,'').replace(/\/+$/,'') + '/u/' + u.label_slug;
  }
  return String(base).replace(/\/+$/,'') + '/report.html?u=' + encodeURIComponent(u.id) + '&t=' + encodeURIComponent(u.qrToken);
}
// Best-effort: give every unit a short slug in one RPC call, then read them back
// onto the in-memory units. Silently no-ops if the migration hasn't been run.
async function _maintEnsureSlugs(units){
  try {
    await fetch(SUPABASE_URL + '/rest/v1/rpc/assign_all_label_slugs', { method:'POST', headers: Object.assign({}, HOUSING_HEADERS, { 'Content-Type':'application/json' }), body: '{}' });
    var r = await fetch(SUPABASE_URL + '/rest/v1/housing_units?select=id,label_slug', { headers: HOUSING_HEADERS });
    if(!r.ok) return;
    var map = {}; (await r.json()).forEach(function(row){ map[row.id] = row.label_slug; });
    units.forEach(function(u){ if(map[u.id] != null) u.label_slug = map[u.id]; });
  } catch(e){ /* pre-migration: fall back to the long URL */ }
}

async function renderMaintenanceQrPanel(){
  var body = document.getElementById('maint_qr_panel_body');
  if(!body) return;
  var role = window.currentRole || '';
  if(!(role==='ed' || role==='super_user')){
    body.innerHTML = '<div class="empty-state-ctr">Only the ED can generate maintenance QR labels.</div>';
    return;
  }
  var occOnly = !!window._maintQrOccupiedOnly;
  var units = _maintQrUnits(occOnly);

  var controls =
      '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:12px;">'
    +   '<label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;cursor:pointer;">'
    +     '<input type="checkbox" id="maint_qr_occ" ' + (occOnly?'checked':'') + ' onchange="_maintQrToggleOcc(this.checked)"/> Only units with a current tenant'
    +   '</label>'
    +   '<div style="display:flex;gap:10px;flex-wrap:wrap;">'
    +     '<button type="button" class="btn btn-ghost" onclick="renderMaintenanceQrPanel()">&#8635; Refresh</button>'
    +     '<button type="button" class="btn btn-primary" onclick="printAllMaintenanceQr()">&#128424; Print all labels</button>'
    +   '</div>'
    + '</div>'
    + '<div class="txt-sm-meta" style="margin-bottom:14px;">' + units.length + ' unit' + (units.length===1?'':'s')
    +   ' &middot; each label posts at the unit for tenants to scan and report an issue.</div>';

  if(!units.length){
    body.innerHTML = controls + '<div class="empty-state-ctr">No units found' + (occOnly?' with a current tenant':'') + '.</div>';
    return;
  }

  // Mint tokens for any unit missing one, and persist only those.
  var minted = [];
  units.forEach(function(u){ if(_maintQrEnsureToken(u)) minted.push(u); });
  if(minted.length){
    minted.forEach(function(u){
      if(typeof saveUnitWithDraftFallback === 'function') saveUnitWithDraftFallback(u);
      else if(typeof sbSaveUnit === 'function') sbSaveUnit(u);
    });
    if(typeof auditEntry === 'function') auditEntry('SETTINGS', 'maint_qr_tokens_minted', 'Generated maintenance QR tokens for ' + minted.length + ' unit(s)', window.currentRole||'staff');
  }

  var nation = (window.NATION_CONFIG && (NATION_CONFIG.display_name || NATION_CONFIG.short)) || 'Housing';
  await _maintEnsureSlugs(units);   // best-effort short-QR slugs (no-op until the migration runs)
  var anyShort = units.some(function(u){ return u.label_slug != null; });
  window._maintQrList = units.map(function(u){
    var addr = ((u.num||'') + ' ' + (u.street||'')).trim() || ('Unit ' + u.id);
    return { url: _maintQrUrl(u), addr: addr, nation: nation };
  });
  if(!anyShort){
    controls += '<div class="txt-sm-meta" style="margin:-6px 0 14px;color:var(--warn-amber-text);">Tip: run the <code>20260818_qr_short_slug</code> migration to shrink these QR codes (shorter link) so they scan more reliably on printed labels.</div>';
  }

  var grid = window._maintQrList.map(function(L, i){
    return '<div style="border:1px solid var(--border);border-radius:10px;padding:12px;text-align:center;background:var(--surface);">'
      + '<div id="maint_qr_host_' + i + '" style="display:inline-block;padding:8px;background:#fff;border-radius:8px;"></div>'
      + '<div style="font-size:13px;font-weight:800;margin-top:8px;word-break:break-word;">' + _qresc(L.addr) + '</div>'
      + '</div>';
  }).join('');
  body.innerHTML = controls
    + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;">' + grid + '</div>';

  try {
    await _qrLoadLib();
    window._maintQrList.forEach(function(L, i){
      var host = document.getElementById('maint_qr_host_' + i);
      if(host){ host.innerHTML=''; new QRCode(host, { text:L.url, width:130, height:130, correctLevel: QRCode.CorrectLevel.M }); }
    });
  } catch(e){
    body.insertAdjacentHTML('beforeend', '<div style="color:var(--danger);font-size:13px;padding:12px;">Could not load the QR generator. Check your connection and try again.</div>');
  }
}
window.renderMaintenanceQrPanel = renderMaintenanceQrPanel;

// Open a print-ready label sheet (3-up grid) from the rendered QR tiles.
function printAllMaintenanceQr(){
  var list = window._maintQrList || [];
  if(!list.length){ if(typeof showToast==='function') showToast('Nothing to print yet'); return; }
  var labels = [];
  for(var i=0;i<list.length;i++){
    var host = document.getElementById('maint_qr_host_' + i);
    var el = host ? (host.querySelector('img') || host.querySelector('canvas')) : null;
    var src = '';
    try { src = el ? (el.tagName==='IMG' ? el.src : el.toDataURL('image/png')) : ''; } catch(e){}
    labels.push({ src: src, addr: list[i].addr, nation: list[i].nation });
  }
  var w = window.open('', '_blank', 'width=900,height=1000');
  if(!w){ if(typeof showToast==='function') showToast('Allow pop-ups to print the labels'); return; }
  var cells = labels.map(function(L){
    return '<div class="label">'
      + (L.src ? '<img class="qr" src="' + L.src + '"/>' : '<div class="qr"></div>')
      + '<div class="body">'
      +   '<div class="addr">' + _qresc(L.addr||'') + '</div>'
      +   '<div class="cta">SCAN TO REPORT A MAINTENANCE ISSUE</div>'
      +   '<div class="nation">' + _qresc(L.nation||'Housing') + '</div>'
      + '</div>'
      + '</div>';
  }).join('');
  // Real 2" x 1" labels laid out on a Letter sheet. Print at 100% scale (no
  // "fit to page") so a label measures exactly 2" x 1". Defaults match common
  // 2x1 stock (Avery 5163 / 10-up); tune margins/pitch to your supplier.
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Maintenance QR Labels</title><style>'
    + '*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}'
    + 'html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;}'
    + '@page{size:letter;margin:0.5in 0.19in;}'
    + '.sheet{display:grid;grid-template-columns:repeat(2,2in);column-gap:0.13in;row-gap:0;justify-content:center;}'
    + '.label{width:2in;height:1in;overflow:hidden;display:flex;align-items:center;gap:0.06in;padding:0.06in;page-break-inside:avoid;break-inside:avoid;}'
    + '.qr{width:0.82in;height:0.82in;flex:0 0 auto;}'
    + '.body{flex:1 1 auto;min-width:0;}'
    + '.addr{font-size:12.5pt;font-weight:800;line-height:1.02;color:#111;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}'
    + '.cta{font-size:5.6pt;font-weight:700;letter-spacing:.2px;color:#555;margin-top:0.03in;line-height:1.1;}'
    + '.nation{font-size:6.5pt;color:#888;margin-top:0.02in;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}'
    + '@media screen{body{background:#eee;padding:16px;}.sheet{background:#fff;}.label{outline:1px dashed #ccc;}}'
    + '</style></head><body><div class="sheet">' + cells + '</div>'
    + '<scr'+'ipt>setTimeout(function(){window.focus();window.print();},300);</scr'+'ipt>'
    + '</body></html>');
  w.document.close();
}
window.printAllMaintenanceQr = printAllMaintenanceQr;

