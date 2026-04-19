// ── Legacy V1 scoring model (used by liveScoreModel fallback) ─
var DEFAULT_SCORING_MODEL = [
  // ── Urgent Need / Displacement ──────────────────────────────────────────────
  {id:'un1', cat:'urgent_need',    label:'No urgent need',                        pts:0,  p:0},
  {id:'un2', cat:'urgent_need',    label:'Unsafe / overcrowded conditions',       pts:5,  p:5},
  {id:'un3', cat:'urgent_need',    label:'Eviction / displacement / fire / flood',pts:8,  p:8},
  {id:'un4', cat:'urgent_need',    label:'Immediate health / safety emergency',   pts:10, p:10},

  // ── Health & Safety Risk ─────────────────────────────────────────────────────
  {id:'hs1', cat:'health_safety',  label:'None',                                  pts:0,  p:0},
  {id:'hs2', cat:'health_safety',  label:'Minor risk — cosmetic / low priority',  pts:2,  p:2},
  {id:'hs3', cat:'health_safety',  label:'Moderate risk — verified by report',    pts:5,  p:5},
  {id:'hs4', cat:'health_safety',  label:'Severe risk — structural / health order',pts:8, p:8},

  // ── Persons Over Occupancy Standard ─────────────────────────────────────────
  {id:'oc1', cat:'occupancy',      label:'1 pt per person over NOS (max 10 pts)', pts:1,  p:1},

  // ── Income Stability ─────────────────────────────────────────────────────────
  {id:'is1', cat:'income_stability', label:'Stable income — employment, pension, social assistance', pts:5, p:5},
  {id:'is2', cat:'income_stability', label:'Unstable / no income',                pts:0,  p:0},

  // ── Household Composition ────────────────────────────────────────────────────
  {id:'hc1', cat:'household_comp', label:'Lone parent household',                 pts:3,  p:3},
  {id:'hc2', cat:'household_comp', label:'Elder in household (55+)',              pts:3,  p:3},
  {id:'hc3', cat:'household_comp', label:'Household member with disability',      pts:2,  p:2},

  // ── Prior CLFN Tenancy ───────────────────────────────────────────────────────
  {id:'pt1', cat:'prior_tenancy',  label:'No prior tenancy — first-time applicant (neutral)', pts:0,  p:0},
  {id:'pt2', cat:'prior_tenancy',  label:'Good standing — positive tenancy history',          pts:3,  p:3},
  {id:'pt3', cat:'prior_tenancy',  label:'Mixed record — minor issues',                       pts:1,  p:1},
  {id:'pt4', cat:'prior_tenancy',  label:'Poor standing — arrears or damage on file',         pts:-2, p:-2},

  // ── Application Age (Waitlist Duration) ──────────────────────────────────────
  {id:'wa1', cat:'waitlist_age',   label:'1 point per full year on waitlist',     pts:1,  p:1}
];

/* ================================================================
 * scoring.js — CLFN Housing Suite
 * Application scoring model: defaults, live model, tier helpers,
 * rescore engine, and mini score bar renderer.
 *
 * Depends on: shared-data.js (applications, housingUnits globals)
 * Load order: after shared-data.js, before housing.html inline scripts
 * ================================================================ */


var DEFAULT_V2_SCORE_MODEL = {
  // Section A — Housing Need
  urgent_need:    { domestic_violence: 20, fire_disaster: 20, homeless_eviction: 15, eviction_risk: 10, separation: 10, none: 0 },
  health_risk:    { severe: 15, moderate: 10, minor: 5, none: 0 },
  overcrowding:   { per_person: 1, max: 10 },
  household:      { per_dependent_u18: 1, max_dependents: 5, elder: 3, lone_parent: 3, disability: 2, max_total: 10 },
  accessibility:  { high: 10, moderate: 5, none: 0 },
  waitlist:       { per_year: 1, max: 5 },
  // Section B — Tenant Responsibility
  rent_payment:   { excellent: 10, mostly: 7, occasional: 5, frequent: 0, no_history: 6 },
  unit_condition: { excellent: 10, good: 7, fair: 4, damage: 0, no_history: 7 },
  tenancy_conduct:{ clean: 5, minor: 3, unresolved: 0, no_history: 4 },
  income_stability:{ stable: 5, irregular: 2, none: 0 },
  // Section C — Arrears Deduction
  arrears:        { none: 0, cleared: 0, repayment: -5, no_repayment: -10 }
};

