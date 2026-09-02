// ── policy-rules.js — per-nation Policy Rules engine ─────────────────────────
// The nation's housing POLICY parameters as configuration, never literals
// (OCAP: each nation's numbers live in its own housing_settings). Every rule
// is {enabled, params} merged over these defaults from housing_settings key
// 'policy_rules'; the Settings > App Settings > Policy Rules panel (gated by
// the editPolicyRules authority) edits them without a deploy, audited.
//
// Enforcement points read rules through policyRule()/policyParam() and are
// listed beside each rule below — a rule with no wired enforcement point yet
// is still safe to configure (it simply isn't consulted anywhere).
//
// CLFN Housing Policy references are noted per rule; other nations keep the
// themes and change the numbers.

window.POLICY_RULES_DEFAULTS = {
  // ── Eligibility (Policy s.8) ───────────────────────────────────────────
  min_age: {
    label: 'Minimum applicant age',
    group: 'Eligibility', cite: 'Policy 8.1(b)',
    enabled: true,
    params: { years: 18 },
    desc: 'Applications require the primary applicant (and co-applicant) to be at least this age. Enforced in the application wizard.'
  },
  rehousing_years: {
    label: 'Years between new-housing allocations',
    group: 'Eligibility', cite: 'Policy 8.4(h)',
    enabled: true,
    params: { years: 15 },
    desc: 'A member allocated new housing within this many years is flagged at final approval; approving anyway is an ED exception recorded in the audit log.'
  },
  renovation_years: {
    label: 'Years between renovation support',
    group: 'Eligibility', cite: 'Policy 8.4(i)',
    enabled: true,
    params: { years: 5 },
    desc: 'Creating a Maintenance Request on a unit with completed renovations inside this window shows a warning (health & safety work is exempt by policy — the warning never blocks).'
  },
  good_standing_gate: {
    label: 'Good standing required for allocation',
    group: 'Eligibility', cite: 'Policy 8.5, 12.5',
    enabled: true,
    params: { minArrears: 1 },
    desc: 'An applicant with arrears at or above the threshold and NO approved repayment arrangement cannot be assigned a unit. Enforced in every assignment path (reads the finance rent ledger + arrangements).'
  },
  // ── Arrears & collections (Policy s.12) ────────────────────────────────
  repayment_extra_pct: {
    label: 'Repayment arrangement minimum (extra % of rent)',
    group: 'Arrears', cite: 'Policy 12.2',
    enabled: true,
    params: { pct: 50 },
    desc: 'Minimum arrangement payment = monthly rent + this percentage of rent toward arrears. Downward adjustments require ED approval and a documented reason.'
  },
  arrangement_window_months: {
    label: 'Protected arrangement window (months)',
    group: 'Arrears', cite: 'Policy 12.3',
    enabled: true,
    params: { months: 12 },
    desc: 'While an approved arrangement is inside this window and compliant, arrears eviction cannot be authorized.'
  },
  arrangement_review_months: {
    label: 'Arrangement review cadence (months)',
    group: 'Arrears', cite: 'Policy 12.3',
    enabled: true,
    params: { months: 3 },
    desc: 'Each active arrangement gets a documented review on this cadence; due reviews surface on the worklist.'
  },
  missed_months_eviction: {
    label: 'Consecutive missed months before eviction eligibility',
    group: 'Arrears', cite: 'Policy 12.4(b)',
    enabled: true,
    params: { months: 3 },
    desc: 'An arrangement counts as failed for eviction purposes only after this many consecutive months with no arrangement payment.'
  },
  final_notice_days: {
    label: 'Final notice period before eviction (days)',
    group: 'Arrears', cite: 'Policy 12.4',
    enabled: true,
    params: { days: 30 },
    desc: 'A recorded final written notice must be at least this old before an arrears eviction can be authorized.'
  },
  meaningful_reduction_pct: {
    label: 'Meaningful arrears reduction (%)',
    group: 'Arrears', cite: 'Policy 12.4(c)',
    enabled: true,
    params: { pct: 25 },
    desc: 'At window expiry, arrears reduced by less than this percentage (with no ED extension) satisfies the expired-window eviction condition.'
  },
  reapply_compliant_months: {
    label: 'Compliant months before re-application after eviction',
    group: 'Arrears', cite: 'Policy 12.5',
    enabled: true,
    params: { months: 6 },
    desc: 'A member evicted for arrears may re-apply after full payment, or after an arrangement honoured for this many consecutive months.'
  }
};

