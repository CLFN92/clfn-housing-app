/* ============================================================
 * scoring.js — CLFN Housing Suite
 * Application scoring, unit matching, reno priority models
 *
 * Load order: shared-config.js → shared-auth.js → shared.js →
 *             shared-ui.js → THIS FILE → shared-data.js
 *
 * Exposes globals:
 *   liveScoreModel        — mutable V1 scoring criteria array
 *   liveV2ScoreModel      — mutable V2 scoring object (from Supabase)
 *   liveV2Tiers           — mutable tier thresholds (from Supabase)
 *   DEFAULT_SCORING_MODEL — V1 default criteria
 *   DEFAULT_V2_SCORE_MODEL— V2 default criteria
 *   DEFAULT_UNIT_SCORE_MODEL — unit matching criteria
 *   DEFAULT_RENO_SCORE_MODEL — reno priority criteria
 *   DEFAULT_NOS_TABLE     — NOS occupancy standards
 *   calcScore()           — score current application form
 *   triggerV2Score()      — re-score using V2 model
 *   autoPopulateScore()   — populate score fields from form data
 *   scoreApplicationLocally(app) — score a saved application
 *   tierColor(tier)       — returns {bg,c} for a priority tier
 *   renderV2ScoringEditor()  — render the V2 scoring editor UI
 *   renderScoringModelTable()— render the V1 scoring table
 *   renderUnitScoreTable()   — render unit matching score table
 * ============================================================ */

'use strict';

// ── Core data arrays (shared across all housing functions) ──────────────────
window.applications = window.applications || [];
window.housingUnits = window.housingUnits || [];

// ── Mutable model references (populated from Supabase on login) ───────────────
window.liveV2ScoreModel = window.liveV2ScoreModel || {};
window.liveV2Tiers      = window.liveV2Tiers      || { critical: 80, high: 60, medium: 40 };
window.liveScoreModel   = window.liveScoreModel   || null;

var SCORING_MODEL_KEY = 'clfn_scoring_model';


// ── V2 Scoring Model Defaults ──────────────────────────────────────────
// These are the editable point values for each option in the V2 model.
// Stored in housing_settings as 'scoring_model_v2'. ED can adjust via Settings.

// ── V2 Priority Tier Thresholds (ED-adjustable) ──────────────────────



function saveV2ScoringModel() {
  localStorage.setItem('clfn_scoring_model_v2', JSON.stringify(liveV2ScoreModel));
  sbSaveSetting('scoring_model_v2', liveV2ScoreModel).then(function(ok){
    if(!ok) showToast('Scoring model saved locally but did not reach the server — it may revert on next sign-in.');
  });
}

function saveV2Tiers() {
  localStorage.setItem('clfn_scoring_tiers_v2', JSON.stringify(liveV2Tiers));
  sbSaveSetting('scoring_tiers_v2', liveV2Tiers).then(function(ok){
    if(!ok) {
      showToast('Tier thresholds saved locally but did not reach the server — please retry.');
      return;
    }
    showToast('Tier thresholds saved — rescore all to apply');
  });
}

// ── V2 Scoring Editor Renderer ──────────────────────────────────────
function renderV2ScoringEditor() {
  var wrap = document.getElementById('scoring_model_table_wrap');
  if (!wrap) return;

  var m = liveV2ScoreModel;
  var t = liveV2Tiers;

  function pts(val, cat, key) {
    var col = val > 0 ? '#15803d' : val < 0 ? '#b91c1c' : '#888';
    var sign = val > 0 ? '+' : '';
    return '<input type="number" value="' + val + '" step="1" min="-30" max="30" data-cat="' + cat + '" data-key="' + key + '" '
      + 'style="width:60px;padding:4px 6px;border:1.5px solid var(--border);border-radius:6px;font-size:13px;font-weight:700;'
      + 'color:' + col + ';text-align:center;font-family:DM Sans,sans-serif;background:var(--surface);" '
      + 'onchange="updateV2ScoreOption(this)" oninput="this.style.color=+this.value>0?\x27#15803d\x27:+this.value<0?\x27#b91c1c\x27:\x27#888\x27"/>';
  }

  function maxPts(cat, key) {
    var val = typeof m[cat] === 'object' && m[cat][key] !== undefined ? m[cat][key] : 0;
    var col = val > 0 ? '#15803d' : val < 0 ? '#b91c1c' : '#888';
    return '<input type="number" value="' + val + '" step="1" min="0" max="30" data-cat="' + cat + '" data-key="' + key + '" '
      + 'style="width:60px;padding:4px 6px;border:1.5px solid var(--border);border-radius:6px;font-size:13px;font-weight:700;'
      + 'color:' + col + ';text-align:center;font-family:DM Sans,sans-serif;background:var(--surface);" '
      + 'onchange="updateV2ScoreOption(this)" oninput="this.style.color=+this.value>0?\x27#15803d\x27:\x27#888\x27"/>';
  }

  function sectionHdr(label, maxScore) {
    return '<div style="padding:10px 16px;background:#1c1c1a;border-bottom:2px solid var(--yellow);border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;margin:16px -20px 12px;">'
      + '<div style="font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#888;">' + label + '</div>'
      + (maxScore ? '<div style="font-size:11px;color:#555;">max ' + maxScore + ' pts</div>' : '')
      + '</div>';
  }

  function optRow(label, inputHtml, note) {
    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;border-radius:7px;margin-bottom:3px;background:var(--bg);">'
      + '<div style="flex:1;"><span class="js-txt-bold2" style="font-weight:400;">' + label + '</span>'
      + (note ? '<div style="font-size:10px;color:var(--muted);margin-top:1px;">' + note + '</div>' : '')
      + '</div>'
      + '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">' + inputHtml + '<span class="js-lbl-sm">pts</span></div>'
      + '</div>';
  }

  var html = '<div style="padding:0 4px;">';

  // ── Section A ──
  html += sectionHdr('Section A — Housing Need', 70);

  html += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin:10px 0 6px;">Urgent Need / Displacement</div>';
  html += optRow('Domestic Violence / Intimate Partner Abuse', pts(m.urgent_need.domestic_violence, 'urgent_need', 'domestic_violence'));
  html += optRow('Fire, Flood or Disaster', pts(m.urgent_need.fire_disaster, 'urgent_need', 'fire_disaster'));
  html += optRow('Homelessness / Imminent Eviction', pts(m.urgent_need.homeless_eviction, 'urgent_need', 'homeless_eviction'));
  html += optRow('Eviction Risk from Current Landlord', pts(m.urgent_need.eviction_risk, 'urgent_need', 'eviction_risk'));
  html += optRow('Separation or Divorce Requiring Housing', pts(m.urgent_need.separation, 'urgent_need', 'separation'));
  html += optRow('No Urgent Need', pts(m.urgent_need.none, 'urgent_need', 'none'));

  html += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin:14px 0 6px;">Health &amp; Safety Risk</div>';
  html += optRow('Severe / Imminent Risk', pts(m.health_risk.severe, 'health_risk', 'severe'));
  html += optRow('Moderate Risk', pts(m.health_risk.moderate, 'health_risk', 'moderate'));
  html += optRow('Minor Risk', pts(m.health_risk.minor, 'health_risk', 'minor'));
  html += optRow('None', pts(m.health_risk.none, 'health_risk', 'none'));

  html += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin:14px 0 6px;">Overcrowding</div>';
  html += optRow('Points per person over occupancy standard', maxPts('overcrowding', 'per_person'), '');
  html += optRow('Maximum points (cap)', maxPts('overcrowding', 'max'), 'Scored field stops accumulating points after this maximum');

  html += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin:14px 0 6px;">Household Composition</div>';
  html += optRow('Per dependent under 18', maxPts('household', 'per_dependent_u18'), '');
  html += optRow('Maximum points for dependents', maxPts('household', 'max_dependents'), '');
  html += optRow('Elder in household', maxPts('household', 'elder'), '');
  html += optRow('Lone parent', maxPts('household', 'lone_parent'), '');
  html += optRow('Household member with disability', maxPts('household', 'disability'), '');
  html += optRow('Maximum total household points', maxPts('household', 'max_total'), 'Combined cap for all household composition factors');

  html += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin:14px 0 6px;">Accessibility / Medical Need</div>';
  html += optRow('High need — structural modification required', pts(m.accessibility.high, 'accessibility', 'high'));
  html += optRow('Moderate need', pts(m.accessibility.moderate, 'accessibility', 'moderate'));
  html += optRow('None', pts(m.accessibility.none, 'accessibility', 'none'));

  html += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin:14px 0 6px;">Waitlist Time</div>';
  html += optRow('Points per full year on waitlist', maxPts('waitlist', 'per_year'), '');
  html += optRow('Maximum waitlist points', maxPts('waitlist', 'max'), '');

  // ── Section B ──
  html += sectionHdr('Section B — Tenant Responsibility', 30);

  html += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin:10px 0 6px;">Rent Payment History</div>';
  html += optRow('Excellent — consistently on time 12+ months', pts(m.rent_payment.excellent, 'rent_payment', 'excellent'));
  html += optRow('Mostly on time', pts(m.rent_payment.mostly, 'rent_payment', 'mostly'));
  html += optRow('Occasionally late', pts(m.rent_payment.occasional, 'rent_payment', 'occasional'));
  html += optRow('Frequently late', pts(m.rent_payment.frequent, 'rent_payment', 'frequent'));
  html += optRow('No prior CLFN tenancy (neutral baseline)', pts(m.rent_payment.no_history, 'rent_payment', 'no_history'), 'Applied automatically for new applicants');

  html += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin:14px 0 6px;">Unit Condition / No Damage</div>';
  html += optRow('Excellent — no damage at last inspection', pts(m.unit_condition.excellent, 'unit_condition', 'excellent'));
  html += optRow('Good', pts(m.unit_condition.good, 'unit_condition', 'good'));
  html += optRow('Fair', pts(m.unit_condition.fair, 'unit_condition', 'fair'));
  html += optRow('Damage noted', pts(m.unit_condition.damage, 'unit_condition', 'damage'));
  html += optRow('No prior CLFN tenancy (neutral baseline)', pts(m.unit_condition.no_history, 'unit_condition', 'no_history'), 'Applied automatically for new applicants');

  html += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin:14px 0 6px;">Tenancy Conduct</div>';
  html += optRow('No complaints or violations in 2 years', pts(m.tenancy_conduct.clean, 'tenancy_conduct', 'clean'));
  html += optRow('Minor complaints, resolved', pts(m.tenancy_conduct.minor, 'tenancy_conduct', 'minor'));
  html += optRow('Ongoing unresolved complaints', pts(m.tenancy_conduct.unresolved, 'tenancy_conduct', 'unresolved'));
  html += optRow('No prior CLFN tenancy (neutral baseline)', pts(m.tenancy_conduct.no_history, 'tenancy_conduct', 'no_history'), 'Applied automatically for new applicants');

  html += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin:14px 0 6px;">Income Stability</div>';
  html += optRow('Stable income — any source', pts(m.income_stability.stable, 'income_stability', 'stable'), 'Employment, social assistance, pension, LTD');
  html += optRow('Irregular income', pts(m.income_stability.irregular, 'income_stability', 'irregular'));
  html += optRow('No income', pts(m.income_stability.none, 'income_stability', 'none'));

  // ── Section C ──
  html += sectionHdr('Section C — Arrears Deduction', 0);
  html += '<div style="font-size:12px;color:var(--muted);margin-bottom:8px;">Values should be zero or negative. Score cannot go below zero regardless of deduction.</div>';
  html += optRow('No arrears', pts(m.arrears.none, 'arrears', 'none'));
  html += optRow('Arrears fully cleared', pts(m.arrears.cleared, 'arrears', 'cleared'));
  html += optRow('Active repayment plan in good standing', pts(m.arrears.repayment, 'arrears', 'repayment'));
  html += optRow('Arrears with no repayment plan', pts(m.arrears.no_repayment, 'arrears', 'no_repayment'));

  // ── Tier Thresholds ──
  html += sectionHdr('Priority Tier Thresholds', 0);
  html += '<div style="font-size:12px;color:var(--muted);margin-bottom:12px;">Set the minimum score required for each tier. Scores are evaluated from highest to lowest — an application meeting the Critical threshold is Critical Priority, even if it also meets the High threshold. The Low tier is anything below the Medium threshold.</div>';

  function tierRow(label, key, col, rangeLabel) {
    var val = t[key];
    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-radius:8px;margin-bottom:6px;background:var(--bg);border-left:3px solid ' + col + ';">'
      + '<div>'
      +   '<div style="font-size:13px;font-weight:700;color:var(--text);">' + label + '</div>'
      +   '<div class="js-lbl-sm" id="tier_range_' + key + '">' + rangeLabel + '</div>'
      + '</div>'
      + '<div style="display:flex;align-items:center;gap:6px;">'
      +   '<span class="js-lbl-sm">Score &ge;</span>'
      +   '<input type="number" value="' + val + '" min="0" max="100" step="1" data-tier="' + key + '" '
      +   'style="width:64px;padding:4px 8px;border:1.5px solid ' + col + ';border-radius:6px;font-size:15px;font-weight:700;color:' + col + ';text-align:center;font-family:DM Sans,sans-serif;background:var(--surface);" '
      +   'onchange="updateV2Tier(this)"/>'
      +   '<span class="js-lbl-sm">pts</span>'
      + '</div>'
      + '</div>';
  }

  // Compute display ranges
  var critR = t.critical + '+ pts';
  var highR = t.high + '–' + Math.max(t.high, t.critical - 1) + ' pts';
  var medR  = t.medium + '–' + Math.max(t.medium, t.high - 1) + ' pts';
  var lowR  = '0–' + Math.max(0, t.medium - 1) + ' pts';

  html += tierRow('Critical Priority', 'critical', '#4ade80', critR);
  html += tierRow('High Priority',     'high',     '#93c5fd', highR);
  html += tierRow('Medium Priority',   'medium',   '#fcd34d', medR);
  html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-radius:8px;margin-bottom:6px;background:var(--bg);border-left:3px solid #f87171;">'
    + '<div>'
    +   '<div style="font-size:13px;font-weight:700;color:var(--text);">Low Priority</div>'
    +   '<div class="js-lbl-sm" id="tier_range_low">' + lowR + '</div>'
    + '</div>'
    + '<div style="font-size:11px;color:var(--muted);font-style:italic;">Anything below Medium</div>'
    + '</div>';

  html += '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">'
    + '<button onclick="saveV2TiersED()" style="background:var(--yellow);border:none;color:#111;padding:7px 18px;border-radius:7px;cursor:pointer;font-family:DM Sans,sans-serif;font-size:12px;font-weight:700;">Save Tier Thresholds</button>'
    + '<button onclick="saveV2TiersAndRescoreED()" style="background:none;border:1.5px solid var(--yellow);color:var(--yellow);padding:7px 14px;border-radius:7px;cursor:pointer;font-family:DM Sans,sans-serif;font-size:12px;font-weight:700;">Save &amp; Rescore All</button>'
    + '<button onclick="resetV2TiersED()" style="background:none;border:1px solid #444;color:#888;padding:7px 14px;border-radius:7px;cursor:pointer;font-family:DM Sans,sans-serif;font-size:12px;">Reset Defaults</button>'
    + '</div>';

  html += '</div>';
  wrap.innerHTML = html;
}

