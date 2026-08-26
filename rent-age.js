// ── rent-age.js — age-based rent adjustment (applies at turnover only) ───────
// adjusted market rent = ROUND(base market rent x age factor) to the nearest
// dollar, THEN the standard payable-% discount applies (see unitMarketRent in
// shared-config.js, which consults rentAgeInfo() when this module is loaded).
//
// Effective construction year = majorRenoYear (major renovation) when set,
// else the unit's Year Built. No year on file = factor 1.00, flagged on the
// unit card as an unverified fallback. The automatic factor never goes below
// the schedule floor (default 0.75); only the per-unit "pending major rehab"
// override (0.60-0.70, reason required) goes lower.
//
// GRANDFATHERING: sitting tenants keep their current rent. The adjusted rent
// is only ever APPLIED when a new tenant moves in (offerTurnoverRent, called
// from the assignment paths) — and each application stamps the factor +
// schedule version used, so editing the schedule never rewrites history.
//
// The band schedule is nation data (OCAP): stored in the nation's own
// housing_settings table (key 'rent_age_factors') as APPEND-ONLY versions
// {versions:[{version, effectiveDate, bands, floor, savedBy, savedAt}]},
// editable in Settings > App Settings > Rent Model without a deploy, gated
// by the 'editRentAgeFactors' approval authority.

window.RENT_AGE_DEFAULTS = {
  floor: 0.75,
  overrideMin: 0.60,
  overrideMax: 0.70,
  // maxAge null = "and up" (the last band).
  bands: [
    { maxAge: 5,    factor: 1.00 },
    { maxAge: 15,   factor: 0.95 },
    { maxAge: 25,   factor: 0.90 },
    { maxAge: 35,   factor: 0.82 },
    { maxAge: null, factor: 0.75 }
  ]
};

// Latest saved version whose effectiveDate is not in the future; the built-in
// defaults act as version 0 when nothing is saved (or nothing is effective yet).
window.getRentAgeSchedule = function () {
  var d = window.RENT_AGE_DEFAULTS;
  var saved = ((window._appSettings || {}).rent_age_factors || {});
  var versions = Array.isArray(saved.versions) ? saved.versions : [];
  var today = new Date().toISOString().split('T')[0];
  var best = null;
  for (var i = 0; i < versions.length; i++) {
    var v = versions[i];
    if (!v || !Array.isArray(v.bands)) continue;
    if (v.effectiveDate && v.effectiveDate > today) continue;
    if (!best || (v.version || 0) > (best.version || 0)) best = v;
  }
  if (!best) return { version: 0, effectiveDate: '', bands: d.bands, floor: d.floor, source: 'default' };
  var floor = Number(best.floor);
  if (isNaN(floor) || floor <= 0 || floor > 1) floor = d.floor;
  return { version: best.version || 1, effectiveDate: best.effectiveDate || '',
           bands: best.bands, floor: floor, source: 'saved' };
};

// The ONE factor resolution for a unit. Returns:
//   { factor, source:'override'|'band'|'no_year', effectiveYear, usedRenoYear,
//     effectiveAge, scheduleVersion, floorApplied, override }
window.rentAgeInfo = function (unit, sched) {
  sched = sched || window.getRentAgeSchedule();
  var d = window.RENT_AGE_DEFAULTS;
  // Per-unit "pending major rehab" override — the only path below the floor.
  var ovr = unit && unit.rehabOverride;
  if (ovr && ovr.factor != null) {
    var f = Number(ovr.factor);
    if (!isNaN(f)) {
      f = Math.min(d.overrideMax, Math.max(d.overrideMin, f));
      return { factor: f, source: 'override', effectiveYear: null, usedRenoYear: false,
               effectiveAge: null, scheduleVersion: sched.version, floorApplied: false,
               override: { factor: f, reason: ovr.reason || '', setBy: ovr.setBy || '', setAt: ovr.setAt || '' } };
    }
  }
  var yearBuilt = parseInt(unit && unit.year, 10);
  var renoYear  = parseInt(unit && unit.majorRenoYear, 10);
  var okBuilt = !isNaN(yearBuilt) && yearBuilt >= 1800 && yearBuilt <= 2200;
  var okReno  = !isNaN(renoYear)  && renoYear  >= 1800 && renoYear  <= 2200;
  var effYear = okReno ? renoYear : (okBuilt ? yearBuilt : null);
  if (effYear == null) {
    return { factor: 1.00, source: 'no_year', effectiveYear: null, usedRenoYear: false,
             effectiveAge: null, scheduleVersion: sched.version, floorApplied: false, override: null };
  }
  var age = Math.max(0, new Date().getFullYear() - effYear);
  var factor = null;
  for (var i = 0; i < sched.bands.length; i++) {
    var b = sched.bands[i];
    if (b.maxAge == null || age <= Number(b.maxAge)) { factor = Number(b.factor); break; }
  }
  if (factor == null || isNaN(factor)) factor = 1.00;
  var floorApplied = factor < sched.floor;
  if (floorApplied) factor = sched.floor;
  return { factor: factor, source: 'band', effectiveYear: effYear, usedRenoYear: okReno,
           effectiveAge: age, scheduleVersion: sched.version, floorApplied: floorApplied, override: null };
};

