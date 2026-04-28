/* ============================================================
 * auth-login.js — CLFN Housing Suite
 * Login screen behaviour: panel switching, sign-in flow, password
 * reset / email verification, "remember me" persistence. After a
 * successful sign-in, control hands off to housing.html via a
 * redirect — that's where the business app lives, the data cache
 * is hydrated, and the post-login views render. Keeping the
 * unauthenticated entry page (index.html) free of business code
 * is intentional for both security and bundle-size reasons.
 *
 * Loaded only by index.html.
 *
 * Load order: shared.js → shared-config.js → shared-auth.js →
 *             shared-ui.js → shared-data.js → THIS FILE
 * ============================================================ */

'use strict';

// ── "Remember me" persistence (cookie + localStorage) ─────────────────────────
var HOUSING_REMEMBER_KEY = 'clfn_housing_email';
function hSetCookie(name, value, days) {
  try {
    var exp = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = name + '=' + encodeURIComponent(value) + ';expires=' + exp + ';path=/;SameSite=Lax';
  } catch(e) {}
}
function hGetCookie(name) {
  try {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  } catch(e) { return null; }
}
function hDeleteCookie(name) {
  try { document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/'; } catch(e) {}
}

function loadRememberedEmail() {
  try {
    var saved = null;
    try { saved = localStorage.getItem(HOUSING_REMEMBER_KEY); } catch(e) {}
    if (!saved) saved = hGetCookie(HOUSING_REMEMBER_KEY);
    if (saved) {
      var emailEl = document.getElementById('signin-email');
      var remEl   = document.getElementById('remember-me');
      if (emailEl) emailEl.value = saved;
      if (remEl)   remEl.checked = true;
      setTimeout(function(){
        var p = document.getElementById('signin-password');
        if (p) p.focus();
      }, 150);
    }
  } catch(e) {}
}

function saveRememberedEmail(email, remember) {
  try {
    if (remember) {
      try { localStorage.setItem(HOUSING_REMEMBER_KEY, email); } catch(e) {}
      hSetCookie(HOUSING_REMEMBER_KEY, email, 365);
    } else {
      try { localStorage.removeItem(HOUSING_REMEMBER_KEY); } catch(e) {}
      hDeleteCookie(HOUSING_REMEMBER_KEY);
    }
  } catch(e) {}
}

// ── Login screen panel switchers ──────────────────────────────────────────────
function showSignInPanel() {
  var p = document.getElementById('signin-panel');
  var v = document.getElementById('verify-panel');
  var f = document.getElementById('forgot-panel');
  if (p) p.style.display = '';
  if (v) v.style.display = 'none';
  if (f) f.style.display = 'none';
}
function showForgotPassword() {
  var p = document.getElementById('signin-panel');
  var f = document.getElementById('forgot-panel');
  if (p) p.style.display = 'none';
  if (f) f.style.display = '';
}
function hidLoginScreen() {
  var ls = document.getElementById('loginScreen');
  if (ls) ls.style.display = 'none';
}
function showLoginScreen() {
  var ls = document.getElementById('loginScreen');
  if (ls) { ls.style.display = 'flex'; }
  showSignInPanel();
  var p = document.getElementById('signin-password'); if (p) p.value = '';
  var e = document.getElementById('signin-error');    if (e) e.style.display = 'none';
}

// ── Email verification + password reset (Supabase auth endpoints) ─────────────
async function resendVerification() {
  var msgEl  = document.getElementById('verify-msg');
  var dispEl = document.getElementById('verify-email-display');
  var email  = dispEl ? (dispEl.textContent || '').trim() : '';
  if (!email) {
    if (msgEl) { msgEl.textContent = 'No email address on file. Please sign in again.'; msgEl.style.color = '#fca5a5'; msgEl.style.display = ''; }
    return;
  }
  if (msgEl) { msgEl.textContent = 'Sending…'; msgEl.style.color = '#888'; msgEl.style.display = ''; }
  try {
    var r = await fetch(SUPABASE_URL + '/auth/v1/resend', {
      method:  'POST',
      headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ type: 'signup', email: email })
    });
    if (!r.ok) {
      var d; try { d = await r.json(); } catch(e) { d = {}; }
      throw new Error(d.error_description || d.msg || 'Could not resend verification email');
    }
    if (msgEl) { msgEl.textContent = 'Verification email resent. Check your inbox.'; msgEl.style.color = '#86efac'; }
  } catch(e) {
    if (msgEl) { msgEl.textContent = e.message || 'Failed to resend.'; msgEl.style.color = '#fca5a5'; }
  }
}