function updateV2ScoreOption(el) {
  var cat = el.getAttribute('data-cat');
  var key = el.getAttribute('data-key');
  var val = parseInt(el.value) || 0;
  if (!liveV2ScoreModel[cat]) liveV2ScoreModel[cat] = {};
  liveV2ScoreModel[cat][key] = val;
  saveV2ScoringModel();
  auditEntry('SETTINGS', 'scoring_v2_change', 'V2 Scoring: ' + cat + '.' + key + ' set to ' + val + ' pts', window.currentRole || 'ed');
  showToast('Score updated — rescore all to apply');
}

function updateV2Tier(el) {
  var key = el.getAttribute('data-tier');
  var val = parseInt(el.value) || 0;
  liveV2Tiers[key] = val;
  // Validate ordering — warn but don't block
  if (liveV2Tiers.critical <= liveV2Tiers.high) {
    showToast('Warning: Critical threshold should be higher than High');
  }
  if (liveV2Tiers.high <= liveV2Tiers.medium) {
    showToast('Warning: High threshold should be higher than Medium');
  }
  // Live-update the range labels so the ED can see the effect immediately
  var t = liveV2Tiers;
  var critR = t.critical + '+ pts';
  var highR = t.high + '–' + Math.max(t.high, t.critical - 1) + ' pts';
  var medR  = t.medium + '–' + Math.max(t.medium, t.high - 1) + ' pts';
  var lowR  = '0–' + Math.max(0, t.medium - 1) + ' pts';
  var labels = {critical:critR, high:highR, medium:medR, low:lowR};
  Object.keys(labels).forEach(function(k){
    var lblEl = document.getElementById('tier_range_' + k);
    if(lblEl) lblEl.textContent = labels[k];
  });
}

function saveV2TiersED() {
  edGuard('V2 tier thresholds updated', function() {
    saveV2Tiers();
    auditEntry('SETTINGS', 'scoring_v2_tiers', 'Priority tier thresholds updated: Critical=' + liveV2Tiers.critical + ' High=' + liveV2Tiers.high + ' Medium=' + liveV2Tiers.medium, 'ed');
  });
}

// Save tier thresholds AND immediately rescore all applications so existing records
// reflect the new tier boundaries in their `tier` field. Without this, the editor
// saves the thresholds but the dashboard keeps showing the old tier labels until
// the ED separately clicks "Rescore All".
function saveV2TiersAndRescoreED() {
  edGuard('V2 tier thresholds updated and applications rescored', function() {
    saveV2Tiers();
    auditEntry('SETTINGS', 'scoring_v2_tiers', 'Priority tier thresholds updated: Critical=' + liveV2Tiers.critical + ' High=' + liveV2Tiers.high + ' Medium=' + liveV2Tiers.medium + ' — auto-rescored', 'ed');
    if(typeof rescoreAndSave === 'function') {
      rescoreAndSave();
    } else if(typeof rescoreAllApplications === 'function') {
      rescoreAllApplications();
    }
  });
}

function resetV2TiersED() {
  edGuard('V2 tier thresholds reset to defaults', function() {
    liveV2Tiers = Object.assign({}, DEFAULT_V2_TIERS);
    saveV2Tiers();
    renderV2ScoringEditor();
    showToast('Tier thresholds reset to defaults');
    auditEntry('SETTINGS', 'scoring_v2_tiers_reset', 'Priority tier thresholds reset to defaults', 'ed');
  });
}

function resetV2ScoringModelED() {
  edGuard('V2 Scoring Model reset to defaults', function() {
    liveV2ScoreModel = JSON.parse(JSON.stringify(DEFAULT_V2_SCORE_MODEL));
    saveV2ScoringModel();
    renderV2ScoringEditor();
    showToast('Scoring model reset to defaults');
    auditEntry('SETTINGS', 'scoring_v2_reset', 'V2 scoring model reset to defaults', 'ed');
  });
}

var SCORING_CAT_LABELS = {
  urgent_need:       'Urgent Need / Displacement',
  health_safety:     'Health & Safety Risk',
  occupancy:         'Persons Over Occupancy Standard',
  income_stability:  'Income Stability',
  household_comp:    'Household Composition',
  prior_tenancy:     'Prior CLFN Tenancy',
  waitlist_age:      'Application Age (Waitlist Duration)'
};

// Load or init scoring model


// ── Live scoring helpers — read from liveScoreModel ──────────────────
// ── Rescore all applications from current liveScoreModel ─────────────

function saveScoringModel() {
  // Save scoring model to Supabase housing_settings
  fetch(SUPABASE_URL+'/rest/v1/housing_settings', {
    method: 'POST',
    headers: Object.assign({}, HOUSING_HEADERS, {'Prefer':'resolution=merge-duplicates,return=minimal'}),
    body: JSON.stringify({ key: 'scoring_model', value: liveScoreModel })
  }).catch(function(e){ console.warn('Scoring model save failed:',e); });
  rescoreAllApplications();
  // Refresh dashboard if visible
  if(document.getElementById('dashView') && document.getElementById('dashView').style.display !== 'none') {
    updateDashStats(); renderDashTable();
  }
}

function resetScoringModel() {
  liveScoreModel = DEFAULT_SCORING_MODEL.map(function(r){ return Object.assign({},r); });
  saveScoringModel();
  auditEntry('SETTINGS','settings_scoring_reset','Housing application scoring model reset to defaults',window.currentRole||'staff');
}

// ── Nation & Modules panel (read-only, Phase A0) ─────────────────────────
// Renders the NATION_CONFIG identity + the CLFN_MODULES enablement list so
// the ED can see what their nation is licensed for. Module toggles are
// controlled by the platform admin tool (separate codebase), not here.
function renderNationPanel(){
  var identEl = document.getElementById('nation_panel_identity');
  var modsEl  = document.getElementById('nation_panel_modules');
  if(!identEl || !modsEl) return;
  var cfg = window.NATION_CONFIG || {};
  var modApi = window.CLFN_MODULES;

  // Identity card — nation display name + the subdomain it's serving.
  var host = (window.location.hostname || '').toLowerCase();
  identEl.innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;">'
    +   '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px 14px;">'
    +     '<div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px;">Nation</div>'
    +     '<div style="font-size:16px;font-weight:700;color:var(--text);">'+(cfg.display_name||'—')+'</div>'
    +     '<div class="js-lbl-sm" class="mt-4">ID: <code style="font-family:Consolas,Monaco,monospace;">'+(cfg.id||'—')+'</code></div>'
    +   '</div>'
    +   '<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px 14px;">'
    +     '<div style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px;">Hosting</div>'
    +     '<div style="font-size:13px;font-weight:700;color:var(--text);font-family:Consolas,Monaco,monospace;word-break:break-all;">'+host+'</div>'
    +     '<div class="js-lbl-sm" class="mt-4">Subdomain-routed</div>'
    +   '</div>'
    + '</div>';

  // Modules list — core vs optional, each with status pill.
  if(!modApi){
    modsEl.innerHTML = '<div class="js-txt-muted-sm">Module registry not available.</div>';
    return;
  }
  var pill = function(label, c, bg){
    return '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:'+bg+';color:'+c+';">'+label+'</span>';
  };
  var row = function(name, status, kind){
    var humanName = name.replace(/_/g,' ').replace(/\b\w/g, function(m){return m.toUpperCase();});
    var statusPill = status==='enabled'
      ? pill('Enabled','#15803d','#f0fdf4')
      : pill('Disabled','#888','#f4f4f0');
    var kindPill = kind==='core'
      ? pill('Core','#1d4ed8','#eff6ff')
      : pill('Optional','#7a6000','#fef9ec');
    return '<tr class="row-divider">'
         +   '<td style="padding:10px 12px;font-size:13px;font-weight:600;color:var(--text);">'+humanName+'</td>'
         +   '<td class="pad-12">'+kindPill+'</td>'
         +   '<td class="pad-12">'+statusPill+'</td>'
         + '</tr>';
  };
  var coreRows = modApi.CORE.map(function(n){ return row(n, 'enabled', 'core'); }).join('');
  var optRows  = modApi.listOptional().map(function(n){
    return row(n, modApi.isEnabled(n) ? 'enabled' : 'disabled', 'optional');
  }).join('');
  modsEl.innerHTML =
      '<div style="font-size:11px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px;">Modules</div>'
    + '<div class="overflow-x">'
    + '<table class="std-tbl">'
    +   '<thead><tr style="background:var(--bg);border-bottom:2px solid var(--border);">'
    +     '<th style="text-align:left;padding:8px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#888;">Module</th>'
    +     '<th style="text-align:left;padding:8px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#888;width:100px;">Type</th>'
    +     '<th style="text-align:left;padding:8px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#888;width:110px;">Status</th>'
    +   '</tr></thead>'
    +   '<tbody>'+coreRows+optRows+'</tbody>'
    + '</table>'
    + '</div>'
    + '<div style="font-size:11px;color:var(--muted);margin-top:12px;font-style:italic;">To enable or disable optional modules for your nation, contact your platform administrator.</div>';
}

