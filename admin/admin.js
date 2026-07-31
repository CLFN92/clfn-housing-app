/* admin.js — FN Hub super-admin panel (P1: auth gate, nations registry, admins).
 * Talks only to the CONTROL-PLANE ("fnhub-platform") Supabase project. Access is
 * gated by the super_admins allow-list (enforced by RLS on that project). The
 * auto-provisioning wizard (create Supabase project, deploy functions, etc.) is
 * a later phase; here you manage the registry, module licensing, and admins. */
(function () {
  'use strict';

  var PBASE = (window.PLATFORM_SUPABASE_URL || '').replace(/\/$/, '');
  var ANON  = window.PLATFORM_SUPABASE_ANON || '';
  var AUTH  = PBASE + '/auth/v1';
  var REST  = PBASE + '/rest/v1';
  var REDIRECT = location.origin + location.pathname;
  var LS_AT = 'fnhub_admin_at', LS_RT = 'fnhub_admin_rt';

  // Optional modules a nation can be licensed for (mirrors CLFN_MODULES keys).
  var MODULES = [
    ['finance','Finance'], ['match','Match'], ['contractors','Contractors'],
    ['renovations','Renovations'], ['rfq','RFQ'], ['mapping','Mapping'],
    ['inspections','Inspections'], ['ai_assistant','AI Assistant']
  ];

  var app = document.getElementById('app');
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
  var _nations = [];   // last-loaded nations list (so Configure can look one up)

  function getAT(){ return localStorage.getItem(LS_AT) || ''; }
  function getRT(){ return localStorage.getItem(LS_RT) || ''; }
  function setSession(at, rt){ if (at) localStorage.setItem(LS_AT, at); if (rt) localStorage.setItem(LS_RT, rt); }
  function clearSession(){ localStorage.removeItem(LS_AT); localStorage.removeItem(LS_RT); }
  function jwtEmail(){ try { return (JSON.parse(atob(getAT().split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).email || '').toLowerCase(); } catch(e){ return ''; } }

  async function refreshSession(){
    var rt = getRT(); if (!rt) return false;
    try {
      var r = await fetch(AUTH + '/token?grant_type=refresh_token', { method:'POST', headers:{ apikey:ANON, 'Content-Type':'application/json' }, body: JSON.stringify({ refresh_token: rt }) });
      if (!r.ok) return false;
      var d = await r.json(); if (d && d.access_token){ setSession(d.access_token, d.refresh_token || rt); return true; }
    } catch(e){}
    return false;
  }

  async function api(method, path, body, prefer){
    var mk = function(){ var o = { method:method, headers:{ apikey:ANON, Authorization:'Bearer '+getAT(), 'Content-Type':'application/json' } }; if (prefer) o.headers['Prefer'] = prefer; if (body) o.body = JSON.stringify(body); return o; };
    var r = await fetch(REST + path, mk());
    if (r.status === 401 && await refreshSession()) r = await fetch(REST + path, mk());
    return r;
  }

  // ---- Views -----------------------------------------------------------------
  function showLogin(prefill){
    app.innerHTML =
      '<h1>Platform admin sign-in</h1>'
      + '<p class="sub">Restricted to FN Hub platform administrators. Enter your email and we\'ll send a secure sign-in link.</p>'
      + '<label>Email address</label>'
      + '<input id="em" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" value="' + esc(prefill||'') + '"/>'
      + '<div class="msg" id="lmsg"></div>'
      + '<button class="btn" id="lbtn" type="button">Email me a sign-in link</button>'
      + '<div class="foot">If you reach this page and aren\'t an administrator, you won\'t be able to sign in.</div>';
    document.getElementById('lbtn').addEventListener('click', sendLink);
    document.getElementById('em').addEventListener('keydown', function(e){ if (e.key === 'Enter') sendLink(); });
  }
  function setMsg(id, t, k){ var el = document.getElementById(id); if (el){ el.className = 'msg ' + (k||'err'); el.textContent = t; } }

  async function sendLink(){
    var em = (document.getElementById('em').value || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { setMsg('lmsg','Please enter a valid email address.'); return; }
    var btn = document.getElementById('lbtn'); btn.disabled = true; btn.textContent = 'Sending…';
    try {
      var r = await fetch(AUTH + '/otp?redirect_to=' + encodeURIComponent(REDIRECT), { method:'POST', headers:{ apikey:ANON, 'Content-Type':'application/json' }, body: JSON.stringify({ email: em, create_user: true }) });
      if (r.ok) {
        app.innerHTML = '<div class="center"><div style="font-size:40px;">📧</div><h1>Check your email</h1>'
          + '<p class="sub">A sign-in link was sent to <b>' + esc(em) + '</b>. Open it on this device.</p>'
          + '<button class="btn ghost" type="button" onclick="location.reload()">Back</button></div>';
      } else { var d = await r.json().catch(function(){return{};}); setMsg('lmsg', (d && (d.msg||d.error_description||d.error)) || 'Could not send the link.'); btn.disabled=false; btn.textContent='Email me a sign-in link'; }
    } catch(e){ setMsg('lmsg','Network error. Please try again.'); btn.disabled=false; btn.textContent='Email me a sign-in link'; }
  }

  async function showDashboard(){
    app.innerHTML = '<div class="center"><p class="sub">Checking access…</p></div>';
    // Gate: RLS only returns super_admins rows to actual admins.
    var meEmail = jwtEmail();
    var r = await api('GET', '/super_admins?select=email,added_by,added_at&order=added_at');
    if (r.status === 401){ clearSession(); showLogin(); return; }
    var admins = r.ok ? await r.json().catch(function(){return[];}) : [];
    var amAdmin = admins.some(function(a){ return String(a.email||'').toLowerCase() === meEmail; });
    if (!amAdmin){
      app.innerHTML = '<div class="center"><div style="font-size:40px;">🚫</div><h1>Not authorized</h1>'
        + '<p class="sub">' + esc(meEmail) + ' is not a platform administrator.</p>'
        + '<button class="btn" type="button" onclick="adminLogout()">Sign out</button></div>';
      return;
    }
    document.getElementById('btn_out').style.display = '';

    // Load nations.
    var nr = await api('GET', '/nations?select=*&order=created_at.desc');
    var nations = nr.ok ? await nr.json().catch(function(){return[];}) : [];
    _nations = nations;

    app.innerHTML =
      '<h1>Nations</h1>'
      + '<p class="sub">Signed in as ' + esc(meEmail) + '</p>'
      + nationsCard(nations)
      + addNationCard()
      + provisionCard()
      + adminsCard(admins, meEmail);
    wireAddNation();
  }

  function nationsCard(nations){
    var rows = nations.length ? nations.map(function(n){
      var st = n.status || 'provisioning';
      var url = 'https://' + esc(n.subdomain) + '.fnhub.app';
      var mods = Object.keys(n.modules_licensed || {}).filter(function(k){ return n.modules_licensed[k]; });
      return '<tr>'
        + '<td><b>' + esc(n.display_name) + '</b><div style="font-size:11px;color:var(--muted);">' + esc(n.subdomain) + '.fnhub.app</div></td>'
        + '<td><span class="pill ' + esc(st) + '">' + esc(st) + '</span></td>'
        + '<td style="font-size:11px;color:var(--muted);">' + esc(mods.join(', ') || '—') + '</td>'
        + '<td><div class="row-actions">'
        +   '<button class="btn sm ghost" type="button" onclick="configureNation(\'' + esc(n.id) + '\')">Configure</button>'
        +   '<a class="btn sm ghost" href="' + url + '" target="_blank" rel="noopener">Open</a>'
        +   (st === 'suspended'
              ? '<button class="btn sm ghost" onclick="adminSetStatus(\'' + esc(n.id) + '\',\'active\')">Resume</button>'
              : '<button class="btn sm danger" onclick="adminSetStatus(\'' + esc(n.id) + '\',\'suspended\')">Suspend</button>')
        + '</div></td></tr>';
    }).join('') : '<tr><td colspan="4" class="empty">No nations yet. Add one below.</td></tr>';
    return '<div class="card"><h3>Registered nations</h3>'
      + '<table><thead><tr><th>Nation</th><th>Status</th><th>Licensed modules</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function addNationCard(){
    var modChecks = MODULES.map(function(m){
      return '<label style="display:inline-flex;align-items:center;gap:6px;font-weight:600;margin:0 12px 6px 0;"><input type="checkbox" class="an-mod" value="' + m[0] + '" style="width:auto;" checked/> ' + m[1] + '</label>';
    }).join('');
    return '<div class="card"><h3>Add a nation (registry)</h3>'
      + '<p class="sub" style="margin:2px 0 4px;">Registers a nation so <code>&lt;subdomain&gt;.fnhub.app</code> resolves. Point it at that nation\'s Supabase project. (Full auto-provisioning arrives in a later phase.)</p>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'
      +   '<div><label>Subdomain</label><input id="an-sub" placeholder="listuguj"/></div>'
      +   '<div><label>Short code</label><input id="an-short" placeholder="LMG"/></div>'
      + '</div>'
      + '<label>Display name</label><input id="an-name" placeholder="Listuguj Mi\'gmaq Government"/>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'
      +   '<div><label>Supabase URL</label><input id="an-url" placeholder="https://xxxx.supabase.co"/></div>'
      +   '<div><label>Supabase anon key</label><input id="an-anon" placeholder="eyJ… (publishable)"/></div>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'
      +   '<div><label>Staff email domain</label><input id="an-domain" placeholder="listuguj.ca"/></div>'
      +   '<div><label>Primary color</label><input id="an-color" placeholder="#f8e41a"/></div>'
      + '</div>'
      + '<label>Licensed modules</label><div style="margin-top:2px;">' + modChecks + '</div>'
      + '<div class="msg" id="an-msg"></div>'
      + '<button class="btn" id="an-btn" type="button">Add nation</button></div>';
  }

  function adminsCard(admins, meEmail){
    var rows = admins.map(function(a){
      var em = String(a.email||'');
      var isMe = em.toLowerCase() === meEmail;
      return '<tr><td>' + esc(em) + (isMe ? ' <span style="color:var(--muted);font-size:11px;">(you)</span>' : '') + '</td>'
        + '<td style="font-size:11px;color:var(--muted);">' + esc(a.added_by||'') + '</td>'
        + '<td>' + (isMe ? '' : '<button class="btn sm danger" onclick="adminRemove(\'' + esc(em) + '\')">Remove</button>') + '</td></tr>';
    }).join('');
    return '<div class="card"><h3>Platform administrators</h3>'
      + '<table><thead><tr><th>Email</th><th>Added by</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
      + '<div style="display:flex;gap:8px;margin-top:12px;align-items:flex-end;flex-wrap:wrap;">'
      +   '<div style="flex:1;min-width:200px;"><label>Add administrator</label><input id="adm-email" type="email" placeholder="name@example.com"/></div>'
      +   '<button class="btn sm" type="button" onclick="adminAdd()">Add</button>'
      + '</div><div class="msg" id="adm-msg"></div></div>';
  }

  // ---- Actions ---------------------------------------------------------------
  function wireAddNation(){
    var btn = document.getElementById('an-btn'); if (!btn) return;
    btn.addEventListener('click', async function(){
      var get = function(id){ return (document.getElementById(id)||{}).value || ''; };
      var sub = get('an-sub').trim().toLowerCase().replace(/[^a-z0-9-]/g,'');
      var name = get('an-name').trim(), short = get('an-short').trim();
      if (!sub || !name || !short){ setMsg('an-msg','Subdomain, display name, and short code are required.'); return; }
      var mods = {};
      Array.prototype.forEach.call(document.querySelectorAll('.an-mod'), function(c){ mods[c.value] = c.checked; });
      var row = {
        subdomain: sub, display_name: name, short: short,
        supabase_url: get('an-url').trim() || null, supabase_anon: get('an-anon').trim() || null,
        email_domain: get('an-domain').trim() || null, primary_color: get('an-color').trim() || null,
        modules_licensed: mods,
        status: (get('an-url').trim() ? 'active' : 'provisioning'),
        provisioned_by: jwtEmail()
      };
      btn.disabled = true; btn.textContent = 'Adding…';
      var r = await api('POST', '/nations', row, 'return=minimal');
      if (r.ok){ await audit('nation_added', sub, name); showDashboard(); }
      else { var t = await r.text(); setMsg('an-msg', /duplicate|unique/i.test(t) ? 'That subdomain is already registered.' : 'Could not add: ' + t); btn.disabled=false; btn.textContent='Add nation'; }
    });
  }

  window.adminSetStatus = async function(id, status){
    var r = await api('PATCH', '/nations?id=eq.' + encodeURIComponent(id), { status: status, updated_at: new Date().toISOString() }, 'return=minimal');
    if (r.ok){ await audit('nation_' + status, id, ''); showDashboard(); }
  };
  window.adminAdd = async function(){
    var em = ((document.getElementById('adm-email')||{}).value || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)){ setMsg('adm-msg','Enter a valid email.'); return; }
    var r = await api('POST', '/super_admins', { email: em, added_by: jwtEmail() }, 'return=minimal');
    if (r.ok){ await audit('admin_added', em, ''); showDashboard(); }
    else { var t = await r.text(); setMsg('adm-msg', /duplicate|unique/i.test(t) ? 'Already an administrator.' : 'Could not add: ' + t); }
  };
  window.adminRemove = async function(email){
    var r = await api('DELETE', '/super_admins?email=eq.' + encodeURIComponent(email), null, 'return=minimal');
    if (r.ok){ await audit('admin_removed', email, ''); showDashboard(); }
  };
  async function audit(action, target, detail){
    try { await api('POST', '/platform_audit', { actor: jwtEmail(), action: action, target: String(target||''), detail: String(detail||'') }, 'return=minimal'); } catch(e){}
  }

  window.adminLogout = function(){
    try { fetch(AUTH + '/logout', { method:'POST', headers:{ apikey:ANON, Authorization:'Bearer '+getAT() } }); } catch(e){}
    clearSession(); document.getElementById('btn_out').style.display = 'none'; showLogin();
  };

  // ---- Configure a nation (P3) -----------------------------------------------
  window.adminHome = function(){ showDashboard(); };

  window.configureNation = async function(id){
    var n = _nations.filter(function(x){ return String(x.id) === String(id); })[0];
    if (!n){
      var r = await api('GET', '/nations?select=*&id=eq.' + encodeURIComponent(id));
      var a = r.ok ? await r.json().catch(function(){return[];}) : [];
      n = a[0];
    }
    if (!n){ showDashboard(); return; }
    document.getElementById('btn_out').style.display = '';
    app.innerHTML = configureView(n);
  };

  function configureView(n){
    var g2 = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;';
    var mods = n.modules_licensed || {};
    var modChecks = MODULES.map(function(m){
      return '<label style="display:inline-flex;align-items:center;gap:6px;font-weight:600;margin:0 12px 8px 0;">'
        + '<input type="checkbox" class="cn-mod" value="' + m[0] + '" style="width:auto;"' + (mods[m[0]] ? ' checked' : '') + '/> ' + esc(m[1]) + '</label>';
    }).join('');
    var stOpt = function(v,l){ return '<option value="' + v + '"' + (String(n.status||'provisioning') === v ? ' selected' : '') + '>' + l + '</option>'; };
    return '<button class="btn sm ghost" type="button" onclick="adminHome()">&larr; Back</button>'
      + '<h1 style="margin-top:12px;">Configure ' + esc(n.display_name) + '</h1>'
      + '<p class="sub"><code>' + esc(n.subdomain) + '.fnhub.app</code> &middot; subdomain is fixed</p>'
      + '<div class="card"><h3>Branding &amp; contact</h3>'
      +   '<div style="' + g2 + '">'
      +     '<div><label>Display name</label><input id="cn-name" value="' + esc(n.display_name) + '"/></div>'
      +     '<div><label>Short code</label><input id="cn-short" value="' + esc(n.short) + '"/></div>'
      +   '</div>'
      +   '<div style="' + g2 + '">'
      +     '<div><label>Primary color</label><input id="cn-color" placeholder="#f8e41a" value="' + esc(n.primary_color || '') + '"/></div>'
      +     '<div><label>Staff email domain</label><input id="cn-domain" placeholder="nation.ca" value="' + esc(n.email_domain || '') + '"/></div>'
      +   '</div>'
      +   '<label>Housing email</label><input id="cn-housing" placeholder="housing@nation.ca" value="' + esc(n.housing_email || '') + '"/>'
      + '</div>'
      + '<div class="card"><h3>Supabase project</h3>'
      +   '<p class="sub" style="margin:2px 0 8px;">The nation\'s own database-per-nation project. The anon key is publishable.</p>'
      +   '<label>Supabase URL</label><input id="cn-url" placeholder="https://xxxx.supabase.co" value="' + esc(n.supabase_url || '') + '"/>'
      +   '<label>Supabase anon key</label><input id="cn-anon" placeholder="eyJ..." value="' + esc(n.supabase_anon || '') + '"/>'
      + '</div>'
      + '<div class="card"><h3>Licensed modules</h3>'
      +   '<p class="sub" style="margin:2px 0 8px;">Which optional modules this nation is allowed to use. The nation still turns each one on or off in its own in-app settings.</p>'
      +   '<div>' + modChecks + '</div>'
      + '</div>'
      + '<div class="card"><h3>Status</h3>'
      +   '<label>Registry status</label>'
      +   '<select id="cn-status">' + stOpt('provisioning','Provisioning') + stOpt('active','Active') + stOpt('suspended','Suspended') + '</select>'
      +   '<p class="sub" style="margin:6px 0 0;">Only <b>active</b> nations are published to <code>nations_public</code> and resolve at <code>&lt;subdomain&gt;.fnhub.app</code>.</p>'
      + '</div>'
      + '<div class="msg" id="cn-msg"></div>'
      + '<button class="btn" id="cn-save" type="button" onclick="saveNationConfig(\'' + esc(n.id) + '\')">Save changes</button>';
  }

  window.saveNationConfig = async function(id){
    var get = function(x){ return (document.getElementById(x) || {}).value || ''; };
    var name = get('cn-name').trim(), short = get('cn-short').trim();
    if (!name || !short){ setMsg('cn-msg','Display name and short code are required.'); return; }
    var mods = {};
    Array.prototype.forEach.call(document.querySelectorAll('.cn-mod'), function(c){ mods[c.value] = c.checked; });
    var patch = {
      display_name: name, short: short,
      primary_color: get('cn-color').trim() || null,
      email_domain:  get('cn-domain').trim() || null,
      housing_email: get('cn-housing').trim() || null,
      supabase_url:  get('cn-url').trim() || null,
      supabase_anon: get('cn-anon').trim() || null,
      modules_licensed: mods,
      status: get('cn-status') || 'provisioning',
      updated_at: new Date().toISOString()
    };
    var btn = document.getElementById('cn-save'); if (btn){ btn.disabled = true; btn.textContent = 'Saving...'; }
    var r = await api('PATCH', '/nations?id=eq.' + encodeURIComponent(id), patch, 'return=minimal');
    if (r.ok){ await audit('nation_configured', id, name); showDashboard(); }
    else { var t = await r.text(); setMsg('cn-msg','Could not save: ' + t); if (btn){ btn.disabled = false; btn.textContent = 'Save changes'; } }
  };

  // ---- Provision a nation (P4, assisted) -------------------------------------
  function provisionCard(){
    return '<div class="card"><h3>Provision a nation (assisted)</h3>'
      + '<p class="sub" style="margin:2px 0 8px;">Stand up a new nation on a Supabase project you already created: replay the bootstrap schema, create the storage bucket, seed the first ED, and register it. Needs the bootstrap schema file and the Management API token secret on the platform function.</p>'
      + '<button class="btn" type="button" onclick="showProvision()">Start provisioning wizard</button></div>';
  }

  window.showProvision = function(){
    document.getElementById('btn_out').style.display = '';
    var g2 = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;';
    var modChecks = MODULES.map(function(m){
      return '<label style="display:inline-flex;align-items:center;gap:6px;font-weight:600;margin:0 12px 8px 0;"><input type="checkbox" class="pv-mod" value="' + m[0] + '" style="width:auto;"/> ' + esc(m[1]) + '</label>';
    }).join('');
    app.innerHTML = '<button class="btn sm ghost" type="button" onclick="adminHome()">&larr; Back</button>'
      + '<h1 style="margin-top:12px;">Provision a nation</h1>'
      + '<p class="sub">Assisted: you created the Supabase project; this runs schema, bucket, first ED, and registry.</p>'
      + '<div class="card"><h3>Nation</h3>'
      +   '<div style="' + g2 + '"><div><label>Subdomain</label><input id="pv-sub" placeholder="listuguj"/></div><div><label>Short code</label><input id="pv-short" placeholder="LMG"/></div></div>'
      +   '<label>Display name</label><input id="pv-name" placeholder="Listuguj Mi\'gmaq Government"/>'
      +   '<div style="' + g2 + '"><div><label>Staff email domain</label><input id="pv-domain" placeholder="listuguj.ca"/></div><div><label>Primary color</label><input id="pv-color" placeholder="#f8e41a"/></div></div>'
      +   '<label>Housing email</label><input id="pv-housing" placeholder="housing@listuguj.ca"/>'
      +   '<label style="margin-top:10px;">Licensed modules</label><div>' + modChecks + '</div>'
      + '</div>'
      + '<div class="card"><h3>Target Supabase project</h3>'
      +   '<p class="sub" style="margin:2px 0 8px;">The new project you created. The service_role key is used once (bucket + ED) and never stored.</p>'
      +   '<div style="' + g2 + '"><div><label>Project ref</label><input id="pv-ref" placeholder="abcdefgh...ref"/></div><div><label>Project URL</label><input id="pv-url" placeholder="https://&lt;ref&gt;.supabase.co"/></div></div>'
      +   '<label>Anon (publishable) key</label><input id="pv-anon" placeholder="eyJ..."/>'
      +   '<label>Service role key (used once)</label><input id="pv-service" placeholder="eyJ... (service_role)"/>'
      + '</div>'
      + '<div class="card"><h3>First ED and bootstrap schema</h3>'
      +   '<div style="' + g2 + '"><div><label>First ED email</label><input id="pv-ed-email" placeholder="ed@listuguj.ca"/></div><div><label>First ED name</label><input id="pv-ed-name" placeholder="Executive Director"/></div></div>'
      +   '<label>Bootstrap schema file (supabase/bootstrap/schema.sql)</label><input id="pv-schema" type="file" accept=".sql,text/plain"/>'
      + '</div>'
      + '<div class="msg" id="pv-msg"></div>'
      + '<button class="btn" id="pv-btn" type="button" onclick="runProvision()">Provision nation</button>'
      + '<div id="pv-results" style="margin-top:14px;"></div>';
  };

  window.runProvision = async function(){
    var get = function(x){ return (document.getElementById(x) || {}).value || ''; };
    var sub = get('pv-sub').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    var name = get('pv-name').trim(), short = get('pv-short').trim();
    if (!sub || !name || !short){ setMsg('pv-msg', 'Subdomain, display name, and short code are required.'); return; }
    var mods = {};
    Array.prototype.forEach.call(document.querySelectorAll('.pv-mod'), function(c){ mods[c.value] = c.checked; });
    var schemaSql = '';
    var fileEl = document.getElementById('pv-schema');
    if (fileEl && fileEl.files && fileEl.files[0]) {
      try { schemaSql = await fileEl.files[0].text(); }
      catch (e){ setMsg('pv-msg', 'Could not read the schema file.'); return; }
    }
    var payload = {
      nation: { subdomain: sub, display_name: name, short: short,
                email_domain: get('pv-domain').trim() || null, housing_email: get('pv-housing').trim() || null,
                primary_color: get('pv-color').trim() || null, modules_licensed: mods },
      target: { ref: get('pv-ref').trim() || null, url: get('pv-url').trim() || null,
                anon: get('pv-anon').trim() || null, service_role: get('pv-service').trim() || null },
      first_ed: { email: get('pv-ed-email').trim() || null, name: get('pv-ed-name').trim() || null },
      schema_sql: schemaSql
    };
    var btn = document.getElementById('pv-btn'); if (btn){ btn.disabled = true; btn.textContent = 'Provisioning...'; }
    document.getElementById('pv-results').innerHTML = '<p class="sub">Running... this can take a minute.</p>';
    try {
      var r = await fetch(PBASE + '/functions/v1/provision-nation', {
        method: 'POST',
        headers: { apikey: ANON, Authorization: 'Bearer ' + getAT(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var d = await r.json().catch(function(){ return {}; });
      if (!r.ok){
        setMsg('pv-msg', (d && d.error) ? ('Failed: ' + d.error) : ('Failed: HTTP ' + r.status));
        document.getElementById('pv-results').innerHTML = '';
      } else { renderProvisionResults(d); }
    } catch (e){ setMsg('pv-msg', 'Network error: ' + String(e).slice(0, 120)); document.getElementById('pv-results').innerHTML = ''; }
    if (btn){ btn.disabled = false; btn.textContent = 'Provision nation'; }
  };

  function renderProvisionResults(d){
    var steps = (d && d.steps) || [];
    var rows = steps.map(function(s){
      return '<tr><td>' + (s.ok ? '✅' : '⚠️') + '</td><td><b>' + esc(s.name) + '</b></td>'
        + '<td style="font-size:12px;color:var(--muted);">' + esc(s.detail) + '</td></tr>';
    }).join('');
    var head = d.ok
      ? '<div class="msg ok" style="display:block;">Provisioned <b>' + esc(d.subdomain) + '</b>. Registry updated.</div>'
      : '<div class="msg err" style="display:block;">Finished with issues - review the steps below.</div>';
    var mel = document.getElementById('pv-msg'); if (mel){ mel.className = 'msg'; mel.textContent = ''; }
    document.getElementById('pv-results').innerHTML = head
      + '<div class="card"><h3>Result</h3><table><tbody>' + rows + '</tbody></table>'
      + '<button class="btn sm" type="button" onclick="adminHome()" style="margin-top:10px;">Back to nations</button></div>';
  }

  // ---- Boot ------------------------------------------------------------------
  function parseHash(){ var h = (location.hash||'').replace(/^#/,''); if (!h) return null; var o={}; h.split('&').forEach(function(kv){ var p=kv.split('='); if (p[0]) o[decodeURIComponent(p[0])] = decodeURIComponent(p[1]||''); }); return o; }

  if (!PBASE || PBASE.indexOf('REPLACE_WITH') !== -1 || !ANON || ANON.indexOf('REPLACE_WITH') !== -1){
    app.innerHTML = '<div class="center"><h1>Not configured</h1><p class="sub">Set <code>PLATFORM_SUPABASE_URL</code> and <code>PLATFORM_SUPABASE_ANON</code> in <code>admin-config.js</code> (the fnhub-platform project\'s URL + anon key), then reload.</p></div>';
    return;
  }
  var hash = parseHash();
  if (hash && hash.access_token){ setSession(hash.access_token, hash.refresh_token); try { history.replaceState(null,'',REDIRECT); } catch(e){ location.hash=''; } showDashboard(); }
  else if (hash && hash.error){ showLogin(); setTimeout(function(){ setMsg('lmsg', hash.error_description || 'That sign-in link is invalid or expired.'); }, 0); }
  else if (getAT()){ showDashboard(); }
  else { showLogin(); }
})();
