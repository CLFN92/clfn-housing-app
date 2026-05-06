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
// Both mechanisms are written on save and read on load. Cookie is written
// with `path=/;SameSite=Lax` so it's reachable from any path the app uses
// (`/`, `/index.html`, etc.) and deleted with the SAME signature so the
// browser actually removes the original (a path mismatch on deletion silently
// creates a new orphan cookie instead of deleting the existing one).
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
  // Delete with the SAME flags used on set (path + SameSite) so the browser
  // matches the original cookie. Without this, an "uncheck → sign in" cycle
  // leaves the cookie in place and the email is still remembered next visit.
  try { document.cookie = name + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;SameSite=Lax'; } catch(e) {}
}

// loadRememberedEmail — pre-fills the email field and ticks the checkbox.
// Idempotent + safe to call multiple times. Called from the login boot AND
// from showSignInPanel() so navigating between sub-panels (forgot/verify)
// and back re-applies the saved value (some browsers wipe on hide/show).
function loadRememberedEmail() {
  try {
    var saved = null;
    try { saved = localStorage.getItem(HOUSING_REMEMBER_KEY); } catch(e) {}
    if (!saved) saved = hGetCookie(HOUSING_REMEMBER_KEY);

    var emailEl = document.getElementById('signin-email');
    var remEl   = document.getElementById('remember-me');
    if (saved) {
      if (emailEl && !emailEl.value) emailEl.value = saved;
      if (remEl) remEl.checked = true;
      // If the email is already filled (we have a remembered value), focus
      // the password field so the user can type immediately. The 150ms delay
      // lets the panel transition complete first.
      setTimeout(function(){
        var p = document.getElementById('signin-password');
        if (p && !p.value) p.focus();
      }, 150);
    } else {
      // No saved value — leave the checkbox at whatever state the user has
      // chosen. Do not force-uncheck here; that would surprise users who
      // ticked the box and haven't signed in yet.
    }
  } catch(e) {}
}

// saveRememberedEmail — writes (or clears) BOTH localStorage and cookie.
// Called from startSignIn() on successful auth. Defensive: if either store
// fails (private browsing, full quota, etc.) the other still persists.
function saveRememberedEmail(email, remember) {
  try {
    if (remember && email) {
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
  // Re-apply the remembered email when returning to the sign-in panel from
  // the verify or forgot-password panel. Without this, navigating Back from
  // those panels leaves the email blank even though localStorage has it.
  loadRememberedEmail();
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

// ── Login page boot ──────────────────────────────────────────────────────────
// Used to live as an inline <script> in index.html. Moved here so index.html
// is just markup. Two responsibilities:
//   1. Hand off to housing.html if the user already has a session token in
//      sessionStorage (shared-auth.js on that page validates it; if stale,
//      the user gets bounced back here).
//   2. Otherwise show the sign-in screen with the remembered email pre-filled.
//
// `init` is named on the function so the registration is a no-op if the script
// is loaded by a page that doesn't have #loginScreen (e.g. the file is now
// pulled into other entry points).
function initLoginPage() {
  // Only act on pages that actually contain the login markup.
  if (!document.getElementById('loginScreen')) return;

  // Set the brand logo from the shared constant (single source of truth) so
  // the same default image lives in shared-config.js and is reused by every
  // page chrome that has an img.hlogo.
  var logoEl = document.getElementById('login-logo');
  if (logoEl && typeof CLFN_LOGO_DATA_URL === 'string') logoEl.src = CLFN_LOGO_DATA_URL;

  loadRememberedEmail();

  // Restored session — hand off directly to housing.html.
  var token = null;
  try { token = sessionStorage.getItem('clfn_housing_token'); } catch(e) {}
  if (token) {
    window.location.href = 'housing.html?view=home';
    return;
  }

  showLoginScreen();
}

document.addEventListener('DOMContentLoaded', initLoginPage);