function renderScoringModelTable() {
  var wrap = document.getElementById('scoring_model_table_wrap');
  if(!wrap) return;

  // Re-read from settings (may have loaded after page init)
  var model = liveScoreModel;
  if(window._appSettings && window._appSettings['scoring_model_v2']) {
    try { var m2 = window._appSettings['scoring_model_v2']; if(m2 && m2.length) model = m2; } catch(e){}
  }
  if(!model || !model.length) {
    wrap.innerHTML = '<div class="empty-state-ctr">No scoring model configured. Settings will appear here after they are saved.</div>';
    return;
  }

  // Group by category
  var grouped = {};
  model.forEach(function(r) {
    if(!grouped[r.cat]) grouped[r.cat] = [];
    grouped[r.cat].push(r);
  });

  var catOrder = ['urgent_need','health_safety','occupancy',
                  'income_stability','household_comp','prior_tenancy','waitlist_age'];

  var html = '';
  catOrder.forEach(function(cat) {
    var rows = (grouped||{})[cat];
    if(!rows || !rows.length) return;
    var catLabel = SCORING_CAT_LABELS[cat] || cat;

    html += '<div style="margin-bottom:20px;">';
    html += '<div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--muted);padding:8px 0 6px;border-bottom:1px solid var(--border);margin-bottom:6px;">'+catLabel+'</div>';

    rows.sort(function(a,b){return a.order-b.order;});
    rows.forEach(function(r) {
      var ptsColor = r.pts > 0 ? '#15803d' : r.pts < 0 ? '#b91c1c' : '#888';
      var sign = r.pts > 0 ? '+' : '';
      var isAuto = (r.id === 'oc1' || r.id === 'wa1');
      html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;border-radius:7px;margin-bottom:3px;background:var(--bg);">'        + '<span style="font-size:13px;color:var(--text);flex:1;">'+r.label+'</span>'        + '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">'        + (isAuto          ? '<span style="font-size:11px;color:var(--muted);font-style:italic;margin-right:4px;">auto-calculated</span>'            + '<input type="number" value="'+r.pts+'" step="1" min="0" max="10" '            +   'style="width:64px;padding:4px 8px;border:1.5px solid var(--border);border-radius:6px;font-size:13px;font-weight:700;color:'+ptsColor+';text-align:center;font-family:\'DM Sans\',sans-serif;background:var(--surface);" '            +   'data-smid="'+r.id+'" oninput="updateV2ScoreModel(this)"/>'            + '<span class="js-lbl-sm">pts each</span>'          : '<input type="number" value="'+r.pts+'" step="1" min="-20" max="30" '            +   'style="width:64px;padding:4px 8px;border:1.5px solid var(--border);border-radius:6px;font-size:13px;font-weight:700;color:'+ptsColor+';text-align:center;font-family:\'DM Sans\',sans-serif;background:var(--surface);" '            +   'data-smid="'+r.id+'" oninput="updateV2ScoreModel(this)"/>'            + '<span class="js-lbl-sm">pts</span>'        )        + '<button onclick="deleteV2ScoreCriteria(\''+r.id+'\')" title="Remove" style="background:none;border:none;color:#888;cursor:pointer;font-size:14px;padding:2px 4px;" onmouseover="this.style.color=\'#b91c1c\'" onmouseout="this.style.color=\'#888\'">✕</button>'        + '</div>'        + '</div>';
    });
    html += '</div>';
  });

  if(!html) html = '<div style="padding:20px;text-align:center;color:var(--muted);">No scoring criteria defined. Click "Add Criteria" to add one.</div>';
  wrap.innerHTML = html;
}

function confirmResetScoringModel() {
  if(confirm('Reset the scoring model to defaults? This cannot be undone.')) {
    resetScoringModel();
    renderScoringModelTable();
    showToast('Scoring model reset to defaults');
  }
}

// Called by the ✕ button in renderScoringModelTable rows.
// Removes the criterion with the given id from the active scoring model and persists.
function deleteV2ScoreCriteria(id) {
  if (!id) return;
  if (!confirm('Remove this scoring criterion?')) return;

  // liveScoreModel may be the V2 model loaded from settings — mutate in place
  var idx = liveScoreModel.findIndex(function(r) { return r.id === id; });
  if (idx === -1) {
    showToast('Criterion not found — it may have already been removed.');
    return;
  }
  var removed = liveScoreModel.splice(idx, 1)[0];
  // Persist to Supabase settings and localStorage
  saveV2ScoringModel();
  // Refresh the editor table
  renderScoringModelTable();
  // Re-score all applications so points reflect the change
  if (typeof rescoreAllApplications === 'function') rescoreAllApplications();
  showToast('Criterion \u201c' + (removed.label || removed.id) + '\u201d removed');
}

// Called oninput on the pts number input in each renderScoringModelTable row.
// Updates the row's pts value in liveScoreModel and persists (debounced).
function updateV2ScoreModel(el) {
  var id  = el.getAttribute('data-smid');
  var val = parseInt(el.value) || 0;
  if (!id) return;
  var row = liveScoreModel.find(function(r) { return r.id === id; });
  if (!row) return;
  row.pts = val;
  // Colour feedback: green positive, red negative, grey zero
  el.style.color = val > 0 ? '#15803d' : val < 0 ? '#b91c1c' : '#888';
  // Debounce the save — avoid hitting Supabase on every keystroke
  clearTimeout(el._saveTimer);
  el._saveTimer = setTimeout(function() {
    saveV2ScoringModel();
    auditEntry('SETTINGS', 'scoring_v2_pts_change',
      'V2 Scoring: ' + (row.label || id) + ' pts set to ' + val,
      window.currentRole || 'ed');
    showToast('Score updated \u2014 rescore all to apply');
  }, 800);
}




function openAddCriteriaModal() {
  var modal = document.getElementById('addCriteriaModal');
  if(!modal){ showToast('Refresh the page and try again'); return; }
  modal.style.removeProperty('display');
  modal.style.setProperty('display', 'flex', 'important');
  modal.style.setProperty('position', 'fixed', 'important');
  modal.style.setProperty('z-index', '9000', 'important');
  // Reset all fields
  var set = function(id,v){ var el=document.getElementById(id); if(el) el.value=v||''; };
  set('acm_cat','reserve_status'); set('acm_label',''); set('acm_pts','0');
}

function closeAddCriteriaModal() {
  var modal = document.getElementById('addCriteriaModal');
  if(modal){
    modal.style.removeProperty('display');
    modal.style.removeProperty('position');
    modal.style.removeProperty('z-index');
    modal.style.setProperty('display', 'none', 'important');
  }
}
function setPts(elId,score){
  const el=document.getElementById(elId);if(!el)return;
  const abs=Math.abs(score);
  el.textContent=score>0?'+'+score+' pts':score<0?score+' pts':'0 pts';
  el.style.background=score>0?'#f0fdf4':score<0?'#fef2f2':'var(--yellow-light)';
  el.style.color=score>0?'#15803d':score<0?'#b91c1c':'#7a6000';
}

// ── V2 tenancy prior toggle ──
function onPriorTenancyChange() {
  var val = (document.getElementById('no_prior_tenancy')||{}).value || 'true';
  var isNew = val === 'true';
  var histFields = document.getElementById('tenancy_history_fields');
  if (histFields) histFields.style.display = isNew ? 'none' : 'block';
  triggerV2Score();
}

// ── Unlock HM-only fields based on role ──
function applyTenancyFieldRoles() {
  var role = window.currentRole || 'housing_employee_l1';
  var isHM = (ROLE.isManagement(role));
  var badge = document.getElementById('tenancy_hm_badge');
  var lockedMsg = document.getElementById('tenancy_locked_msg');
  if (badge) badge.style.display = isHM ? 'flex' : 'none';
  document.querySelectorAll('.field-hm-only').forEach(function(el) {
    el.disabled = !isHM;
    el.style.opacity = isHM ? '1' : '0.5';
    el.style.cursor  = isHM ? '' : 'not-allowed';
  });
  if (lockedMsg) lockedMsg.style.display = isHM ? 'none' : 'block';
}

// ── triggerV2Score — calls the Edge Function and updates display ──

// ── Build V2 form selects from live scoring model ──────────────────────────
function buildV2FormSelects() {
  var model = liveScoreModel;
  // Re-read from appSettings in case they loaded after init
  if(window._appSettings) {
    var src = window._appSettings['scoring_model_v2'] || window._appSettings['scoring_model'];
    if(src && src.length) {
      model = src.map(function(r) {
        if(r.pts === undefined && r.p !== undefined) return Object.assign({}, r, {pts: r.p});
        return r;
      });
    }
  }

  // Defensive: if neither liveScoreModel nor _appSettings provided a model,
  // bail out gracefully. This can happen on first load before settings
  // fetch completes, or if the scoring_model_v2 key is missing in Supabase.
  // The form will render with its static default <option>s from the HTML.
  if(!model || !model.length) {
    console.warn('[scoring] buildV2FormSelects: no scoring model available yet — leaving form defaults in place');
    return;
  }

  // Helper: get rows for a category
  function catRows(cat) {
    return model.filter(function(r) { return r.cat === cat; });
  }

  // urgent_need select
  var unSel = document.getElementById('urgent_need');
  if(unSel) {
    var unRows = catRows('urgent_need');
    if(unRows.length) {
      var curVal = unSel.value;
      unSel.innerHTML = unRows.map(function(r, i) {
        var pts = (r.pts !== undefined ? r.pts : (r.p||0));
        var val = i === 0 ? 'none' : 'level_'+i;
        // Map by position: un1=none, un2=level_2, un3=level_3, un4=level_4
        val = r.id === 'un1' ? 'none' : r.id === 'un2' ? 'overcrowded' : r.id === 'un3' ? 'eviction' : 'emergency';
        return '<option value="'+val+'">'+ r.label + (pts > 0 ? ' (+'+pts+' pts)' : ' ('+pts+' pts)') +'</option>';
      }).join('');
      if(curVal) unSel.value = curVal;
    }
  }

  // health_risk select
  var hrSel = document.getElementById('health_risk');
  if(hrSel) {
    var hrRows = catRows('health_safety');
    if(hrRows.length) {
      var curHr = hrSel.value;
      hrSel.innerHTML = hrRows.map(function(r) {
        var pts = (r.pts !== undefined ? r.pts : (r.p||0));
        var val = r.id === 'hs1' ? 'none' : r.id === 'hs2' ? 'minor' : r.id === 'hs3' ? 'moderate' : 'severe';
        return '<option value="'+val+'">'+r.label+' ('+pts+' pts)</option>';
      }).join('');
      if(curHr) hrSel.value = curHr;
    }
  }

  // income_stability select
  var isSel = document.getElementById('income_stability');
  if(isSel) {
    var isRows = catRows('income_stability');
    if(isRows.length) {
      var curIs = isSel.value;
      isSel.innerHTML = isRows.map(function(r) {
        var pts = (r.pts !== undefined ? r.pts : (r.p||0));
        var val = r.id === 'is1' ? 'stable' : 'unstable';
        return '<option value="'+val+'">'+r.label+' ('+pts+' pts)</option>';
      }).join('');
      if(curIs) isSel.value = curIs;
    }
  }

  // Update household composition pt labels
  var hcRows = catRows('household_comp');
  hcRows.forEach(function(r) {
    var pts = (r.pts !== undefined ? r.pts : (r.p||0));
    var labelId = r.id === 'hc1' ? 'lp_pts_label' : r.id === 'hc2' ? 'ei_pts_label' : 'hd_pts_label';
    var el = document.getElementById(labelId);
    if(el) el.textContent = '(+'+pts+' pts)';
  });

  // Update occupancy per-person label
  var ocRows = catRows('occupancy');
  if(ocRows.length) {
    var ocEl = document.getElementById('oc_pts_label');
    if(ocEl) ocEl.textContent = '('+ocRows[0].pts+' pt each, max 10 pts)';
  }
}



// ══════════════════════════════════════════════════════════════
// NOS TABLE — National Occupancy Standard
// ══════════════════════════════════════════════════════════════

var DEFAULT_NOS_TABLE = {
  '0': 1,   // Studio / no bedroom — 1 person max
  '1': 2,   // 1 bedroom — 2 persons max
  '2': 4,   // 2 bedrooms — 4 persons max
  '3': 6,   // 3 bedrooms — 6 persons max
  '4': 8,   // 4 bedrooms — 8 persons max
  '5': 10   // 5+ bedrooms — 10 persons max
};

var NOS_BED_LABELS = {
  '0': 'Studio / 0 bedrooms',
  '1': '1 bedroom',
  '2': '2 bedrooms',
  '3': '3 bedrooms',
  '4': '4 bedrooms',
  '5': '5+ bedrooms'
};

function getNosTable() {
  // Read from settings (loaded from Supabase), fall back to default
  if(window._appSettings && window._appSettings['nos_table']) {
    return Object.assign({}, DEFAULT_NOS_TABLE, window._appSettings['nos_table']);
  }
  return Object.assign({}, DEFAULT_NOS_TABLE);
}

