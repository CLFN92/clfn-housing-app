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
      _get('finance_rent_ledger?select=tenant_id,entry_type,amount,entry_date&limit=20000'),
      _get('finance_arrangements?select=*&order=created_at.desc&limit=2000'),
      _get('finance_arr_payments?select=arrangement_id,payment_date,amount,voids_id&limit=20000'),
      _get('tenants?select=id,full_name,application_id,current_unit_id&merged_into=is.null&limit=5000')
    ]).then(function (res) {
      var ledger = res[0] || [], arrs = res[1] || [], pays = res[2] || [], tenants = res[3] || [];
      // Balance per tenant. Finance stores every row's amount SIGNED (charges
      // positive; payments and credits negative — see _rentLedgerToRow), so a
      // row's amount IS its balance contribution for every entry_type,
      // including void reversals. Summing signed amounts exactly matches the
      // finance module's charge-minus-payment running balance.
      var TYPES = { opening_balance: 1, rent_charge: 1, adjustment_debit: 1, payment: 1, adjustment_credit: 1, void: 1 };
      var bal = {}, lastPay = {};
      ledger.forEach(function (r) {
        if (!r || !r.tenant_id || !TYPES[r.entry_type]) return;
        bal[r.tenant_id] = (bal[r.tenant_id] || 0) + (Number(r.amount) || 0);
        // Last real payment date (negative payment rows), for the C&C report.
        if (r.entry_type === 'payment' && Number(r.amount) < 0) {
          var d = String(r.entry_date || '').slice(0, 10);
          if (d && (!lastPay[r.tenant_id] || d > lastPay[r.tenant_id])) lastPay[r.tenant_id] = d;
        }
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
        CACHE.byTenant[t.id] = { tenant: t, balance: Math.round((bal[t.id] || 0) * 100) / 100, lastPayment: lastPay[t.id] || '', arrangements: [], payments: [] };
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
      // finance_arrangements.frequency is NOT NULL with no default; the
      // finance module always writes 'monthly' (see _arrangementToRow).
      frequency: 'monthly',
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
    _audit(tenantId, 'arrears_final_notice', 'Final written notice recorded — ' + days + '-day re-engagement period begins' + ((typeof policyCiteSuffix==='function')?policyCiteSuffix('final_notice_days'):''));
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
    if (!met.length) { showToast('No eviction precondition' + ((typeof policyCiteSuffix==='function')?policyCiteSuffix('final_notice_days'):'') + ' is met or attested — eviction cannot be authorized.', { type: 'error' }); return false; }
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
        return 'Not in good standing: $' + st.balance.toFixed(2) + ' arrears with no approved repayment arrangement' + ((typeof policyCiteSuffix==='function')?policyCiteSuffix('good_standing_gate'):'') + '. Set up an arrangement first.';
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
    mount.innerHTML = '<div class="tic-section tic-section-spaced"><div class="tic-section-h">Arrears &amp; Repayment</div>'
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
      ? showPrompt({ title: 'Extend the window (ED)', message: 'Documented reason for extending past the protected window' + ((typeof policyCiteSuffix==='function')?policyCiteSuffix('arrangement_window_months'):'') + '.', placeholder: 'required', confirmText: 'Record extension' })
      : Promise.resolve(window.prompt('Extension reason (required):'));
    p.then(function (txt) { if (txt != null && String(txt).trim()) { window.arrearsRecordExtension(tid, String(txt)); _repaint(tid, rent); } });
  };
  window._arrUiFinalNotice = function (tid, rent) {
    var days = (typeof policyParam === 'function') ? policyParam('final_notice_days', 'days', 30) : 30;
    var go = (typeof showConfirm === 'function')
      ? showConfirm({ title: 'Record final written notice?', message: 'Confirms the final written notice (grounds + a ' + days + '-day opportunity to re-engage' + ((typeof policyCiteSuffix==='function')?policyCiteSuffix('final_notice_days'):'') + ') has been GIVEN to the tenant. Eviction cannot be authorized until ' + days + ' days after this record.', confirmText: 'Record notice' })
      : Promise.resolve(window.confirm('Record final written notice?'));
    go.then(function (ok) { if (ok) { window.arrearsRecordFinalNotice(tid); _repaint(tid, rent); } });
  };
  window._arrUiEvictionCheck = function (tid, rent) {
    var chk = window.arrearsEvictionCheck(tid);
    var out = document.getElementById('tic_arrears_detail');
    if (!chk || !out) return;
    var html = '<div style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;">'
      + '<div style="font-weight:700;font-size:12px;margin-bottom:6px;">Eviction preconditions' + ((typeof policyCiteSuffix==='function')?policyCiteSuffix('final_notice_days'):'') + '</div>'
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
      ? showConfirm({ title: 'Authorize arrears eviction?', message: 'This records the ED\'s written authorization with the verified/attested policy conditions and the notice history. It is the LAST resort after supportive collection has been exhausted.', confirmText: 'Authorize', cancelText: 'Cancel' })
      : Promise.resolve(window.confirm('Authorize arrears eviction?'));
    go.then(function (ok) {
      if (!ok) return;
      if (window.arrearsAuthorizeEviction(tid, attested, '')) _repaint(tid, rent);
    });
  };

  // ── A/R report for Chief & Council ───────────────────────────────────────
  // The quarterly-report arrears content (Policy s.5.2/s.31): totals, account
  // states, and a per-tenant table — straight from the live finance data the
  // machine already holds. PDF via lazy-loaded jsPDF+autotable (nation header,
  // no hardcoded branding); CSV for spreadsheets.
  window.arrearsReportData = function () {
    var rows = [];
    var sum = { outstanding: 0, credits: 0, inArrears: 0, creditCount: 0,
                arrActive: 0, arrPending: 0, arrNonCompliant: 0, evictions: 0 };
    Object.keys(CACHE.byTenant).forEach(function (tid) {
      var st = window.arrearsStateForTenant(tid);
      if (!st || (st.balance === 0 && !st.arrangement)) return;
      var unit = _unitForTenant(st.tenant);
      var arrStatus = st.hasApproved
        ? (st.compliant ? 'Active — compliant' : 'Active — ' + st.consecutiveMissed + ' mo missed')
        : st.pendingEd ? 'Pending ED approval' : 'None';
      if (st.balance > 0) { sum.outstanding += st.balance; sum.inArrears++; }
      else if (st.balance < 0) { sum.credits += st.balance; sum.creditCount++; }
      if (st.hasApproved) { sum.arrActive++; if (!st.compliant) sum.arrNonCompliant++; }
      if (st.pendingEd) sum.arrPending++;
      if (st.stamps.arrears_eviction_authorized) sum.evictions++;
      rows.push({
        name: (st.tenant && st.tenant.full_name) || tid,
        unit: unit ? ((unit.num || '') + ' ' + (unit.street || '')).trim() : '',
        balance: st.balance,
        arrangement: arrStatus,
        monthly: st.hasApproved ? Number(st.arrangement.payment_amount || 0) : null,
        lastPayment: (CACHE.byTenant[tid].lastPayment || ''),
        windowEnds: st.windowEndsAt || ''
      });
    });
    rows.sort(function (a, b) { return b.balance - a.balance; });
    sum.outstanding = Math.round(sum.outstanding * 100) / 100;
    sum.credits = Math.round(sum.credits * 100) / 100;
    return { rows: rows, sum: sum, asOf: _todayISO() };
  };

  var _jspdfPromise = null;
  function _loadJsPdf() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
    if (_jspdfPromise) return _jspdfPromise;
    function inject(src) {
      return new Promise(function (res, rej) {
        var sc = document.createElement('script');
        sc.src = src; sc.onload = res;
        sc.onerror = function () { rej(new Error('PDF library failed to load')); };
        document.head.appendChild(sc);
      });
    }
    _jspdfPromise = inject('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
      .then(function () { return inject('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js'); })
      .catch(function (e) { _jspdfPromise = null; throw e; });
    return _jspdfPromise;
  }

  window.arrearsCouncilReport = function (format) {
    window.arrearsLoad().then(function () {
      var ids = Object.keys(CACHE.byTenant).filter(function (tid) { return CACHE.byTenant[tid].arrangements.length || CACHE.byTenant[tid].balance !== 0; });
      return window.arrearsLoadStamps(ids.slice(0, 500));
    }).then(function () {
      var d = window.arrearsReportData();
      var nation = (window.NATION_CONFIG && (NATION_CONFIG.display_name || NATION_CONFIG.short)) || 'Housing Authority';
      var money = function (v) { return '$' + Number(v || 0).toLocaleString('en-CA', { minimumFractionDigits: 2 }); };
      if (format === 'csv') {
        var head = ['Tenant', 'Unit', 'Balance', 'Arrangement', 'Monthly Payment', 'Last Payment', 'Window Ends'];
        var csv = [head.join(',')].concat(d.rows.map(function (r) {
          return [r.name, r.unit, r.balance.toFixed(2), r.arrangement, r.monthly != null ? r.monthly.toFixed(2) : '', r.lastPayment, r.windowEnds]
            .map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
        })).join('\n');
        var a = document.createElement('a');
        a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
        a.download = ((window.NATION_CONFIG && NATION_CONFIG.short) || 'Nation') + '_AR_Report_' + d.asOf + '.csv';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        if (typeof auditEntry === 'function') auditEntry('SETTINGS', 'ar_report_generated', 'A/R report exported (CSV) — ' + d.rows.length + ' accounts, ' + money(d.sum.outstanding) + ' outstanding', window.currentRole || 'staff');
        return;
      }
      _loadJsPdf().then(function () {
        var doc = new window.jspdf.jsPDF();
        var pw = doc.internal.pageSize.getWidth();
        doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
        doc.text(nation, 14, 16);
        doc.setFontSize(12); doc.text('Rental Arrears (A/R) Report — Chief & Council', 14, 24);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
        doc.text('As of ' + d.asOf + ' · generated from the housing management system rent ledger', 14, 30);
        var s = d.sum;
        var lines = [
          'Total arrears outstanding: ' + money(s.outstanding) + ' across ' + s.inArrears + ' account(s)',
          'Credit balances: ' + money(s.credits) + ' (' + s.creditCount + ' account(s))',
          'Repayment arrangements: ' + s.arrActive + ' active (' + s.arrNonCompliant + ' non-compliant) · ' + s.arrPending + ' awaiting ED approval',
          'Arrears evictions authorized: ' + s.evictions
        ];
        doc.setFontSize(10);
        lines.forEach(function (t, i) { doc.text(t, 14, 40 + i * 6); });
        doc.autoTable({
          startY: 40 + lines.length * 6 + 4,
          head: [['Tenant', 'Unit', 'Balance', 'Arrangement', '$/mo', 'Last Payment']],
          body: d.rows.map(function (r) {
            return [r.name, r.unit, money(r.balance), r.arrangement, r.monthly != null ? money(r.monthly) : '—', r.lastPayment || '—'];
          }),
          styles: { fontSize: 8, cellPadding: 1.6 },
          headStyles: { fillColor: [40, 40, 40] },
          columnStyles: { 2: { halign: 'right' }, 4: { halign: 'right' } },
          didDrawPage: function () {
            var page = doc.internal.getNumberOfPages();
            doc.setFontSize(8);
            doc.text(nation + ' — A/R Report ' + d.asOf + ' — Page ' + page, 14, doc.internal.pageSize.getHeight() - 8);
          }
        });
        doc.save(((window.NATION_CONFIG && NATION_CONFIG.short) || 'Nation') + '_AR_Report_' + d.asOf + '.pdf');
        if (typeof auditEntry === 'function') auditEntry('SETTINGS', 'ar_report_generated', 'A/R report generated (PDF) — ' + d.rows.length + ' accounts, ' + money(d.sum.outstanding) + ' outstanding', window.currentRole || 'staff');
      }).catch(function (e) {
        showToast('PDF library unavailable (' + e.message + ') — use the CSV export.', { type: 'error' });
      });
    });
  };

  // ── A/R ledger import (reconciliation exercise) ──────────────────────────
  // Paste a Sage-style "A/R Aged Trial Balance" report (or any text/CSV where
  // each line ends with the six money columns Current / 1-30 / 31-60 / 61-90 /
  // Over-90 / Total). Rows are fuzzy-matched to tenants, reviewed, then:
  //   - Total    -> an opening_balance row in finance_rent_ledger (the arrears
  //                 machine + finance module pick it up immediately)
  //   - Current  -> the tenant's unit monthly rent, ONLY when the unit has no
  //                 rent recorded (never overwrites)
  // Every imported row is tagged [AR-IMPORT:<customer-no>] in the ledger
  // description, so re-pasting the same report skips already-imported rows.
  // The same tagged rows double as a customer-number -> tenant memory: once a
  // ledger customer has been imported (even via a manual picker choice), later
  // uploads match them to that tenant automatically, before the name cascade.
  var IMP = { rows: [], imported: {}, remembered: {} };

  function _normName(s) {
    return String(s || '').toLowerCase()
      .replace(/\(.*?\)/g, ' ')                        // (SIW) etc.
      .replace(/\b(rent|mort|mortgage|sec(tion)?)\b/g, ' ')
      .replace(/[^a-z\s]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  function _parseArText(text) {
    var rows = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var l = line.trim();
      if (!l) return;
      var moneys = l.match(/-?[\d,]+\.\d{2}/g);
      if (!moneys || moneys.length < 6) return;
      var last6 = moneys.slice(-6).map(function (m) { return parseFloat(m.replace(/,/g, '')); });
      var headEnd = l.indexOf(moneys[moneys.length - 6]);
      var head = l.slice(0, headEnd).trim();
      var mHead = head.match(/^(\S+)\s+(.+)$/);
      if (!mHead) return;
      var custno = mHead[1], name = mHead[2].replace(/[-–]\s*$/, '').trim();
      if (/interest/i.test(name) || /^HYDRO/i.test(custno)) return;   // non-tenant accounts
      rows.push({ custno: custno, rawName: name, name: _normName(name),
                  current: last6[0], total: last6[5] });
    });
    return rows;
  }
  // Display name for minted tenant rows: the ledger name minus account
  // decorations, keeping the original casing.
  function _cleanDisplayName(raw) {
    return String(raw || '').replace(/\(.*?\)/g, ' ')
      .replace(/\b(RENT|MORT(GAGE)?|SEC(TION)?\d*)\b/gi, ' ')
      .replace(/[–-]\s*$/, '').replace(/\s+/g, ' ').trim();
  }
  function _fuzzyHits(normName, list, nameOf) {
    var toks = normName.split(' ');
    if (toks.length < 2) return [];
    var f = toks[0], l = toks[toks.length - 1];
    return list.filter(function (x) {
      var tt = _normName(nameOf(x)).split(' ');
      return tt.length >= 2 && ((tt[0] === f && tt[tt.length - 1] === l) || (tt[0] === l && tt[tt.length - 1] === f));
    });
  }
  // Three-level match cascade: TENANT (person already in the shared tenants
  // table) -> UNIT (a housing unit's assigned tenant name — housed but no
  // tenant row yet) -> APPLICATION (an applicant on file — arrears from a
  // past tenancy follow them onto the waitlist and feed the good-standing
  // gate). More than one hit at a level = ambiguous: the picker decides.
  function _matchLedgerRow(normName) {
    var tenants = CACHE.tenants || [];
    var units = (window.housingUnits || []).filter(function (u) { return u && !u.archived && u.assignedName; });
    var apps = ((typeof applications !== 'undefined' && applications) ? applications : (window.applications || []))
      .filter(function (a) { return a && !a.archived; });
    var appName = function (a) { return (a.fn || '') + ' ' + (a.ln || ''); };
    // tenants
    var hits = tenants.filter(function (t) { return _normName(t.full_name) === normName; });
    var how = 'exact';
    if (!hits.length) { hits = _fuzzyHits(normName, tenants, function (t) { return t.full_name; }); how = 'fuzzy'; }
    if (hits.length === 1) return { kind: 'tenant', how: how, tenant: hits[0] };
    if (hits.length > 1) return { kind: 'tenant', how: 'ambiguous', ambiguous: hits.length };
    // units
    hits = units.filter(function (u) { return _normName(u.assignedName) === normName; });
    how = 'exact';
    if (!hits.length) { hits = _fuzzyHits(normName, units, function (u) { return u.assignedName; }); how = 'fuzzy'; }
    if (hits.length === 1) return { kind: 'unit', how: how, unit: hits[0] };
    if (hits.length > 1) return { kind: 'unit', how: 'ambiguous', ambiguous: hits.length };
    // applications
    hits = apps.filter(function (a) { return _normName(appName(a)) === normName; });
    how = 'exact';
    if (!hits.length) { hits = _fuzzyHits(normName, apps, appName); how = 'fuzzy'; }
    if (hits.length === 1) return { kind: 'application', how: how, app: hits[0] };
    if (hits.length > 1) return { kind: 'application', how: 'ambiguous', ambiguous: hits.length };
    return { kind: 'none', how: 'none' };
  }
  function _unitForTenant(t) {
    if (!t || !t.current_unit_id) return null;
    return ((window.housingUnits || []).find(function (u) { return u && u.id === t.current_unit_id; })) || null;
  }
  // Resolve (or mint) the tenant row a ledger line's balance attaches to.
  // Unit matches mint an 'active' tenant on the unit; application matches
  // mint an 'applicant' tenant linked to the application — both find-first
  // via sbResolveTenantId so no duplicates are created.
  async function _arImpEnsureTenant(row) {
    if (row.kind === 'tenant' && row.tenantId) return row.tenantId;
    var display = _cleanDisplayName(row.rawName);
    // Find-FIRST only (sbResolveTenantId would create a bare row on miss —
    // we mint our own richer row below, with status + unit/application link).
    try {
      var fr = await fetch(SUPABASE_URL + '/rest/v1/tenants?full_name=eq.'
        + encodeURIComponent(display) + '&merged_into=is.null&select=id&order=id.asc&limit=1', { headers: _hdrs() });
      if (fr.ok) {
        var found = await fr.json();
        if (found && found.length && found[0].id) { row.tenantId = found[0].id; return found[0].id; }
      }
    } catch (e) {}
    var insert = { full_name: display, created_at: new Date().toISOString() };
    if (row.kind === 'unit' && row.unitId) { insert.status = 'active'; insert.current_unit_id = row.unitId; }
    else if (row.kind === 'application' && row.appId) { insert.status = 'applicant'; insert.application_id = row.appId; }
    else return null;
    var r = await fetch(SUPABASE_URL + '/rest/v1/tenants', {
      method: 'POST',
      headers: _hdrs({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify(insert)
    });
    if (!r.ok) throw new Error('tenant create HTTP ' + r.status);
    var saved = (await r.json())[0];
    if (saved && saved.id) {
      CACHE.tenants.push(saved);
      CACHE.byTenant[saved.id] = { tenant: saved, balance: 0, arrangements: [], payments: [] };
      if (typeof auditEntry === 'function') auditEntry('TENANT:' + saved.id, 'tenant_created',
        'Tenant record minted by A/R import (' + row.kind + ' match, ' + row.custno + ')', window.currentRole || 'staff');
      row.tenantId = saved.id;
      return saved.id;
    }
    return null;
  }

  window.openArrearsImport = function () {
    if (!_can('manageArrears')) { showToast('You are not authorized to import arrears.', { type: 'error' }); return; }
    var ex = document.getElementById('modalArImport'); if (ex) ex.remove();
    var mo = document.createElement('div');
    mo.className = 'modal-ov'; mo.id = 'modalArImport';
    mo.innerHTML = '<div class="modal" style="max-width:1000px;width:96%;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;">'
      + '<div class="modal-hdr"><div><h2>Import Arrears Ledger (A/R)</h2>'
      + '<div style="font-size:11px;opacity:.7;margin-top:2px;">Paste the A/R Aged Trial Balance text. Totals become opening balances in the rent ledger; the Current column sets unit rent where none is recorded. Already-imported rows are skipped automatically.</div></div>'
      + '<button class="modal-close" onclick="var m=document.getElementById(\'modalArImport\');if(m)m.remove();">&#x2715;</button></div>'
      + '<div class="modal-body" style="padding:14px 16px;flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;">'
      +   '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">'
      +     '<label class="btn btn-ghost" style="padding:6px 12px;font-size:12px;cursor:pointer;">📄 Upload PDF / text file'
      +       '<input type="file" id="ar_import_file" accept=".pdf,.txt,.csv,application/pdf,text/plain,text/csv" style="display:none;" onchange="_arImpFile(this)"/></label>'
      +     '<span id="ar_import_file_status" style="font-size:11px;color:var(--muted);">…or paste the report text below</span>'
      +   '</div>'
      +   '<textarea id="ar_import_text" style="width:100%;min-height:130px;box-sizing:border-box;font-family:ui-monospace,Menlo,monospace;font-size:11px;" placeholder="Paste the report text here — each customer line ending in the six amount columns…"></textarea>'
      +   '<div style="margin:8px 0;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">'
      +     '<button class="btn btn-primary" onclick="_arImpParse()">Parse &amp; Match</button>'
      +     '<label style="font-size:12px;color:var(--muted);display:inline-flex;align-items:center;gap:6px;">Report as-of date '
      +       '<input type="date" id="ar_import_asof" value="' + _todayISO() + '" style="padding:4px 8px;font-size:12px;"/></label>'
      +   '</div>'
      +   '<div id="ar_import_review"></div>'
      + '</div></div>';
    mo.addEventListener('click', function (e) { if (e.target === mo) mo.remove(); });
    document.body.appendChild(mo); mo.style.display = ''; mo.classList.add('on');
    window.arrearsLoad();
  };

  // ── File upload: .txt/.csv read directly; .pdf extracted in-browser via
  // pdf.js (lazy-loaded from cdnjs — the same CSP-allowlisted host as jsPDF;
  // cross-origin workers can't start, so pdf.js falls back to its main-thread
  // "fake worker" automatically, fine for a report-sized document).
  var PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var _pdfjsPromise = null;
  function _loadPdfjs() {
    if (window.pdfjsLib) return Promise.resolve();
    if (_pdfjsPromise) return _pdfjsPromise;
    _pdfjsPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = PDFJS_URL;
      s.onload = function () {
        try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; } catch (e) {}
        resolve();
      };
      s.onerror = function () { _pdfjsPromise = null; reject(new Error('PDF library failed to load (offline?)')); };
      document.head.appendChild(s);
    });
    return _pdfjsPromise;
  }
  // Rebuild text LINES from pdf.js text items: group by row (rounded y within
  // the page), order by x, join with spaces — the report is a table, so each
  // customer's columns share one baseline.
  function _arImpLinesFromItems(items) {
    var rows = {};
    (items || []).forEach(function (it) {
      if (!it || !it.str || !it.transform) return;
      var y = Math.round(it.transform[5]);
      var key = null;
      // Snap to an existing row within 2px so tiny baseline jitter doesn't split rows.
      for (var dy = -2; dy <= 2; dy++) { if (rows[y + dy]) { key = y + dy; break; } }
      if (key == null) { key = y; rows[key] = []; }
      rows[key].push({ x: it.transform[4], s: it.str });
    });
    return Object.keys(rows)
      .sort(function (a, b) { return Number(b) - Number(a); })   // top of page first
      .map(function (k) {
        return rows[k].sort(function (a, b) { return a.x - b.x; }).map(function (p) { return p.s; }).join(' ');
      });
  }
  window._arImpLinesFromItems = _arImpLinesFromItems;   // exposed for tests
  window._arImpFile = function (input) {
    var f = input && input.files && input.files[0];
    if (!f) return;
    var status = document.getElementById('ar_import_file_status');
    var setStatus = function (t) { if (status) status.textContent = t; };
    var finish = function (text) {
      var ta = document.getElementById('ar_import_text');
      if (ta) ta.value = text;
      setStatus(f.name + ' loaded — parsing…');
      window._arImpParse();
      setStatus(f.name + ' loaded.');
    };
    input.value = '';
    if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
      setStatus('Reading ' + f.name + '…');
      var reader = new FileReader();
      reader.onload = function () {
        _loadPdfjs().then(function () {
          return window.pdfjsLib.getDocument({ data: new Uint8Array(reader.result) }).promise;
        }).then(function (doc) {
          var pages = [];
          var chain = Promise.resolve();
          for (var i = 1; i <= doc.numPages; i++) {
            (function (n) {
              chain = chain.then(function () {
                setStatus('Reading ' + f.name + ' — page ' + n + ' of ' + doc.numPages + '…');
                return doc.getPage(n).then(function (p) { return p.getTextContent(); })
                  .then(function (tc) { pages.push(_arImpLinesFromItems(tc.items).join('\n')); });
              });
            })(i);
          }
          return chain.then(function () { finish(pages.join('\n')); });
        }).catch(function (err) {
          setStatus('');
          showToast('Could not read the PDF (' + err.message + '). Paste the report text instead.', { type: 'error' });
        });
      };
      reader.readAsArrayBuffer(f);
    } else {
      var r2 = new FileReader();
      r2.onload = function () { finish(String(r2.result || '')); };
      r2.readAsText(f);
    }
  };

  window._arImpParse = function () {
    var txt = (document.getElementById('ar_import_text') || {}).value || '';
    var review = document.getElementById('ar_import_review');
    if (!review) return;
    review.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px 0;">Matching against tenants and prior imports…</div>';
    Promise.all([
      window.arrearsLoad(),
      _get('finance_rent_ledger?description=like.*AR-IMPORT*&select=description,tenant_id&limit=8000'),
      _get('housing_settings?key=eq.ar_cleanup&select=value&limit=1')
    ]).then(function (res) {
      IMP.imported = {};
      IMP.remembered = {};
      // Merge saved-over-local, local wins: a re-parse fired before the 800ms
      // classification debounce has flushed must not wipe just-typed edits.
      var clsSaved = (res[2] && res[2][0] && res[2][0].value) || {};
      IMP.cleanup = Object.assign({}, clsSaved.accounts || {}, IMP.cleanup || {});
      (res[1] || []).forEach(function (r) {
        var m = String(r.description || '').match(/\[AR-IMPORT:([^\]:]+)(?::([^\]]+))?\]/);
        if (m) {
          (IMP.imported[m[1]] = IMP.imported[m[1]] || {})[m[2] || 'initial'] = true;
          if (r.tenant_id) IMP.remembered[m[1]] = r.tenant_id;
        }
      });
      IMP.rows = _parseArText(txt).map(function (row) {
        // Remembered match first: a customer number imported before resolves
        // straight to the tenant its ledger rows were written against — no
        // name matching, so spelling-variant rows picked manually last month
        // stay matched every month after. Falls back to the name cascade if
        // the remembered tenant no longer exists (merged/removed).
        var m = null, remId = IMP.remembered[row.custno];
        if (remId) {
          var remT = (CACHE.tenants || []).find(function (t) { return t && t.id === remId; });
          if (remT) m = { kind: 'tenant', how: 'remembered', tenant: remT };
        }
        if (!m) m = _matchLedgerRow(row.name);
        row.kind = m.kind; row.how = m.how; row.ambiguous = m.ambiguous || 0;
        row.tenantId = m.tenant ? m.tenant.id : '';
        row.unitId = m.unit ? m.unit.id : (m.tenant && m.tenant.current_unit_id) || '';
        row.appId = m.app ? m.app.id : '';
        row.targetName = m.tenant ? m.tenant.full_name
                       : m.unit ? m.unit.assignedName
                       : m.app ? ((m.app.fn || '') + ' ' + (m.app.ln || '')).trim() : '';
        row.targetDetail = m.unit ? ((m.unit.num || '') + ' ' + (m.unit.street || '')).trim()
                         : m.app ? m.app.id
                         : (m.tenant && m.tenant.current_unit_id) || '';
        var period = (document.getElementById('ar_import_asof') || {}).value || _todayISO();
        row.period = period;
        row.already = !!(IMP.imported[row.custno] && IMP.imported[row.custno][period]);
        row.appBalance = row.tenantId && CACHE.byTenant[row.tenantId]
          ? CACHE.byTenant[row.tenantId].balance : 0;
        row.delta = Math.round((row.total - row.appBalance) * 100) / 100;
        row.inSync = Math.abs(row.delta) < 0.005;
        return row;
      });
      _arImpRender();
    });
  };
  // Manual picker options: tenants + housed units + applications, disambiguated
  // by a suffix the change-handler parses back.
  function _arImpPickerOptions() {
    var opts = [];
    (CACHE.tenants || []).forEach(function (t) { opts.push({ v: t.full_name + '  [tenant]', kind: 'tenant', tenant: t }); });
    (window.housingUnits || []).forEach(function (u) {
      if (u && !u.archived && u.assignedName) opts.push({ v: u.assignedName + '  [unit ' + ((u.num || '') + ' ' + (u.street || '')).trim() + ']', kind: 'unit', unit: u });
    });
    (((typeof applications !== 'undefined' && applications) ? applications : (window.applications || [])) || []).forEach(function (a) {
      if (a && !a.archived) opts.push({ v: (((a.fn || '') + ' ' + (a.ln || '')).trim() || a.id) + '  [' + a.id + ']', kind: 'application', app: a });
    });
    return opts;
  }

  // ── A/R cleanup classification ───────────────────────────────────────────
  // The 20-years-of-A/R cleanup exercise: each ledger account can be tagged
  // with an income program (OW/ODSP), an account flag (Deceased / Write Off /
  // Staff / Other), and a free-text note. Stored in housing_settings key
  // 'ar_cleanup' as {accounts:{custno:{income,flag,note,name,tenantId,total,
  // current,by,at}}} — keyed by the Sage customer number so classifications
  // survive re-imports and re-matches; totals are snapshotted at classify
  // time so the report works without re-parsing the ledger.
  var _CLS_FLAGS = { deceased: 'Deceased', write_off: 'Write Off', staff: 'Staff', other: 'Other' };
  var _clsSaveTimer = null;
  function _arClsPersist() {
    clearTimeout(_clsSaveTimer);
    _clsSaveTimer = setTimeout(function () {
      if (typeof sbSaveSetting === 'function') {
        sbSaveSetting('ar_cleanup', { accounts: IMP.cleanup || {}, updatedAt: new Date().toISOString() });
      }
    }, 800);
  }
  // Deliberately does NOT re-render the table: a re-render mid-typing would
  // throw focus out of the note box. The inputs hold their own state.
  window._arClsSet = function (i, key, value) {
    var r = IMP.rows[i]; if (!r) return;
    if (!_can('manageArrears')) { showToast('You are not authorized to classify arrears accounts.', { type: 'error' }); return; }
    IMP.cleanup = IMP.cleanup || {};
    var e = IMP.cleanup[r.custno] = IMP.cleanup[r.custno] || {};
    var flagChanged = (key === 'flag' && value !== (e.flag || ''));
    e[key] = value;
    e.name = _cleanDisplayName(r.rawName);
    if (r.tenantId) e.tenantId = r.tenantId;
    e.total = r.total; e.current = r.current;
    e.by = (window.HOUSING_SESSION || {}).email || 'staff';
    e.at = new Date().toISOString();
    if (!e.income && !e.flag && !e.note) delete IMP.cleanup[r.custno];
    _arClsPersist();
    if (flagChanged && value && typeof auditEntry === 'function') {
      auditEntry(r.tenantId ? ('TENANT:' + r.tenantId) : 'SETTINGS', 'ar_account_flagged',
        'A/R cleanup: ' + _cleanDisplayName(r.rawName) + ' (' + r.custno + ', ' + _money(r.total) + ') flagged ' + (_CLS_FLAGS[value] || value),
        window.currentRole || 'staff');
    }
  };

  // Cleanup report — every classified account with per-flag $ subtotals.
  // Reads the SAVED dataset (fetches it if the import modal hasn't), so the
  // report can be generated any time, not only right after a parse.
  window._arClsReport = async function (format) {
    var accounts = IMP.cleanup;
    if (!accounts || !Object.keys(accounts).length) {
      try {
        var sv = await _get('housing_settings?key=eq.ar_cleanup&select=value&limit=1');
        accounts = (sv && sv[0] && sv[0].value && sv[0].value.accounts) || {};
        IMP.cleanup = accounts;
      } catch (e) { accounts = IMP.cleanup || {}; }
    }
    var keys = Object.keys(accounts).filter(function (k) { var e = accounts[k]; return e && (e.income || e.flag || e.note); });
    if (!keys.length) { showToast('Nothing classified yet — tag accounts in the Import Arrears Ledger table first.', { type: 'error' }); return; }
    var rows = keys.map(function (k) { var e = accounts[k]; return {
      custno: k, name: e.name || '', income: e.income || '',
      flag: e.flag ? (_CLS_FLAGS[e.flag] || e.flag) : '', note: e.note || '',
      total: Number(e.total || 0), by: e.by || '', at: String(e.at || '').slice(0, 10)
    }; });
    rows.sort(function (a, b) { return (a.flag || 'zz').localeCompare(b.flag || 'zz') || b.total - a.total; });
    var sum = { count: rows.length, flags: {}, ow: 0, odsp: 0, flaggedTotal: 0 };
    rows.forEach(function (r) {
      if (r.income === 'OW') sum.ow++; if (r.income === 'ODSP') sum.odsp++;
      if (r.flag) {
        var f = sum.flags[r.flag] = sum.flags[r.flag] || { n: 0, total: 0 };
        f.n++; f.total = Math.round((f.total + r.total) * 100) / 100;
        sum.flaggedTotal = Math.round((sum.flaggedTotal + r.total) * 100) / 100;
      }
    });
    var asOf = _todayISO();
    var nation = (window.NATION_CONFIG && (NATION_CONFIG.display_name || NATION_CONFIG.short)) || 'Housing Authority';
    var money = function (v) { return '$' + Number(v || 0).toLocaleString('en-CA', { minimumFractionDigits: 2 }); };
    if (format === 'csv') {
      var head = ['Customer #', 'Name', 'Income (OW/ODSP)', 'Account Flag', 'Note', 'Ledger Total', 'Classified By', 'Date'];
      var csv = [head.join(',')].concat(rows.map(function (r) {
        return [r.custno, r.name, r.income, r.flag, r.note, r.total.toFixed(2), r.by, r.at]
          .map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
      })).join('\n');
      var a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
      a.download = ((window.NATION_CONFIG && NATION_CONFIG.short) || 'Nation') + '_AR_Cleanup_' + asOf + '.csv';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      if (typeof auditEntry === 'function') auditEntry('SETTINGS', 'ar_cleanup_report_generated', 'A/R cleanup report exported (CSV) — ' + rows.length + ' classified accounts', window.currentRole || 'staff');
      return;
    }
    _loadJsPdf().then(function () {
      var doc = new window.jspdf.jsPDF();
      doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
      doc.text(nation, 14, 16);
      doc.setFontSize(12); doc.text('A/R Cleanup Classification Report', 14, 24);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      doc.text('As of ' + asOf + ' · classifications recorded during the arrears ledger reconciliation', 14, 30);
      var lines = [rows.length + ' account(s) classified · flagged accounts total ' + money(sum.flaggedTotal)];
      Object.keys(sum.flags).forEach(function (f) {
        lines.push(f + ': ' + sum.flags[f].n + ' account(s) · ' + money(sum.flags[f].total));
      });
      lines.push('Income classified: ' + sum.ow + ' OW · ' + sum.odsp + ' ODSP');
      doc.setFontSize(10);
      lines.forEach(function (t, i) { doc.text(t, 14, 40 + i * 6); });
      doc.autoTable({
        startY: 44 + lines.length * 6,
        head: [['Cust #', 'Name', 'OW/ODSP', 'Flag', 'Note', 'Ledger Total', 'By', 'Date']],
        body: rows.map(function (r) { return [r.custno, r.name, r.income, r.flag, r.note, money(r.total), r.by, r.at]; }),
        styles: { fontSize: 8, cellPadding: 1.6 },
        headStyles: { fillColor: [40, 40, 40] },
        columnStyles: { 5: { halign: 'right' } },
        didDrawPage: function () {
          var page = doc.internal.getNumberOfPages();
          doc.setFontSize(8);
          doc.text(nation + ' — A/R Cleanup ' + asOf + ' — Page ' + page, 14, doc.internal.pageSize.getHeight() - 8);
        }
      });
      doc.save(((window.NATION_CONFIG && NATION_CONFIG.short) || 'Nation') + '_AR_Cleanup_' + asOf + '.pdf');
      if (typeof auditEntry === 'function') auditEntry('SETTINGS', 'ar_cleanup_report_generated', 'A/R cleanup report generated (PDF) — ' + rows.length + ' classified accounts', window.currentRole || 'staff');
    }).catch(function (e2) {
      showToast('PDF library unavailable (' + e2.message + ') — use the CSV export.', { type: 'error' });
    });
  };

  function _rowResolved(r) { return !!(r.tenantId || (r.kind === 'unit' && r.unitId) || (r.kind === 'application' && r.appId)); }
  function _arImpRender() {
    var review = document.getElementById('ar_import_review');
    if (!review) return;
    if (!IMP.rows.length) { review.innerHTML = '<div style="color:var(--muted);font-size:12px;">No ledger lines recognized — each line must end with six amount columns.</div>'; return; }
    var kindChip = {
      tenant:      ['Tenant', 'var(--success)', 'var(--success-bg)'],
      unit:        ['Unit', 'var(--info-blue)', 'var(--info-blue-bg)'],
      application: ['Applicant', 'var(--warn-amber-text)', 'var(--warn-amber-bg)'],
      none:        ['Unmatched', 'var(--danger)', 'var(--danger-bg)']
    };
    var counts = { tenant: 0, unit: 0, application: 0, none: 0, ambiguous: 0, already: 0, rentSets: 0 };
    var picker = _arImpPickerOptions();
    var dl = '<datalist id="ar_tenant_dl">' + picker.map(function (o) { return '<option value="' + _esc(o.v) + '"></option>'; }).join('') + '</datalist>';
    var body = IMP.rows.map(function (r, i) {
      var isAmb = r.how === 'ambiguous';
      if (r.already) counts.already++;
      else if (isAmb) counts.ambiguous++;
      else counts[_rowResolved(r) ? r.kind : 'none']++;
      var unit = r.unitId ? ((window.housingUnits || []).find(function (u) { return u && u.id === r.unitId; })) : null;
      var willSetRent = !!(unit && r.current > 0 && !(Number(unit.monthlyRent) > 0) && !r.already && !isAmb);
      if (willSetRent) counts.rentSets++;
      r._willSetRent = willSetRent;
      var c = kindChip[_rowResolved(r) && !isAmb ? r.kind : 'none'];
      var chipHtml = r.already
        ? '<span style="font-size:10px;font-weight:700;color:var(--muted);">Imported ✓</span>'
        : isAmb
          ? '<span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:8px;color:var(--danger);background:var(--danger-bg);">' + r.ambiguous + ' matches — pick one</span>'
          : '<span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:8px;color:' + c[1] + ';background:' + c[2] + ';"' + (r.how === 'remembered' ? ' title="Matched from a prior import of this customer number"' : '') + '>' + c[0] + (r.how === 'fuzzy' ? ' ~' : r.how === 'remembered' ? ' ✓' : '') + '</span>';
      var pickerVal = _rowResolved(r) && !isAmb
        ? r.targetName + (r.kind === 'unit' ? '  [unit ' + _esc(r.targetDetail) + ']' : r.kind === 'application' ? '  [' + _esc(r.targetDetail) + ']' : '  [tenant]')
        : '';
      if (!r.already && !isAmb && _rowResolved(r) && r.inSync) counts.insync = (counts.insync || 0) + 1;
      var canRow = _rowResolved(r) && !isAmb && !r.already && !r.inSync;
      // Cleanup classification cells — active on EVERY row (already-imported
      // and in-sync included; classifying is the point of the exercise).
      var cls = (IMP.cleanup || {})[r.custno] || {};
      if (cls.income || cls.flag || cls.note) counts.classified = (counts.classified || 0) + 1;
      var clsHtml =
          '<td><select data-ar-cls="' + i + '" data-cls-k="income" style="font-size:11px;padding:3px 4px;">'
        +   ['', 'OW', 'ODSP'].map(function (o) { return '<option value="' + o + '"' + ((cls.income || '') === o ? ' selected' : '') + '>' + (o || '—') + '</option>'; }).join('')
        + '</select></td>'
        + '<td><select data-ar-cls="' + i + '" data-cls-k="flag" style="font-size:11px;padding:3px 4px;">'
        +   '<option value=""' + (!cls.flag ? ' selected' : '') + '>—</option>'
        +   Object.keys(_CLS_FLAGS).map(function (f) { return '<option value="' + f + '"' + (cls.flag === f ? ' selected' : '') + '>' + _CLS_FLAGS[f] + '</option>'; }).join('')
        + '</select></td>'
        + '<td><input data-ar-cls="' + i + '" data-cls-k="note" value="' + _esc(cls.note || '') + '" placeholder="note…" style="width:130px;font-size:11px;padding:3px 6px;"/></td>';
      return '<tr' + (r.already ? ' style="opacity:.5;"' : '') + '>'
        + '<td style="font-family:ui-monospace,monospace;font-size:10px;">' + _esc(r.custno) + '</td>'
        + '<td style="font-weight:600;font-size:12px;">' + _esc(r.rawName) + '</td>'
        + '<td>' + chipHtml + '</td>'
        + '<td><input list="ar_tenant_dl" data-ar-row="' + i + '" value="' + _esc(pickerVal) + '" placeholder="pick person…" style="width:190px;font-size:11px;padding:3px 6px;"' + (r.already ? ' disabled' : '') + '/></td>'
        + '<td style="text-align:right;font-size:12px;">' + _money(r.current) + '</td>'
        + '<td style="text-align:right;font-size:12px;font-weight:700;">' + _money(r.total) + '</td>'
        + '<td style="text-align:right;font-size:11px;color:var(--muted);">' + (_rowResolved(r) && !isAmb ? _money(r.appBalance) : '') + '</td>'
        + '<td style="text-align:right;font-size:11px;font-weight:700;white-space:nowrap;">' + (r.already ? '' : isAmb || !_rowResolved(r) ? '' : (r.inSync ? '<span style="color:var(--success);">in sync</span>' : ((r.delta > 0 ? '+' : '') + _money(r.delta).replace('$-','-$')))) + '</td>'
        + '<td style="font-size:10px;color:var(--muted);white-space:nowrap;">' + (willSetRent ? 'rent → ' + _money(r.current) : (unit && Number(unit.monthlyRent) > 0 ? 'rent set' : '')) + '</td>'
        + clsHtml
        + '<td>' + (canRow ? '<button class="btn btn-ghost" style="padding:3px 10px;font-size:11px;white-space:nowrap;" data-ar-import-one="' + i + '">Import</button>' : '') + '</td>'
        + '</tr>';
    }).join('');
    review.innerHTML = dl
      + '<div style="font-size:12px;color:var(--muted);margin-bottom:6px;">' + IMP.rows.length + ' rows — '
      + counts.tenant + ' tenant · ' + counts.unit + ' unit · ' + counts.application + ' applicant · '
      + counts.none + ' unmatched · ' + counts.ambiguous + ' ambiguous · ' + counts.already + ' imported · '
      + (counts.insync || 0) + ' already in sync · ' + counts.rentSets + ' unit rents will be set · ' + (counts.classified || 0) + ' classified for cleanup. Each import writes the DIFFERENCE between the report total and the app balance (first import = opening balance; monthly re-imports = adjustments), so re-running the monthly A/R keeps balances synced. Unit/Applicant matches create the missing tenant record on import (find-first, audited). ~ marks a fuzzy name match; ✓ marks a customer remembered from a prior import (matched by customer number, not name). OW/ODSP, Flag and Note save automatically as you set them and feed the A/R Cleanup Report.</div>'
      + '<div style="overflow-x:auto;"><table class="tbl"><thead><tr><th>Cust #</th><th>Ledger name</th><th>Match</th><th>Matched to</th><th style="text-align:right;">Current</th><th style="text-align:right;">Ledger Total</th><th style="text-align:right;">App Balance</th><th style="text-align:right;">Will Write</th><th></th><th>OW/ODSP</th><th>Flag</th><th>Note</th><th></th></tr></thead><tbody>'
      + body + '</tbody></table></div>'
      + '<div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
      + '<button class="btn btn-primary" onclick="_arImpRun()">Import all matched rows</button>'
      + '<button class="btn btn-ghost" onclick="_arClsReport(\'pdf\')">📄 Cleanup Report (PDF)</button>'
      + '<button class="btn btn-ghost" onclick="_arClsReport(\'csv\')">Cleanup CSV</button>'
      + '<span id="ar_import_progress" style="font-size:12px;color:var(--muted);"></span></div>';
    review.querySelectorAll('[data-ar-row]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        var r = IMP.rows[Number(inp.getAttribute('data-ar-row'))];
        var o = picker.find(function (x) { return x.v === inp.value; });
        r.tenantId = ''; r.unitId = ''; r.appId = ''; r.ambiguous = 0;
        if (o) {
          r.kind = o.kind; r.how = 'exact';
          if (o.kind === 'tenant') { r.tenantId = o.tenant.id; r.unitId = o.tenant.current_unit_id || ''; r.targetName = o.tenant.full_name; r.targetDetail = o.tenant.current_unit_id || ''; }
          else if (o.kind === 'unit') { r.unitId = o.unit.id; r.targetName = o.unit.assignedName; r.targetDetail = ((o.unit.num || '') + ' ' + (o.unit.street || '')).trim(); }
          else { r.appId = o.app.id; r.targetName = ((o.app.fn || '') + ' ' + (o.app.ln || '')).trim(); r.targetDetail = o.app.id; r.unitId = o.app.assignedUnit || ''; }
        } else { r.kind = 'none'; r.how = 'none'; r.targetName = ''; r.targetDetail = ''; }
        _arImpRender();
      });
    });
    review.querySelectorAll('[data-ar-import-one]').forEach(function (btn) {
      btn.addEventListener('click', function () { _arImpImportOne(Number(btn.getAttribute('data-ar-import-one'))); });
    });
    review.querySelectorAll('[data-ar-cls]').forEach(function (inp) {
      inp.addEventListener('change', function () {
        window._arClsSet(Number(inp.getAttribute('data-ar-cls')), inp.getAttribute('data-cls-k'), inp.value.trim());
      });
    });
  }

  // Per-row import: resolve/mint the tenant, write the opening balance, set
  // unit rent where applicable, audit — then refresh the table in place.
  window._arImpImportOne = async function (i) {
    var r = IMP.rows[i];
    if (!r || r.already || !_rowResolved(r) || r.how === 'ambiguous' || r.inSync) return false;
    if (!_can('manageArrears')) { showToast('You are not authorized to import arrears.', { type: 'error' }); return false; }
    var prog = document.getElementById('ar_import_progress');
    try {
      var tid = await _arImpEnsureTenant(r);
      if (!tid) { showToast('Could not resolve a tenant record for ' + r.rawName + '.', { type: 'error' }); return false; }
      // Balance SYNC: write the difference between the report total and the
      // current app balance. First import (no balance) lands as an opening
      // balance; later monthly imports land as adjustments. Signed amounts:
      // positive = adjustment_debit, negative = adjustment_credit — either
      // way the stored amount is the balance contribution.
      var bal = (CACHE.byTenant[tid] && CACHE.byTenant[tid].balance) || 0;
      var delta = Math.round((r.total - bal) * 100) / 100;
      if (Math.abs(delta) < 0.005) { r.already = true; _arImpRender(); return true; }
      var etype = bal === 0 ? 'opening_balance' : (delta > 0 ? 'adjustment_debit' : 'adjustment_credit');
      var asOf = r.period || _todayISO();
      var resp = await fetch(SUPABASE_URL + '/rest/v1/finance_rent_ledger', {
        method: 'POST',
        headers: _hdrs({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
        body: JSON.stringify([{
          id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random(),
          nation_id: (window.NATION_CONFIG && NATION_CONFIG.id) || 'default',
          tenant_id: tid,
          unit_id: r.unitId || null,
          entry_type: etype,
          amount: delta,
          entry_date: asOf,
          description: 'A/R balance sync ' + asOf + ' — ' + r.rawName + ' (ledger ' + r.total.toFixed(2) + ', app ' + bal.toFixed(2) + ') [AR-IMPORT:' + r.custno + ':' + asOf + ']',
          // finance_rent_ledger.created_by is NOT NULL with no default —
          // omitting it 400s the insert.
          created_by: (window.HOUSING_SESSION && HOUSING_SESSION.email) || 'ar-import'
        }])
      });
      if (!resp.ok) throw new Error('ledger insert HTTP ' + resp.status);
      if (r._willSetRent && r.unitId) {
        var unit = (window.housingUnits || []).find(function (u) { return u && u.id === r.unitId; });
        if (unit && !(Number(unit.monthlyRent) > 0)) {
          unit.monthlyRent = Math.round(r.current * 100) / 100;
          if (typeof saveUnitWithDraftFallback === 'function') saveUnitWithDraftFallback(unit);
          else if (typeof sbSaveUnit === 'function') sbSaveUnit(unit);
          if (typeof auditEntry === 'function') auditEntry(unit.id, 'rent_set_from_ar_import',
            'Monthly rent set to $' + unit.monthlyRent.toFixed(2) + ' from the A/R ledger Current column (' + r.custno + ')', window.currentRole || 'staff');
        }
      }
      if (typeof auditEntry === 'function') auditEntry('TENANT:' + tid, 'arrears_imported',
        'A/R balance synced to ' + _money(r.total) + ' (' + etype + ' ' + _money(delta) + ', ' + r.custno + ', ' + r.kind + ' match, as of ' + asOf + ')', window.currentRole || 'staff');
      var e = CACHE.byTenant[tid];
      if (e) e.balance = Math.round((e.balance + delta) * 100) / 100;
      r.already = true;
      (IMP.imported[r.custno] = IMP.imported[r.custno] || {})[asOf] = true;
      _arImpRender();
      return true;
    } catch (err) {
      if (prog) prog.textContent = '';
      showToast('Import failed for ' + r.rawName + ': ' + err.message, { type: 'error' });
      return false;
    }
  };

  window._arImpRun = async function () {
    if (!_can('manageArrears')) return;
    var todo = IMP.rows.map(function (r, i) { return { r: r, i: i }; })
      .filter(function (x) { return _rowResolved(x.r) && x.r.how !== 'ambiguous' && !x.r.already && !x.r.inSync; });
    if (!todo.length) { showToast('Nothing to import — no matched, un-imported rows with a total.', { type: 'error' }); return; }
    var kinds = { tenant: 0, unit: 0, application: 0 };
    todo.forEach(function (x) { kinds[x.r.kind] = (kinds[x.r.kind] || 0) + 1; });
    var go = (typeof showConfirm === 'function')
      ? await showConfirm({ title: 'Import ' + todo.length + ' ledger rows?',
          message: kinds.tenant + ' tenant matches, ' + kinds.unit + ' unit matches, ' + kinds.application + ' applicant matches. '
            + 'Each row writes an opening balance into the finance rent ledger (tagged for re-run safety); unit and applicant matches create their missing tenant record first (find-first); '
            + 'unit rent is set from the Current column only where none is recorded. Every write is audited.',
          confirmText: 'Import ' + todo.length, cancelText: 'Cancel' })
      : window.confirm('Import ' + todo.length + ' rows?');
    if (!go) return;
    var prog = document.getElementById('ar_import_progress');
    var done = 0, failed = 0;
    for (var k = 0; k < todo.length; k++) {
      if (prog) prog.textContent = 'Importing ' + (k + 1) + ' of ' + todo.length + '…';
      var okRow = await window._arImpImportOne(todo[k].i);
      if (okRow) done++; else failed++;
    }
    if (prog) prog.textContent = '';
    showToast('Imported ' + done + ' arrears balances' + (failed ? ' · ' + failed + ' failed (see messages)' : '') + '.', { type: failed ? 'error' : 'info' });
    await window.arrearsLoad(true);
    _arImpRender();
    if (typeof renderWorklist === 'function' && document.getElementById('worklist_body')) renderWorklist();
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
