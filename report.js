/* report.js — public tenant maintenance-request form (scan-to-report).
 * Self-contained: talks ONLY to the `tenant-mr` Edge Function (validate + submit)
 * with the nation's anon key. Never touches production tables. The per-unit
 * secret token from the QR is the access gate. */
(function () {
  'use strict';

  var SB   = window.SUPABASE_URL || '';
  var ANON = window.SUPABASE_ANON || '';
  var NC   = window.NATION_CONFIG || {};
  var FN   = SB ? SB.replace(/\/$/, '') + '/functions/v1/tenant-mr' : '';

  var qp    = new URLSearchParams(location.search);
  var unit  = (qp.get('u') || '').trim();
  var token = (qp.get('t') || '').trim();

  var app     = document.getElementById('app');
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };

  // Nation branding in the top bar.
  var nn = document.getElementById('nname'), nl = document.getElementById('nlogo');
  if (nn) nn.textContent = (NC.display_name || NC.short || 'Housing') + ' Housing';
  if (nl) nl.textContent = ((NC.short || 'H').charAt(0) || 'H').toUpperCase();
  if (NC.primary_color) document.documentElement.style.setProperty('--accent', NC.primary_color);

  function fail(msg) {
    app.innerHTML = '<div class="center"><div class="check" style="background:#fef2f2;color:#b91c1c;">&#33;</div>'
      + '<h1>Sorry &mdash; we can’t open this form</h1>'
      + '<p class="sub">' + esc(msg || 'This code is invalid or has expired. Please contact the Housing office.') + '</p></div>';
  }

  async function call(action, extra) {
    var payload = Object.assign({ action: action, unit_id: unit, token: token }, extra || {});
    var r = await fetch(FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': ANON, 'Authorization': 'Bearer ' + ANON },
      body: JSON.stringify(payload)
    });
    var data = await r.json().catch(function () { return {}; });
    return { ok: r.ok, status: r.status, data: data };
  }

  var CATS = ['Plumbing', 'Heating / Furnace', 'Electrical', 'Appliance', 'Doors / Windows / Locks', 'Structural', 'Water / Leak', 'Pests', 'Other'];

  function renderForm(address) {
    app.innerHTML =
      '<h1>Report a maintenance issue</h1>'
      + '<p class="sub">Tell us what needs fixing. The Housing office will review your request.</p>'
      + '<div class="addr"><b>Your unit</b>' + esc(address || 'Your unit') + '</div>'
      + '<form id="mrf" novalidate>'
      + '<label>What is the problem with? <span class="req">*</span></label>'
      + '<select id="f_cat" required><option value="">Select a category&hellip;</option>'
      +   CATS.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select>'
      + '<label>How urgent is it?</label>'
      + '<div class="urg">'
      +   '<label><input type="radio" name="urg" value="routine" checked><span>Routine</span></label>'
      +   '<label><input type="radio" name="urg" value="urgent"><span>Urgent</span></label>'
      +   '<label><input type="radio" name="urg" value="emergency"><span>Emergency</span></label>'
      + '</div>'
      + '<label>Describe the problem <span class="req">*</span></label>'
      + '<textarea id="f_desc" required placeholder="e.g. The kitchen sink is leaking under the cabinet and the floor is getting wet."></textarea>'
      + '<label>Your name (optional)</label>'
      + '<input id="f_name" type="text" autocomplete="name" placeholder="So we know who to follow up with"/>'
      + '<label>Phone (optional)</label>'
      + '<input id="f_phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="Best number to reach you"/>'
      + '<div class="msg err" id="f_err"></div>'
      + '<button class="btn" id="f_btn" type="submit">Submit request</button>'
      + '</form>'
      + '<div class="foot">Emergencies (no heat, flooding, gas smell)? Call the Housing office directly &mdash; don’t rely on this form.</div>';

    var form = document.getElementById('mrf');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var errEl = document.getElementById('f_err'); errEl.style.display = 'none';
      var cat  = document.getElementById('f_cat').value;
      var desc = document.getElementById('f_desc').value.trim();
      var urg  = (form.querySelector('input[name="urg"]:checked') || {}).value || 'routine';
      if (!cat || !desc) { errEl.textContent = 'Please choose a category and describe the problem.'; errEl.style.display = 'block'; return; }
      var btn = document.getElementById('f_btn'); btn.disabled = true; btn.textContent = 'Submitting…';
      call('submit', {
        category: cat, description: desc, urgency: urg,
        contact_name: document.getElementById('f_name').value.trim(),
        contact_phone: document.getElementById('f_phone').value.trim()
      }).then(function (res) {
        if (res.ok && res.data && res.data.ok) { renderDone(res.data.reference); }
        else { btn.disabled = false; btn.textContent = 'Submit request'; errEl.textContent = (res.data && res.data.error) || 'Something went wrong. Please try again.'; errEl.style.display = 'block'; }
      }).catch(function () {
        btn.disabled = false; btn.textContent = 'Submit request';
        errEl.textContent = 'Network error. Please check your connection and try again.'; errEl.style.display = 'block';
      });
    });
  }

  function renderDone(ref) {
    app.innerHTML = '<div class="center"><div class="check">&#10003;</div>'
      + '<h1>Request submitted</h1>'
      + '<p class="sub">Thank you. The Housing office has received your maintenance request and will review it.</p>'
      + (ref ? '<div class="ref">Reference: ' + esc(ref) + '</div>' : '')
      + '</div>';
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  if (!unit || !token) { fail('This link is missing its unit code. Please scan the QR code on the unit again.'); return; }
  if (!SB || !ANON)    { fail('Configuration error. Please contact the Housing office.'); return; }

  call('validate').then(function (res) {
    if (res.ok && res.data && res.data.ok) renderForm(res.data.address);
    else fail((res.data && res.data.error) || 'This code is invalid or has expired.');
  }).catch(function () { fail('Could not reach the server. Please try again shortly.'); });
})();