function renderNosTable() {
  var tbody = document.getElementById('nos_table_tbody');
  if(!tbody) return;
  var defaults = {'0':1,'1':2,'2':4,'3':6,'4':8,'5':10};
  var bedLabels = {'0':'Studio / 0 bedrooms','1':'1 bedroom','2':'2 bedrooms','3':'3 bedrooms','4':'4 bedrooms','5':'5+ bedrooms'};
  var nos = defaults;
  try { if(typeof getNosTable === 'function') nos = getNosTable(); } catch(e) { nos = defaults; }
  var isED = (window.currentRole === ROLE.ED);
  tbody.innerHTML = Object.keys(bedLabels).map(function(beds) {
    var maxPeople = (nos[beds] !== undefined) ? nos[beds] : defaults[beds];
    var label = bedLabels[beds];
    var inputStyle = 'width:72px;padding:4px 8px;border:1.5px solid var(--border);border-radius:6px;font-size:13px;font-weight:700;color:var(--text);text-align:center;font-family:DM Sans,sans-serif;background:var(--surface);' + (isED ? '' : 'opacity:0.55;cursor:not-allowed;');
    return '<tr class="row-divider">'
      + '<td style="padding:10px 12px;font-size:13px;color:var(--text);">' + label + '</td>'
      + '<td style="padding:10px 12px;text-align:center;">'
      + '<input type="number" data-nos-beds="' + beds + '" value="' + maxPeople + '" min="1" max="20" step="1" ' + (isED ? '' : 'disabled ') + 'style="' + inputStyle + '"/>'
      + '<span style="font-size:11px;color:var(--muted);margin-left:6px;">persons</span>'
      + '</td></tr>';
  }).join('');
}


function saveNosTable() {
  if(window.currentRole !== ROLE.ED) {
    showToast('Only the Executive Director can update the NOS table.');
    return;
  }
  var nos = {};
  document.querySelectorAll('#nos_table_tbody input[data-nos-beds]').forEach(function(el) {
    var beds = el.getAttribute('data-nos-beds');
    nos[beds] = parseInt(el.value) || DEFAULT_NOS_TABLE[beds];
  });

  // Save to _appSettings and Supabase
  if(!window._appSettings) window._appSettings = {};
  window._appSettings['nos_table'] = nos;

  sbSaveSetting('nos_table', nos).then(function(ok) {
    if(ok) {
      showToast('\u2713 NOS table saved');
      auditEntry('SETTINGS', 'nos_table_save', 'NOS table updated by ED', 'Executive Director');
    } else {
      showToast('Save failed — check connection');
    }
  });
}


// ── Auto-calculate Persons Over Occupancy Standard ───────────────────────────
function calcPersonsOverStandard() {
  // Count total household members
  var habCount  = document.querySelectorAll('#habList .rrow').length;
  var coStatus  = (document.getElementById('co_status')||{}).value || 'no';
  var coCount   = (coStatus === 'yes' || coStatus === 'y') ? 1 : 0;
  var totalPeople = 1 + coCount + habCount; // applicant + co-applicant + members

  // NOS: max occupants allowed per bedroom count — read from settings
  var nosSettings = (typeof getNosTable === 'function') ? getNosTable() : {'0':1,'1':2,'2':4,'3':6,'4':8,'5':10};
  var nosMax = [
    nosSettings['0'] || 1,
    nosSettings['1'] || 2,
    nosSettings['2'] || 4,
    nosSettings['3'] || 6,
    nosSettings['4'] || 8,
    nosSettings['5'] || 10
  ];

  // Determine how many bedrooms the applicant's current home has
  // We use the current unit's bedrooms if selected, otherwise estimate from people
  var currentUnit = document.getElementById('currentUnitId');
  var currentBeds = 0;
  if(currentUnit && currentUnit.value) {
    var allUnits = (typeof housingUnits !== 'undefined') ? housingUnits : [];
    var unit = allUnits.find(function(u){ return u.id === currentUnit.value; });
    if(unit) currentBeds = parseInt(unit.bedrooms) || 0;
  }
  // If no current unit selected, use bedrooms field if available
  if(!currentBeds) {
    var bedsEl = document.getElementById('au_bedrooms') || document.getElementById('ue_bedrooms');
    if(bedsEl) currentBeds = parseInt(bedsEl.value) || 0;
  }

  // Max people allowed in current home per NOS
  var maxAllowed = nosMax[Math.min(currentBeds, nosMax.length-1)];
  var over = Math.max(0, Math.min(10, totalPeople - maxAllowed));

  // Update the field
  var posEl = document.getElementById('persons_over_standard');
  if(posEl) posEl.value = over;

  // Update display counters
  var occCo  = document.getElementById('occ_coapplicant'); if(occCo) occCo.textContent = coCount;
  var occMem = document.getElementById('occ_members');    if(occMem) occMem.textContent = habCount;
  var occTot = document.getElementById('occ_total');      if(occTot) occTot.textContent = totalPeople;
  var scSize = document.getElementById('sc_size');        if(scSize) scSize.value = Math.min(7, Math.max(1, totalPeople));

  return over;
}


function scoreApplicationLocally(app) {
  var urgentMap = { domestic_violence:20, fire_disaster:20, homeless_eviction:15, eviction_risk:10, separation:10, none:0 };
  var urgentPts = urgentMap[app.urgentNeed || 'none'] !== undefined ? urgentMap[app.urgentNeed || 'none'] : 0;
  var healthMap = { severe:15, moderate:10, minor:5, none:0 };
  var healthPts = healthMap[app.healthRisk || 'none'] !== undefined ? healthMap[app.healthRisk || 'none'] : 0;
  var overcrowdingPts = Math.min(10, Math.max(0, parseInt(app.personsOverStandard || '0') || 0));
  var deps = Math.min(5, parseInt(app.dependentsUnder18 || '0') || 0);
  var householdPts = Math.min(10, deps + (app.elderInHousehold?3:0) + (app.loneParent?3:0) + (app.householdDisability?2:0));
  var accessMap = { high:10, moderate:5, none:0 };
  var accessPts = accessMap[app.accessibilityNeed || 'none'] !== undefined ? accessMap[app.accessibilityNeed || 'none'] : 0;
  var waitlistPts = 0;
  if (app.appDate) { var yrs = (Date.now() - new Date(app.appDate).getTime()) / (365.25*24*3600*1000); waitlistPts = Math.min(5, Math.max(0, Math.floor(yrs))); }
  var sectionA = urgentPts + healthPts + overcrowdingPts + householdPts + accessPts + waitlistPts;
  var isNew = (app.noPriorTenancy === true || app.noPriorTenancy === 'true');
  var rentMap = { excellent:10, mostly:7, occasional:5, frequent:0, no_history:6 };
  var condMap = { excellent:10, good:7, fair:4, damage:0, no_history:7 };
  var conductMap = { clean:5, minor:3, unresolved:0, no_history:4 };
  var incomeMap = { stable:5, irregular:2, none:0 };
  var rentPts    = rentMap[isNew    ? 'no_history' : (app.rentPaymentHistory || 'no_history')];
  var condPts    = condMap[isNew    ? 'no_history' : (app.unitCondition     || 'no_history')];
  var conductPts = conductMap[isNew ? 'no_history' : (app.tenancyConduct    || 'no_history')];
  var incomePts  = incomeMap[app.incomeStability || 'stable'];
  if (rentPts    === undefined) rentPts    = 6;
  if (condPts    === undefined) condPts    = 7;
  if (conductPts === undefined) conductPts = 4;
  if (incomePts  === undefined) incomePts  = 5;
  var sectionB = rentPts + condPts + conductPts + incomePts;
  var arrearsMap = { none:0, cleared:0, repayment:-5, no_repayment:-10 };
  var arrearsDed = arrearsMap[app.arrearsStatus || 'none'] !== undefined ? arrearsMap[app.arrearsStatus || 'none'] : 0;
  var edAdj = parseInt(app.edAdjustment || '0') || 0;
  var finalScore = Math.max(0, sectionA + sectionB + arrearsDed + edAdj);
  var _t = window.liveV2Tiers || { critical:80, high:60, medium:40 };
  var tier = finalScore >= _t.critical ? 'Critical Priority' : finalScore >= _t.high ? 'High Priority' : finalScore >= _t.medium ? 'Medium Priority' : 'Low Priority';
  return { score:finalScore, tier:tier, isNewApplicant:isNew, breakdown:{ sectionA:{ total:sectionA, urgent:urgentPts, health:healthPts, overcrowding:overcrowdingPts, household:householdPts, accessibility:accessPts, waitlist:waitlistPts }, sectionB:{ total:sectionB, rent:rentPts, condition:condPts, conduct:conductPts, income:incomePts }, arrears:arrearsDed, edAdjustment:edAdj } };
}

function triggerV2Score() {
  var appDate = (document.getElementById('appDate')||{}).value || '';
  var noPrior = (document.getElementById('no_prior_tenancy')||{}).value === 'true';

  // Auto-calculate persons over standard from household size
  calcPersonsOverStandard();
  var personsOver = parseInt((document.getElementById('persons_over_standard')||{}).value || '0') || 0;

  // Dependents under 18 from habList
  var dependentsUnder18 = 0;
  document.querySelectorAll('#habList .rrow').forEach(function(row) {
    var dobEl = row.querySelector('[data-role="habDob"]');
    if (!dobEl || !dobEl.value) return;
    var age = (Date.now() - new Date(dobEl.value).getTime()) / (365.25*24*3600*1000);
    if (age < 18) dependentsUnder18++;
  });

  // Arrears status — derive from toggle + plan months
  var hasArrears = document.getElementById('arrToggle') && document.getElementById('arrToggle').checked;
  var arrStatus = 'none';
  if (hasArrears) {
    var planMonths = parseInt((document.getElementById('arrPlanMonths')||{}).value || '0') || 0;
    arrStatus = planMonths > 0 ? 'repayment' : 'no_repayment';
  }

  // Accessibility — map to high/moderate/none
  var accVal = (document.getElementById('accessibility')||{}).value || '';
  var accessNeed = 'none';
  if (accVal && accVal !== 'None' && accVal !== '' && accVal !== '0') {
    // Wheelchair or structural needs = high, sensory = moderate
    if (/wheelchair/i.test(accVal)) accessNeed = 'high';
    else accessNeed = 'moderate';
  }

  var appData = {
    urgentNeed:          (document.getElementById('urgent_need')||{}).value || 'none',
    healthRisk:          (document.getElementById('health_risk')||{}).value || 'none',
    personsOverStandard: String(personsOver),
    dependentsUnder18:   String(dependentsUnder18),
    loneParent:          !!(document.getElementById('lone_parent')||{}).checked,
    elderInHousehold:    !!(document.getElementById('elder_in_household')||{}).checked,
    householdDisability: !!(document.getElementById('household_disability')||{}).checked,
    accessibilityNeed:   accessNeed,
    appDate:             appDate,
    noPriorTenancy:      noPrior,
    rentPaymentHistory:  (document.getElementById('rent_payment_history')||{}).value || 'no_history',
    unitCondition:       (document.getElementById('unit_condition')||{}).value || 'no_history',
    tenancyConduct:      (document.getElementById('tenancy_conduct')||{}).value || 'no_history',
    incomeStability:     (document.getElementById('income_stability')||{}).value || 'stable',
    arrearsStatus:       arrStatus,
    edAdjustment:        (document.getElementById('edAdjustment')||{}).value || '0'
  };

  // Store for rubric display labels
  window._v2AppData = appData;

  try {
    var result = scoreApplicationLocally(appData);

    // Apply live tier thresholds (ED-adjustable) to override Edge Function tier
    var _score = result.score;
    var _t = window.liveV2Tiers || { critical: 80, high: 60, medium: 40 };
    var _tier = _score >= _t.critical ? 'Critical Priority'
              : _score >= _t.high     ? 'High Priority'
              : _score >= _t.medium   ? 'Medium Priority'
              : 'Low Priority';
    result.tier = _tier;

    window._lastScoreResult    = result;
    window._lastScoreBreakdown = result.breakdown;

    // Update display elements
    var scoreEl = document.getElementById('sc_score_total');
    var scoreShadow = document.getElementById('totalScore');
    var tierEl  = document.getElementById('sc_score_tier');
    var tierShadow = document.getElementById('priorityTier');
    var barEl   = document.getElementById('sc_score_bar') || document.getElementById('scoreBarFill');

    if (scoreEl)  scoreEl.textContent  = _score;
    if (scoreShadow) scoreShadow.textContent = _score;
    if (tierEl) {
      tierEl.textContent = _tier;
      var tierColors = {
        'Critical Priority': { bg:'#0d2d1a', color:'#4ade80' },
        'High Priority':      { bg:'#0d2040', color:'#93c5fd' },
        'Medium Priority':    { bg:'#3d3000', color:'#fcd34d' },
        'Low Priority':       { bg:'#3d1515', color:'#f87171' }
      };
      var tc = tierColors[_tier] || { bg:'#2a2a28', color:'#aaa' };
      tierEl.style.background = tc.bg;
      tierEl.style.color      = tc.color;
    }
    if (tierShadow) tierShadow.textContent = _tier;
    if (barEl) barEl.style.width = Math.min(100, Math.round(_score)) + '%';

    // Update rubric display
    renderRubricTableV2(result.breakdown);

    // Store for save chain
    window._appScore = { total: _score, tier: _tier, breakdown: result.breakdown };

    // Auto-save V2 fields to Supabase whenever score changes
    if (window.currentAppId) {
      var v2Patch = {
        score: _score, tier: _tier, score_v2: _score, tier_v2: _tier,
        score_breakdown_v2: result.breakdown,
        urgent_need: appData.urgentNeed,
        health_risk: appData.healthRisk,
        persons_over_standard: parseInt(appData.personsOverStandard) || 0,
        lone_parent: appData.loneParent,
        elder_in_household: appData.elderInHousehold,
        household_disability: appData.householdDisability,
        income_stability: appData.incomeStability,
        rent_payment_history: appData.rentPaymentHistory,
        unit_condition: appData.unitCondition,
        tenancy_conduct: appData.tenancyConduct,
        no_prior_tenancy: appData.noPriorTenancy,
        arrears_status: appData.arrearsStatus
      };
      fetch(SUPABASE_URL + '/rest/v1/housing_applications?id=eq.' + encodeURIComponent(window.currentAppId), {
        method: 'PATCH',
        headers: Object.assign({}, HOUSING_HEADERS, { 'Prefer': 'return=minimal' }),
        body: JSON.stringify(v2Patch)
      }).catch(function(e) { console.warn('[V2 autosave] failed:', e); });
    }

  } catch(err) {
    console.warn('[V2 Score] calculation failed:', err.message);
  }
}

