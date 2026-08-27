// ── arrears.js — the Policy s.12 arrears machine (housing side) ──────────────
// Reads the FINANCE module's own tables — finance_rent_ledger (balances),
// finance_arrangements (repayment arrangements, status 'pending-ed' ->
// 'approved'), finance_arr_payments (arrangement payments) — and layers the
// housing POLICY on top: the rent+X% minimum, the protected 12-month window,
// quarterly reviews, and the eviction precondition gate. It NEVER duplicates
// finance data: arrangements created here are ordinary finance_arrangements
// rows the finance module sees on its next load, and every policy stamp
// (review done, final notice, extension, eviction authorization) is an
// append-only housing_audit_log row keyed to the tenant — no new tables.
//
// Loaded on housing.html + tenants.html. All timing parameters come from the
// Policy Rules engine (policy-rules.js).

(function () {
  var CACHE = { loaded: false, loading: null, byTenant: {}, tenants: [], arrangements: [], stamps: {} };
  window._arrearsCache = CACHE;

  function _hdrs(extra) {
    return Object.assign({}, (window.HOUSING_HEADERS || {}), extra || {});
  }
  function _get(path) {
    return fetch(SUPABASE_URL + '/rest/v1/' + path, { headers: _hdrs() })
      .then(function (r) { return r.ok ? r.json() : []; })
      .catch(function () { return []; });
  }
  function _todayISO() { return new Date().toISOString().split('T')[0]; }
  function _addMonths(iso, m) {
    var d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
    if (isNaN(d.getTime())) return '';
    d.setMonth(d.getMonth() + m);
    return d.toISOString().split('T')[0];
  }
  function _monthKey(iso) { return String(iso || '').slice(0, 7); }

  // Policy stamps ride housing_audit_log (append-only): entity 'TENANT:<id>'.
  var STAMP_ACTIONS = ['arrears_review', 'arrears_final_notice', 'arrears_extension', 'arrears_eviction_authorized'];

  // ── Load: finance tables (read-only) + policy stamps ─────────────────────
  window.arrearsLoad = function (force) {
    if (CACHE.loaded && !force) return Promise.resolve(CACHE);
    if (CACHE.loading && !force) return CACHE.loading;
    CACHE.loading = Promise.all([
      _get('finance_rent_ledger?select=tenant_id,entry_type,amount&limit=20000'),
      _get('finance_arrangements?select=*&order=created_at.desc&limit=2000'),
      _get('finance_arr_payments?select=arrangement_id,payment_date,amount,voids_id&limit=20000'),
      _get('tenants?select=id,full_name,application_id,current_unit_id&merged_into=is.null&limit=5000')
    ]).then(function (res) {
      var ledger = res[0] || [], arrs = res[1] || [], pays = res[2] || [], tenants = res[3] || [];
      // Balance per tenant — SAME semantics as finance's _rentLedgerFromRow:
      // charges (opening/rent_charge/adjustment_debit) minus payments
      // (payment/adjustment_credit); void reversal rows carry a signed amount
      // so they net out against their originals without status tracking.
      var bal = {};
      ledger.forEach(function (r) {
        if (!r || !r.tenant_id) return;
        var amt = Number(r.amount) || 0, delta = 0;
        var t = r.entry_type;
        if (t === 'opening_balance' || t === 'rent_charge' || t === 'adjustment_debit') delta = amt;
        else if (t === 'payment' || t === 'adjustment_credit') delta = -amt;
        else if (t === 'void') delta = amt;   // reversal rows store a SIGNED amount (charge-reversal negative, payment-reversal positive), so adding it nets out the original
        bal[r.tenant_id] = (bal[r.tenant_id] || 0) + delta;
      });
      var paysByArr = {};
      pays.forEach(function (p) {
        if (!p || p.voids_id) return;
        (paysByArr[p.arrangement_id] = paysByArr[p.arrangement_id] || []).push(p);
      });
      CACHE.byTenant = {};
      CACHE.tenants = tenants;
      CACHE.arrangements = arrs;
      tenants.forEach(function (t) {
        CACHE.byTenant[t.id] = { tenant: t, balance: Math.round((bal[t.id] || 0) * 100) / 100, arrangements: [], payments: [] };
      });
      arrs.forEach(function (a) {
        if (!a || a.archived) return;
        var e = CACHE.byTenant[a.tenant_id];
        if (e) { e.arrangements.push(a); e.payments = e.payments.concat(paysByArr[a.id] || []); }
      });
      CACHE.loaded = true;
      CACHE.loading = null;
      return CACHE;
    });
    return CACHE.loading;
  };

  window.arrearsLoadStamps = function (tenantIds) {
    var ids = (tenantIds || []).filter(Boolean).map(function (id) { return 'TENANT:' + id; });
    if (!ids.length) return Promise.resolve({});
    var q = 'housing_audit_log?select=entity_id,action,detail,created_at,actor'
      + '&entity_id=in.(' + ids.map(encodeURIComponent).join(',') + ')'
      + '&action=in.(' + STAMP_ACTIONS.join(',') + ')'
      + '&order=created_at.desc&limit=2000';
    return _get(q).then(function (rows) {
      (rows || []).forEach(function (r) {
        var tid = String(r.entity_id || '').replace('TENANT:', '');
        var s = (CACHE.stamps[tid] = CACHE.stamps[tid] || {});
        if (!s[r.action]) s[r.action] = r;   // newest wins (ordered desc)
      });
      return CACHE.stamps;
    });
  };

  function _resolveTenantByName(name) {
    var norm = function (s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); };
    var n = norm(name);
    if (!n) return null;
    return CACHE.tenants.find(function (t) { return norm(t.full_name) === n; }) || null;
  }
  window.arrearsTenantByName = _resolveTenantByName;

  // ── The state machine per tenant ─────────────────────────────────────────
  // Returns the full Policy s.12 view: balance, the current arrangement, its
  // compliance, window + review timing, and stamps. Sync — reads the cache.
  window.arrearsStateForTenant = function (tenantId) {
    var e = CACHE.byTenant[tenantId];
    if (!e) return null;
    var winM = (typeof policyParam === 'function') ? policyParam('arrangement_window_months', 'months', 12) : 12;
    var revM = (typeof policyParam === 'function') ? policyParam('arrangement_review_months', 'months', 3) : 3;
    var missM = (typeof policyParam === 'function') ? policyParam('missed_months_eviction', 'months', 3) : 3;
    var arr = e.arrangements.find(function (a) { return a.status === 'approved'; })
           || e.arrangements.find(function (a) { return a.status === 'pending-ed'; })
           || null;
    var st = {
      tenantId: tenantId, tenant: e.tenant, balance: e.balance,
      arrangement: arr, hasApproved: !!(arr && arr.status === 'approved'),
      pendingEd: !!(arr && arr.status === 'pending-ed'),
      windowEndsAt: null, windowExpired: false,
      nextReviewDue: null, reviewOverdue: false,
      consecutiveMissed: 0, compliant: null,
      stamps: CACHE.stamps[tenantId] || {}
    };
    if (arr && arr.status === 'approved') {
      var start = arr.start_date || (arr.approved_at || '').slice(0, 10) || _todayISO();
      st.windowEndsAt = _addMonths(start, winM);
      st.windowExpired = st.windowEndsAt && st.windowEndsAt < _todayISO();
      // Review cadence: from the last recorded review (audit stamp) or the
      // arrangement start.
      var lastRev = st.stamps.arrears_review ? String(st.stamps.arrears_review.created_at).slice(0, 10) : start;
      st.nextReviewDue = _addMonths(lastRev, revM);
      st.reviewOverdue = st.nextReviewDue && st.nextReviewDue < _todayISO();
      // Consecutive missed months: walk back from last month; a month with no
      // non-void arrangement payment counts as missed. The current month is
      // never counted (it isn't over).
      var payMonths = {};
      e.payments.forEach(function (p) { if (p && p.arrangement_id === arr.id) payMonths[_monthKey(p.payment_date)] = true; });
      var startMonth = _monthKey(start);
      var probe = new Date(); probe.setDate(1);
      var missed = 0;
      for (var i = 0; i < 24; i++) {
        probe.setMonth(probe.getMonth() - 1);
        var mk = probe.toISOString().slice(0, 7);
        if (mk < startMonth) break;
        if (payMonths[mk]) break;
        missed++;
      }
      st.consecutiveMissed = missed;
      st.compliant = missed < missM;
    }
    return st;
  };

  // ── Policy 12.4 — the eviction precondition gate ─────────────────────────
  // Machine-verifies each condition it can; conditions the policy leaves to
  // judgement are returned as attestations for the ED to confirm. Authorizing
  // requires: (at least one condition met or attested) AND a final notice at
  // least final_notice_days old AND the authorizeEviction authority.
  window.arrearsEvictionCheck = function (tenantId) {
    var st = window.arrearsStateForTenant(tenantId);
    if (!st) return null;
    var missM = (typeof policyParam === 'function') ? policyParam('missed_months_eviction', 'months', 3) : 3;
    var redPct = (typeof policyParam === 'function') ? policyParam('meaningful_reduction_pct', 'pct', 25) : 25;
    var noticeDays = (typeof policyParam === 'function') ? policyParam('final_notice_days', 'days', 30) : 30;
    var conds = [];
    // (a) refused/failed to enter an arrangement after notice — machine sees
    // "no arrangement at all"; the reasonable-opportunity part is attested.
    conds.push({
      key: 'a', label: 'No repayment arrangement after written notice and reasonable opportunity',
      machine: !st.arrangement, attest: !st.arrangement,
      note: st.arrangement ? 'An arrangement exists — condition (a) does not apply.' : 'System confirms: no arrangement on file. ED attests notice + opportunity were given.'
    });
    // (b) arrangement in place but >= N consecutive months unpaid.
    conds.push({
      key: 'b', label: st.hasApproved ? (st.consecutiveMissed + ' consecutive month(s) without an arrangement payment (threshold ' + missM + ')') : 'Approved arrangement with ' + missM + '+ consecutive missed months',
      machine: st.hasApproved && st.consecutiveMissed >= missM, attest: false,
      note: st.hasApproved ? 'Measured from finance arrangement payments.' : 'No approved arrangement to measure.'
    });
    // (c) window expired without meaningful reduction and no extension.
    var reduced = null;
    if (st.arrangement && Number(st.arrangement.total_owing) > 0) {
      reduced = Math.round((1 - (st.balance / Number(st.arrangement.total_owing))) * 100);
    }
    var extended = !!st.stamps.arrears_extension
      && st.windowEndsAt && String(st.stamps.arrears_extension.created_at).slice(0, 10) >= _addMonths(st.windowEndsAt, -1);
    conds.push({
      key: 'c', label: 'Protected window expired; arrears not meaningfully reduced (' + redPct + '%); no ED extension',
      machine: !!(st.windowExpired && reduced != null && reduced < redPct && !extended), attest: false,
      note: st.windowExpired
        ? ('Window ended ' + st.windowEndsAt + '; arrears reduced ' + (reduced == null ? 'n/a' : reduced + '%') + (extended ? '; ED extension on file.' : '; no extension on file.'))
        : ('Window ' + (st.windowEndsAt ? 'runs to ' + st.windowEndsAt : 'not started') + '.')
    });
    // (d) breach + other serious violations — judgement; pure attestation.
    conds.push({
      key: 'd', label: 'Arrangement breach combined with other serious housing-agreement violations',
      machine: false, attest: true,
      note: 'Documented by staff; ED attests.'
    });
    var notice = st.stamps.arrears_final_notice || null;
    var noticeAge = notice ? Math.floor((Date.now() - new Date(notice.created_at).getTime()) / 86400000) : null;
    return {
      state: st, conditions: conds,
      anyMachineMet: conds.some(function (c) { return c.machine; }),
      finalNotice: notice, finalNoticeAgeDays: noticeAge,
      noticeSatisfied: notice != null && noticeAge >= noticeDays,
      noticeDaysRequired: noticeDays,
      alreadyAuthorized: !!st.stamps.arrears_eviction_authorized
    };
  };

  // ── Actions (all audited; arrangements write to FINANCE tables) ──────────
  function _audit(tenantId, action, detail) {
    if (typeof auditEntry === 'function') auditEntry('TENANT:' + tenantId, action, detail, window.currentRole || 'staff');
    var s = (CACHE.stamps[tenantId] = CACHE.stamps[tenantId] || {});
    s[action] = { action: action, detail: detail, created_at: new Date().toISOString(), actor: (window.HOUSING_SESSION || {}).email || '' };
  }
  function _can(auth) {
    return typeof APPROVAL_AUTHORITY === 'undefined' || APPROVAL_AUTHORITY.can(auth, window.currentRole);
  }

  // Create a repayment arrangement (finance_arrangements row, status
  // 'pending-ed' — the ED approves here or in Finance). Minimum payment =
  // rent + pct% of rent from the policy rules; going below requires the ED
  // tier and a documented reason (Policy 12.2 flexibility clause).
  window.arrearsCreateArrangement = async function (tenantId, opts) {
    if (!_can('manageArrears')) { showToast('You are not authorized to create repayment arrangements.', { type: 'error' }); return null; }
    opts = opts || {};
    var e = CACHE.byTenant[tenantId];
    if (!e) { showToast('Tenant not found in the arrears data.', { type: 'error' }); return null; }
    var payment = Number(opts.payment);
    var totalOwing = Number(opts.totalOwing != null ? opts.totalOwing : e.balance);
    if (isNaN(payment) || payment <= 0) { showToast('A payment amount is required.', { type: 'error' }); return null; }
    var rent = Number(opts.monthlyRent) || 0;
    var pct = (typeof policyParam === 'function') ? policyParam('repayment_extra_pct', 'pct', 50) : 50;
    var minPay = Math.round((rent + rent * pct / 100) * 100) / 100;
    if (rent > 0 && payment < minPay) {
      var isEd = (typeof ROLE !== 'undefined' && window.currentRole === 'ed') || window.currentRole === 'super_user';
      if (!isEd || !(opts.reason || '').trim()) {
        showToast('Below the policy minimum ($' + minPay.toFixed(2) + ' = rent + ' + pct + '%). An ED-approved documented reason is required to go lower.', { type: 'error' });
        return null;
      }
    }
    var row = {
      tenant_id: tenantId,
      total_owing: totalOwing,
      payment_amount: payment,
      start_date: opts.startDate || _todayISO(),
      end_date: null,
      reason: (opts.reason || '') + (rent > 0 && payment < minPay ? ' [ED-approved below policy minimum $' + minPay.toFixed(2) + ']' : ''),
      status: 'pending-ed',
      created_by: (window.HOUSING_SESSION || {}).email || 'housing'
    };
    try {
      var r = await fetch(SUPABASE_URL + '/rest/v1/finance_arrangements', {
        method: 'POST',
        headers: _hdrs({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
        body: JSON.stringify(row)
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var saved = (await r.json())[0] || row;
      e.arrangements.unshift(saved);
      _audit(tenantId, 'arrears_review', 'Repayment arrangement submitted: $' + payment.toFixed(2) + '/month toward $' + totalOwing.toFixed(2) + ' (policy minimum $' + minPay.toFixed(2) + ')');
      showToast('Arrangement submitted for ED approval.', { type: 'info' });
      return saved;
    } catch (err) {
      showToast('Arrangement save failed: ' + err.message, { type: 'error' });
      return null;
    }
  };

  window.arrearsApproveArrangement = async function (arrangementId, tenantId) {
    if (!_can('approveArrangement')) { showToast('Only the ED can approve repayment arrangements.', { type: 'error' }); return false; }
    try {
      var r = await fetch(SUPABASE_URL + '/rest/v1/finance_arrangements?id=eq.' + encodeURIComponent(arrangementId), {
        method: 'PATCH',
        headers: _hdrs({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
        body: JSON.stringify({ status: 'approved', approved_by: (window.HOUSING_SESSION || {}).email || '', approved_at: new Date().toISOString() })
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var e = CACHE.byTenant[tenantId];
      if (e) { var a = e.arrangements.find(function (x) { return x.id === arrangementId; }); if (a) { a.status = 'approved'; a.approved_at = new Date().toISOString(); } }
      _audit(tenantId, 'arrears_review', 'Repayment arrangement APPROVED — protected window begins');
      showToast('Arrangement approved.', { type: 'info' });
      return true;
    } catch (err) { showToast('Approve failed: ' + err.message, { type: 'error' }); return false; }
  };

  window.arrearsRecordReview = function (tenantId, summary) {
    if (!_can('manageArrears')) { showToast('You are not authorized to record arrears reviews.', { type: 'error' }); return false; }
    var st = window.arrearsStateForTenant(tenantId) || {};
    _audit(tenantId, 'arrears_review', 'Quarterly arrangement review — balance $' + (st.balance != null ? st.balance.toFixed(2) : '?')
      + (st.consecutiveMissed ? ', ' + st.consecutiveMissed + ' consecutive missed month(s)' : ', payments current')
      + (summary ? ' — ' + summary : ''));
    if (typeof sbSaveTenantNote === 'function' && st.tenant) {
      sbSaveTenantNote(st.tenant.full_name, 'Arrears arrangement review: ' + (summary || 'reviewed, see audit log'), { context: 'arrears_review', tenantId: tenantId });
    }
    showToast('Review recorded.', { type: 'info' });
    return true;
  };

  window.arrearsRecordFinalNotice = function (tenantId) {
    if (!_can('manageArrears')) { showToast('You are not authorized to record notices.', { type: 'error' }); return false; }
    var days = (typeof policyParam === 'function') ? policyParam('final_notice_days', 'days', 30) : 30;
    _audit(tenantId, 'arrears_final_notice', 'Final written notice recorded — ' + days + '-day re-engagement period begins (Policy 12.4)');
    showToast('Final notice recorded. Eviction cannot be authorized for ' + days + ' days.', { type: 'info' });
    return true;
  };

  window.arrearsRecordExtension = function (tenantId, reason) {
    if (!_can('approveArrangement')) { showToast('Only the ED can extend an arrangement window.', { type: 'error' }); return false; }
    if (!(reason || '').trim()) { showToast('A documented reason is required for an extension.', { type: 'error' }); return false; }
    _audit(tenantId, 'arrears_extension', 'Arrangement window extended by ED — ' + reason);
    showToast('Extension recorded.', { type: 'info' });
    return true;
  };

  window.arrearsAuthorizeEviction = function (tenantId, attestedKeys, notes) {
    if (!_can('authorizeEviction')) { showToast('Only the ED can authorize an arrears eviction.', { type: 'error' }); return false; }
    var chk = window.arrearsEvictionCheck(tenantId);
    if (!chk) return false;
    var met = chk.conditions.filter(function (c) { return c.machine || (attestedKeys || []).indexOf(c.key) !== -1; });
    if (!met.length) { showToast('No Policy 12.4 condition is met or attested — eviction cannot be authorized.', { type: 'error' }); return false; }
    if (!chk.noticeSatisfied) {
      showToast('The final written notice must be recorded and at least ' + chk.noticeDaysRequired + ' days old first.', { type: 'error' });
      return false;
    }
    _audit(tenantId, 'arrears_eviction_authorized',
      'ARREARS EVICTION AUTHORIZED by ED — conditions: ' + met.map(function (c) { return '(' + c.key + ')' + (c.machine ? ' verified' : ' attested'); }).join(', ')
      + '; final notice ' + chk.finalNoticeAgeDays + ' days prior' + (notes ? ' — ' + notes : ''));
    showToast('Eviction authorization recorded with full documentation.', { type: 'info' });
    return true;
  };

  // ── Allocation gate (Policy 8.5 / 12.5) ──────────────────────────────────
  // Consulted by appAssignabilityStatus. Fails OPEN when the cache isn't
  // loaded (never strand an assignment on a fetch) and when the rule is off.
  window.arrearsAllocationBlock = function (applicantName) {
    try {
      if (typeof policyRule !== 'function') return null;
      var rule = policyRule('good_standing_gate');
      if (!rule.enabled || !CACHE.loaded) return null;
      var t = _resolveTenantByName(applicantName);
      if (!t) return null;
      var st = window.arrearsStateForTenant(t.id);
      if (!st) return null;
      var min = Number(rule.params.minArrears) || 1;
      if (st.balance >= min && !st.hasApproved) {
        return 'Not in good standing: $' + st.balance.toFixed(2) + ' arrears with no approved repayment arrangement (Policy 8.5). Set up an arrangement first.';
      }
      return null;
    } catch (e) { return null; }
  };

  // ── Worklist section (management) ────────────────────────────────────────
  // Returns HTML for "Arrears — action needed": pending-ED approvals, overdue
  // quarterly reviews, and windows expiring within 30 days. renderWorklist
  // calls this when available; loads lazily and re-renders once ready.
  // ── TIC panel (Overview tab) ─────────────────────────────────────────────
  // Balance + arrangement state + the Policy s.12 actions. Renders "no data"
  // quietly for people with no tenant/finance footprint.
  function _esc(s) { return (typeof escapeHtml === 'function') ? escapeHtml(s) : String(s == null ? '' : s); }
  function _money(v) { return '$' + Number(v || 0).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  window.arrearsRenderTicPanel = function (mount, tenantName, monthlyRent) {
    if (!mount) return;
    mount.innerHTML = '<div class="tic-section tic-section-spaced"><div class="tic-section-h">Arrears &amp; Repayment</div><div style="font-size:12px;color:var(--muted);padding:6px 0;">Loading finance data…</div></div>';
    window.arrearsLoad().then(function () {
      var t = _resolveTenantByName(tenantName);
      if (!t) { mount.innerHTML = ''; return; }
      return window.arrearsLoadStamps([t.id]).then(function () { _paint(mount, t.id, monthlyRent); });
    }).catch(function () { mount.innerHTML = ''; });
  };

  function _paint(mount, tid, monthlyRent) {
    var st = window.arrearsStateForTenant(tid);
    if (!st) { mount.innerHTML = ''; return; }
    var canManage = _can('manageArrears');
    var canApprove = _can('approveArrangement');
    var canEvict = _can('authorizeEviction');
    var pct = (typeof policyParam === 'function') ? policyParam('repayment_extra_pct', 'pct', 50) : 50;
    var minPay = Math.round((monthlyRent + monthlyRent * pct / 100) * 100) / 100;
    var chip = function (txt, tone) {
      var c = tone === 'bad' ? 'var(--danger);background:var(--danger-bg)'
            : tone === 'warn' ? 'var(--warn-amber-text);background:var(--warn-amber-bg)'
            : 'var(--success);background:var(--success-bg)';
      return '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;color:' + c + ';white-space:nowrap;">' + txt + '</span>';
    };
    var rows = [];
    rows.push('<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
      + '<strong style="font-size:14px;">Balance ' + _money(st.balance) + '</strong>'
      + (st.balance > 0 ? chip('ARREARS', 'bad') : chip('CURRENT', 'ok'))
      + (st.hasApproved ? chip('Arrangement · ' + (st.compliant ? 'compliant' : st.consecutiveMissed + ' mo missed'), st.compliant ? 'ok' : 'bad') : '')
      + (st.pendingEd ? chip('Arrangement pending ED', 'warn') : '')
      + '</div>');
    if (st.hasApproved) {
      rows.push('<div style="font-size:12px;color:var(--muted);margin-top:4px;">'
        + _money(st.arrangement.payment_amount) + '/month toward ' + _money(st.arrangement.total_owing)
        + ' · window ends ' + _esc(st.windowEndsAt || '—') + (st.windowExpired ? ' <strong style="color:var(--danger);">(EXPIRED)</strong>' : '')
        + ' · next review ' + _esc(st.nextReviewDue || '—') + (st.reviewOverdue ? ' <strong style="color:var(--warn-amber-text);">(overdue)</strong>' : '')
        + '</div>');
    } else if (st.balance > 0) {
      rows.push('<div style="font-size:12px;color:var(--muted);margin-top:4px;">No repayment arrangement on file. Policy minimum: rent + ' + pct + '% = <strong>' + _money(minPay) + '/month</strong>.</div>');
    }
    if (st.stamps.arrears_final_notice) rows.push('<div style="font-size:11px;color:var(--warn-amber-text);margin-top:3px;">Final notice recorded ' + _esc(String(st.stamps.arrears_final_notice.created_at).slice(0, 10)) + '</div>');
    if (st.stamps.arrears_eviction_authorized) rows.push('<div style="font-size:11px;color:var(--danger);font-weight:700;margin-top:3px;">Arrears eviction AUTHORIZED ' + _esc(String(st.stamps.arrears_eviction_authorized.created_at).slice(0, 10)) + '</div>');
    var btns = [];
    var b = function (label, fn, primary) {
      return '<button type="button" class="btn ' + (primary ? 'btn-primary' : 'btn-ghost') + '" style="padding:4px 10px;font-size:11px;" onclick="' + fn + '">' + label + '</button>';
    };
    var args = "'" + tid + "'," + (Number(monthlyRent) || 0);
    if (canManage && st.balance > 0 && !st.arrangement) btns.push(b('+ Repayment arrangement', '_arrUiNewArrangement(' + args + ')', true));
    if (canApprove && st.pendingEd) btns.push(b('✓ Approve arrangement', '_arrUiApprove(' + args + ')', true));
    if (canManage && st.hasApproved) btns.push(b('📝 Record review', '_arrUiReview(' + args + ')'));
    if (canApprove && st.hasApproved && st.windowExpired && !st.stamps.arrears_extension) btns.push(b('⏩ Extend window', '_arrUiExtend(' + args + ')'));
    if (canManage && st.balance > 0) btns.push(b('📮 Record final notice', '_arrUiFinalNotice(' + args + ')'));
    if (canEvict && st.balance > 0) btns.push(b('⚖ Eviction readiness', '_arrUiEvictionCheck(' + args + ')'));
    mount.innerHTML = '<div class="tic-section tic-section-spaced"><div class="tic-section-h">Arrears &amp; Repayment (Policy s.12)</div>'
      + '<div style="padding:6px 0 2px;">' + rows.join('') + '</div>'
      + (btns.length ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">' + btns.join('') + '</div>' : '')
      + '<div id="tic_arrears_detail" style="margin-top:8px;"></div>'
      + '</div>';
    mount.dataset.tid = tid;
    mount.dataset.rent = String(monthlyRent || 0);
  }
  function _repaint(tid, rent) {
    var mount = document.getElementById('tic_arrears_mount');
    if (mount) _paint(mount, tid, Number(rent) || 0);
  }

  // Inline UI actions (prompt-driven; every write is audited).
  window._arrUiNewArrangement = function (tid, rent) {
    var pct = (typeof policyParam === 'function') ? policyParam('repayment_extra_pct', 'pct', 50) : 50;
    var minPay = Math.round((rent + rent * pct / 100) * 100) / 100;
    var p = (typeof showPrompt === 'function')
      ? showPrompt({ title: 'Repayment arrangement', message: 'Monthly payment amount. Policy minimum is rent + ' + pct + '% = $' + minPay.toFixed(2) + ' (going lower needs the ED tier + a reason).', placeholder: String(minPay), confirmText: 'Next' })
      : Promise.resolve(window.prompt('Monthly payment amount (min $' + minPay.toFixed(2) + '):', String(minPay)));
    p.then(function (amt) {
      if (amt == null || String(amt).trim() === '') return;
      var pay = parseFloat(amt);
      var p2 = (typeof showPrompt === 'function')
        ? showPrompt({ title: 'Reason / notes', message: 'Context for the arrangement (required when below the policy minimum).', placeholder: 'e.g. income change — ED approved reduced amount', confirmText: 'Submit' })
        : Promise.resolve(window.prompt('Reason / notes (optional unless below minimum):') || '');
      p2.then(function (reason) {
        if (reason == null) return;
        window.arrearsCreateArrangement(tid, { payment: pay, monthlyRent: rent, reason: String(reason || '') })
          .then(function (saved) { if (saved) _repaint(tid, rent); });
      });
    });
  };
  window._arrUiApprove = function (tid, rent) {
    var st = window.arrearsStateForTenant(tid);
    if (!st || !st.arrangement) return;
    var go = (typeof showConfirm === 'function')
      ? showConfirm({ title: 'Approve arrangement?', message: 'Approve ' + _money(st.arrangement.payment_amount) + '/month toward ' + _money(st.arrangement.total_owing) + '? The protected ' + ((typeof policyParam === 'function') ? policyParam('arrangement_window_months', 'months', 12) : 12) + '-month window starts now.', confirmText: 'Approve' })
      : Promise.resolve(window.confirm('Approve this arrangement?'));
    go.then(function (ok) { if (ok) window.arrearsApproveArrangement(st.arrangement.id, tid).then(function () { _repaint(tid, rent); }); });
  };
  window._arrUiReview = function (tid, rent) {
    var p = (typeof showPrompt === 'function')
      ? showPrompt({ title: 'Quarterly review', message: 'Outcome of the review (progress, changes, supports offered).', placeholder: 'e.g. payments current, arrangement unchanged', confirmText: 'Record review' })
      : Promise.resolve(window.prompt('Review summary:'));
    p.then(function (txt) { if (txt != null) { window.arrearsRecordReview(tid, String(txt || '')); _repaint(tid, rent); } });
  };
  window._arrUiExtend = function (tid, rent) {
    var p = (typeof showPrompt === 'function')
      ? showPrompt({ title: 'Extend the window (ED)', message: 'Documented reason for extending past the 12-month window (Policy 12.3).', placeholder: 'required', confirmText: 'Record extension' })
      : Promise.resolve(window.prompt('Extension reason (required):'));
    p.then(function (txt) { if (txt != null && String(txt).trim()) { window.arrearsRecordExtension(tid, String(txt)); _repaint(tid, rent); } });
  };
  window._arrUiFinalNotice = function (tid, rent) {
    var days = (typeof policyParam === 'function') ? policyParam('final_notice_days', 'days', 30) : 30;
    var go = (typeof showConfirm === 'function')
      ? showConfirm({ title: 'Record final written notice?', message: 'Confirms the final written notice (grounds + a ' + days + '-day opportunity to re-engage, Policy 12.4) has been GIVEN to the tenant. Eviction cannot be authorized until ' + days + ' days after this record.', confirmText: 'Record notice' })
      : Promise.resolve(window.confirm('Record final written notice?'));
    go.then(function (ok) { if (ok) { window.arrearsRecordFinalNotice(tid); _repaint(tid, rent); } });
  };
  window._arrUiEvictionCheck = function (tid, rent) {
    var chk = window.arrearsEvictionCheck(tid);
    var out = document.getElementById('tic_arrears_detail');
    if (!chk || !out) return;
    var html = '<div style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;">'
      + '<div style="font-weight:700;font-size:12px;margin-bottom:6px;">Policy 12.4 — eviction preconditions</div>'
      + chk.conditions.map(function (c) {
          var mark = c.machine ? '<strong style="color:var(--danger);">MET (verified)</strong>'
                   : (c.attest ? '<label style="cursor:pointer;"><input type="checkbox" data-arr-attest="' + c.key + '"/> ED attests</label>'
                   : '<span style="color:var(--muted);">not met</span>');
          return '<div style="display:flex;gap:8px;align-items:flex-start;padding:4px 0;border-top:1px solid var(--border);font-size:12px;">'
            + '<span style="flex:0 0 14px;font-weight:700;">(' + c.key + ')</span>'
            + '<span style="flex:1;">' + _esc(c.label) + '<div style="font-size:11px;color:var(--muted);">' + _esc(c.note) + '</div></span>'
            + '<span style="flex-shrink:0;font-size:11px;">' + mark + '</span></div>';
        }).join('')
      + '<div style="font-size:12px;margin-top:6px;">Final notice: ' + (chk.finalNotice
          ? _esc(String(chk.finalNotice.created_at).slice(0, 10)) + ' (' + chk.finalNoticeAgeDays + ' days ago; ' + chk.noticeDaysRequired + ' required)'
            + (chk.noticeSatisfied ? ' <strong style="color:var(--success);">OK</strong>' : ' <strong style="color:var(--danger);">too recent</strong>')
          : '<strong style="color:var(--danger);">not recorded</strong>') + '</div>'
      + (chk.alreadyAuthorized ? '<div style="font-size:12px;color:var(--danger);font-weight:700;margin-top:4px;">Already authorized.</div>'
         : '<div style="margin-top:8px;"><button type="button" class="btn btn-primary" style="padding:4px 12px;font-size:11px;" onclick="_arrUiAuthorize(\'' + tid + '\',' + (Number(rent) || 0) + ')">Authorize arrears eviction (ED)</button></div>')
      + '</div>';
    out.innerHTML = html;
  };
  window._arrUiAuthorize = function (tid, rent) {
    var out = document.getElementById('tic_arrears_detail');
    var attested = out ? Array.prototype.map.call(out.querySelectorAll('[data-arr-attest]:checked'), function (el) { return el.getAttribute('data-arr-attest'); }) : [];
    var go = (typeof showConfirm === 'function')
      ? showConfirm({ title: 'Authorize arrears eviction?', message: 'This records the ED\'s written authorization with the verified/attested Policy 12.4 conditions and the notice history. It is the LAST resort after supportive collection has been exhausted.', confirmText: 'Authorize', cancelText: 'Cancel' })
      : Promise.resolve(window.confirm('Authorize arrears eviction?'));
    go.then(function (ok) {
      if (!ok) return;
      if (window.arrearsAuthorizeEviction(tid, attested, '')) _repaint(tid, rent);
    });
  };

  // ── Boot: hydrate the cache after login so the allocation gate and the
  // worklist section have data. Re-renders the worklist when ready.
  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () {
      if (!window.HOUSING_HEADERS) return;
      window.arrearsLoad().then(function () {
        var tids = [];
        Object.keys(CACHE.byTenant).forEach(function (tid) {
          if (CACHE.byTenant[tid].arrangements.length || CACHE.byTenant[tid].balance > 0) tids.push(tid);
        });
        return window.arrearsLoadStamps(tids.slice(0, 200));
      }).then(function () {
        if (typeof renderWorklist === 'function' && document.getElementById('worklist_body')) renderWorklist();
      }).catch(function () {});
    }, 2500);
  });

  window.arrearsWorklistItems = function () {
    var items = [];
    Object.keys(CACHE.byTenant).forEach(function (tid) {
      var st = window.arrearsStateForTenant(tid);
      if (!st || !st.arrangement) return;
      var name = (st.tenant && st.tenant.full_name) || tid;
      if (st.pendingEd) items.push({ tid: tid, name: name, kind: 'approve', label: 'Arrangement awaiting ED approval — $' + Number(st.arrangement.payment_amount || 0).toFixed(2) + '/month' });
      else if (st.hasApproved && st.reviewOverdue) items.push({ tid: tid, name: name, kind: 'review', label: 'Quarterly review overdue (due ' + st.nextReviewDue + ')' });
      else if (st.hasApproved && st.windowEndsAt && !st.windowExpired && st.windowEndsAt <= _addMonths(_todayISO(), 1)) {
        items.push({ tid: tid, name: name, kind: 'expiry', label: '12-month window ends ' + st.windowEndsAt + ' — full account review required' });
      } else if (st.hasApproved && st.windowExpired) {
        items.push({ tid: tid, name: name, kind: 'expired', label: 'Window EXPIRED ' + st.windowEndsAt + ' — review for extension or escalation' });
      }
    });
    return items;
  };
})();