// Offer to apply the calculated rent when a NEW tenant is assigned (the only
// moment rent changes — sitting tenants are grandfathered). Returns a promise
// so callers can sequence their own follow-up dialogs. Silent no-op when the
// caller lacks the assignRentAmount authority or nothing would change. Every
// application stamps {factor, schedule version, base} for history integrity.
window.offerTurnoverRent = function (unit, opts) {
  opts = opts || {};
  try {
    if (!unit || typeof unitMarketRent !== 'function' || typeof showConfirm !== 'function') return Promise.resolve();
    if (typeof APPROVAL_AUTHORITY !== 'undefined' && !APPROVAL_AUTHORITY.can('assignRentAmount', window.currentRole)) return Promise.resolve();
    var info = unitMarketRent(unit);
    if (info.estRent == null) return Promise.resolve();
    var newRent = info.estRent;
    var cur = (unit.monthlyRent != null) ? Number(unit.monthlyRent) : null;
    if (cur === newRent) return Promise.resolve();
    var ai = info.ageInfo || {};
    var pct = Math.round((info.payablePct || 0) * 100);
    var deriv = '$' + Number(info.marketRent).toLocaleString() + ' market'
      + (info.adjustedMarketRent != null && info.adjustedMarketRent !== info.marketRent
          ? ' × ' + ai.factor + ' age factor = $' + Number(info.adjustedMarketRent).toLocaleString() : '')
      + ' × ' + pct + '% payable = $' + newRent.toFixed(2) + '/month';
    return showConfirm({
      title: 'New tenancy — update monthly rent?',
      message: 'Set the monthly rent for the new tenancy to $' + newRent.toFixed(2) + '? (' + deriv + '.)'
        + (cur != null ? ' Current rent: $' + cur.toFixed(2) + '.' : '')
        + ' Sitting tenants are never re-rated — this applies only because the unit is turning over.',
      confirmText: 'Set $' + newRent.toFixed(2), cancelText: 'Keep current'
    }).then(function (ok) {
      if (!ok) return;
      var role = window.currentRole || 'staff';
      unit.monthlyRent = newRent;
      unit.rentCalcStamp = {
        baseRent: info.marketRent, ageFactor: ai.factor != null ? ai.factor : 1,
        ageSource: ai.source || '', effectiveAge: ai.effectiveAge,
        scheduleVersion: ai.scheduleVersion != null ? ai.scheduleVersion : 0,
        adjustedMarketRent: info.adjustedMarketRent, appliedRent: newRent,
        appliedAt: new Date().toISOString(), appliedBy: role, context: opts.context || 'assignment'
      };
      if (window.housingUnits) {
        var i = window.housingUnits.findIndex(function (x) { return x.id === unit.id; });
        if (i !== -1) { window.housingUnits[i].monthlyRent = newRent; window.housingUnits[i].rentCalcStamp = unit.rentCalcStamp; }
      }
      if (typeof saveUnitWithDraftFallback === 'function') saveUnitWithDraftFallback(unit);
      else if (typeof sbSaveUnit === 'function') sbSaveUnit(unit);
      if (typeof auditEntry === 'function') auditEntry(unit.id, 'rent_set_on_turnover',
        'Monthly rent set to $' + newRent.toFixed(2) + ' on tenant turnover (' + deriv
        + '; schedule v' + (ai.scheduleVersion != null ? ai.scheduleVersion : 0) + ')', role);
      if (typeof showToast === 'function') showToast('Monthly rent updated to $' + newRent.toFixed(2) + ' for the new tenancy.', { type: 'info' });
    });
  } catch (e) { return Promise.resolve(); }
};