// ── autoPopulateScore ──
function autoPopulateScore(){
  // Reserve
  const reserveVal=g('reserve')==='Off Reserve'?'off':'on';
  const reserveEl=document.getElementById('sc_reserve');if(reserveEl)reserveEl.value=reserveVal;

  // Band
  let bandCount=0;
  if(g('band'))bandCount++;
  if(g('co_band'))bandCount++;
  document.querySelectorAll('#habList .rrow').forEach(function(row){
    var inputs=row.querySelectorAll('input[type="number"]');
    if(inputs.length>0&&inputs[0].value)bandCount++;
  });
  const scBand=document.getElementById('sc_band_count');if(scBand)scBand.value=bandCount;
  const bdDet=document.getElementById('sc_band_detail');
  if(bdDet)bdDet.textContent=bandCount>0?bandCount+' band member'+(bandCount!==1?'s':'')+' — +'+bandCount+' pt'+(bandCount!==1?'s':''):'No band members';

  // Income
  const incomeRows=document.querySelectorAll('#incomeList .rrow');
  let primaryType='';
  incomeRows.forEach(function(row){
    var sels=row.querySelectorAll('select');
    if(sels[0]&&sels[1]&&sels[0].value==='Applicant'&&!primaryType)primaryType=sels[1].value;
  });
  var incomeScore=0;
  if(['Employment','Employed','Self-Employment'].includes(primaryType)) incomeScore=livePoints('employed');
  else if(primaryType==='Pension'||primaryType==='CPP')                 incomeScore=livePoints('pension');
  else                                                                   incomeScore=livePoints('social');
  const scIncome=document.getElementById('sc_income');if(scIncome)scIncome.value=incomeScore;

  // Relation
  const marital=g('marital');
  const relScore=['Divorced','Separated'].includes(marital)?livePoints('div_sep'):livePoints('other');
  const scRel=document.getElementById('sc_rel');if(scRel)scRel.value=relScore;

  // Ages
  function calcAgeScore(dob){
    if(!dob)return 0;
    const age=(new Date()-new Date(dob))/(365.25*24*3600*1000);
    return liveAgePoints(age);
  }
  function ageLabel(dob){
    if(!dob)return'?';
    return Math.floor((new Date()-new Date(dob))/(365.25*24*3600*1000))+' yrs';
  }
  const people=[];
  const appDob=g('dob');if(appDob)people.push({label:'Applicant ('+ageLabel(appDob)+')',dob:appDob});
  const coDob=g('co_dob');if(coDob)people.push({label:'Co-Applicant ('+ageLabel(coDob)+')',dob:coDob});
  document.querySelectorAll('#habList .rrow').forEach(function(row,i){
    var inputs=row.querySelectorAll('input[type="date"]');
    const fn=row.querySelector('input[type="text"]');
    if(inputs.length>0&&inputs[0].value)
      people.push({label:(fn?fn.value||'Member '+(i+1):'Member '+(i+1))+' ('+ageLabel(inputs[0].value)+')',dob:inputs[0].value});
  });
  const breakdown=document.getElementById('sc_age_breakdown');
  const emptyMsg=document.getElementById('sc_age_empty');
  const scAge=document.getElementById('sc_age');
  if(people.length>0){
    if(emptyMsg)emptyMsg.style.display='none';
    if(breakdown)breakdown.innerHTML=people.map(function(p){
      var pts=calcAgeScore(p.dob);
      const col=pts>=3?'#15803d':pts>=2?'#1e3a5f':'#7a6000';
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:var(--bg);border-radius:6px;font-size:12px;">'
        +'<span class="js-lbl-xs">'+p.label+'</span>'
        +'<span style="font-weight:700;color:'+col+';">+'+pts+' pts</span></div>';
    }).join('');
    if(scAge)scAge.value=people.reduce(function(s,p){return s+calcAgeScore(p.dob);},0);
  }else{
    if(emptyMsg)emptyMsg.style.display='block';
    if(breakdown)breakdown.innerHTML='';
    if(scAge)scAge.value=0;
  }

  // Accessibility
  const accessVal=g('accessibility');
  const hasAccess=accessVal&&accessVal!==''&&accessVal!=='None';
  const scAccess=document.getElementById('sc_access');if(scAccess)scAccess.checked=hasAccess;

  // Move-In
  const occDate=g('occDate');
  let moveInScore=0;
  if(occDate){
    const yrs=(new Date(occDate)-new Date())/(365.25*24*3600*1000);
    if(yrs<=1)      moveInScore=livePoints('within_1yr');
    else if(yrs<=3) moveInScore=livePoints('1_to_3yr');
    else            moveInScore=livePoints('3_plus_yr');
  }
  const scMoveIn=document.getElementById('sc_movein');if(scMoveIn)scMoveIn.value=moveInScore;

  // Home Condition
  const hasHouse=document.getElementById('hasHouseToggle')?document.getElementById('hasHouseToggle').checked:false;
  const homeCond=g('homeCondition');
  let homeCondScore=0;
  if(hasHouse&&homeCond){
    const hcMap={Good:livePoints('good'),Average:livePoints('average'),Poor:livePoints('poor')};
    homeCondScore=hcMap[homeCond]||0;
  }
  const scHomeCond=document.getElementById('sc_homecond');if(scHomeCond)scHomeCond.value=homeCondScore;

  // Renos
  const renosCost=(function(){var v=(g('renosCost')||'').replace(/[^0-9]/g,'');return parseInt(v)||0;})();
  const scRenos=document.getElementById('sc_renos');if(scRenos)scRenos.value=renosCost;

  // Arrears
  const hasArrears=document.getElementById('arrToggle')?document.getElementById('arrToggle').checked:false;
  var _arrEl=document.getElementById('arrBalAmt');
  var _arrRaw=_arrEl?(_arrEl.value||'').replace(/[^0-9]/g,''):'0';
  const arrealAmt=hasArrears?(parseInt(_arrRaw)||0):0;
  const scArrears=document.getElementById('sc_arrears');if(scArrears)scArrears.value=arrealAmt;

  // Payment
  const payDur=parseFloat(g('arrPlanMonths')||'0')||0;
  const scPayment=document.getElementById('sc_payment');if(scPayment)scPayment.value=payDur;

  // Occupants (calculated)
  const habCount=document.querySelectorAll('#habList .rrow').length;
  const coCount=(g('co_status')==='yes')?1:0;
  const totalPeople=1+coCount+habCount;
  const occCo=document.getElementById('occ_coapplicant');if(occCo)occCo.textContent=coCount;
  const occMem=document.getElementById('occ_members');if(occMem)occMem.textContent=habCount;
  const occTot=document.getElementById('occ_total');if(occTot)occTot.textContent=totalPeople;
  const scSize=document.getElementById('sc_size');if(scSize)scSize.value=Math.min(7,Math.max(1,totalPeople));

  // Waitlist
  const appDateVal=g('appDate');
  const scAppdateEl=document.getElementById('sc_appdate');if(scAppdateEl&&appDateVal)scAppdateEl.value=appDateVal;

  // Store rubric data
  window._rubricData={
    waitlist:0,waitlist_label:'',
    reserve:reserveVal==='off'?1:0,reserve_label:g('reserve')||'Not specified',
    band:bandCount,income:incomeScore,income_label:primaryType||'No income record',
    relation:relScore,relation_label:marital||'Not specified',
    ages:people.reduce(function(s,p){return s+calcAgeScore(p.dob);},0),age_people:[],
    access:hasAccess?1:0,access_label:hasAccess?accessVal:'None',
    moveIn:moveInScore,movein_label:'',homeCond:homeCondScore,homecond_label:'',
    renos:0,renos_amt:renosCost,arrears:0,arrears_amt:arrealAmt,payment:0,payment_months:payDur,
  };

  triggerV2Score();
}