async function sendPasswordReset() {
  var inp   = document.getElementById('forgot-email');
  var msgEl = document.getElementById('forgot-msg');
  var email = inp ? (inp.value || '').trim() : '';
  if (!email) {
    if (msgEl) { msgEl.textContent = 'Enter your email address.'; msgEl.style.color = '#fca5a5'; msgEl.style.background = '#3b0a0a'; msgEl.style.display = ''; }
    return;
  }
  if (msgEl) { msgEl.textContent = 'Sending reset link…'; msgEl.style.color = '#888'; msgEl.style.background = 'transparent'; msgEl.style.display = ''; }
  try {
    var r = await fetch(SUPABASE_URL + '/auth/v1/recover', {
      method:  'POST',
      headers: { 'apikey': SUPABASE_ANON, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email: email })
    });
    // Supabase returns 200 even for unknown emails (to prevent enumeration).
    // Show a generic "if registered" message either way.
    if (msgEl) { msgEl.textContent = 'If that email is registered, a reset link has been sent. Check your inbox.'; msgEl.style.color = '#86efac'; msgEl.style.background = 'rgba(22,101,52,0.2)'; }
  } catch(e) {
    console.warn('[FORGOT PWD]', e);
    if (msgEl) { msgEl.textContent = 'Request could not be completed. Please try again.'; msgEl.style.color = '#fca5a5'; msgEl.style.background = '#3b0a0a'; }
  }
}

// ── Sign-in flow ──────────────────────────────────────────────────────────────
// On success, save token + role to sessionStorage and redirect to housing.html.
// housing-init.js on that page reads the session, fetches the data caches,
// and renders the home view — keeping the unauthenticated entry page minimal.
async function startSignIn() {
  var email    = ((document.getElementById('signin-email')    || {}).value || '').trim().toLowerCase();
  var password = (document.getElementById('signin-password') || {}).value || '';
  var remember = (document.getElementById('remember-me')      || {}).checked || false;
  var errEl    = document.getElementById('signin-error');
  var btn      = document.getElementById('signin-btn');

  if (errEl) errEl.style.display = 'none';

  if (!email || !password) {
    if (errEl) { errEl.textContent = 'Please enter your email and password.'; errEl.style.display = 'block'; }
    return;
  }

  // Generic error for all auth failures — do not leak specifics (wrong domain,
  // invalid password, unverified email, missing user) to the unauthenticated
  // visitor. Real details stay in the console.
  var GENERIC_AUTH_ERROR = 'Sign-in failed. Please check your email and password.';

  // Silent domain prefilter: skip the network call for obviously-wrong emails.
  if (!email.endsWith('@clfn.on.ca')) {
    if (errEl) { errEl.textContent = GENERIC_AUTH_ERROR; errEl.style.display = 'block'; }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
  try {
    var r = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
      method:  'POST',
      headers: HOUSING_HEADERS,
      body:    JSON.stringify({ email: email, password: password })
    });
    var data = await r.json();
    if (!r.ok) throw new Error(GENERIC_AUTH_ERROR);

    // Email verification check — stop here and show the verify panel
    var emailConfirmed = data.user.email_confirmed_at || data.user.confirmed_at;
    if (!emailConfirmed) {
      var dispEl = document.getElementById('verify-email-display');
      if (dispEl) dispEl.textContent = email;
      document.getElementById('signin-panel').style.display = 'none';
      document.getElementById('verify-panel').style.display = '';
      if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
      return;
    }

    // Save token + session globals (used by resolveHousingRole below)
    saveRememberedEmail(email, remember);
    HOUSING_SESSION.email       = email;
    HOUSING_SESSION.name        = (data.user.user_metadata && data.user.user_metadata.full_name) || email;
    HOUSING_SESSION.accessToken = data.access_token;
    HOUSING_HEADERS['Authorization'] = 'Bearer ' + data.access_token;
    try { sessionStorage.setItem('clfn_housing_token', data.access_token); } catch(e) {}

    // Resolve role from the staff table — this is the real authorization gate
    await resolveHousingRole();

    // Persist session info for module pages so they don't re-validate on navigation
    try {
      sessionStorage.setItem('clfn_housing_role',          window.currentRole || 'employee');
      sessionStorage.setItem('clfn_housing_name',          HOUSING_SESSION.name  || '');
      sessionStorage.setItem('clfn_housing_email_session', HOUSING_SESSION.email || '');
    } catch(e) {}

    // Hand off to the authenticated app — housing-init.js handles data load + home view render
    window.location.href = 'housing.html?view=home';

  } catch(e) {
    console.error('[HOUSING LOGIN]', e);
    if (errEl) { errEl.textContent = GENERIC_AUTH_ERROR; errEl.style.display = 'block'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Sign in'; }
  }
}
