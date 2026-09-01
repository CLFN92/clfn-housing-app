/* apply.js - applicant application portal (Phase T-A: magic-link auth + dashboard).
 * Self-contained. Talks only to Supabase Auth (magic link) and the authenticated
 * `applicant-intake` Edge Function with the applicant's own JWT. Never touches
 * production tables. The full application wizard arrives in Phase T-B. */
(function () {
  'use strict';

  var SB   = window.SUPABASE_URL || '';
  var ANON = window.SUPABASE_ANON || '';
  var NC   = window.NATION_CONFIG || {};
  var SBASE = SB ? SB.replace(/\/$/, '') : '';
  var AUTH = SBASE ? SBASE + '/auth/v1' : '';
  var FN   = SBASE ? SBASE + '/functions/v1/applicant-intake' : '';
  var BUCKET = window.STORAGE_BUCKET || 'housing-files';
  var REDIRECT = location.origin + location.pathname;   // where the magic link returns

  var LS_AT = 'clfn_apply_at', LS_RT = 'clfn_apply_rt';
  var app = document.getElementById('app');
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };

  // Nation branding — applied at boot and re-applied when the registry
  // refresh lands mid-visit (a stale localStorage cache otherwise leaves the
  // OLD brand colour on buttons until the next visit).
  function _applyBranding() {
    var C = window.NATION_CONFIG || NC;
    var nn = document.getElementById('nname'), nl = document.getElementById('nlogo');
    if (nn) nn.textContent = (C.display_name || C.short || 'Housing') + ' Housing';
    if (nl) nl.textContent = ((C.short || 'H').charAt(0) || 'H').toUpperCase();
    if (C.primary_color) document.documentElement.style.setProperty('--accent', C.primary_color);
  }
  _applyBranding();
  window.addEventListener('fnhub:registry-refreshed', _applyBranding);

  function getAT() { return localStorage.getItem(LS_AT) || ''; }
  function getRT() { return localStorage.getItem(LS_RT) || ''; }
  function setSession(at, rt) { if (at) localStorage.setItem(LS_AT, at); if (rt) localStorage.setItem(LS_RT, rt); }
  // One place for the client-side registry-number shape check + its generic,
  // non-disclosing error sentence (two hand-copies before).
  function _bandInvalidMsg(band) {
    return /^\d{10}$/.test(band) ? '' : 'That band / membership number could not be verified. Please check the number on your status card, or contact the Housing office.';
  }

  function clearSession() {
    localStorage.removeItem(LS_AT); localStorage.removeItem(LS_RT);
    // The verified registry number is personal data — never leave it behind
    // for the NEXT person on a shared device (band office kiosk, family
    // computer), where it would silently prefill their application.
    try { localStorage.removeItem('clfn_apply_band'); } catch (e) {}
  }

  function authHeaders() { return { 'apikey': ANON, 'Authorization': 'Bearer ' + getAT(), 'Content-Type': 'application/json' }; }

  // Try to refresh the access token once with the stored refresh token.
  async function refreshSession() {
    var rt = getRT(); if (!rt) return false;
    try {
      var r = await fetch(AUTH + '/token?grant_type=refresh_token', {
        method: 'POST', headers: { 'apikey': ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: rt })
      });
      if (!r.ok) return false;
      var d = await r.json();
      if (d && d.access_token) { setSession(d.access_token, d.refresh_token || rt); return true; }
    } catch (e) {}
    return false;
  }

  // Call the intake function, refreshing the token once on 401.
  async function api(action, extra) {
    var doCall = function () {
      return fetch(FN, { method: 'POST', headers: authHeaders(), body: JSON.stringify(Object.assign({ action: action }, extra || {})) });
    };
    var r = await doCall();
    if (r.status === 401 && await refreshSession()) r = await doCall();
    var data = await r.json().catch(function () { return {}; });
    return { ok: r.ok, status: r.status, data: data };
  }

  // ---- Views ----------------------------------------------------------------
  // Front-door state from portal_info: whether sign-in also requires a band
  // number, and whether the portal is open at all. The 3-digit prefix itself
  // is never sent to the client (anti-spoofing) — the server checks it.
  // The band_required answer is CACHED per device so the field renders
  // instantly on every visit after the first — without the cache, the field
  // popped in only after the portal_info round-trip (a visible delay on edge
  // function cold starts). The fresh server answer still reconciles silently.
  var LS_BANDREQ = 'clfn_apply_band_req';
  var _loginBandRequired = (function () {
    try { return localStorage.getItem(LS_BANDREQ) === '1'; } catch (e) { return false; }
  })();
  function _setBandRowVisible(on) {
    _loginBandRequired = !!on;
    var row = document.getElementById('band_row');
    if (!row) return;
    row.style.display = on ? '' : 'none';
    if (on) {
      var b = document.getElementById('lband');
      if (b && !b._enterWired) {
        b._enterWired = true;
        b.addEventListener('keydown', function (e) { if (e.key === 'Enter') sendLink(); });
      }
    }
  }
  function showLogin(prefill) {
    app.innerHTML =
      '<h1>Housing application portal</h1>'
      + '<p class="sub">Sign in with your email. We\'ll send you a secure link — no password to remember. Clicking the link confirms your email and signs you in.</p>'
      + '<label for="em">Email address</label>'
      + '<input id="em" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" value="' + esc(prefill || '') + '"/>'
      + '<div id="band_row" style="display:none;">'
      +   '<label for="lband">Band / membership number</label>'
      +   '<input id="lband" type="text" inputmode="numeric" autocomplete="off" maxlength="14"/>'
      + '</div>'
      + '<div class="msg" id="lmsg"></div>'
      + '<button class="btn" id="lbtn" type="button">Email me a sign-in link</button>'
      + '<div class="foot">Your information is kept private and reviewed only by the Housing office.</div>';
    document.getElementById('lbtn').addEventListener('click', sendLink);
    document.getElementById('em').addEventListener('keydown', function (e) { if (e.key === 'Enter') sendLink(); });
    if (_loginBandRequired) _setBandRowVisible(true);   // instant, from cache
    _loginApplyPortalInfo();
  }

  // Ask the server whether the portal is open and whether a band number is
  // required, then adapt the sign-in screen. Fails open (plain email sign-in)
  // if the call can't complete — the server still enforces everything.
  async function _loginApplyPortalInfo() {
    try {
      var r = await fetch(FN, {
        method: 'POST', headers: { 'apikey': ANON, 'Authorization': 'Bearer ' + ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'portal_info' })
      });
      var d = await r.json().catch(function () { return {}; });
      if (d && d.ok && d.enabled === false) {
        app.innerHTML = '<div class="center"><h1>Applications are closed</h1><p class="sub">'
          + esc(d.closed_message || 'Online applications are currently closed. Please contact the Housing office.') + '</p></div>';
        return;
      }
      if (d && d.ok) {
        try { localStorage.setItem(LS_BANDREQ, d.band_required ? '1' : '0'); } catch (e) {}
        _setBandRowVisible(!!d.band_required);
      }
    } catch (e) { /* fail open — server-side gates still apply */ }
  }

  function setMsg(id, text, kind) {
    var el = document.getElementById(id); if (!el) return;
    el.className = 'msg ' + (kind || 'err'); el.textContent = text;
  }

  function showCheckEmail(em) {
    app.innerHTML = '<div class="center"><div style="font-size:40px;">📧</div>'
      + '<h1>Check your email</h1>'
      + '<p class="sub">We sent a sign-in link to <b>' + esc(em) + '</b>. Open it on this device to continue. The link expires shortly.</p>'
      + '<button class="btn ghost" type="button" onclick="location.reload()">Back</button></div>';
  }

  // Fallback to Supabase's built-in magic-link sender (used only if the nation
  // has no email provider configured, or our function is unreachable).
  async function _otpFallback(em) {
    try {
      var r = await fetch(AUTH + '/otp?redirect_to=' + encodeURIComponent(REDIRECT), {
        method: 'POST', headers: { 'apikey': ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: em, create_user: true })
      });
      return r.ok;
    } catch (e) { return false; }
  }

  async function sendLink() {
    var em = (document.getElementById('em').value || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { setMsg('lmsg', 'Please enter a valid email address.', 'err'); return; }
    var band = '';
    if (_loginBandRequired) {
      band = ((document.getElementById('lband') || {}).value || '').replace(/[\s-]/g, '');
      // Generic on purpose — never disclose the expected length or prefix.
      var _bandErr = _bandInvalidMsg(band); if (_bandErr) { setMsg('lmsg', _bandErr, 'err'); return; }
    }
    var btn = document.getElementById('lbtn'); btn.disabled = true; btn.textContent = 'Sending…';
    function fail(msg) { setMsg('lmsg', msg || 'Could not send the link. Please try again.', 'err'); btn.disabled = false; btn.textContent = 'Email me a sign-in link'; }
    function ok() {
      // Remember the verified number so the application form pre-fills it —
      // the applicant shouldn't have to type it twice.
      if (band) { try { localStorage.setItem('clfn_apply_band', band); } catch (e) {} }
      showCheckEmail(em);
    }
    try {
      // Preferred: our branded pipeline (the nation's own sender via applicant-intake).
      var r = await fetch(FN, {
        method: 'POST', headers: { 'apikey': ANON, 'Authorization': 'Bearer ' + ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request_link', email: em, redirect_to: REDIRECT, band: band || undefined })
      });
      var d = await r.json().catch(function () { return {}; });
      if (r.ok && d && d.ok) { ok(); return; }
      // Portal switched off: a 503 too, but must NOT fall back to Supabase's
      // sender — that would sneak past the closed portal.
      if (d && d.portal_disabled) { fail(d.error || 'Online applications are currently closed. Please contact the Housing office.'); return; }
      // No provider configured for this nation -> Supabase's built-in sender.
      // (Reached only after the server's band gate passed, when configured.)
      if (r.status === 503 || (d && d.error === 'email_not_configured')) {
        if (await _otpFallback(em)) { ok(); return; }
      }
      fail(d && d.error && d.error !== 'email_not_configured' ? d.error : null);
    } catch (e) {
      if (await _otpFallback(em)) { ok(); return; }
      fail('Network error. Please try again.');
    }
  }

  // 'approved' deliberately does NOT say "Approved": acceptance means the
  // application entered the housing registry queue, not that a house has been
  // offered — a bare "Approved" pill invited that misread. Wording is
  // per-type via _statusLabel (a file update isn't "in the queue").
  var STATUS_LABEL = {
    draft: 'Draft', submitted: 'Submitted', in_review: 'In review',
    changes_requested: 'Changes requested', approved: 'Accepted — in the housing queue', rejected: 'Not approved', withdrawn: 'Withdrawn'
  };
  var _ACCEPTED_BY_TYPE = { update: 'Processed — file updated', transfer: 'Accepted — in the housing queue', new: 'Accepted — in the housing queue' };
  function _statusLabel(s) {
    var st = s.status || 'draft';
    if (st === 'approved' && _ACCEPTED_BY_TYPE[s.submission_type]) return _ACCEPTED_BY_TYPE[s.submission_type];
    return STATUS_LABEL[st] || st;
  }
  var TYPE_LABEL = { new: 'New application', update: 'Application update', transfer: 'Transfer request' };

  // Whether this nation requires a 10-digit band (registry) number. The
  // 3-digit nation prefix is deliberately NEVER sent to the portal (no hint,
  // no prefix in errors) so the expected format can't be learned and spoofed;
  // the prefix match itself happens server-side at submit.
  var _bandRequired = false;

  async function showDashboard() {
    app.innerHTML = '<div class="center"><p class="sub">Loading your applications…</p></div>';
    var res = await api('ping');
    if (!res.ok) {
      if (res.status === 401) { clearSession(); showLogin(); return; }
      if (res.status === 403) {
        app.innerHTML = '<div class="center"><h1>Confirm your email</h1><p class="sub">'
          + esc((res.data && res.data.error) || 'Please confirm your email, then sign in again.')
          + '</p><button class="btn" type="button" onclick="applyLogout()">Back to sign in</button></div>';
        return;
      }
      if (res.data && res.data.portal_disabled) {
        app.innerHTML = '<div class="center"><h1>Applications are closed</h1><p class="sub">'
          + esc(res.data.error || 'Online applications are currently closed. Please contact the Housing office.')
          + '</p><button class="btn ghost" type="button" onclick="applyLogout()">Sign out</button></div>';
        return;
      }
      app.innerHTML = '<div class="center"><h1>Something went wrong</h1><p class="sub">'
        + esc((res.data && res.data.error) || 'Please try again shortly.')
        + '</p><button class="btn ghost" type="button" onclick="location.reload()">Retry</button></div>';
      return;
    }
    document.getElementById('btn_out').style.display = '';
    _bandRequired = !!(res.data && res.data.band_required);
    var email = (res.data && res.data.email) || '';
    var subs  = (res.data && res.data.submissions) || [];
    var prof  = (res.data && res.data.profile) || {};
    var linked = (prof && prof.linked_app_ids) || [];
    var name = (prof && prof.full_name) || '';

    var listHtml = subs.length
      ? '<ul class="sublist">' + subs.map(function (s) {
          var st = s.status || 'draft';
          var noteLine = (st === 'changes_requested' && s.review_notes)
            ? '<div style="width:100%;font-size:12px;color:#9a3412;background:#fff7ed;border:1px solid #fed7aa;border-radius:7px;padding:7px 9px;margin-top:6px;"><b>Changes requested:</b> ' + esc(s.review_notes) + '</div>'
            : '';
          return '<li style="flex-wrap:wrap;"><span>' + esc(TYPE_LABEL[s.submission_type] || 'Application')
            + (s.submitted_at ? ' · ' + new Date(s.submitted_at).toLocaleDateString() : '')
            + '</span><span class="pill ' + esc(st) + '">' + esc(_statusLabel(s)) + '</span>'
            + noteLine + '</li>';
        }).join('') + '</ul>'
      : '<div class="empty">You have no applications yet.</div>';

    // "Has application vs not" per account, plus any in-progress draft to resume.
    var hasApp = (linked && linked.length) || subs.some(function (s) { return s.status === 'approved'; });
    var editable = subs.filter(function (s) { return s.status === 'draft' || s.status === 'changes_requested'; });
    var actionHtml, cardTitle, cardHint = '';
    if (editable.length) {
      cardTitle = 'Continue your application';
      if (editable[0].status === 'changes_requested') cardHint = '<p class="sub" style="margin:6px 0 12px;color:#9a3412;">The Housing office asked for some changes. Continue to update and resubmit.</p>';
      actionHtml = '<button class="btn" type="button" onclick="applyContinue(\'' + esc(editable[0].id) + '\')">Continue &rarr;</button>'
        + '<button class="btn ghost" type="button" onclick="showTypeChooser()">Start a different application</button>';
    } else if (hasApp) {
      cardTitle = 'Manage your housing';
      cardHint = '<p class="sub" style="margin:6px 0 12px;">Update your file, request a transfer, or start a new application.</p>';
      actionHtml = '<button class="btn" type="button" onclick="showTypeChooser()">Start an application</button>';
    } else {
      cardTitle = 'Apply for housing';
      cardHint = '<p class="sub" style="margin:6px 0 12px;">Start your housing application. You can save and come back any time.</p>';
      actionHtml = '<button class="btn" type="button" onclick="showTypeChooser()">Start an application</button>';
    }

    app.innerHTML =
      '<h1>Welcome' + (name ? ', ' + esc(name.split(' ')[0]) : '') + '</h1>'
      + '<p class="sub">Signed in as ' + esc(email) + '</p>'
      + '<div class="card"><h3>Your applications</h3>' + listHtml + '</div>'
      + '<div class="card"><h3>' + cardTitle + '</h3>' + cardHint + actionHtml + '</div>';
  }

  // ── Application-type chooser ────────────────────────────────────────────────
  // Mirrors the staff wizard's Application Type card: the member picks what
  // kind of application they are making before the form opens. Business /
  // Department requests are deliberately NOT offered here — those go through
  // the Housing office directly (and the intake API only accepts the three
  // community types).
  var APPLY_TYPES = [
    { key: 'new', title: 'New Housing Application',
      desc: 'You are applying for a housing unit of your own. Your application will be scored and ranked on the waitlist.' },
    { key: 'update', title: 'Existing Tenant — File Update',
      desc: 'You already rent a unit and are updating the information on your file. This is not scored or ranked.' },
    { key: 'transfer', title: 'Existing Tenant — New Housing Request',
      desc: 'You currently rent a unit and are applying to move to a different one. This will be scored and ranked.' }
  ];
  window.showTypeChooser = function () {
    app.innerHTML =
      '<h1>What kind of application?</h1>'
      + '<p class="sub" style="margin:0 0 16px;">Choose the option that matches your situation.</p>'
      + APPLY_TYPES.map(function (t) {
          return '<button type="button" class="typecard" data-apptype="' + esc(t.key) + '"'
            + ' style="display:block;width:100%;text-align:left;background:var(--surface,#fff);border:2px solid var(--hair);border-radius:11px;padding:14px 16px;margin-bottom:10px;cursor:pointer;font-family:inherit;">'
            + '<div style="font-weight:700;font-size:15px;">' + esc(t.title) + '</div>'
            + '<div class="sub" style="margin:4px 0 0;">' + t.desc + '</div>'
            + '</button>';
        }).join('')
      + '<button class="btn ghost" type="button" onclick="showDashboardPublic()" style="margin-top:8px;">&larr; Back</button>';
    Array.prototype.forEach.call(document.querySelectorAll('.typecard'), function (b) {
      b.addEventListener('click', function () { applyStart(b.getAttribute('data-apptype') || 'new'); });
    });
  };

  // Fetch one of the applicant's own submissions in full (RLS: owner only).
  async function apiGetSubmission(id) {
    var doCall = function () {
      return fetch(SB.replace(/\/$/, '') + '/rest/v1/application_submissions?id=eq.' + encodeURIComponent(id) + '&select=*&limit=1',
        { headers: { 'apikey': ANON, 'Authorization': 'Bearer ' + getAT() } });
    };
    var r = await doCall();
    if (r.status === 401 && await refreshSession()) r = await doCall();
    if (!r.ok) return null;
    var rows = await r.json().catch(function () { return []; });
    return (rows && rows[0]) || null;
  }

  window.applyLogout = function () {
    try { fetch(AUTH + '/logout', { method: 'POST', headers: authHeaders() }); } catch (e) {}
    clearSession();
    document.getElementById('btn_out').style.display = 'none';
    showLogin();
  };

  // ==== Application wizard (Phase T-B) ========================================
  // Captures the applicant-facing fields into a payload shaped like the
  // housing_applications `data` blob, so staff can merge it on verify. Staff-only
  // scoring steps (needs/tenancy) are NOT collected here. Documents are a
  // follow-up (T-B.2). Saves drafts + submits through the applicant-intake fn.
  var _wiz = null;
  var REL_OPTS    = ['Spouse / Partner', 'Child', 'Parent', 'Sibling', 'Grandparent', 'Grandchild', 'Other'];
  // Income types store the CANONICAL staff-side values (same list as the
  // staff wizard / TIC), with friendly labels for the member. Records saved
  // by the old label-valued list are normalized on render via _INC_CANON, so
  // drafts and re-opened submissions migrate themselves.
  var INCOME_OPTS = [
    { v: 'Employed',        l: 'Employment' },
    { v: 'Self-Employment', l: 'Self-employed' },
    { v: 'OW',              l: 'Ontario Works (OW)' },
    { v: 'ODSP',            l: 'ODSP (Disability)' },
    { v: 'EI',              l: 'Employment Insurance (EI)' },
    { v: 'CPP',             l: 'CPP' },
    { v: 'Pension',         l: 'Pension' },
    { v: 'Other',           l: 'Other (child benefit, support, ...)' },
    { v: 'No Income',       l: 'No income' }
  ];
  var _INC_CANON = { 'Employment': 'Employed', 'Self-employed': 'Self-Employment',
    'Employment Insurance': 'EI', 'Disability (ODSP)': 'ODSP',
    'Social Assistance': 'OW', 'Child Benefit': 'Other' };
  var PET_SIZES   = ['Small', 'Medium', 'Large'];
  var APPTYPE_OF  = { new: 'new_housing', transfer: 'transfer_request', update: 'existing_tenant' };
  var DOC_CAT_LABEL = { id: 'ID', income: 'Proof of income', housing_hist: 'Housing history', medical: 'Medical', other: 'Other' };

  function wfEsc(v) { return esc(v == null ? '' : v); }
  // Single labeled field bound to payload key `id`.
  function wf(label, id, val, type, opts, ph) {
    type = type || 'text';
    if (type === 'select') {
      return '<label>' + wfEsc(label) + '</label><select id="' + id + '"><option value="">Select&hellip;</option>'
        + (opts || []).map(function (o) { return '<option' + (String(val) === o ? ' selected' : '') + '>' + wfEsc(o) + '</option>'; }).join('') + '</select>';
    }
    if (type === 'checkbox') {
      return '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600;"><input type="checkbox" id="' + id + '" style="width:auto;"' + (val ? ' checked' : '') + '/> ' + wfEsc(label) + '</label>';
    }
    if (type === 'textarea') return '<label>' + wfEsc(label) + '</label><textarea id="' + id + '">' + wfEsc(val) + '</textarea>';
    return '<label>' + wfEsc(label) + '</label><input id="' + id + '" type="' + type + '"' + (ph ? ' placeholder="' + wfEsc(ph) + '"' : '') + ' value="' + wfEsc(val) + '"/>';
  }
  function wfVal(id) { var el = document.getElementById(id); return el ? (el.type === 'checkbox' ? el.checked : el.value.trim()) : (id ? '' : ''); }

  // Repeater: renders array rows of `fields` + an Add button.
  function wfRepeater(cid, rows, fields, addFn) {
    var body = (rows || []).map(function (row, i) {
      return '<div class="wrow" style="border:1px solid var(--hair);border-radius:9px;padding:10px 10px 4px;margin-bottom:8px;position:relative;">'
        + fields.map(function (f) {
            var v = row[f.k];
            if (f.type === 'select') return '<label>' + wfEsc(f.label) + '</label><select data-k="' + f.k + '"><option value="">Select&hellip;</option>' + (f.opts || []).map(function (o) { var ov = (o && typeof o === 'object') ? o.v : o, ol = (o && typeof o === 'object') ? o.l : o; return '<option value="' + wfEsc(ov) + '"' + (String(v) === ov ? ' selected' : '') + '>' + wfEsc(ol) + '</option>'; }).join('') + '</select>';
            return '<label>' + wfEsc(f.label) + '</label><input data-k="' + f.k + '" type="' + (f.type || 'text') + '" value="' + wfEsc(v == null ? '' : v) + '"/>';
          }).join('')
        + '<button type="button" onclick="' + addFn.replace('add', 'rm') + '(' + i + ')" style="position:absolute;top:6px;right:8px;background:none;border:none;color:var(--danger);font-size:20px;line-height:1;cursor:pointer;padding:0;">&times;</button>'
        + '</div>';
    }).join('');
    return '<div id="' + cid + '">' + body + '</div><button type="button" class="btn ghost" style="margin-top:2px;" onclick="' + addFn + '()">+ Add</button>';
  }
  function wfCollectRepeater(cid, keys) {
    var out = [];
    (document.querySelectorAll('#' + cid + ' .wrow') || []).forEach(function (row) {
      var obj = {}, any = false;
      keys.forEach(function (k) { var el = row.querySelector('[data-k="' + k + '"]'); var v = el ? el.value.trim() : ''; obj[k] = v; if (v) any = true; });
      if (any) out.push(obj);
    });
    return out;
  }

  // Living situation: keys from shared-config's LIVING_SITUATIONS registry
  // are stored on the application; the wf() select works with label strings,
  // so map label <-> key on render/collect.
  function _livsitList() { return window.LIVING_SITUATIONS || []; }
  function _livsitLabels() { return _livsitList().map(function (o) { return o.label; }); }
  function _livsitLabel(key) {
    var L = _livsitList();
    for (var i = 0; i < L.length; i++) { if (L[i].key === key) return L[i].label; }
    return '';
  }
  function _livsitKey(label) {
    var L = _livsitList();
    for (var i = 0; i < L.length; i++) { if (L[i].label === label) return L[i].key; }
    return '';
  }

  var WIZ_STEPS = [
    { title: 'Applicant', render: function (p) {
        return '<div class="grid2">' + wf('First name', 'w_fn', p.fn) + wf('Last name', 'w_ln', p.ln) + '</div>'
          + wf('Date of birth', 'w_dob', p.dob, 'date')
          + '<div class="grid2">' + wf('Band / membership #', 'w_band', p.band)
          +   wf('Marital status', 'w_marital', p.marital, 'select', ['Single', 'Married', 'Common-law', 'Separated', 'Divorced', 'Widowed']) + '</div>'
          + wf('Reserve status', 'w_reserve', p.reserve, 'select', ['On Reserve', 'Off Reserve'])
          + wf('Where do you live right now?', 'w_livsit', _livsitLabel(p.livingSituation), 'select', _livsitLabels())
          + '<div class="grid2">' + wf('Phone', 'w_phone', p.phone, 'tel') + wf('Email', 'w_email', p.email, 'email') + '</div>'
          + '<h4 style="margin:16px 0 2px;">Current address</h4>'
          + wf('Street address *', 'w_street', p.street)
          + '<div class="grid2">' + wf('City / community *', 'w_city', p.city) + wf('Province', 'w_province', p.province) + '</div>'
          + '<div class="grid2">' + wf('Postal code', 'w_postal', p.postal) + wf('Date you need housing by', 'w_occDate', p.occDate, 'date') + '</div>'
          + '<div style="margin:12px 0;">' + wf('I am currently homeless / have no fixed address', 'w_homeless', p.homeless, 'checkbox') + '</div>'
          + '<div style="margin:12px 0;">' + wf('I currently have a house on reserve', 'w_haveHouse', p.haveHouse, 'checkbox') + '</div>'
          + '<h4 style="margin:16px 0 2px;">Co-applicant (optional)</h4>'
          + '<div style="margin:8px 0;">' + wf('There is a co-applicant', 'w_hasco', p.hasCoApp, 'checkbox') + '</div>'
          + '<div id="w_co_wrap" style="' + (p.hasCoApp ? '' : 'display:none;') + '">'
          +   '<div class="grid2">' + wf('Co-applicant first name', 'w_cofn', (p.coApp || {}).fn) + wf('Co-applicant last name', 'w_coln', (p.coApp || {}).ln) + '</div>'
          +   '<div class="grid2">' + wf('Date of birth', 'w_codob', (p.coApp || {}).dob, 'date') + wf('Band / membership #', 'w_coband', (p.coApp || {}).band) + '</div>'
          +   '<div class="grid2">' + wf('Phone', 'w_cocell', (p.coApp || {}).cell, 'tel') + wf('Email', 'w_coemail', (p.coApp || {}).email, 'email') + '</div>'
          + '</div>';
      }, collect: function (p) {
        p.fn = wfVal('w_fn'); p.ln = wfVal('w_ln'); p.dob = wfVal('w_dob'); p.band = wfVal('w_band');
        p.livingSituation = _livsitKey(wfVal('w_livsit'));
        p.marital = wfVal('w_marital'); p.reserve = wfVal('w_reserve'); p.phone = wfVal('w_phone'); p.email = wfVal('w_email');
        p.street = wfVal('w_street'); p.city = wfVal('w_city'); p.province = wfVal('w_province'); p.postal = wfVal('w_postal'); p.occDate = wfVal('w_occDate');
        p.homeless = wfVal('w_homeless'); p.haveHouse = wfVal('w_haveHouse'); p.hasCoApp = wfVal('w_hasco');
        p.coApp = { fn: wfVal('w_cofn'), ln: wfVal('w_coln'), dob: wfVal('w_codob'), band: wfVal('w_coband'), cell: wfVal('w_cocell'), email: wfVal('w_coemail') };
      } },
    { title: 'Household', render: function (p) {
        return '<h4 style="margin:0 0 6px;">People who will live in the home</h4>'
          + '<p class="sub" style="margin:0 0 10px;">Everyone besides yourself (and the co-applicant).</p>'
          + wfRepeater('rep_hab', p.habitants || [], [
              { k: 'fn', label: 'First name' }, { k: 'ln', label: 'Last name' },
              { k: 'dob', label: 'Date of birth', type: 'date' }, { k: 'relationship', label: 'Relationship to you', type: 'select', opts: REL_OPTS }
            ], 'wizAddHab')
          + '<h4 style="margin:18px 0 6px;">Pets (optional)</h4>'
          + wfRepeater('rep_pet', p.pets || [], [
              { k: 'name', label: 'Name' }, { k: 'type', label: 'Type (dog, cat&hellip;)' }, { k: 'size', label: 'Size', type: 'select', opts: PET_SIZES }
            ], 'wizAddPet');
      }, collect: function (p) {
        p.habitants = wfCollectRepeater('rep_hab', ['fn', 'ln', 'dob', 'relationship']);
        p.pets = wfCollectRepeater('rep_pet', ['name', 'type', 'size']);
      } },
    { title: 'Income', render: function (p) {
        // Migrate rows saved under the old label-valued type list so their
        // select renders pre-picked (the canonical value persists on next save).
        (p.incomes || []).forEach(function (r) { if (r && _INC_CANON[r.incomeType]) r.incomeType = _INC_CANON[r.incomeType]; });
        return '<h4 style="margin:0 0 6px;">Household income</h4>'
          + '<p class="sub" style="margin:0 0 10px;">Add each source of income for the household.</p>'
          + wfRepeater('rep_inc', p.incomes || [], [
              { k: 'person', label: 'Who' }, { k: 'incomeType', label: 'Type', type: 'select', opts: INCOME_OPTS },
              { k: 'employer', label: 'Employer / source' }, { k: 'primaryAmt', label: 'Monthly amount ($)', type: 'number' }
            ], 'wizAddInc');
      }, collect: function (p) {
        p.incomes = wfCollectRepeater('rep_inc', ['person', 'incomeType', 'employer', 'primaryAmt']);
        // The amount field is labeled "Monthly amount" — stamp the period so
        // the staff form's Person/Type/Amount/Period all arrive filled.
        p.incomes.forEach(function (r) { if (r.primaryAmt) r.incomePeriod = 'month'; });
      } },
    { title: 'Contacts', render: function (p) {
        return '<h4 style="margin:0 0 6px;">References / emergency contacts</h4>'
          + '<p class="sub" style="margin:0 0 10px;">People we can contact about your application.</p>'
          + wfRepeater('rep_ref', p.references || [], [
              { k: 'fn', label: 'First name' }, { k: 'ln', label: 'Last name' },
              { k: 'phone', label: 'Phone', type: 'tel' }, { k: 'relationship', label: 'Relationship' }
            ], 'wizAddRef');
      }, collect: function (p) { p.references = wfCollectRepeater('rep_ref', ['fn', 'ln', 'phone', 'relationship']); } },
    { title: 'Documents', render: function (p) {
        var docs = p._docs || [];
        var list = docs.length
          ? docs.map(function (d, i) {
              return '<div style="display:flex;align-items:center;gap:8px;border:1px solid var(--hair);border-radius:9px;padding:9px 11px;margin-bottom:8px;">'
                + '<span style="flex:1;font-size:13px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + wfEsc(d.name || 'Document') + '</span>'
                + '<span style="font-size:11px;color:var(--muted);white-space:nowrap;">' + wfEsc(DOC_CAT_LABEL[d.category] || d.category || '') + '</span>'
                + '<button type="button" data-rmdoc="' + i + '" style="background:none;border:none;color:var(--danger);font-size:20px;line-height:1;cursor:pointer;padding:0;">&times;</button>'
                + '</div>';
            }).join('')
          : '<div class="sub" style="font-style:italic;margin:0 0 10px;">No documents uploaded yet.</div>';
        return '<h4 style="margin:0 0 6px;">Supporting documents (optional)</h4>'
          + '<p class="sub" style="margin:0 0 12px;">Upload ID, proof of income, or other documents. You can also bring them to the Housing office later.</p>'
          + '<label>Document type</label>'
          + '<select id="doc_cat"><option value="id">ID</option><option value="income">Proof of income</option><option value="housing_hist">Housing history</option><option value="medical">Medical</option><option value="other">Other</option></select>'
          + '<label style="margin-top:10px;">Choose a file</label>'
          + '<input id="doc_file" type="file" accept="image/*,application/pdf" style="padding:9px 10px;"/>'
          + '<div id="doc_list" style="margin-top:14px;">' + list + '</div>'
          + '<div class="msg" id="doc_msg"></div>';
      }, collect: function () { /* docs persist on upload */ }, wire: function () { _wizWireDocs(); } },
    { title: 'Review', render: function (p) {
        var line = function (l, v) { return v ? '<div style="font-size:13px;margin:2px 0;"><b>' + wfEsc(l) + ':</b> ' + wfEsc(v) + '</div>' : ''; };
        return '<h4 style="margin:0 0 8px;">Review &amp; submit</h4>'
          + '<div style="background:var(--surface);border:1px solid var(--hair);border-radius:9px;padding:12px;margin-bottom:14px;">'
          +   line('Name', [p.fn, p.ln].filter(Boolean).join(' '))
          +   line('Date of birth', p.dob) + line('Band #', p.band) + line('Phone', p.phone) + line('Email', p.email)
          +   line('Address', [p.street, p.city, p.province, p.postal].filter(Boolean).join(', '))
          +   line('Household members', (p.habitants || []).length ? (p.habitants.length + ' listed') : '')
          +   line('Income sources', (p.incomes || []).length ? (p.incomes.length + ' listed') : '')
          +   line('References', (p.references || []).length ? (p.references.length + ' listed') : '')
          +   line('Documents', (p._docs || []).length ? (p._docs.length + ' uploaded') : '')
          + '</div>'
          + '<p class="sub" style="margin:0 0 10px;">You can add or change documents on the previous step, or bring them to the Housing office later.</p>'
          + '<h4 style="margin:16px 0 2px;">Comments for the Housing office (optional)</h4>'
          + wf('Anything else you would like us to know about your situation?', 'w_comments', p.applicantComments, 'textarea')
          + '<div style="margin:12px 0;">' + wf('I consent to the Housing office collecting and reviewing this information for my application.', 'w_consent', p.consentShareCLFN, 'checkbox') + '</div>'
          + wf('Type your full name to sign', 'w_sig', (p.sig || {}).typed, 'text', null, 'Your full legal name')
          + wf('Date', 'w_sigdate', (p.sig || {}).date || new Date().toISOString().slice(0, 10), 'date');
      }, collect: function (p) {
        p.applicantComments = wfVal('w_comments');
        p.consentShareCLFN = wfVal('w_consent');
        p.sig = { typed: wfVal('w_sig'), date: wfVal('w_sigdate') };
      } }
  ];

  function wizRender() {
    var s = WIZ_STEPS[_wiz.step], n = WIZ_STEPS.length;
    var dots = WIZ_STEPS.map(function (st, i) { return '<span style="flex:1;height:4px;border-radius:2px;background:' + (i <= _wiz.step ? 'var(--accent)' : 'var(--hair)') + ';"></span>'; }).join('');
    app.innerHTML =
      '<div style="display:flex;gap:4px;margin:4px 0 14px;">' + dots + '</div>'
      + '<h1 style="margin:0 0 2px;">' + wfEsc(s.title) + '</h1>'
      + '<p class="sub">Step ' + (_wiz.step + 1) + ' of ' + n
      +   ((TYPE_LABEL[_wiz.type]) ? ' &middot; ' + wfEsc(TYPE_LABEL[_wiz.type]) : '') + '</p>'
      + '<form id="wizf" novalidate onsubmit="return false;">' + s.render(_wiz.payload) + '</form>'
      + '<div class="msg" id="wmsg"></div>'
      + '<div style="display:flex;gap:10px;margin-top:18px;">'
      +   (_wiz.step > 0 ? '<button class="btn ghost" type="button" onclick="wizNav(-1)">Back</button>' : '<button class="btn ghost" type="button" onclick="wizExit()">Cancel</button>')
      +   (_wiz.step < n - 1
            ? '<button class="btn" type="button" onclick="wizNav(1)">Next</button>'
            : '<button class="btn" type="button" onclick="wizSubmit()">Submit application</button>')
      + '</div>'
      + '<div style="text-align:center;margin-top:12px;"><button type="button" onclick="wizSaveExit()" style="background:none;border:none;color:var(--muted);font-size:13px;text-decoration:underline;cursor:pointer;">Save &amp; finish later</button></div>';
    // Co-applicant show/hide.
    var co = document.getElementById('w_hasco');
    if (co) co.addEventListener('change', function () { var w = document.getElementById('w_co_wrap'); if (w) w.style.display = co.checked ? '' : 'none'; });
    if (s.wire) s.wire();
  }

  // ---- Document upload (Documents step) --------------------------------------
  function _applyUid() {
    try { var t = getAT().split('.')[1]; return JSON.parse(atob(t.replace(/-/g, '+').replace(/_/g, '/'))).sub || ''; }
    catch (e) { return ''; }
  }
  async function _wizUploadFile(file, cat) {
    var uid = _applyUid(), sid = _wiz.id;
    var safe = (file.name || 'file').replace(/[^\w.\-]+/g, '_').slice(0, 80);
    var path = 'application-intake/' + uid + '/' + sid + '/' + (new Date().getTime()) + '_' + safe;
    var r = await fetch(SBASE + '/storage/v1/object/' + BUCKET + '/' + path, {
      method: 'POST', headers: { 'apikey': ANON, 'Authorization': 'Bearer ' + getAT(), 'x-upsert': 'true' }, body: file
    });
    if (r.status === 401 && await refreshSession()) {
      r = await fetch(SBASE + '/storage/v1/object/' + BUCKET + '/' + path, {
        method: 'POST', headers: { 'apikey': ANON, 'Authorization': 'Bearer ' + getAT(), 'x-upsert': 'true' }, body: file
      });
    }
    if (!r.ok) throw new Error(await r.text());
    return { path: path, name: file.name, size: file.size, type: file.type, category: cat };
  }
  async function _wizDeleteFile(path) {
    try {
      await fetch(SBASE + '/storage/v1/object/' + BUCKET, {
        method: 'DELETE', headers: { 'apikey': ANON, 'Authorization': 'Bearer ' + getAT(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [path] })
      });
    } catch (e) {}
  }
  function _wizWireDocs() {
    var f = document.getElementById('doc_file');
    if (f) f.addEventListener('change', function (ev) { var file = ev.target.files && ev.target.files[0]; if (file) _wizAddDoc(file); ev.target.value = ''; });
    var list = document.getElementById('doc_list');
    if (list) Array.prototype.forEach.call(list.querySelectorAll('[data-rmdoc]'), function (b) {
      b.addEventListener('click', function () { _wizRemoveDoc(+b.getAttribute('data-rmdoc')); });
    });
  }
  async function _wizAddDoc(file) {
    var msg = document.getElementById('doc_msg');
    var setMsg = function (t, k) { if (msg) { msg.className = 'msg ' + (k || 'err'); msg.textContent = t; } };
    if (file.size > 15 * 1024 * 1024) { setMsg('That file is too large (max 15 MB).'); return; }
    if (!_wiz.id) { setMsg('Saving…', 'ok'); if (!await wizPersist()) { setMsg('Could not save yet — please try again.'); return; } }
    var cat = (document.getElementById('doc_cat') || {}).value || 'other';
    setMsg('Uploading ' + file.name + '…', 'ok');
    try {
      var meta = await _wizUploadFile(file, cat);
      _wiz.payload._docs = _wiz.payload._docs || [];
      _wiz.payload._docs.push(meta);
      await wizPersist();
      wizRender();
    } catch (e) { setMsg('Upload failed. Please check your connection and try again.'); }
  }
  async function _wizRemoveDoc(i) {
    var docs = _wiz.payload._docs || [];
    var d = docs[i]; if (!d) return;
    if (d.path) await _wizDeleteFile(d.path);
    docs.splice(i, 1); _wiz.payload._docs = docs;
    await wizPersist();
    wizRender();
  }

  function wizCollect() { try { WIZ_STEPS[_wiz.step].collect(_wiz.payload); } catch (e) {} }

  async function wizPersist() {
    _wiz.payload.appType = APPTYPE_OF[_wiz.type] || 'new_housing';
    var res = await api('save_draft', { submission_id: _wiz.id || undefined, submission_type: _wiz.type, payload: _wiz.payload });
    if (res.ok && res.data && res.data.id) { _wiz.id = res.data.id; return true; }
    return false;
  }

  function _evtBtn() { return (typeof event !== 'undefined' && event && event.target) ? event.target : null; }
  // Band-number FORMAT check only. The nation-prefix match is enforced
  // server-side at submit — the portal never knows the prefix. The message is
  // deliberately generic: it never discloses the expected length or prefix.
  function _bandError(p) {
    if (!_bandRequired) return '';
    var band = String(p.band || '').replace(/[\s-]/g, '');
    var _be = _bandInvalidMsg(band); if (_be) return _be;
    p.band = band;
    return '';
  }
  // Current address is required — unless the applicant checked the homeless /
  // no fixed address box, which is exactly the case where there is none.
  function _addrError(p) {
    if (p.homeless) return '';
    if (!p.street || !p.city) return 'Please enter your current address (street and city/community), or check the "currently homeless / no fixed address" box.';
    return '';
  }
  window.wizNav = async function (dir) {
    wizCollect();
    if (dir > 0 && _wiz.step === 0) {
      var bErr = _bandError(_wiz.payload) || _addrError(_wiz.payload);
      if (bErr) { var bm = document.getElementById('wmsg'); if (bm) { bm.className = 'msg err'; bm.textContent = bErr; } return; }
    }
    if (dir > 0) { var btn = _evtBtn(); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; } await wizPersist(); }
    _wiz.step = Math.max(0, Math.min(WIZ_STEPS.length - 1, _wiz.step + dir));
    wizRender();
  };
  window.wizExit = function () { _wiz = null; showDashboard(); };
  window.wizSaveExit = async function () { wizCollect(); await wizPersist(); _wiz = null; showDashboard(); };
  window.wizSubmit = async function () {
    wizCollect();
    var p = _wiz.payload;
    if (!p.fn || !p.ln) { var m = document.getElementById('wmsg'); if (m) { m.className = 'msg err'; m.textContent = 'Please enter your first and last name (Applicant step).'; } return; }
    var bandErr = _bandError(p) || _addrError(p);
    if (bandErr) { var mb = document.getElementById('wmsg'); if (mb) { mb.className = 'msg err'; mb.textContent = bandErr + ' (Applicant step)'; } return; }
    if (!p.consentShareCLFN) { var m2 = document.getElementById('wmsg'); if (m2) { m2.className = 'msg err'; m2.textContent = 'Please check the consent box to submit.'; } return; }
    var btn = _evtBtn(); if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
    if (!await wizPersist()) { if (btn) { btn.disabled = false; btn.textContent = 'Submit application'; } return; }
    var res = await api('submit', { submission_id: _wiz.id });
    if (res.ok && res.data && res.data.ok) {
      _wiz = null;
      app.innerHTML = '<div class="center"><div class="check">&#10003;</div><h1>Application submitted</h1>'
        + '<p class="sub">Thank you. The Housing office has received your application and will review it. You can check the status here any time.</p>'
        + '<button class="btn" type="button" onclick="showDashboardPublic()">Back to my applications</button></div>';
    } else {
      if (btn) { btn.disabled = false; btn.textContent = 'Submit application'; }
      var m3 = document.getElementById('wmsg'); if (m3) { m3.className = 'msg err'; m3.textContent = (res.data && res.data.error) || 'Could not submit. Please try again.'; }
    }
  };
  window.showDashboardPublic = function () { showDashboard(); };

  // Repeater add/remove (collect first so sibling fields aren't lost).
  function wizRepAdd(key) { wizCollect(); _wiz.payload[key] = _wiz.payload[key] || []; _wiz.payload[key].push({}); wizRender(); }
  function wizRepRm(key, i) { wizCollect(); (_wiz.payload[key] || []).splice(i, 1); wizRender(); }
  window.wizAddHab = function () { wizRepAdd('habitants'); }; window.wizRmHab = function (i) { wizRepRm('habitants', i); };
  window.wizAddPet = function () { wizRepAdd('pets'); };       window.wizRmPet = function (i) { wizRepRm('pets', i); };
  window.wizAddInc = function () { wizRepAdd('incomes'); };    window.wizRmInc = function (i) { wizRepRm('incomes', i); };
  window.wizAddRef = function () { wizRepAdd('references'); }; window.wizRmRef = function (i) { wizRepRm('references', i); };

  window.applyStart = function (type) {
    _wiz = { type: type || 'new', id: null, step: 0, payload: {} };
    // Pre-fill the band number verified at sign-in (typed once, used twice).
    try { var sb = localStorage.getItem('clfn_apply_band'); if (sb && !_wiz.payload.band) _wiz.payload.band = sb; } catch (e) {}
    wizRender();
  };
  window.applyContinue = async function (id) {
    app.innerHTML = '<div class="center"><p class="sub">Loading your application…</p></div>';
    var row = await apiGetSubmission(id);
    if (!row) { showDashboard(); return; }
    _wiz = { type: row.submission_type || 'new', id: row.id, step: 0, payload: row.payload || {} };
    wizRender();
  };

  // ---- Boot ------------------------------------------------------------------
  function parseHash() {
    var h = (location.hash || '').replace(/^#/, '');
    if (!h) return null;
    var out = {}; h.split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) out[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); });
    return out;
  }

  if (!SB || !ANON) {
    app.innerHTML = '<div class="center"><h1>Configuration error</h1><p class="sub">Please contact the Housing office.</p></div>';
    return;
  }

  var hash = parseHash();
  if (hash && hash.access_token) {
    setSession(hash.access_token, hash.refresh_token);
    try { history.replaceState(null, '', REDIRECT); } catch (e) { location.hash = ''; }
    showDashboard();
  } else if (hash && hash.error) {
    showLogin();
    setTimeout(function () { setMsg('lmsg', hash.error_description || 'That sign-in link is invalid or has expired. Please request a new one.', 'err'); }, 0);
  } else if (getAT()) {
    showDashboard();
  } else {
    showLogin();
  }
})();
