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
  // Must mirror the optional-module keys in CLFN_MODULES._licensed
  // (shared-config.js). A key missing here cannot be licensed or un-licensed
  // from this panel: applyNationLicensing() only overrides keys PRESENT in
  // modules_licensed, so an omitted module silently keeps its default (true)
  // for every nation. Add new modules to both places.
  var MODULES = [
    ['finance','Finance'], ['match','Match'], ['contractors','Contractors'],
    ['renovations','Renovations'], ['rfq','RFQ'], ['mapping','Mapping'],
    ['inspections','Inspections'], ['ai_assistant','AI Assistant'],
    ['projects','Capital Projects']
  ];

  var app = document.getElementById('app');
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
  var _nations = [];   // last-loaded nations list (so Configure can look one up)

  // External destinations referenced by the checklist + field hints. Supabase
  // dashboard deep links use the "/project/_/..." form, which resolves to the
  // operator's last-opened project (or the picker) -- exact refs aren't known
  // until the nation's project is created.
  var LINKS = {
    supaNew:  'https://supabase.com/dashboard/new',                       // create a project
    supaApi:  'https://supabase.com/dashboard/project/_/settings/api',    // URL + keys
    supaFns:  'https://supabase.com/dashboard/project/_/settings/functions', // Edge Function secrets
    supaCli:  'https://supabase.com/docs/guides/functions/deploy',        // functions deploy docs
    cf:       'https://dash.cloudflare.com',                              // Cloudflare (DNS + Workers)
    gh:       'https://github.com/CLFN92/clfn-housing-app/actions'        // deploy workflows
  };
  function extLink(href, label){ return '<a href="' + href + '" target="_blank" rel="noopener" style="color:#1d4ed8;font-weight:600;">' + label + '</a>'; }
  // Small muted "where to find it" line under a form field.
  function fieldHint(html){ return '<div class="sub" style="margin:4px 0 0;font-size:11px;line-height:1.45;">' + html + '</div>'; }

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
          + '<button class="btn ghost" type="button" data-act="reload">Back</button></div>';
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
        + '<button class="btn" type="button" data-act="logout">Sign out</button></div>';
      return;
    }
    document.getElementById('btn_out').style.display = '';

    // Load nations.
    var nr = await api('GET', '/nations?select=*&order=created_at.desc');
    var nations = nr.ok ? await nr.json().catch(function(){return[];}) : [];
    _nations = nations;

    // Load per-nation usage (push-reported by each nation's app). Keyed by
    // subdomain; absent until a nation manager has opened Settings -> Nation.
    var ur = await api('GET', '/nation_usage?select=*');
    var usageRows = ur.ok ? await ur.json().catch(function(){return[];}) : [];
    var usageBySub = {};
    usageRows.forEach(function(u){ if (u && u.subdomain) usageBySub[u.subdomain] = u; });

    app.innerHTML =
      '<h1>Nations</h1>'
      + '<p class="sub">Signed in as ' + esc(meEmail) + '</p>'
      + nationsCard(nations, usageBySub)
      + provisionCard()
      + addNationStepsCard()
      + addNationCard()
      + adminsCard(admins, meEmail);
    wireAddNation();
  }

  // Human byte formatter for the admin panel (mirrors the nation app's _duFmtBytes).
  function fmtBytes(b){
    if (b == null) return '—';
    b = Number(b) || 0;
    if (b < 1024 * 1024)        return (b / 1024).toFixed(0) + ' KB';
    if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
    return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }
  function timeAgo(iso){
    try {
      var t = new Date(iso).getTime(); if (!t) return '';
      var s = Math.floor((Date.now() - t) / 1000);
      if (s < 60)    return 'just now';
      if (s < 3600)  return Math.floor(s / 60) + 'm ago';
      if (s < 86400) return Math.floor(s / 3600) + 'h ago';
      return Math.floor(s / 86400) + 'd ago';
    } catch(e){ return ''; }
  }
  function usageCell(u){
    if (!u) return '<span style="color:var(--muted);font-style:italic;">not reported</span>';
    return '<div style="font-variant-numeric:tabular-nums;line-height:1.35;">'
      + '<div>' + esc(fmtBytes(u.database_bytes)) + ' <span style="color:var(--muted);">db</span></div>'
      + '<div>' + esc(fmtBytes(u.storage_bytes)) + ' <span style="color:var(--muted);">files</span></div>'
      + '<div style="font-size:10px;color:var(--muted);">' + esc(timeAgo(u.reported_at)) + '</div>'
      + '</div>';
  }

  function nationsCard(nations, usageBySub){
    usageBySub = usageBySub || {};
    var rows = nations.length ? nations.map(function(n){
      var st = n.status || 'provisioning';
      var url = 'https://' + esc(n.subdomain) + '.fnhub.app';
      var mods = Object.keys(n.modules_licensed || {}).filter(function(k){ return n.modules_licensed[k]; });
      return '<tr>'
        + '<td><b>' + esc(n.display_name) + '</b><div style="font-size:11px;color:var(--muted);">' + esc(n.subdomain) + '.fnhub.app</div></td>'
        + '<td><span class="pill ' + esc(st) + '">' + esc(st) + '</span></td>'
        + '<td style="font-size:11px;color:var(--muted);">' + esc(mods.join(', ') || '—') + '</td>'
        + '<td style="font-size:12px;">' + usageCell(usageBySub[n.subdomain]) + '</td>'
        + '<td><div class="row-actions">'
        +   '<button class="btn sm ghost" type="button" data-act="configure" data-id="' + esc(n.id) + '">Configure</button>'
        +   '<a class="btn sm ghost" href="' + url + '" target="_blank" rel="noopener">Open</a>'
        +   (st === 'suspended'
              ? '<button class="btn sm ghost" data-act="status" data-status="active" data-id="' + esc(n.id) + '">Resume</button>'
              : '<button class="btn sm danger" data-act="status" data-status="suspended" data-id="' + esc(n.id) + '">Suspend</button>')
        + '</div></td></tr>';
    }).join('') : '<tr><td colspan="5" class="empty">No nations yet. Add one below.</td></tr>';
    return '<div class="card"><h3>Registered nations</h3>'
      + '<table><thead><tr><th>Nation</th><th>Status</th><th>Licensed modules</th><th>Data usage</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
      + '<p class="sub" style="margin:10px 0 0;font-size:11px;">Data usage is reported by each nation\'s app when a manager opens Settings &rarr; Nation (database size + file storage, against the 8 GB / 100 GB Supabase Pro tiers).</p>'
      + '</div>';
  }

  // Sequential, numbered reference of the full "add a nation" workflow across
  // all three surfaces (Supabase, GitHub, Cloudflare). Static guide (no per-
  // nation step tracking). Each step is tagged Automated (the platform already
  // does it) or Manual (an external cloud action the operator performs).
  function stepTag(kind){
    return kind === 'auto'
      ? '<span class="pill" style="font-size:9px;background:#dcfce7;color:#166534;">Automated</span>'
      : '<span class="pill" style="font-size:9px;background:#f4f4f0;color:#696960;">Manual</span>';
  }
  function addNationStepsCard(){
    // [ title, kind('auto'|'manual'), html ]
    var steps = [
      ['Register the nation', 'manual',
        'Fill in the <b>Add a nation</b> card below (subdomain, display name, short code). Creates the registry row and reserves <code>&lt;subdomain&gt;.fnhub.app</code>.'],
      ['Create its Supabase project', 'manual',
        'Stand up a fresh <b>database-per-nation</b> project: ' + extLink(LINKS.supaNew, 'Supabase &rarr; New project') + '. Then grab the ref, URL, anon + service_role keys from ' + extLink(LINKS.supaApi, 'Settings &rarr; API') + '.'],
      ['Provision (schema, bucket, first ED)', 'auto',
        'Click <b>Provision this nation</b> below. The platform replays the bootstrap schema, creates the <code>housing-files</code> storage bucket, seeds the first ED, and writes the registry row &mdash; one action. (Requires <code>SUPABASE_MGMT_TOKEN</code> set on the platform function.) The service_role key is used once and never stored.'],
      ['Set the project\'s Edge Function secrets', 'manual',
        'On the new project, add the function secrets (email/Graph or Resend, <code>ANTHROPIC_API_KEY</code>, etc.): ' + extLink(LINKS.supaFns, 'Settings &rarr; Edge Functions') + '. Also run the <code>hs_data_usage</code> migration there so this panel\'s usage column fills in.'],
      ['Deploy the Edge Functions to the project', 'manual',
        'The ' + extLink(LINKS.gh, 'GitHub Actions') + ' deploy targets one project via the <code>SUPABASE_PROJECT_ID</code> repo secret. For a new nation, deploy to its ref: <code>supabase functions deploy --project-ref &lt;ref&gt;</code> (' + extLink(LINKS.supaCli, 'docs') + '), or point that secret at it and push. Control-plane-only functions (<code>provision-nation</code>, <code>report-nation-usage</code>) are excluded from that workflow by design.'],
      ['Cloudflare subdomain', 'auto',
        'The app deploys to Cloudflare on every push to <code>main</code> and serves <b>every</b> nation by hostname &mdash; no per-nation app deploy. Just confirm <code>&lt;subdomain&gt;.fnhub.app</code> resolves; with the wildcard <code>*.fnhub.app</code> DNS record + Worker route it is automatic. If not, add a DNS record + route in the ' + extLink(LINKS.cf, 'Cloudflare dashboard') + '.'],
      ['License the modules', 'manual',
        'Open <b>Configure</b> and tick which optional modules this nation may use (Finance, RFQ, Inspections, Capital Projects, …).'],
      ['Set status to Active', 'manual',
        'Only <b>active</b> nations publish to <code>nations_public</code> and resolve at <code>&lt;subdomain&gt;.fnhub.app</code>. Flip status to Active in Configure.'],
      ['Hand off to the nation\'s ED', 'manual',
        'The ED signs in at <code>&lt;subdomain&gt;.fnhub.app</code> and adds their own staff. Done &mdash; the nation manages itself from here.']
    ];
    var items = steps.map(function(s, i){
      return '<li style="display:flex;gap:12px;padding:11px 0;border-bottom:1px solid var(--line);align-items:flex-start;">'
        + '<span style="flex:0 0 auto;width:26px;height:26px;border-radius:50%;background:var(--accent);color:var(--ink);font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;">' + (i + 1) + '</span>'
        + '<div style="flex:1;"><div style="font-weight:700;font-size:13px;margin-bottom:3px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' + s[0] + ' ' + stepTag(s[1]) + '</div>'
        + '<div style="font-size:12px;color:var(--muted);line-height:1.55;">' + s[2] + '</div></div>'
        + '</li>';
    }).join('');
    return '<div class="card"><h3>Adding a nation &mdash; step by step</h3>'
      + '<p class="sub" style="margin:2px 0 6px;"><span class="pill" style="font-size:9px;background:#dcfce7;color:#166534;">Automated</span> steps the platform already handles; <span class="pill" style="font-size:9px;background:#f4f4f0;color:#696960;">Manual</span> steps you do in Supabase, GitHub, or Cloudflare. Links open each destination.</p>'
      + '<ol style="list-style:none;margin:4px 0 0;padding:0;">' + items + '</ol>'
      + '</div>';
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
        + '<td>' + (isMe ? '' : '<button class="btn sm danger" data-act="rm-admin" data-email="' + esc(em) + '">Remove</button>') + '</td></tr>';
    }).join('');
    return '<div class="card"><h3>Platform administrators</h3>'
      + '<table><thead><tr><th>Email</th><th>Added by</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>'
      + '<div style="display:flex;gap:8px;margin-top:12px;align-items:flex-end;flex-wrap:wrap;">'
      +   '<div style="flex:1;min-width:200px;"><label>Add administrator</label><input id="adm-email" type="email" placeholder="name@example.com"/></div>'
      +   '<button class="btn sm" type="button" data-act="add-admin">Add</button>'
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
      // Cache it: _nations is cold on a deep link or after a reload, and
      // showProvision(id) reads this array to prefill. Without this the wizard
      // would open blank with an EDITABLE subdomain and could mint a duplicate
      // registry row instead of updating this one.
      if (n) _nations = _nations.filter(function(x){ return String(x.id) !== String(n.id); }).concat([n]);
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
    return '<button class="btn sm ghost" type="button" data-act="home">&larr; Back</button>'
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
      + '<div class="card"><h3>Provisioning</h3>'
      +   '<p class="sub" style="margin:2px 0 8px;">'
      +     (n.supabase_url
              ? 'This nation already points at a Supabase project. Re-running provisioning replays the bootstrap schema and re-seeds the bucket and first ED against that project.'
              : 'This nation is registered but has no Supabase project yet. Create the project first, then run the wizard to apply the bootstrap schema, create the storage bucket, and seed the first ED.')
      +   '</p>'
      +   '<button class="btn sm ghost" type="button" data-act="provision" data-id="' + esc(n.id) + '">'
      +     (n.supabase_url ? 'Re-run provisioning &rarr;' : 'Provision this nation &rarr;') + '</button>'
      + '</div>'
      + '<div class="msg" id="cn-msg"></div>'
      + '<button class="btn" id="cn-save" type="button" data-act="save-config" data-id="' + esc(n.id) + '">Save changes</button>';
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
      + '<button class="btn" type="button" data-act="provision">Start provisioning wizard</button></div>';
  }

  // https://<ref>.supabase.co -> <ref>, so the wizard can prefill Project ref
  // from the URL already stored on the registry row.
  function _refFromUrl(url){
    var m = /^https?:\/\/([a-z0-9-]+)\.supabase\.co/i.exec(String(url || '').trim());
    return m ? m[1] : '';
  }

  // showProvision(id?) -- with an id, prefills from the registry row and locks
  // the subdomain, so provisioning an ALREADY-REGISTERED nation (the normal
  // flow: register first, create the project, then provision) updates that row
  // instead of trying to mint a second one. provision-nation upserts on
  // subdomain, so re-running against an existing nation is safe.
  window.showProvision = async function(id){
    document.getElementById('btn_out').style.display = '';
    var n = id ? (_nations.filter(function(x){ return String(x.id) === String(id); })[0] || null) : null;
    // Defensive: if the cache missed, fetch before rendering rather than
    // falling back to a blank wizard (see the note in configureNation).
    if (id && !n){
      var rr = await api('GET', '/nations?select=*&id=eq.' + encodeURIComponent(id));
      var aa = rr.ok ? await rr.json().catch(function(){return[];}) : [];
      n = aa[0] || null;
      if (n) _nations = _nations.concat([n]);
    }
    var v = function(x){ return esc(x == null ? '' : x); };
    var g2 = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;';
    var licensed = (n && n.modules_licensed) || null;
    var modChecks = MODULES.map(function(m){
      // Existing nation: mirror its licensing. New nation: all on by default,
      // matching the Add Nation card.
      var on = licensed ? !!licensed[m[0]] : true;
      return '<label style="display:inline-flex;align-items:center;gap:6px;font-weight:600;margin:0 12px 8px 0;"><input type="checkbox" class="pv-mod" value="' + m[0] + '" style="width:auto;"' + (on ? ' checked' : '') + '/> ' + esc(m[1]) + '</label>';
    }).join('');
    app.innerHTML = '<button class="btn sm ghost" type="button" data-act="' + (n ? 'configure' : 'home') + '"' + (n ? ' data-id="' + v(n.id) + '"' : '') + '>&larr; Back</button>'
      + '<h1 style="margin-top:12px;">' + (n ? 'Provision ' + v(n.display_name) : 'Provision a nation') + '</h1>'
      + '<p class="sub">Assisted: you created the Supabase project; this runs schema, bucket, first ED, and registry.</p>'
      + (n ? '<div class="msg ok" style="display:block;">Prefilled from the registry. The registry row for <code>' + v(n.subdomain) + '</code> will be updated, not duplicated.</div>' : '')
      + '<div class="card"><h3>Nation</h3>'
      +   '<div style="' + g2 + '"><div><label>Subdomain</label><input id="pv-sub" placeholder="listuguj" value="' + v(n && n.subdomain) + '"' + (n ? ' readonly style="background:var(--bg);color:var(--muted);"' : '') + '/></div><div><label>Short code</label><input id="pv-short" placeholder="LMG" value="' + v(n && n.short) + '"/></div></div>'
      +   '<label>Display name</label><input id="pv-name" placeholder="Listuguj Mi\'gmaq Government" value="' + v(n && n.display_name) + '"/>'
      +   '<div style="' + g2 + '"><div><label>Staff email domain</label><input id="pv-domain" placeholder="listuguj.ca" value="' + v(n && n.email_domain) + '"/></div><div><label>Primary color</label><input id="pv-color" placeholder="#f8e41a" value="' + v(n && n.primary_color) + '"/></div></div>'
      +   '<label>Housing email</label><input id="pv-housing" placeholder="housing@listuguj.ca" value="' + v(n && n.housing_email) + '"/>'
      +   '<label style="margin-top:10px;">Licensed modules</label><div>' + modChecks + '</div>'
      + '</div>'
      + '<div class="card"><h3>Target Supabase project ' + extLink(LINKS.supaApi, 'Where to find these &rarr;') + '</h3>'
      +   '<p class="sub" style="margin:2px 0 8px;">The new project you created (' + extLink(LINKS.supaNew, 'create one &rarr;') + '). All four values are on the project\'s <b>Settings &rarr; API</b> page. The service_role key is used once (bucket + ED) and never stored.</p>'
      +   '<div style="' + g2 + '">'
      +     '<div><label>Project ref</label><input id="pv-ref" placeholder="abcdefgh...ref" value="' + v(_refFromUrl(n && n.supabase_url)) + '" title="Supabase -> your project -> Settings -> General -> Reference ID. It is also the string in the dashboard URL: supabase.com/dashboard/project/<ref>"/>' + fieldHint('Settings &rarr; General &rarr; <b>Reference ID</b> (also the code in the dashboard URL).') + '</div>'
      +     '<div><label>Project URL</label><input id="pv-url" placeholder="https://&lt;ref&gt;.supabase.co" value="' + v(n && n.supabase_url) + '" title="Supabase -> Settings -> API -> Project URL (https://<ref>.supabase.co)"/>' + fieldHint('Settings &rarr; API &rarr; <b>Project URL</b>.') + '</div>'
      +   '</div>'
      +   '<label>Anon (publishable) key</label><input id="pv-anon" placeholder="eyJ..." value="' + v(n && n.supabase_anon) + '" title="Supabase -> Settings -> API -> Project API keys -> anon / public. Publishable; safe to store."/>' + fieldHint('Settings &rarr; API &rarr; Project API keys &rarr; <b>anon / public</b>. Publishable &mdash; safe to store.')
      +   '<label>Service role key (used once)</label><input id="pv-service" placeholder="eyJ... (service_role)" title="Supabase -> Settings -> API -> Project API keys -> service_role. SECRET. Used once here (bucket + first ED) and never stored."/>' + fieldHint('Settings &rarr; API &rarr; Project API keys &rarr; <b>service_role</b>. <b style="color:var(--danger);">Secret</b> &mdash; used once, never stored.')
      + '</div>'
      + '<div class="card"><h3>First ED and bootstrap schema</h3>'
      +   '<div style="' + g2 + '"><div><label>First ED email</label><input id="pv-ed-email" placeholder="ed@listuguj.ca"/></div><div><label>First ED name</label><input id="pv-ed-name" placeholder="Executive Director"/></div></div>'
      +   '<label>Bootstrap schema file (supabase/bootstrap/schema.sql)</label>'
      +   '<div id="pv-drop" style="border:2px dashed var(--hair);border-radius:10px;padding:18px 16px;text-align:center;cursor:pointer;background:var(--bg);transition:border-color .15s, background .15s;">'
      +     '<div style="font-size:22px;line-height:1;margin-bottom:6px;pointer-events:none;">&#128228;</div>'
      +     '<div style="font-size:13px;color:var(--muted);pointer-events:none;">Drag &amp; drop <code>schema.sql</code> here, or <b style="color:var(--ink);">click to choose a file</b></div>'
      +     '<input id="pv-schema" type="file" accept=".sql,text/plain" style="display:none;" title="The bootstrap schema shipped in the app repo at supabase/bootstrap/schema.sql."/>'
      +     '<div id="pv-schema-name" style="font-size:12px;font-weight:600;color:var(--ok);margin-top:8px;min-height:16px;"></div>'
      +   '</div>'
      +   fieldHint('Ships in the app repo at <code>supabase/bootstrap/schema.sql</code> &mdash; ' + extLink(LINKS.gh.replace('/actions', '/raw/main/supabase/bootstrap/schema.sql'), 'download the raw file &rarr;') + ', then drop or choose it here. (Only needed when provisioning a brand-new nation.)')
      + '</div>'
      + '<div class="msg" id="pv-msg"></div>'
      + '<button class="btn" id="pv-btn" type="button" data-act="run-provision">Provision nation</button>'
      + '<div id="pv-results" style="margin-top:14px;"></div>';
    wireSchemaDropzone();
  };

  // Drag-and-drop + click-to-browse for the bootstrap schema file. The panel's
  // CSP has no inline handlers, and drag events can't be delegated, so this is
  // wired directly after showProvision paints. runProvision still reads
  // document.getElementById('pv-schema').files[0], so we assign the dropped
  // file back onto the hidden native input via a DataTransfer.
  function wireSchemaDropzone(){
    var dz = document.getElementById('pv-drop');
    var input = document.getElementById('pv-schema');
    var nameEl = document.getElementById('pv-schema-name');
    if (!dz || !input) return;
    function showName(){ if (nameEl) nameEl.textContent = (input.files && input.files[0]) ? ('✓ ' + input.files[0].name) : ''; }
    function hot(on){ dz.style.borderColor = on ? 'var(--accent)' : 'var(--hair)'; dz.style.background = on ? 'var(--accent-light)' : 'var(--bg)'; }
    input.addEventListener('change', showName);
    dz.addEventListener('click', function(){ input.click(); });
    ['dragenter','dragover'].forEach(function(ev){ dz.addEventListener(ev, function(e){ e.preventDefault(); e.stopPropagation(); hot(true); }); });
    ['dragleave','dragend'].forEach(function(ev){ dz.addEventListener(ev, function(e){ e.preventDefault(); e.stopPropagation(); hot(false); }); });
    dz.addEventListener('drop', function(e){
      e.preventDefault(); e.stopPropagation(); hot(false);
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      try { var dt = new DataTransfer(); dt.items.add(files[0]); input.files = dt.files; } catch(err){ /* older browsers: fall back to click */ }
      showName();
    });
  }

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
      + '<button class="btn sm" type="button" data-act="home" style="margin-top:10px;">Back to nations</button></div>';
  }

  // ---- Event delegation ------------------------------------------------------
  // Every button here is wired through ONE delegated listener keyed on
  // data-act, because this panel's CSP is `script-src 'self'` with NO
  // 'unsafe-inline' (admin/_headers). An inline onclick="..." is silently
  // BLOCKED by the browser -- the button simply does nothing, with only a
  // console CSP violation to show for it. Do not reintroduce inline handlers:
  // add a data-act value and a case below instead.
  // Delegation also survives app.innerHTML re-renders, so nothing needs
  // re-wiring after a view change.
  document.addEventListener('click', function(e){
    var el = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el) return;
    var act = el.getAttribute('data-act');
    var id  = el.getAttribute('data-id') || '';
    switch (act){
      case 'home':          window.adminHome(); break;
      case 'logout':        window.adminLogout(); break;
      case 'reload':        location.reload(); break;
      case 'configure':     window.configureNation(id); break;
      case 'save-config':   window.saveNationConfig(id); break;
      case 'status':        window.adminSetStatus(id, el.getAttribute('data-status') || ''); break;
      case 'add-admin':     window.adminAdd(); break;
      case 'rm-admin':      window.adminRemove(el.getAttribute('data-email') || ''); break;
      // id is '' from the standalone card, which falls through to the blank
      // wizard; from a Configure page it prefills that nation.
      case 'provision':     window.showProvision(id); break;
      case 'run-provision': window.runProvision(); break;
    }
  });

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