// ── calcScore ──
function calcScore(){
  // Local helpers — read form field values by id
  function fv(id){ var e=document.getElementById(id); return e ? e.value.trim() : ''; }
  function fb(id){ var e=document.getElementById(id); return e ? e.checked : false; }
  // If this is a file update for an existing tenant, don't score
  if(typeof getAppType === 'function' && getAppType() === 'existing_tenant') {
    var sc = document.getElementById('sc_score_total');
    if(sc) sc.textContent = 'N/A';
    var tierEl = document.getElementById('sc_score_tier');
    if(tierEl){ tierEl.textContent = 'File Update Only'; tierEl.style.color='#888'; tierEl.style.background='#2a2a28'; }
    return;
  }
  let total=0;
  const reserveScore=fv('sc_reserve')==='off'?livePoints('off_reserve'):livePoints('on_reserve');
  setPts('sc_reserve_pts',reserveScore);total+=reserveScore;
  const bandCount=parseInt(fv('sc_band_count')||'0')||0;
  const bandPts=bandCount*livePerMemberPoints('band_membership');
  setPts('sc_band_pts',bandPts);total+=bandPts;
  const incomeVal=parseInt(fv('sc_income')||'0')||0;
  setPts('sc_income_pts',incomeVal);total+=incomeVal;
  const relVal=parseInt(fv('sc_rel')||'0')||0;
  setPts('sc_rel_pts',relVal);total+=relVal;
  const allPeopleRows=document.querySelectorAll('#sc_age_breakdown > div');
  let allAgesTotal=0;
  allPeopleRows.forEach(function(row){
    var badge=row.querySelector('span:last-child');
    if(badge)allAgesTotal+=parseInt((badge.textContent||'').replace(/[^\-0-9]/g,''))||0;
  });
  if(allPeopleRows.length===0)allAgesTotal=parseInt(fv('sc_age')||'0')||0;
  setPts('sc_child_pts',allAgesTotal);total+=allAgesTotal;
  setPts('sc_age_pts',0);
  const accessScore=fb('sc_access')?livePoints('has_needs'):livePoints('none');
  setPts('sc_access_pts',accessScore);total+=accessScore;
  const moveInVal=parseInt(fv('sc_movein')||'0')||0;
  setPts('sc_movein_pts',moveInVal);total+=moveInVal;
  const homeCondVal=parseInt(fv('sc_homecond')||'0')||0;
  setPts('sc_homecond_pts',homeCondVal);total+=homeCondVal;
  const renosAmt=parseFloat(fv('sc_renos')||'0')||0;
  const renosScore=liveRangeScore('renos_estimate',renosAmt);
  setPts('sc_renos_pts',renosScore);total+=renosScore;
  const arrearsAmt=parseFloat(fv('sc_arrears')||'0')||0;
  const arrearsScore=liveRangeScore('arrears',arrearsAmt);
  setPts('sc_arrears_pts',arrearsScore);total+=arrearsScore;
  const paymentMonths=parseFloat(fv('sc_payment')||'0')||0;
  let paymentScore=0;
  if(arrearsAmt>0&&paymentMonths>0)paymentScore=liveRangeScore('payment_arrangement',paymentMonths);
  setPts('sc_payment_pts',paymentScore);total+=paymentScore;

  // Waitlist
  let waitlistScore=0;
  const scAppDate=document.getElementById('sc_appdate');
  if(scAppDate&&scAppDate.value){
    const yearsWaiting=(new Date()-new Date(scAppDate.value))/(365.25*24*3600*1000);
    waitlistScore=Math.max(0,Math.floor(yearsWaiting))*livePerYearPoints();
  }
  setPts('sc_waitlist_pts',waitlistScore);total+=waitlistScore;

  // Household size (informational)
  const sizeVal=parseInt(fv('sc_size')||'1');
  const sizeInfo=SCORING_RUBRIC.housingSizes[sizeVal]||{};
  const bedroomRec=document.getElementById('sc_bedroom_rec');
  if(bedroomRec)bedroomRec.textContent=sizeInfo.bedrooms||'—';

  // ED Adjustment
  const edAdj=parseInt(document.getElementById('edAdjustment')?document.getElementById('edAdjustment').value||'0':'0')||0;
  const adjustedTotal=total+edAdj;
  const adjustedTier=adjustedTotal>=80?'Critical Priority':adjustedTotal>=60?'High Priority':adjustedTotal>=40?'Medium Priority':'Low Priority';

  const _ts=document.getElementById('totalScore');if(_ts)_ts.textContent=adjustedTotal;
  // Also sync primary display
  const _sct=document.getElementById('sc_score_total');if(_sct)_sct.textContent=adjustedTotal;
  const adjTierEl=document.getElementById('priorityTier');
  if(adjTierEl){
    adjTierEl.textContent=adjustedTier;
    var _tc = adjustedTotal>=80 ? {bg:'#0d2d1a',col:'#4ade80'}
            : adjustedTotal>=60 ? {bg:'#0d2040',col:'#93c5fd'}
            : adjustedTotal>=40 ? {bg:'#3d3000',col:'#fcd34d'}
            : {bg:'#3d1515',col:'#f87171'};
    adjTierEl.style.background = _tc.bg;
    adjTierEl.style.color      = _tc.col;
  }
  const adjBar=document.getElementById('scoreBarFill');
  if(adjBar)adjBar.style.width=Math.min(100,Math.round(adjustedTotal))+'%';
  // Update rubric data
  if(window._rubricData){
    window._rubricData.renos=renosScore;
    window._rubricData.arrears=arrearsScore;
    window._rubricData.payment=paymentScore;
    window._rubricData.waitlist=waitlistScore;
    renderRubricTable(window._rubricData);
  }

  window._appScore={
    total:adjustedTotal,rubricTotal:total,edAdjustment:edAdj,
    edAdjustReason:document.getElementById('edAdjustReason')?document.getElementById('edAdjustReason').value||'':'',
    edNotes:document.getElementById('edNotes')?document.getElementById('edNotes').value||'':'',
    tier:adjustedTier,
    breakdown:{
      waitlist:waitlistScore,reserve:reserveScore,band:bandCount,income:incomeVal,
      relation:relVal,ages:allAgesTotal,access:accessScore,moveIn:moveInVal,
      homeCond:homeCondVal,renos:renosScore,arrears:arrearsScore,payment:paymentScore,
      edAdjustment:edAdj,edAdjustReason:document.getElementById('edAdjustReason')?document.getElementById('edAdjustReason').value||'':'',
    }
  };
}

// ── renderRubricTable (V1 — kept for compatibility) ──
function renderRubricTable(scores, targetEl) {
  // V2 scoring is now handled by renderRubricTableV2
  // This stub is kept so any legacy calls don't error
  if (window._lastScoreResult) {
    renderRubricTableV2(window._lastScoreResult.breakdown, targetEl);
  }
}

// ── renderRubricTableV2 — V2 scoring model display ──
function renderRubricTableV2(breakdown, targetEl) {
  var el = targetEl || document.getElementById('sc_rubric_rows');
  if (!el || !breakdown) return;
  var sA = breakdown.sectionA || {};
  var sB = breakdown.sectionB || {};
  var arrDed = breakdown.arrears || 0;
  var edAdj  = breakdown.edAdjustment || 0;

  function sectionHeader(label, total, maxPts) {
    var pct = maxPts > 0 ? Math.round((total / maxPts) * 100) : 0;
    return '<div style="padding:10px 18px;background:#1c1c1a;border-bottom:2px solid var(--yellow);display:flex;align-items:center;justify-content:space-between;">'
      + '<div style="font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#888;">' + label + '</div>'
      + '<div style="font-size:13px;font-weight:700;color:var(--yellow);">' + total + ' <span style="font-size:10px;color:#666;">/ ' + maxPts + ' pts</span></div>'
      + '</div>';
  }

  function row(label, pts, maxPts, value, note) {
    var pos  = pts > 0;
    var neg  = pts < 0;
    var col  = pos ? '#15803d' : neg ? '#b91c1c' : '#888';
    var bg   = pos ? 'rgba(21,128,61,0.15)' : neg ? 'rgba(185,28,28,0.15)' : 'var(--bg)';
    var sign = pts > 0 ? '+' : '';
    var pct  = maxPts > 0 ? Math.round(Math.abs(pts) / maxPts * 100) : 0;
    return '<div style="padding:12px 18px;border-bottom:1px solid var(--border);">'
      + '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">'
      +   '<div>'
      +     '<div class="js-txt-bold">' + label + '</div>'
      +     (value ? '<div class="js-lbl-sm" class="mt-4">→ ' + value + '</div>' : '')
      +     (note  ? '<div style="font-size:10px;color:var(--muted);margin-top:4px;font-style:italic;">' + note + '</div>' : '')
      +   '</div>'
      +   '<div style="flex-shrink:0;text-align:right;">'
      +     '<span style="display:inline-block;min-width:46px;text-align:center;font-size:18px;font-weight:700;padding:4px 10px;border-radius:7px;background:' + bg + ';color:' + col + ';">' + sign + pts + '</span>'
      +     (maxPts ? '<div style="font-size:10px;color:#555;margin-top:2px;">max ' + maxPts + '</div>' : '')
      +   '</div>'
      + '</div>'
      + '</div>';
  }

  var urgentLabels = {
    domestic_violence:'Domestic violence (verified)', fire_disaster:'Fire / disaster (verified)',
    homeless_eviction:'Homelessness / eviction', eviction_risk:'Eviction risk from landlord',
    separation:'Separation / divorce', none:'No urgent need'
  };
  var healthLabels  = { severe:'Severe / imminent risk', moderate:'Moderate risk', minor:'Minor risk', none:'None' };
  var rentLabels    = { excellent:'Consistently on time 12+ months', mostly:'Mostly on time',
                        occasional:'Occasionally late', frequent:'Frequently late', no_history:'No prior tenancy (neutral)' };
  var condLabels    = { excellent:'Excellent — no damage', good:'Good', fair:'Fair',
                        damage:'Damage noted', no_history:'No prior tenancy (neutral)' };
  var conductLabels = { clean:'No complaints / violations 2 yrs', minor:'Minor complaints, resolved',
                        unresolved:'Ongoing unresolved complaints', no_history:'No prior tenancy (neutral)' };
  var incLabels     = { stable:'Stable income', irregular:'Irregular income', none:'No income' };
  var arrLabels     = { none:'No arrears', cleared:'Arrears cleared', repayment:'Active repayment plan', no_repayment:'Arrears, no repayment plan' };

  var urgentKey = (window._lastScoreResult && window._lastScoreResult.breakdown) ? '' : '';
  var html = '';

  // Section A
  html += sectionHeader('Section A — Housing Need', sA.total || 0, 70);
  html += row('Urgent Need / Displacement', sA.urgent || 0, 20, urgentLabels[(window._v2AppData||{}).urgentNeed || 'none'], 'Documentation required for points above 0');
  html += row('Health & Safety Risk', sA.health || 0, 15, healthLabels[(window._v2AppData||{}).healthRisk || 'none'], 'Verified by inspection or public health order');
  html += row('Overcrowding', sA.overcrowding || 0, 10, ((sA.overcrowding||0) + ' person' + (sA.overcrowding!==1?'s':'')+' over standard'), '1 pt per person over national occupancy standard');
  html += row('Household Composition', sA.household || 0, 10, '', 'Dependents under 18 (1 pt each, max 5) · Elder +3 · Lone parent +3 · Disability +2');
  html += row('Accessibility / Medical Need', sA.accessibility || 0, 10, '', 'Verified medical documentation required');
  html += row('Waitlist Time', sA.waitlist || 0, 5, (sA.waitlist||0) + ' year' + (sA.waitlist!==1?'s':'') + ' on waitlist', '1 pt per full year, maximum 5 pts');

  // Section B
  html += sectionHeader('Section B — Tenant Responsibility', sB.total || 0, 30);
  html += row('Rent Payment History', sB.rent || 0, 10, rentLabels[(window._v2AppData||{}).rentPaymentHistory || 'no_history'], 'Neutral baseline 6 pts for new applicants');
  html += row('Unit Condition / No Damage', sB.condition || 0, 10, condLabels[(window._v2AppData||{}).unitCondition || 'no_history'], 'Neutral baseline 7 pts for new applicants');
  html += row('Tenancy Conduct', sB.conduct || 0, 5, conductLabels[(window._v2AppData||{}).tenancyConduct || 'no_history'], 'Neutral baseline 4 pts for new applicants');
  html += row('Income Stability', sB.income || 0, 5, incLabels[(window._v2AppData||{}).incomeStability || 'stable'], 'All stable sources treated equally');

  // Section C
  html += sectionHeader('Section C — Arrears', arrDed, 0);
  html += row('Arrears Status', arrDed, 10, arrLabels[(window._v2AppData||{}).arrearsStatus || 'none'], 'Active repayment plan: −5 · No plan: −10 · None or cleared: 0');

  // ED Adjustment
  if (edAdj !== 0) {
    html += sectionHeader('ED Adjustment', edAdj, 0);
    html += row('Executive Director Adjustment', edAdj, 20, '', 'Manual override by Executive Director');
  }

  // Score floor note
  html += '<div style="padding:10px 18px;font-size:11px;color:var(--muted);font-style:italic;border-top:1px solid var(--border);">Score floor: 0. Even with maximum arrears deduction, the reported score cannot go below zero.</div>';

  el.innerHTML = html;
}
function calcDuration(startInput) {
  var row      = startInput.closest('[data-grp]') || startInput.closest('.rrow');
  if(!row) return;
  var durInput = row.querySelector('[data-role="duration"]');
  if(!durInput) return;

  var startVal = startInput.value;
  if(!startVal) { durInput.value = ''; return; }

  var start = new Date(startVal);
  var today = new Date();

  if(isNaN(start.getTime()) || start > today) { durInput.value = ''; return; }

  var years  = today.getFullYear() - start.getFullYear();
  var months = today.getMonth()    - start.getMonth();

  if(months < 0) { years--; months += 12; }

  var parts = [];
  if(years  > 0) parts.push(years  + ' yr'  + (years  !== 1 ? 's' : ''));
  if(months > 0) parts.push(months + ' mo'  + (months !== 1 ? 's' : ''));
  if(!parts.length) parts.push('< 1 month');

  durInput.value = parts.join(' ');
}

// ── SP Data (v9) ──
const SAMPLE_DATA_VERSION='10';
const SP_APPLICATIONS=[];
const SAMPLE_APPLICATIONS=SP_APPLICATIONS;

// ── Housing Unit Inventory (from SharePoint — 262 units) ──
const HOUSING_UNITS_DATA=[];
let housingUnits=[];
(function(){
  var stored=null; // RESET_v2 - localStorage.getItem('clfn_housing_units');
  if(stored){try{housingUnits=JSON.parse(stored);}catch(e){housingUnits=HOUSING_UNITS_DATA.slice();}}
  else{housingUnits=HOUSING_UNITS_DATA.slice();}
})();

// ── Audit Log ──
var auditLog=[];
(function(){
  auditLog = []; // audit log is now in Supabase housing_audit_log
})();