var DEFAULT_V2_TIERS = {
  critical: 80,   // score >= critical  → Critical Priority
  high:     60,   // score >= high      → High Priority
  medium:   40,   // score >= medium    → Medium Priority
              // score < medium      → Low Priority
};

var liveV2ScoreModel = (function() {
  try {
    var stored = window._appSettings && window._appSettings['scoring_model_v2']
      ? JSON.stringify(window._appSettings['scoring_model_v2']) : null;
    if (!stored) stored = localStorage.getItem('clfn_scoring_model_v2');
    return stored ? JSON.parse(stored) : JSON.parse(JSON.stringify(DEFAULT_V2_SCORE_MODEL));
  } catch(e) { return JSON.parse(JSON.stringify(DEFAULT_V2_SCORE_MODEL)); }
})();

var liveV2Tiers = (function() {
  try {
    var stored = window._appSettings && window._appSettings['scoring_tiers_v2']
      ? JSON.stringify(window._appSettings['scoring_tiers_v2']) : null;
    if (!stored) stored = localStorage.getItem('clfn_scoring_tiers_v2');
    return stored ? JSON.parse(stored) : Object.assign({}, DEFAULT_V2_TIERS);
  } catch(e) { return Object.assign({}, DEFAULT_V2_TIERS); }
})();

var liveScoreModel = (function() {
  function normalize(arr) {
    // Ensure all entries use 'pts' key (normalize from 'p' if needed)
    return arr.map(function(r) {
      if(r.pts === undefined && r.p !== undefined) r = Object.assign({}, r, {pts: r.p});
      return r;
    });
  }
  try {
    // Prefer scoring_model_v2 (new format), fall back to scoring_model, then default
    var src = (window._appSettings && window._appSettings['scoring_model_v2']) ||
              (window._appSettings && window._appSettings['scoring_model']) || null;
    if(src && src.length) return normalize(JSON.parse(JSON.stringify(src)));
    var stored = localStorage.getItem('clfn_scoring_model_v2') || localStorage.getItem('clfn_scoring_model');
    if(stored) return normalize(JSON.parse(stored));
    return normalize(DEFAULT_SCORING_MODEL.slice());
  } catch(e) { return normalize(DEFAULT_SCORING_MODEL.slice()); }
})();

function livePoints(key) {
  var r = liveScoreModel.find(function(x){ return x.key === key; });
  return r ? r.pts : 0;
}
function liveRangeScore(cat, value) {
  // Get all rows for this category sorted by min, pick matching range
  var rows = liveScoreModel.filter(function(r){ return r.cat === cat && r.min !== null; });
  rows.sort(function(a,b){ return (a.min||0)-(b.min||0); });
  for(var i=0; i<rows.length; i++){
    var r = rows[i];
    var inRange = (value >= (r.min||0)) && (r.max === null || value <= r.max);
    if(inRange) return r.pts;
  }
  return 0;
}
function livePerMemberPoints(cat) {
  var r = liveScoreModel.find(function(x){ return x.cat === cat && x.key === 'per_member'; });
  return r ? r.pts : 1;
}
function livePerYearPoints() {
  var r = liveScoreModel.find(function(x){ return x.cat === 'waitlist' && x.key === 'per_year'; });
  return r ? r.pts : 1;
}
function liveAgePoints(ageYears) {
  var rows = liveScoreModel.filter(function(r){ return r.cat === 'household_ages' && r.min !== null; });
  for(var i=0; i<rows.length; i++){
    var r = rows[i];
    if(ageYears >= r.min && ageYears <= (r.max||999)) return r.pts;
  }
  return 0;
}