// Saved overrides merged over the defaults (same pattern as the rent model:
// a save from before a rule existed still gets the new rule's defaults).
window.getPolicyRules = function () {
  var d = window.POLICY_RULES_DEFAULTS;
  var saved = ((window._appSettings || {}).policy_rules || {}).rules || {};
  var out = {};
  Object.keys(d).forEach(function (k) {
    var s = saved[k] || {};
    var params = {};
    Object.keys(d[k].params).forEach(function (p) {
      var v = (s.params && s.params[p] != null) ? Number(s.params[p]) : d[k].params[p];
      params[p] = (isNaN(v) || v < 0) ? d[k].params[p] : v;
    });
    out[k] = {
      label: d[k].label, group: d[k].group, desc: d[k].desc,
      // The policy citation is NATION DATA, not app copy — the shipped
      // defaults are the reference nation's section numbers; every nation
      // edits (or blanks) them in Settings to match its own policy.
      cite: (s.cite != null) ? String(s.cite) : d[k].cite,
      enabled: (s.enabled != null) ? !!s.enabled : d[k].enabled,
      params: params
    };
  });
  return out;
};

// The two accessors enforcement points use. Both fail SAFE for gates:
// an unknown key reads as disabled.
window.policyRule = function (key) {
  var r = window.getPolicyRules()[key];
  return r || { enabled: false, params: {} };
};
// The nation's own policy citation for a rule — '' when blanked/unknown.
// policyCiteSuffix wraps it as ' (…)' for message building.
window.policyCite = function (key) {
  var r = window.getPolicyRules()[key];
  return (r && r.cite) ? String(r.cite) : '';
};
window.policyCiteSuffix = function (key) {
  var c = window.policyCite(key);
  return c ? ' (' + c + ')' : '';
};
window.policyParam = function (key, name, fallback) {
  var r = window.policyRule(key);
  var v = r.params ? r.params[name] : null;
  return (v == null || isNaN(Number(v))) ? fallback : Number(v);
};

// ── Rule helpers used by more than one enforcement point ────────────────────

// Age in whole years from an ISO date string; null when unparseable.
window.policyAgeYears = function (dob) {
  if (!dob) return null;
  var d = new Date(String(dob).slice(0, 10) + 'T12:00:00');
  if (isNaN(d.getTime())) return null;
  var age = new Date(Date.now() - d.getTime()).getUTCFullYear() - 1970;
  return age >= 0 ? age : null;
};

// Policy 8.4(h): has this applicant been allocated new housing within the
// configured window? Scans the applications cache for a same-name application
// (other than this one) with an assignment date inside the window. Returns
// null when the rule is off / no data, else {year, appId} of the prior
// allocation for the warning text.
window.policyPriorAllocation = function (app) {
  var rule = window.policyRule('rehousing_years');
  if (!rule.enabled || !app) return null;
  var years = rule.params.years;
  var apps = (typeof applications !== 'undefined' && applications) ? applications : (window.applications || []);
  var norm = (typeof window.normNameKey === 'function') ? window.normNameKey
           : function (s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); };
  var name = norm((app.fn || '') + ' ' + (app.ln || ''));
  if (!name) return null;
  var cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - years);
  var hit = null;
  apps.forEach(function (a) {
    if (!a || a.id === app.id) return;
    if (norm((a.fn || '') + ' ' + (a.ln || '')) !== name) return;
    var when = a.assignedAt || a.assignedDate || '';
    if (!when) return;
    var d = new Date(String(when).slice(0, 10) + 'T12:00:00');
    if (isNaN(d.getTime()) || d < cutoff) return;
    if (!hit || String(when) > String(hit.when)) hit = { when: String(when).slice(0, 10), appId: a.id };
  });
  return hit;
};