// ══════════════════════════════════════════════════════════════
// ARCHIVE SYSTEM
// ══════════════════════════════════════════════════════════════

// Collect all unit-linked documents into one bundle object
function _bundleUnitDocs(unitId) {
  var bundle = {};
  var keys = ['clfn_sow_','clfn_reno_progress_','clfn_reno_budget_','clfn_tenant_files_','clfn_unit_photos_'];
  keys.forEach(function(k) {
    try {
      var raw = null; // data now in Supabase
      if(raw && raw !== 'null') bundle[k + unitId] = raw;
    } catch(e) {}
  });
  return bundle;
}

// Archive an APPLICATION — bundles any linked unit documents before archiving
function archiveApplication(appId) {
  var idx = applications.findIndex(function(a){ return a.id === appId; });
  if(idx === -1) { showToast('Application not found'); return; }
  var role = window.currentRole || 'staff';
  var app  = applications[idx];
  var linkedUnitId = app.assignedUnit || app.assignedUnitId || null;
  if(linkedUnitId) {
    app.archivedUnitDocs = _bundleUnitDocs(linkedUnitId);
  }
  app.archived   = true;
  app.archivedAt = new Date().toISOString().split('T')[0];
  app.archivedBy = role;
  sbSaveApplication(app).catch(function(e){ console.warn('Archive save failed:',e); });
  auditEntry(appId, 'archived',
    'Application archived' + (linkedUnitId ? ' — unit docs bundled for ' + linkedUnitId : ''),
    role);
  updateDashStats(); renderDashTable();
  showToast('Application and supporting documents archived');
}

// Archive a UNIT (demolition) — bundles all docs, marks archived, auto-archives linked apps
function archiveUnit(unitId) {
  var units = (typeof housingUnits !== 'undefined' && housingUnits.length) ? housingUnits : (window.HOUSING_UNITS_DATA || []);
  var u = units.find(function(x){ return x.id === unitId; });
  if(!u) { showToast('Unit not found'); return; }
  var role = window.currentRole || 'staff';
  var addr = u.num + ' ' + u.street;
  if(!confirm('Archive ' + addr + '?\n\nThis marks the unit as demolished. All documentation (SOW, renovation progress, tenant files, photos) will be preserved in the archive record. The unit will be hidden from active inventory.')) return;
  u.unitArchive = {
    archivedAt: new Date().toISOString(),
    archivedBy: role,
    reason: 'Demolished / Removed from active inventory',
    docs: _bundleUnitDocs(unitId)
  };
  u.archived   = true;
  u.archivedAt = new Date().toISOString().split('T')[0];
  u.archivedBy = role;
  u.status     = APP_STATUS.ARCHIVED;
  // Also archive any linked applications
  applications.forEach(function(a, ai) {
    if((a.assignedUnit === unitId || a.assignedUnitId === unitId) && !a.archived) {
      applications[ai].archived       = true;
      applications[ai].archivedAt     = u.archivedAt;
      applications[ai].archivedBy     = role;
      applications[ai].archivedReason = 'Unit ' + addr + ' archived (demolished)';
      auditEntry(a.id, 'archived', 'Auto-archived — linked unit ' + addr + ' demolished', role);
    }
  });
  sbSaveUnit(u).catch(function(e){ console.warn('Unit archive save failed:',e); });
  applications.forEach(function(a){
    if(a.archived && (a.assignedUnit===unitId||a.assignedUnitId===unitId)){
      sbSaveApplication(a).catch(function(e){ console.warn('Linked app archive save failed:',e); });
    }
  });
  auditEntry('UNIT:' + unitId, 'unit_archived',
    addr + ' archived — ' + Object.keys(u.unitArchive.docs).length + ' document(s) preserved', role);
  closeUnitEditModal();
  renderInventoryView();
  if(typeof updateDashStats === 'function') updateDashStats();
  showToast('Unit archived — all documents preserved');
}

// Restore a UNIT from archive
function unarchiveUnit(unitId) {
  var units = (typeof housingUnits !== 'undefined' && housingUnits.length) ? housingUnits : (window.HOUSING_UNITS_DATA || []);
  var u = units.find(function(x){ return x.id === unitId; });
  if(!u) { showToast('Unit not found'); return; }
  var role = window.currentRole || 'staff';
  var addr = u.num + ' ' + u.street;
  if(!confirm('Restore ' + addr + ' from archive?\n\nThe unit will return to active inventory with status Vacant. Archived documents remain attached to the unit record.')) return;
  u.archived   = false;
  u.archivedAt = null;
  u.archivedBy = null;
  u.status     = 'vacant';
  u.assignedTo = null; u.assignedName = null; u.assignedDate = null;
  sbSaveUnit(u).catch(function(e){ console.warn('Unarchive unit save failed:',e); });
  auditEntry('UNIT:' + unitId, 'unit_unarchived', addr + ' restored from archive to Vacant', role);
  closeUnitEditModal();
  renderInventoryView();
  showToast(addr + ' restored to active inventory');
}


let applications=[];
let dashView=false;

// Load or init applications
// Applications loaded from Supabase on login (loadAppDataFromSupabase)
// Sample data is only used as fallback if Supabase is unavailable

// ── Score popup ──
// When a user clicks a score cell on the dashboard, route to the full V2 scorecard view
// (the legacy #scorePopup modal DOM was removed but the click handlers survived).
window._openScoreByEl=function(el){
  var id=el.getAttribute('data-score-id');
  window._openScoreById(id);
};
window._openScoreById=function(id){
  var app=null;
  for(var i=0;i<applications.length;i++){if(applications[i].id===id){app=applications[i];break;}}
  if(!app)return;
  if(true) showScorecard(app);
};

// ── Tier/score helpers ──
function scoreMiniBar(score) {
  var pct = Math.min(100, Math.max(0, Math.round((score || 0) / 100 * 100)));
  var color = score >= 80 ? '#b91c1c' : score >= 60 ? '#1d4ed8' : score >= 40 ? '#7a6000' : '#15803d';
  return '<div style="height:3px;width:48px;background:var(--border);border-radius:2px;margin-top:3px;">'
       + '<div style="height:100%;width:'+pct+'%;background:'+color+';border-radius:2px;"></div></div>';
}

function tierColor(tier){
  if(tier==='Critical Priority')return{bg:'#f0fdf4',c:'#15803d'};
  if(tier==='High Priority')return{bg:'#e8eef5',c:'#1e3a5f'};
  if(tier==='Medium Priority')return{bg:'#fef9ec',c:'#7a6000'};
  return{bg:'#fef2f2',c:'#b91c1c'};
}


// ── Unit matching + Reno priority models ──────────────────────────────────

var DEFAULT_UNIT_SCORE_MODEL = [
  {id:'bed_exact',   factor:'Bedroom Fit',       condition:'Exact match',             pts:10, max:10, group:'bed', editable:true,  notes:'Unit bedrooms = household need'},
  {id:'bed_larger',  factor:'Bedroom Fit',       condition:'Larger than needed',      pts:5,  max:10, group:'bed', editable:true,  notes:'Unit has more beds than needed'},
  {id:'bed_one_short',factor:'Bedroom Fit',      condition:'One bedroom short',       pts:3,  max:10, group:'bed', editable:true,  notes:'Unit is 1 bed under household need'},
  {id:'bed_insuff',  factor:'Bedroom Fit',       condition:'Insufficient bedrooms',   pts:0,  max:10, group:'bed', editable:false, notes:'2+ beds under need (no points)'},
  {id:'acc_met',     factor:'Accessibility',     condition:'Need met by unit',        pts:8,  max:8,  group:'acc', editable:true,  notes:'Applicant needs accessible unit and unit qualifies'},
  {id:'acc_unmet',   factor:'Accessibility',     condition:'Need not met (penalty)',  pts:-4, max:8,  group:'acc', editable:true,  notes:'Applicant needs accessible unit but unit does not qualify'},
  {id:'acc_na',      factor:'Accessibility',     condition:'Not required',            pts:0,  max:8,  group:'acc', editable:false, notes:'No accessibility need'},
  {id:'eld_matched', factor:'Elders Eligibility',condition:'Eligible + Elders unit',  pts:6,  max:6,  group:'eld', editable:true,  notes:'Applicant is 55+ and unit is Elders Unit'},
  {id:'eld_ineligible',factor:'Elders Eligibility',condition:'Not eligible (penalty)',pts:-2, max:6,  group:'eld', editable:true,  notes:'Applicant under 55 but unit is Elders Unit'},
  {id:'eld_standard',factor:'Elders Eligibility',condition:'Eligible, standard unit', pts:0,  max:6,  group:'eld', editable:false, notes:'Applicant is 55+ but standard unit'},
  {id:'eld_na',      factor:'Elders Eligibility',condition:'Not applicable',           pts:0,  max:6,  group:'eld', editable:false, notes:'Applicant under 55, standard unit'},
];






// ══ RENOVATION PRIORITY SCORING MODEL ══════════════════════════════════════
var RENO_SCORE_KEY = 'clfn_reno_score_model_v3'; // v3 — conduct scores now negative