async function rescoreAllApplications() {
  // V2: Call the Edge Function for each application using stored V2 fields
  console.log('[SCORE] Rescoring ' + applications.length + ' applications…');
  var batchSize = 5; // process in small batches to avoid overwhelming the function
  for (var i = 0; i < applications.length; i += batchSize) {
    var batch = applications.slice(i, i + batchSize);
    await Promise.all(batch.map(async function(app) {
      if (app.status === APP_STATUS.ARCHIVED || app.appType === 'existing_tenant') return;
      try {
        // Build V2 payload from stored app fields
        var arrStatus = 'none';
        if (app.hasArrears) {
          arrStatus = (parseInt(app.arrPlanMonths)||0) > 0 ? 'repayment' : 'no_repayment';
        }
        if (app.arrearsStatus) arrStatus = app.arrearsStatus; // use stored v2 field if present

        var accVal = app.accessibility || '';
        var accessNeed = 'none';
        if (accVal && accVal !== 'None' && accVal !== '0' && accVal !== '') {
          accessNeed = /wheelchair/i.test(accVal) ? 'high' : 'moderate';
        }
        if (app.accessibilityNeed) accessNeed = app.accessibilityNeed;

        var dependentsUnder18 = 0;
        if (app.habitants) {
          app.habitants.forEach(function(h) {
            if (!h.dob) return;
            var age = (Date.now() - new Date(h.dob).getTime()) / (365.25*24*3600*1000);
            if (age < 18) dependentsUnder18++;
          });
        }

        var appData = {
          urgentNeed:          app.urgent_need          || app.urgentNeed          || 'none',
          healthRisk:          app.health_risk          || app.healthRisk          || 'none',
          personsOverStandard: String(app.persons_over_standard || app.personsOverStandard || 0),
          dependentsUnder18:   String(app.dependentsUnder18 || dependentsUnder18 || 0),
          loneParent:          !!(app.lone_parent          || app.loneParent),
          elderInHousehold:    !!(app.elder_in_household   || app.elderInHousehold),
          householdDisability: !!(app.household_disability || app.householdDisability),
          accessibilityNeed:   accessNeed,
          appDate:             app.appDate || '',
          noPriorTenancy:      (app.no_prior_tenancy !== undefined ? !!app.no_prior_tenancy : true),
          rentPaymentHistory:  app.rent_payment_history || app.rentPaymentHistory || 'no_history',
          unitCondition:       app.unit_condition       || app.unitCondition       || 'no_history',
          tenancyConduct:      app.tenancy_conduct      || app.tenancyConduct      || 'no_history',
          incomeStability:     app.income_stability     || app.incomeStability     || 'stable',
          arrearsStatus:       arrStatus,
          edAdjustment:        String(app.edAdjustment || 0)
        };

        var result = scoreApplicationLocally(appData);

        // Apply live tier thresholds
        var _rt = window.liveV2Tiers || { critical: 80, high: 60, medium: 40 };
        var _rtier = result.score >= _rt.critical ? 'Critical Priority'
                   : result.score >= _rt.high     ? 'High Priority'
                   : result.score >= _rt.medium   ? 'Medium Priority'
                   : 'Low Priority';
        result.tier = _rtier;
        app.score    = result.score;
        app.tier     = _rtier;
        app.score_v2 = result.score;
        app.tier_v2  = _rtier;
        app.scoreBreakdown = result.breakdown;

        // Persist to Supabase
        fetch(SUPABASE_URL + '/rest/v1/housing_applications?id=eq.' + encodeURIComponent(app.id), {
          method: 'PATCH',
          headers: Object.assign({}, HOUSING_HEADERS, { 'Prefer': 'return=minimal' }),
          body: JSON.stringify({
            score: result.score,
            tier:  result.tier,
            score_v2: result.score,
            tier_v2:  result.tier,
            score_breakdown_v2: result.breakdown
          })
        }).catch(function(){});

      } catch(err) {
        console.warn('[V2 rescore] failed for app', app.id, err.message);
      }
    }));
  }
  // (rescore toast removed)
}

function scoreMiniBar(score){
  var s = score || 0;
  var _t = (typeof liveV2Tiers === 'object' && liveV2Tiers) ? liveV2Tiers : {critical:80, high:60, medium:40};
  // Scale the bar against a V2 ceiling that peaks slightly above the Critical threshold (same math as the full scorecard bar).
  var barMax = Math.max(100, (_t.critical || 80) * 1.25);
  var w = Math.min(100, Math.max(0, Math.round((s / barMax) * 100)));
  // Color by V2 tier thresholds.
  var col = !score           ? '#ccc'
          : s >= _t.critical ? '#15803d'   // Critical — green
          : s >= _t.high     ? '#3b82f6'   // High — blue
          : s >= _t.medium   ? '#d97706'   // Medium — orange
          :                    '#b91c1c';  // Low — red
  return '<div style="height:3px;width:64px;background:var(--border);border-radius:2px;margin-top:3px;"><div style="height:100%;width:'+w+'%;background:'+col+';border-radius:2px;"></div></div>';
}