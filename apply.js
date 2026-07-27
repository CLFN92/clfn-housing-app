/* apply.js - applicant application portal (Phase T-A: magic-link auth + dashboard).
 * Self-contained. Talks only to Supabase Auth (magic link) and the authenticated
 * `applicant-intake` Edge Function with the applicant's own JWT. Never touches
 * production tables. The full application wizard arrives in Phase T-B. */
(function () {
  'use strict';

  var SB   = window.SUPABASE_URL || '';
  var ANON = window.SUPABASE_ANON || '';
  var NC   = window.NATION_CONFIG || {};
  var AUTH = SB ? SB.replace(/\/$/, '') + '/auth/v1' : '';
  var FN   = SB ? SB.replace(/\/$/, '') + '/functions/v1/applicant-intake' : '';
  var REDIRECT = location.origin + location.pathname;   // where the magic link returns

  var LS_AT = 'clfn_apply_at', LS_RT = 'clfn_apply_rt';
  var app = document.getElementById('app');
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };

  // Nation branding.
  var nn = document.getElementById('nname'), nl = document.getElementById('nlogo');
  if (nn) nn.textContent = (NC.display_name || NC.short || 'Housing') + ' Housing';
  if (nl) nl.textContent = ((NC.short || 'H').charAt(0) || 'H').toUpperCase();
  if (NC.primary_color) document.documentElement.style.setProperty('--accent', NC.primary_color);

  function getAT() { return localStorage.getItem(LS_AT) || ''; }
  function getRT() { return localStorage.getItem(LS_RT) || ''; }
  function setSession(at, rt) { if (at) localStorage.setItem(LS_AT, at); if (rt) localStorage.setItem(LS_RT, rt); }
  function clearSession() { localStorage.removeItem(LS_AT); localStorage.removeItem(LS_RT); }

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
  function showLogin(prefill) {
    app.innerHTML =
      '<h1>Housing application portal</h1>'
      + '<p class="sub">Sign in with your email. We\'ll send you a secure link — no password to remember. Clicking the link confirms your email and signs you in.</p>'
      + '<label for="em">Email address</label>'
      + '<input id="em" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" value="' + esc(prefill || '') + '"/>'
      + '<div class="msg" id="lmsg"></div>'
      + '<button class="btn" id="lbtn" type="button">Email me a sign-in link</button>'
      + '<div class="foot">Your information is kept private and reviewed only by the Housing office.</div>';
    document.getElementById('lbtn').addEventListener('click', sendLink);
    document.getElementById('em').addEventListener('keydown', function (e) { if (e.key === 'Enter') sendLink(); });
  }

  function setMsg(id, text, kind) {
    var el = document.getElementById(id); if (!el) return;
    el.className = 'msg ' + (kind || 'err'); el.textContent = text;
  }

  async function sendLink() {
    var em = (document.getElementById('em').value || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { setMsg('lmsg', 'Please enter a valid email address.', 'err'); return; }
    var btn = document.getElementById('lbtn'); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      var r = await fetch(AUTH + '/otp?redirect_to=' + encodeURIComponent(REDIRECT), {
        method: 'POST', headers: { 'apikey': ANON, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: em, create_user: true })
      });
      if (r.ok) {
        app.innerHTML = '<div class="center"><div style="font-size:40px;">📧</div>'
          + '<h1>Check your email</h1>'
          + '<p class="sub">We sent a sign-in link to <b>' + esc(em) + '</b>. Open it on this device to continue. The link expires shortly.</p>'
          + '<button class="btn ghost" type="button" onclick="location.reload()">Back</button></div>';
      } else {
        var d = await r.json().catch(function () { return {}; });
        setMsg('lmsg', (d && (d.msg || d.error_description || d.error)) || 'Could not send the link. Please try again.', 'err');
        btn.disabled = false; btn.textContent = 'Email me a sign-in link';
      }
    } catch (e) {
      setMsg('lmsg', 'Network error. Please try again.', 'err');
      btn.disabled = false; btn.textContent = 'Email me a sign-in link';
    }
  }

  var STATUS_LABEL = {
    draft: 'Draft', submitted: 'Submitted', in_review: 'In review',
    changes_requested: 'Changes requested', approved: 'Approved', rejected: 'Not approved', withdrawn: 'Withdrawn'
  };
  var TYPE_LABEL = { new: 'New application', update: 'Application update', transfer: 'Transfer request' };

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
      app.innerHTML = '<div class="center"><h1>Something went wrong</h1><p class="sub">'
        + esc((res.data && res.data.error) || 'Please try again shortly.')
        + '</p><button class="btn ghost" type="button" onclick="location.reload()">Retry</button></div>';
      return;
    }
    document.getElementById('btn_out').style.display = '';
    var email = (res.data && res.data.email) || '';
    var subs  = (res.data && res.data.submissions) || [];
    var prof  = (res.data && res.data.profile) || {};
    var linked = (prof && prof.linked_app_ids) || [];
    var name = (prof && prof.full_name) || '';

    var listHtml = subs.length
      ? '<ul class="sublist">' + subs.map(function (s) {
          var st = s.status || 'draft';
          return '<li><span>' + esc(TYPE_LABEL[s.submission_type] || 'Application')
            + (s.submitted_at ? ' · ' + new Date(s.submitted_at).toLocaleDateString() : '')
            + '</span><span class="pill ' + esc(st) + '">' + esc(STATUS_LABEL[st] || st) + '</span></li>';
        }).join('') + '</ul>'
      : '<div class="empty">You have no applications yet.</div>';

    // "Has application vs not" (Phase T-B/T-D will wire the buttons):
    var hasApp = (linked && linked.length) || subs.some(function (s) { return s.status === 'approved'; });
    var actionHtml = hasApp
      ? '<button class="btn" type="button" disabled>Update my application (coming soon)</button>'
        + '<button class="btn ghost" type="button" disabled>Request a transfer (coming soon)</button>'
      : '<button class="btn" type="button" disabled>Start a new application (coming soon)</button>';

    app.innerHTML =
      '<h1>Welcome' + (name ? ', ' + esc(name.split(' ')[0]) : '') + '</h1>'
      + '<p class="sub">Signed in as ' + esc(email) + '</p>'
      + '<div class="card"><h3>Your applications</h3>' + listHtml + '</div>'
      + '<div class="card"><h3>' + (hasApp ? 'Manage your housing' : 'Apply for housing') + '</h3>'
      +   '<p class="sub" style="margin:6px 0 0;">The application form will be available here shortly.</p>'
      +   actionHtml
      + '</div>';
  }

  window.applyLogout = function () {
    try { fetch(AUTH + '/logout', { method: 'POST', headers: authHeaders() }); } catch (e) {}
    clearSession();
    document.getElementById('btn_out').style.display = 'none';
    showLogin();
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