var DEFAULT_RENO_SCORE_MODEL = [
  // Unit Condition (from unit record)
  {id:'rs_cond_critical', group:'condition', factor:'Unit Condition', condition:'Condemned / Critical',         pts:20, editable:true,  notes:'Unit status is condemned'},
  {id:'rs_cond_poor',     group:'condition', factor:'Unit Condition', condition:'Poor — major repairs needed',  pts:15, editable:true,  notes:'Home condition rated Poor'},
  {id:'rs_cond_average',  group:'condition', factor:'Unit Condition', condition:'Average — minor wear',         pts:8,  editable:true,  notes:'Home condition rated Average'},
  {id:'rs_cond_good',     group:'condition', factor:'Unit Condition', condition:'Good — well maintained',       pts:2,  editable:true,  notes:'Home condition rated Good'},
  // Critical Systems (from SOW line items — additive, each system that appears in SOW adds points)
  {id:'rs_sys_furnace',   group:'systems',   factor:'Critical Systems (additive)', condition:'Furnace / Heating system',      pts:14, editable:true,  notes:'SOW contains Heating / HVAC work'},
  {id:'rs_sys_hvac',      group:'systems',   factor:'Critical Systems (additive)', condition:'HVAC / Ventilation',            pts:12, editable:true,  notes:'SOW contains HVAC / Ventilation work'},
  {id:'rs_sys_electrical',group:'systems',   factor:'Critical Systems (additive)', condition:'Electrical system',             pts:13, editable:true,  notes:'SOW contains Electrical work'},
  {id:'rs_sys_roof',      group:'systems',   factor:'Critical Systems (additive)', condition:'Roof replacement / repair',     pts:15, editable:true,  notes:'SOW contains Roofing work'},
  {id:'rs_sys_windows',   group:'systems',   factor:'Critical Systems (additive)', condition:'Exterior windows & doors',      pts:10, editable:true,  notes:'SOW contains Windows & Doors work'},
  // SOW Cost (from Scope of Work)
  {id:'rs_cost_5',        group:'cost',      factor:'SOW Est. Cost',  condition:'$50,000+',                    pts:18, editable:true,  notes:'Major renovation — highest urgency'},
  {id:'rs_cost_4',        group:'cost',      factor:'SOW Est. Cost',  condition:'$25,001 – $50,000',           pts:14, editable:true,  notes:'Significant renovation'},
  {id:'rs_cost_3',        group:'cost',      factor:'SOW Est. Cost',  condition:'$10,001 – $25,000',           pts:10, editable:true,  notes:'Moderate renovation'},
  {id:'rs_cost_2',        group:'cost',      factor:'SOW Est. Cost',  condition:'$2,501 – $10,000',            pts:5,  editable:true,  notes:'Minor repairs'},
  {id:'rs_cost_1',        group:'cost',      factor:'SOW Est. Cost',  condition:'$0 – $2,500',                 pts:2,  editable:true,  notes:'Routine maintenance'},
  // Health & Safety Concerns (from SOW checkboxes — each adds points, higher = more urgent)
  {id:'rs_haz_mold',      group:'hazard',    factor:'Health & Safety Concerns (additive)', condition:'Mould / Mildew',              pts:8,  editable:true,  notes:'Health risk — increases reno urgency'},
  {id:'rs_haz_asbestos',  group:'hazard',    factor:'Health & Safety Concerns (additive)', condition:'Asbestos Risk',               pts:12, editable:true,  notes:'Serious health hazard — high urgency'},
  {id:'rs_haz_electrical',group:'hazard',    factor:'Health & Safety Concerns (additive)', condition:'Electrical Hazard',           pts:10, editable:true,  notes:'Fire/safety risk — high urgency'},
  {id:'rs_haz_structural',group:'hazard',    factor:'Health & Safety Concerns (additive)', condition:'Structural Concern',          pts:10, editable:true,  notes:'Structural failure risk — high urgency'},
  {id:'rs_haz_plumbing',  group:'hazard',    factor:'Health & Safety Concerns (additive)', condition:'Plumbing/Sewage',             pts:7,  editable:true,  notes:'Health/sanitation risk'},
  {id:'rs_haz_fire',      group:'hazard',    factor:'Health & Safety Concerns (additive)', condition:'Fire Safety',                 pts:12, editable:true,  notes:'Fire safety risk — high urgency'},
  // SOW Scope (number of line items — additive)
  {id:'rs_items_5',       group:'scope',     factor:'SOW Scope',      condition:'10+ work items',              pts:8,  editable:true,  notes:'Very broad scope'},
  {id:'rs_items_4',       group:'scope',     factor:'SOW Scope',      condition:'6 – 9 work items',            pts:5,  editable:true,  notes:'Broad scope'},
  {id:'rs_items_3',       group:'scope',     factor:'SOW Scope',      condition:'3 – 5 work items',            pts:3,  editable:true,  notes:'Moderate scope'},
  {id:'rs_items_2',       group:'scope',     factor:'SOW Scope',      condition:'1 – 2 work items',            pts:1,  editable:true,  notes:'Targeted repair'},
  {id:'rs_items_1',       group:'scope',     factor:'SOW Scope',      condition:'No SOW filed',                pts:0,  editable:false, notes:'No scope of work submitted'},
  // Occupancy impact
  {id:'rs_occ_displaced', group:'occupancy', factor:'Occupancy',      condition:'Tenant displaced (under repair)', pts:10, editable:true,  notes:'Unit status is under_repair with tenant'},
  {id:'rs_occ_condemned', group:'occupancy', factor:'Occupancy',      condition:'Condemned — uninhabitable',   pts:12, editable:true,  notes:'Unit is condemned'},
  {id:'rs_occ_vacant',    group:'occupancy', factor:'Occupancy',      condition:'Vacant — no tenant impact',   pts:3,  editable:true,  notes:'Unit is vacant'},
  {id:'rs_occ_occupied',  group:'occupancy', factor:'Occupancy',      condition:'Occupied — tenant in place',  pts:0,  editable:false, notes:'Active tenant — lower urgency'},
  // Tenant Accountability — Damage & Conduct (increases urgency — unit needs repair because of tenant)
  {id:'rs_ten_damage',    group:'conduct',   factor:'Tenant Conduct — Damage (additive)', condition:'Damage caused by tenant',     pts:-12, editable:true,  notes:'Tenant caused damage — reduces reno priority'},
  {id:'rs_ten_negligence',group:'conduct',   factor:'Tenant Conduct — Damage (additive)', condition:'Negligence (failure to maintain/report)', pts:-10, editable:true, notes:'Failure to maintain or report — reduces priority'},
  {id:'rs_ten_vandalism', group:'conduct',   factor:'Tenant Conduct — Damage (additive)', condition:'Vandalism',                   pts:-15, editable:true,  notes:'Intentional damage — tenant liability reduces priority'},
  {id:'rs_ten_police',    group:'conduct',   factor:'Tenant Conduct — Damage (additive)', condition:'Police report on file',       pts:-5,  editable:true,  notes:'Police involvement — reduces reno priority'},
  // Tenant Arrears — mirrors housing app scoring but as penalty (negative points = lower priority)
  // A payment plan reduces the penalty, mirroring the payment arrangement bonus in the housing app
  {id:'rs_arr_0',         group:'arrears',   factor:'Tenant Arrears',  condition:'$0 — no arrears',             pts:0,  editable:false, notes:'No arrears — no impact on score'},
  {id:'rs_arr_1',         group:'arrears',   factor:'Tenant Arrears',  condition:'$1 – $500',                   pts:0,  editable:true,  notes:'Minor arrears — no penalty'},
  {id:'rs_arr_2',         group:'arrears',   factor:'Tenant Arrears',  condition:'$501 – $1,500',               pts:-1, editable:true,  notes:'Mirrors housing app arrears score'},
  {id:'rs_arr_3',         group:'arrears',   factor:'Tenant Arrears',  condition:'$1,501 – $3,000',             pts:-2, editable:true,  notes:'Mirrors housing app arrears score'},
  {id:'rs_arr_4',         group:'arrears',   factor:'Tenant Arrears',  condition:'$3,001 – $5,000',             pts:-3, editable:true,  notes:'Mirrors housing app arrears score'},
  {id:'rs_arr_5',         group:'arrears',   factor:'Tenant Arrears',  condition:'$5,001+',                     pts:-5, editable:true,  notes:'Mirrors housing app arrears score'},
  // Payment arrangement — mirrors housing app: shorter plan = larger bonus that offsets arrears penalty
  {id:'rs_pay_1',         group:'arrears',   factor:'Tenant Arrears',  condition:'Payment plan 0–12 months',    pts:5,  editable:true,  notes:'Mirrors payment arrangement bonus — short plan reduces penalty most'},
  {id:'rs_pay_2',         group:'arrears',   factor:'Tenant Arrears',  condition:'Payment plan 13–36 months',   pts:4,  editable:true,  notes:'Mirrors payment arrangement bonus'},
  {id:'rs_pay_3',         group:'arrears',   factor:'Tenant Arrears',  condition:'Payment plan 37–60 months',   pts:3,  editable:true,  notes:'Mirrors payment arrangement bonus'},
  {id:'rs_pay_4',         group:'arrears',   factor:'Tenant Arrears',  condition:'Payment plan 61–120 months',  pts:2,  editable:true,  notes:'Mirrors payment arrangement bonus'},
  {id:'rs_pay_5',         group:'arrears',   factor:'Tenant Arrears',  condition:'Payment plan 121–180 months', pts:1,  editable:true,  notes:'Mirrors payment arrangement bonus'},
  {id:'rs_pay_6',         group:'arrears',   factor:'Tenant Arrears',  condition:'Payment plan 181+ months',    pts:0,  editable:true,  notes:'Very long plan — no bonus'},
];









// ── Calculate renovation priority score for a unit ──────────────────────────




// ── Render score badge in the progress modal ─────────────────────────────────


// ══ END RENOVATION SCORING ═══════════════════════════════════════════════════

// ══ RENOVATION BUDGET APPROVAL ═══════════════════════════════════════════════

// Funding rules by funder type
var RENO_FUND_RULES = {
  'ISC':        { pools:['rrap','band','ofnlp'],         label:'ISC House',         rule:'Eligible: RRAP Funds + Band Funds + OFNLP' },
  'CMHC_95':    { pools:['cmhc','band','ofnlp'],         label:'CMHC Section 95',   rule:'Eligible: CMHC Replacement Funds + Band Funds + OFNLP' },
  'CMHC_56':    { pools:['cmhc','band','ofnlp'],         label:'CMHC Section 56.1', rule:'Eligible: CMHC Replacement Funds + Band Funds + OFNLP' },
  'rent_to_own':{ pools:['rrap','isc','band','ofnlp'],   label:'Rent-to-Own',       rule:'Eligible: RRAP + ISC + Band Funds + OFNLP. Tenant repayment expected.', repayment:true },
  '':           { pools:['band','ofnlp'],                label:'Band / None',       rule:'Eligible: Band Funds + OFNLP (all units eligible for OFNLP)' },
};

// Critical system SOW categories — must be funded first
var CRITICAL_SOW_CATS = ['Heating / HVAC','Electrical','Roofing','Windows & Doors','Plumbing'];











// ══ END RENOVATION BUDGET APPROVAL ═══════════════════════════════════════════


// ── rescoreAllApplications ────────────────────────────────────────────────────
// Re-score every application in the global array using the current V2 model.
// Called after scoring model changes or on data load.
async function rescoreAllApplications() {
  if (!window.applications || !window.applications.length) return;
  window.applications.forEach(function(app) {
    try {
      var result = scoreApplicationLocally(app);
      if (result) {
        app.score = result.score;
        app.tier  = result.tier;
      }
    } catch(e) { /* skip individual failures silently */ }
  });
}

// ── Default model initialisers ────────────────────────────────────────────────
// These are used only when Supabase settings haven't loaded yet.
// The real values come from housing_settings on login.
if (typeof DEFAULT_SCORING_MODEL === 'undefined') {
  window.DEFAULT_SCORING_MODEL = [];
}
// ── DEFAULT_V2_SCORE_MODEL — full default point values ────────────────────────
window.DEFAULT_V2_SCORE_MODEL = {
  urgent_need: {
    domestic_violence: 25, fire_disaster: 25, homeless_eviction: 20,
    eviction_risk: 15, separation: 10, none: 0
  },
  health_risk: {
    severe: 20, moderate: 12, minor: 6, none: 0
  },
  household: {
    per_dependent_u18: 2, max_dependents: 10, elder: 5,
    lone_parent: 5, disability: 5, max_total: 20
  },
  accessibility: {
    high: 10, moderate: 5, none: 0
  },
  rent_payment: {
    excellent: 10, mostly: 6, occasional: 2, frequent: -5, no_history: 0
  },
  unit_condition: {
    excellent: 5, good: 3, fair: 1, damage: -5, no_history: 0
  },
  tenancy_conduct: {
    clean: 5, minor: 2, unresolved: -10, no_history: 0
  },
  income_stability: {
    stable: 5, irregular: 2, none: 0
  },
  arrears: {
    none: 5, cleared: 3, repayment: 1, no_repayment: -10
  }
};

// Initialise liveV2ScoreModel from DEFAULT_V2_SCORE_MODEL if not yet set
if (!window.liveV2ScoreModel || !Object.keys(window.liveV2ScoreModel).length) {
  window.liveV2ScoreModel = JSON.parse(JSON.stringify(window.DEFAULT_V2_SCORE_MODEL));
}

// Initialise liveScoreModel from DEFAULT_SCORING_MODEL
if (!window.liveScoreModel && window.DEFAULT_SCORING_MODEL.length) {
  window.liveScoreModel = DEFAULT_SCORING_MODEL.map(function(r) {
    return Object.assign({}, r);
  });
}

// ── Built-in V1-format fallback for buildV2FormSelects ───────────────────────
// DEFAULT_SCORING_MODEL is intentionally empty (model comes from Supabase).
// If Supabase hasn't loaded the model yet (or was never saved), seed
// liveScoreModel so New Application form dropdowns always have labelled options.
if (!window.liveScoreModel || !window.liveScoreModel.length) {
  var _v2 = window.DEFAULT_V2_SCORE_MODEL || {};
  var _un = _v2.urgent_need || {};
  var _hr = _v2.health_risk || {};
  var _is = _v2.income_stability || {};
  window.liveScoreModel = [
    {id:'un1', cat:'urgent_need',      label:'None',                        pts: _un.none              || 0},
    {id:'un2', cat:'urgent_need',      label:'Overcrowding',                pts: _un.eviction_risk     || 15},
    {id:'un3', cat:'urgent_need',      label:'Eviction / Homelessness Risk',pts: _un.homeless_eviction || 20},
    {id:'un4', cat:'urgent_need',      label:'Emergency (fire / DV)',       pts: _un.domestic_violence || 25},
    {id:'hs1', cat:'health_safety',    label:'None',                        pts: _hr.none              || 0},
    {id:'hs2', cat:'health_safety',    label:'Minor',                       pts: _hr.minor             || 6},
    {id:'hs3', cat:'health_safety',    label:'Moderate',                    pts: _hr.moderate          || 12},
    {id:'hs4', cat:'health_safety',    label:'Severe',                      pts: _hr.severe            || 20},
    {id:'is1', cat:'income_stability', label:'Stable income',               pts: _is.stable            || 5},
    {id:'is2', cat:'income_stability', label:'Unstable / irregular',        pts: _is.irregular         || 2},
    {id:'hc1', cat:'household_comp',   label:'Lone parent',                 pts: (_v2.household||{}).lone_parent        || 5},
    {id:'hc2', cat:'household_comp',   label:'Elder household',             pts: (_v2.household||{}).elder              || 5},
    {id:'hc3', cat:'household_comp',   label:'Disability',                  pts: (_v2.household||{}).disability         || 5},
    {id:'oc1', cat:'occupancy',        label:'Per person over NOS',         pts: (_v2.household||{}).per_dependent_u18  || 2},
  ];
}
