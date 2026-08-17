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
    gh:       'https://github.com/CLFN92/clfn-housing-app/actions',       // deploy workflows
    azure:    'https://portal.azure.com',                                // Entra app registrations
    resend:   'https://resend.com/domains'                               // verify domain + API keys
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
        'On the new project, add the non-email function secrets (e.g. <code>ANTHROPIC_API_KEY</code> for the AI assistant): ' + extLink(LINKS.supaFns, 'Settings &rarr; Edge Functions') + '. Email secrets are the next step. Also run the <code>hs_data_usage</code> migration there so this panel\'s usage column fills in.'],
      ['Set up email notifications (Microsoft 365 / Azure or Resend)', 'manual',
        'Transactional email goes through the <code>send-notification</code> function; each nation picks a provider with the <code>EMAIL_PROVIDER</code> secret, then adds the matching secrets in ' + extLink(LINKS.supaFns, 'Settings &rarr; Edge Functions') + '.'
        + '<div style="margin-top:6px;padding-left:10px;border-left:3px solid var(--hair);">'
        +   '<div style="margin-bottom:5px;"><b>Microsoft 365 / Azure</b> (<code>EMAIL_PROVIDER=graph</code>) &mdash; register an Entra app with the <b>Mail.Send</b> application permission in the ' + extLink(LINKS.azure, 'Azure portal') + ', then set <code>GRAPH_TENANT_ID</code>, <code>GRAPH_CLIENT_ID</code>, <code>GRAPH_CLIENT_SECRET</code>, and <code>GRAPH_FROM_USER</code> (a licensed/shared mailbox to send from).</div>'
        +   '<div><b>Resend</b> (<code>EMAIL_PROVIDER=resend</code>) &mdash; verify the sending domain and create an API key at ' + extLink(LINKS.resend, 'Resend') + ', then set <code>RESEND_API_KEY</code>, <code>EMAIL_FROM</code>, and <code>EMAIL_FROM_NAME</code>. (No M365 needed &mdash; good for nations without Microsoft.)</div>'
        + '</div>'
        + 'Optional for either provider: <code>EMAIL_BRAND</code> (footer wordmark) and <code>EMAIL_REPLY_TO</code>. Defaults to <code>graph</code> if unset.'],
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
    renderNationDocsCard(n.subdomain);
    wireDocFileInput();
    renderNationNotes(n.subdomain);
    renderNationInvoices(n.subdomain);
    window.invAddLine();          // seed one empty invoice line
    loadNicSummary(n.subdomain);
  };

  function configureView(n){
    var g2 = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;';
    var mods = n.modules_licensed || {};
    var modChecks = MODULES.map(function(m){
      return '<label style="display:inline-flex;align-items:center;gap:6px;font-weight:600;margin:0 12px 8px 0;">'
        + '<input type="checkbox" class="cn-mod" value="' + m[0] + '" style="width:auto;"' + (mods[m[0]] ? ' checked' : '') + '/> ' + esc(m[1]) + '</label>';
    }).join('');
    var stOpt = function(v,l){ return '<option value="' + v + '"' + (String(n.status||'provisioning') === v ? ' selected' : '') + '>' + l + '</option>'; };
    var tab = function(k, l, active){ return '<button class="nic-tab' + (active ? ' active' : '') + '" type="button" data-act="nic-tab" data-tab="' + k + '">' + l + '</button>'; };
    var panel = function(k, html, active){ return '<div class="nic-panel' + (active ? ' active' : '') + '" data-panel="' + k + '">' + html + '</div>'; };
    var modCount = Object.keys(n.modules_licensed || {}).filter(function(k){ return n.modules_licensed[k]; }).length;

    // Panel content (existing card markup, regrouped under tabs).
    var pOverview =
        '<div class="card"><h3>Branding &amp; contact</h3>'
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
      + '<div class="card"><h3>Licensed modules</h3>'
      +   '<p class="sub" style="margin:2px 0 8px;">Which optional modules this nation is allowed to use. The nation still turns each one on or off in its own in-app settings.</p>'
      +   '<div>' + modChecks + '</div>'
      + '</div>'
      + '<div class="card"><h3>Status</h3>'
      +   '<label>Registry status</label>'
      +   '<select id="cn-status">' + stOpt('provisioning','Provisioning') + stOpt('active','Active') + stOpt('suspended','Suspended') + '</select>'
      +   '<p class="sub" style="margin:6px 0 0;">Only <b>active</b> nations are published to <code>nations_public</code> and resolve at <code>&lt;subdomain&gt;.fnhub.app</code>.</p>'
      + '</div>';

    var pSupabase =
        '<div class="card"><h3>Supabase project</h3>'
      +   '<p class="sub" style="margin:2px 0 8px;">The nation\'s own database-per-nation project. The anon key is publishable.</p>'
      +   '<label>Supabase URL</label><input id="cn-url" placeholder="https://xxxx.supabase.co" value="' + esc(n.supabase_url || '') + '"/>'
      +   '<label>Supabase anon key</label><input id="cn-anon" placeholder="eyJ..." value="' + esc(n.supabase_anon || '') + '"/>'
      + '</div>'
      + '<div class="card"><h3>Provisioning</h3>'
      +   '<p class="sub" style="margin:2px 0 8px;">'
      +     (n.supabase_url
              ? 'This nation already points at a Supabase project. Re-running provisioning replays the bootstrap schema and re-seeds the bucket and first ED against that project.'
              : 'This nation is registered but has no Supabase project yet. Create the project first, then run the wizard to apply the bootstrap schema, create the storage bucket, and seed the first ED.')
      +   '</p>'
      +   '<button class="btn sm ghost" type="button" data-act="provision" data-id="' + esc(n.id) + '">'
      +     (n.supabase_url ? 'Re-run provisioning &rarr;' : 'Provision this nation &rarr;') + '</button>'
      + '</div>';

    var pNotes =
        '<div class="card"><h3>Notes</h3>'
      +   '<p class="sub" style="margin:2px 0 8px;">Internal log for this nation (calls, decisions, follow-ups). Visible to platform admins only.</p>'
      +   '<div id="cn-notes"><div class="empty">Loading notes...</div></div>'
      +   '<div style="margin-top:10px;"><textarea id="cn-note-body" rows="2" placeholder="Add a note..." style="width:100%;padding:10px 12px;border:1px solid var(--hair);border-radius:9px;font-size:14px;font-family:inherit;resize:vertical;"></textarea></div>'
      +   '<div class="msg" id="cn-note-msg"></div>'
      +   '<button class="btn sm" type="button" data-act="note-add" data-sub="' + esc(n.subdomain) + '">Add note</button>'
      + '</div>';

    var pInvoices =
        '<div class="card"><h3>Invoices</h3>'
      +   '<p class="sub" style="margin:2px 0 8px;">Subscription, setup and add-on billing for this nation. Creating an invoice generates a PDF and files it in Documents.</p>'
      +   '<div id="cn-invoices"><div class="empty">Loading invoices...</div></div>'
      +   '<div style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px;">'
      +     '<div style="font-weight:700;font-size:13px;margin-bottom:8px;">New invoice</div>'
      +     '<div id="cn-inv-lines"></div>'
      +     '<button class="btn sm ghost" type="button" data-act="inv-add-line" style="margin-top:2px;">+ Add line</button>'
      +     '<div style="' + g2 + 'margin-top:12px;">'
      +       '<div><label>Tax rate (%)</label><input id="cn-inv-tax" type="number" step="0.01" min="0" placeholder="0" value="0"/></div>'
      +       '<div><label>Due date</label><input id="cn-inv-due" type="date"/></div>'
      +     '</div>'
      +     '<label>Invoice notes (optional)</label><input id="cn-inv-notes" placeholder="Payable within 30 days; e-transfer to..."/>'
      +     '<div class="msg" id="cn-inv-msg"></div>'
      +     '<button class="btn" type="button" data-act="inv-create" data-sub="' + esc(n.subdomain) + '" data-id="' + esc(n.id) + '">Create invoice &amp; PDF</button>'
      +   '</div>'
      + '</div>';

    var pAgreement =
        '<div class="card"><h3>Subscription agreement</h3>'
      +   '<p class="sub" style="margin:2px 0 8px;">Generate the Home Land Homes software subscription agreement for this nation as a PDF. It fills in the nation party details below and is saved to the document library.</p>'
      +   '<label>Nation legal name (party)</label><input id="cn-agr-name" value="' + esc(n.display_name || '') + '"/>'
      +   '<label>Administrative office address</label><input id="cn-agr-addr" placeholder="123 Main St, Town, ON  A1A 1A1" value="' + esc(n.office_address || '') + '"/>'
      +   '<div class="msg" id="cn-agr-msg"></div>'
      +   '<button class="btn" type="button" data-act="gen-agreement" data-id="' + esc(n.id) + '">Generate agreement PDF</button>'
      + '</div>';

    var pDocuments =
        '<div class="card"><h3>Documents</h3>'
      +   '<p class="sub" style="margin:2px 0 8px;">Signed agreements, BCRs, invoices and other files for this nation. Stored privately on the control plane.</p>'
      +   '<div id="cn-docs"><div class="empty">Loading documents...</div></div>'
      +   '<div style="margin-top:14px;">'
      +     '<label>Document type for new uploads</label>'
      +     '<select id="cn-doc-kind"><option value="agreement">Agreement</option><option value="bcr">BCR</option><option value="other" selected>Other</option></select>'
      +     '<div id="cn-doc-drop" style="margin-top:10px;border:2px dashed var(--hair);border-radius:10px;padding:18px 16px;text-align:center;cursor:pointer;background:var(--bg);transition:border-color .15s, background .15s;">'
      +       '<div style="font-size:22px;line-height:1;margin-bottom:6px;pointer-events:none;">&#128228;</div>'
      +       '<div style="font-size:13px;color:var(--muted);pointer-events:none;">Drag &amp; drop a file here, or <b style="color:var(--ink);">click to choose</b></div>'
      +       '<input id="cn-doc-file" type="file" style="display:none;" data-sub="' + esc(n.subdomain) + '"/>'
      +       '<div id="cn-doc-name" style="font-size:12px;font-weight:600;color:var(--ok);margin-top:8px;min-height:16px;"></div>'
      +     '</div>'
      +   '</div>'
      +   '<div class="msg" id="cn-doc-msg"></div>'
      + '</div>';

    return '<div class="nic-shell">'
      + '<div class="nic-hero">'
      +   '<button class="back" type="button" data-act="home">&larr; All nations</button>'
      +   '<h1>' + esc(n.display_name) + '</h1>'
      +   '<div class="nic-sub"><code>' + esc(n.subdomain) + '.fnhub.app</code> &middot; Nation Information Card</div>'
      + '</div>'
      + '<div class="nic-strip">'
      +   '<div class="nic-strip-tile"><div class="l">Status</div><div class="v"><span class="pill ' + esc(n.status||'provisioning') + '">' + esc(n.status||'provisioning') + '</span></div></div>'
      +   '<div class="nic-strip-tile"><div class="l">Licensed modules</div><div class="v">' + modCount + '</div></div>'
      +   '<div class="nic-strip-tile"><div class="l">Data usage</div><div class="v" id="cn-sum-usage" style="color:var(--muted);">&mdash;</div></div>'
      +   '<div class="nic-strip-tile"><div class="l">Outstanding</div><div class="v" id="cn-sum-inv" style="color:var(--muted);">&mdash;</div></div>'
      + '</div>'
      + '<div class="nic-tabs">'
      +   tab('overview', 'Overview', true) + tab('supabase', 'Supabase') + tab('agreement', 'Agreement')
      +   tab('invoices', 'Invoices') + tab('notes', 'Notes') + tab('documents', 'Documents')
      + '</div>'
      + '<div class="nic-body">'
      +   panel('overview', pOverview, true) + panel('supabase', pSupabase)
      +   panel('agreement', pAgreement) + panel('invoices', pInvoices)
      +   panel('notes', pNotes) + panel('documents', pDocuments)
      + '</div>'
      + '<div class="nic-footer">'
      +   '<div class="msg" id="cn-msg"></div>'
      +   '<button class="btn" id="cn-save" type="button" data-act="save-config" data-id="' + esc(n.id) + '">Save changes</button>'
      + '</div>'
      + '</div>';
  }
  window.nicTab = function(name){
    Array.prototype.forEach.call(document.querySelectorAll('.nic-tab'), function(b){ b.classList.toggle('active', b.getAttribute('data-tab') === name); });
    Array.prototype.forEach.call(document.querySelectorAll('.nic-panel'), function(p){ p.classList.toggle('active', p.getAttribute('data-panel') === name); });
  };

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

  // ==========================================================================
  // Subscription agreement PDF + per-nation document library
  // ==========================================================================
  var STORE = PBASE + '/storage/v1';
  var DOC_BUCKET = 'nation-docs';

  // Lazy-load jsPDF (same build the nation app uses). CSP allows cdnjs here.
  var _jspdfLoading = null;
  function ensureJsPdf(cb, onerr){
    if (window.jspdf && window.jspdf.jsPDF) { cb(); return; }
    if (_jspdfLoading) { _jspdfLoading.then(cb, onerr); return; }
    _jspdfLoading = new Promise(function(resolve, reject){
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload = resolve; s.onerror = function(){ reject(new Error('jspdf load failed')); };
      document.head.appendChild(s);
    });
    _jspdfLoading.then(cb, onerr);
  }

  // The agreement, marker-formatted. Placeholders: {{NATION}} {{ADDRESS}} {{DATE}}.
  // Markers:  >disclaimer  #title  %subtitle  ##section  ###clause  -bullet  (blank)=gap
  var AGREEMENT_TPL = [
    '>TEMPLATE - This agreement was prepared as a working draft and is not legal advice. Have it reviewed by a lawyer (ideally one experienced with First Nations clients) before first use, and update the Provider party details upon incorporation.',
    '#SOFTWARE SUBSCRIPTION AGREEMENT',
    '%Home Land Homes - Housing Management Platform',
    'This Software Subscription Agreement (the "Agreement") is made as of the date of last signature below (the "Effective Date") between:',
    'Kevin Proctor, operating as "Home Land Homes" (the "Provider"), and',
    '{{NATION}}, a First Nation with administrative offices at {{ADDRESS}} (the "Nation").',
    '##Background',
    '-The Nation operates a housing department that manages homes, applications, tenancies, maintenance, capital projects and related finances for its members.',
    '-The Provider makes available a housing-management software platform designed for First Nations housing departments.',
    "-Both parties intend that the Nation's data remain under the Nation's ownership and control at all times, consistent with the principles of OCAP(R) (Ownership, Control, Access and Possession).",
    "-The parties acknowledge the United Nations Declaration on the Rights of Indigenous Peoples (UNDRIP), including Article 23 (the right of Indigenous peoples to be actively involved in developing and administering housing programmes through their own institutions) and Article 31 (the right of Indigenous peoples to maintain, control, protect and develop their data and cultural heritage), and the United Nations Declaration on the Rights of Indigenous Peoples Act, S.C. 2021, c. 14. This Agreement is intended to support the Nation's administration of its own housing programme through its own institutions.",
    '-The parties therefore agree as follows.',
    '##1. Definitions',
    '"Customer Data" means all data, records, documents, images and other content submitted to or generated within the Platform by or for the Nation, including personal information of the Nation\'s members, applicants, tenants, staff and contractors.',
    '"Platform" means the Provider\'s hosted housing-management software, including its staff application, tenant/applicant portal, and all modules listed in Schedule A, together with associated documentation.',
    '"Order Form" means Schedule A to this Agreement, which records the subscription tier, fees, term and options selected by the Nation.',
    '"Users" means individuals authorized by the Nation to access the Platform, including staff, leadership, consultants (subject to Section 2.4), and members using the tenant/applicant portal.',
    '"Setup Services" means the one-time onboarding services described in Schedule B.',
    '"Subscription Term" means the Initial Term and each Renewal Term described in Section 8.',
    '##2. Subscription and Access',
    '###2.1 Grant',
    'Subject to this Agreement and payment of the Fees, the Provider grants the Nation a non-exclusive, non-transferable right during the Subscription Term for its Users to access and use the Platform for the Nation\'s internal housing-administration purposes.',
    "###2.2 The Nation's workspace",
    "The Provider will provision a dedicated workspace for the Nation, including a database used solely for the Nation's Customer Data (no other customer's data is stored in the Nation's database), the Nation's own subdomain, and the Nation's branding as supplied by the Nation.",
    '###2.3 Users',
    'The Nation may authorize an unlimited number of Users. The Nation is responsible for its Users\' compliance with this Agreement, for maintaining the accuracy of role assignments, and for promptly deactivating Users who should no longer have access. Login credentials are personal and must not be shared.',
    '###2.4 Consultants and outside contractors',
    "The Nation may grant restricted access to external consultants using the Platform's per-user feature-access controls. Such access is at the Nation's direction and risk, and consultants are Users for the purposes of this Agreement.",
    '###2.5 Restrictions',
    "The Nation will not (and will not permit anyone to): resell or provide the Platform to any third party other than Users; copy, modify or create derivative works of the Platform; reverse engineer the Platform except to the extent permitted by law; use the Platform to violate applicable law; or attempt to access another customer's data.",
    '##3. Provider Obligations',
    '###3.1 Hosting and data location',
    "The Provider will host the Platform and store Customer Data (including backups) on infrastructure located in Canada, and will not transfer Customer Data outside Canada without the Nation's prior written consent, except as strictly required to deliver a feature the Nation has enabled (in which case the Provider will identify the subprocessor and location in advance).",
    '###3.2 Availability and support',
    'The Provider will provide the Platform and support in accordance with Schedule C (Support and Service Levels).',
    '###3.3 Backups',
    "The Provider will maintain automated daily backups of the Nation's database, retained for at least seven (7) days, and will restore from backup without additional charge where data loss results from a Platform failure.",
    '###3.4 Security',
    'The Provider will maintain administrative, technical and organizational safeguards appropriate to the sensitivity of Customer Data, including encryption of data in transit, role-based access control, per-action approval authorities, and tamper-resistant (append-only) audit logging of material actions within the Platform.',
    '###3.5 Updates',
    'The Provider will maintain and update the Platform at no additional charge. Updates will not materially reduce the functionality the Nation has subscribed to during a Subscription Term.',
    '###3.6 Transparency reporting',
    'At least once per contract year, and additionally on the Nation\'s reasonable request, the Provider will give the Nation a written transparency summary covering: availability performance against Schedule C; any security incidents affecting the Nation and their resolution; written confirmation that Customer Data (including backups) remained on infrastructure in Canada in accordance with Section 3.1; any subprocessor additions or changes (Schedule D); and material changes to the Platform. The Provider does not place advertising trackers or third-party analytics in the Platform; operational logs are used only to operate, support and secure the service.',
    '##4. Customer Data - Ownership and Sovereignty',
    '###4.1 Ownership',
    'As between the parties, the Nation owns all right, title and interest in and to Customer Data. The Provider acquires no rights in Customer Data other than the limited license in Section 4.2.',
    '###4.2 Limited license',
    'The Nation grants the Provider a limited, non-exclusive license to host, process, transmit, display and back up Customer Data solely as necessary to provide and support the Platform, and for no other purpose.',
    '###4.3 Prohibited uses',
    'The Provider will not sell Customer Data; will not share Customer Data with any third party except subprocessors necessary to deliver the service; will not use Customer Data for advertising or profiling; and will not use Customer Data to train any artificial-intelligence model. The optional AI Assistant operates only if the Nation selects and initials that add-on in Schedule A; that selection constitutes the Nation\'s prior written approval under Section 3.1 for the limited out-of-Canada processing described in Schedule D. AI queries are processed by the Provider\'s AI subprocessor under agreements that prohibit the use of the Nation\'s data for model training; the AI Assistant has read-only access governed by the requesting User\'s permissions, and the Nation may disable it at any time in Platform settings.',
    '###4.4 Access and control',
    "The Nation controls which Users may access which functions and records through the Platform's role, approval-authority and feature-access settings. The Provider will access the Nation's workspace only for support, maintenance, or as directed by the Nation, and such access is logged.",
    '###4.5 Export',
    'The Nation may request, and the Provider will deliver within fifteen (15) business days, a complete export of Customer Data in machine-readable formats (such as CSV/JSON, plus stored files in their native formats) at no charge no more than twice per year, and at a reasonable fee thereafter.',
    '###4.6 Return and deletion on termination',
    "For sixty (60) days following expiry or termination of this Agreement, the Provider will make a complete export of Customer Data available to the Nation as described in Section 4.5 at no charge. Following that period (or earlier at the Nation's written direction), the Provider will permanently delete Customer Data from production systems, with deletion from rolling backups occurring in the ordinary course within seven (7) days thereafter, and will certify deletion on request.",
    '###4.7 Privacy compliance and breach notice',
    'Each party will comply with privacy laws applicable to it in respect of personal information contained in Customer Data, including the Personal Information Protection and Electronic Documents Act (Canada) to the extent applicable. The Provider will notify the Nation without undue delay, and in any event within seventy-two (72) hours, after becoming aware of any breach of security leading to unauthorized access to or disclosure of Customer Data, and will cooperate with the Nation\'s reasonable investigation and notification obligations.',
    '###4.8 OCAP(R) alignment',
    'The parties record how this Agreement gives effect to the principles of OCAP(R): Ownership - the Nation owns all Customer Data (Section 4.1); Control - the Nation controls access, roles and approvals within the Platform, and the Provider may use Customer Data only as the Nation permits (Sections 4.2-4.4); Access - the Nation may access and export its complete data at any time (Section 4.5); Possession - on exit, the Nation takes possession of its complete records and the Provider deletes its copies (Section 4.6). OCAP(R) is a registered trademark of the First Nations Information Governance Centre (FNIGC); the Provider is not affiliated with, endorsed by, or certified by FNIGC, and this Section describes contractual commitments, not a certification.',
    '###4.9 UNDRIP and interpretation',
    'This Agreement shall be interpreted in a manner consistent with the United Nations Declaration on the Rights of Indigenous Peoples, including the Nation\'s right of self-determination, its right to administer its housing programmes through its own institutions (Article 23), and its rights in respect of its data and information (Article 31 and the principles of Indigenous data sovereignty). Nothing in this Agreement abrogates or derogates from the Nation\'s inherent, Aboriginal or treaty rights, or from the Nation\'s own laws, customs and governance processes. If any provision of this Agreement is ambiguous, the interpretation that best upholds the Nation\'s ownership and control of Customer Data prevails.',
    '###4.10 Government and third-party demands',
    'If the Provider receives a court order, subpoena, or other governmental or third-party demand for Customer Data, the Provider will (unless legally prohibited from doing so): promptly notify the Nation before any disclosure; disclose only the minimum Customer Data it is legally compelled to disclose; and reasonably cooperate, at the Nation\'s request and expense, with the Nation\'s efforts to contest, limit or seek protective treatment of the demand. The Provider will not voluntarily disclose Customer Data to any government or third party.',
    '##5. Setup Services and Data Migration',
    'The Provider will perform the Setup Services described in Schedule B for the one-time fee in Schedule A. Before signature, the Provider will confirm the setup scope in writing following a scoping call, including any additional flat-fee line items for unusually large or complex historical data. The setup fee and any such line items stated in Schedule A are fixed: the Provider will not invoice the Nation for setup amounts beyond those stated in Schedule A.',
    '##6. Nation Obligations',
    "The Nation will: designate a primary administrative contact; provide source records reasonably required for migration in the condition described in Schedule B; ensure information it submits is, to its knowledge, accurate; use the Platform in compliance with applicable law, including privacy law applicable to the Nation's handling of member and tenant information; and pay Fees when due.",
    '##7. Fees and Payment',
    '###7.1 Fees',
    'The Nation will pay the subscription fees, one-time setup fee, and any selected add-on fees stated in Schedule A (the "Fees"). All amounts are in Canadian dollars and exclusive of applicable taxes, if any.',
    '###7.2 Billing',
    'Unless Schedule A states otherwise, subscription Fees are invoiced annually in advance, with billing aligned to the April-March fiscal year where the Nation requests it. Monthly billing, where selected, is charged at the monthly rate stated in Schedule A. Invoices are payable within thirty (30) days.',
    '###7.3 Setup discount',
    "Where the Nation signs a one-year term and pays the first year's subscription in advance, the one-time setup fee is reduced by fifty percent (50%), as reflected in Schedule A.",
    '###7.4 Fee changes',
    'Fees are fixed for the Initial Term. The Provider may adjust Fees effective at a Renewal Term by giving at least sixty (60) days\' written notice before renewal; the Nation may decline renewal in accordance with Section 8.',
    '###7.5 Late amounts',
    'Amounts more than thirty (30) days overdue may bear interest at 1% per month (12.68% annually). The Provider will not suspend the Nation\'s access for non-payment without first giving at least thirty (30) days\' written notice specifically referencing suspension, and will not delete Customer Data as a consequence of non-payment except in accordance with Section 4.6 following termination.',
    '##8. Term and Termination',
    '###8.1 Term',
    'This Agreement begins on the Effective Date and continues for the initial term stated in Schedule A (the "Initial Term"). It renews automatically for successive one-year terms (each a "Renewal Term") unless either party gives written notice of non-renewal at least sixty (60) days before the end of the then-current term.',
    '###8.2 Termination for cause',
    'Either party may terminate this Agreement if the other party materially breaches it and fails to cure the breach within thirty (30) days of written notice describing the breach.',
    '###8.3 Termination by the Nation for data-commitment breach',
    'Without limiting Section 8.2, a breach by the Provider of Section 3.1 (data location) or Section 4.3 (prohibited uses) is deemed material and, if not cured (where curable) within ten (10) days of notice, entitles the Nation to terminate immediately and receive a pro-rata refund of prepaid subscription Fees for the unused portion of the term.',
    '###8.4 Effect of termination',
    'Upon expiry or termination: the Nation\'s access ends (subject to the export period in Section 4.6); Fees accrued to the termination date remain payable; and Sections 4.5-4.10, 9, 11, 12, 13, 14 and 16 survive.',
    '###8.5 Business continuity',
    "If the Provider decides to permanently discontinue the Platform, the Provider will give the Nation at least ninety (90) days' written notice, will extend the export period in Section 4.6 to cover that notice period, and will provide reasonable transition assistance (data export, format documentation, and orderly handover) at the hourly rate in Schedule B. The Provider will maintain current documentation of the Platform's data formats sufficient for the Nation, or a successor provider acting for it, to make full use of exported Customer Data.",
    '##9. Confidentiality',
    "Each party will protect the other party's non-public information received under this Agreement with at least the care it uses for its own confidential information (and no less than reasonable care), will use it only to perform this Agreement, and will not disclose it except to personnel and advisors bound by confidentiality obligations, or as required by law with prompt notice to the other party where permitted. Customer Data is the Nation's confidential information. Pricing granted to the Nation under Schedule A is confidential to both parties; this Section does not restrict the Nation's internal governance processes (including Chief and Council review) or any disclosure required by the Nation's accountability obligations to its members or funders.",
    '##10. Intellectual Property',
    'The Provider owns the Platform and all related intellectual property, including improvements. No rights are granted to the Nation other than the subscription rights in Section 2. The Nation owns its Customer Data (Section 4.1) and its own names, marks and branding; the Nation grants the Provider a limited license to display them within the Nation\'s own workspace solely to provide the service. If the Nation provides suggestions or feedback, the Provider may use it to improve the Platform without obligation, provided doing so never incorporates Customer Data.',
    '##11. Warranties and Disclaimers',
    'The Provider warrants that: (a) it will provide the Platform with reasonable skill and care; (b) the Platform will materially conform to its documentation; and (c) it will not knowingly introduce malicious code. Except as stated in this Agreement, the Platform is provided "as is" and the Provider disclaims all other warranties, express or implied, including merchantability, fitness for a particular purpose and non-infringement, and does not warrant that the Platform will be uninterrupted or error-free. The Platform supports, but does not replace, the Nation\'s own decision-making; housing decisions (including allocations, approvals and financial decisions) remain the Nation\'s.',
    '##12. Indemnities',
    "The Provider will defend and indemnify the Nation against third-party claims alleging that the Platform, as provided by the Provider and used as permitted, infringes Canadian intellectual-property rights, and will pay resulting damages finally awarded or agreed in settlement. If such a claim arises, the Provider may procure the right to continue, modify the Platform to be non-infringing, or terminate the affected subscription with a pro-rata refund. The Nation will defend and indemnify the Provider against third-party claims arising from Customer Data content the Nation submits or the Nation's use of the Platform in violation of law, except to the extent caused by the Provider's breach of this Agreement.",
    '##13. Limitation of Liability',
    "Except for (i) a party's indemnity obligations under Section 12, (ii) the Provider's breach of Section 4.3 (prohibited uses of Customer Data), or (iii) either party's gross negligence or wilful misconduct: neither party is liable for indirect, incidental, special or consequential damages, or loss of profits or revenue; and each party's total aggregate liability under this Agreement is limited to the Fees paid or payable by the Nation in the twelve (12) months preceding the event giving rise to the claim. For breaches described in clause (ii), the Provider's aggregate liability cap is instead two (2) times such Fees.",
    '##14. Publicity',
    "Neither party will publicly name the other, or use the other's name, logo or marks in marketing, case studies, references or announcements, without the other party's prior written consent. For the Nation, such consent may only be given in accordance with the Nation's own governance processes.",
    '##15. Dispute Resolution and Governing Law',
    'The parties will first attempt in good faith to resolve any dispute through discussion between designated representatives for at least thirty (30) days. Failing resolution, the parties will attempt mediation with a mutually agreed mediator before commencing proceedings, except where urgent injunctive relief is required. This Agreement is governed by the laws of the Province of Ontario and the federal laws of Canada applicable in it, without prejudice to the Nation\'s inherent and treaty rights, which are not affected by this Agreement. The parties attorn to the non-exclusive jurisdiction of the courts of Ontario. [Note to counsel: jurisdiction, venue and any dispute-resolution preferences of the Nation - including arbitration or the Nation\'s own processes - should be settled per negotiation.]',
    '##16. General',
    '-Entire agreement. This Agreement (including its Schedules) is the entire agreement between the parties regarding its subject matter and supersedes prior discussions.',
    '-Amendment. Amendments must be in writing and signed by both parties.',
    '-Assignment. Neither party may assign this Agreement without the other\'s written consent, except the Provider may assign it to a corporation it forms to carry on the Home Land Homes business, or in connection with a merger or sale of that business, with written notice to the Nation; the Nation may terminate within sixty (60) days of such notice if the assignee is unacceptable to it, acting reasonably, with a pro-rata refund of prepaid Fees.',
    '-Subcontracting. The Provider may use the subprocessors and third-party systems listed in Schedule D to deliver the Platform and remains responsible for them. The Provider will give the Nation at least thirty (30) days\' written notice before adding or replacing a subprocessor that will process Customer Data; if the Nation reasonably objects on data-protection grounds and no resolution is found, the Nation may terminate the affected feature or this Agreement with a pro-rata refund of prepaid Fees.',
    '-Force majeure. Neither party is liable for delay or failure caused by events beyond its reasonable control, provided it uses reasonable efforts to mitigate.',
    '-Notices. Notices must be in writing and delivered to the contacts listed in Schedule A (email is sufficient, with confirmation of receipt for termination or breach notices).',
    '-Severability; waiver. Invalid provisions are severed without affecting the remainder; a waiver applies only to the instance given in writing.',
    '-Counterparts. This Agreement may be signed in counterparts, including electronically.',
    '##Signatures',
    'Each signatory confirms they are authorized to bind the party they sign for. Where the Nation\'s governance requires it, the Nation\'s signature may be supported by a Band Council Resolution referenced below.',
    '###PROVIDER: Kevin Proctor, operating as Home Land Homes',
    'Signature: ______________________________     Date: ____________________',
    'Name: Kevin Proctor',
    '###THE NATION: {{NATION}}',
    'Signature: ______________________________     Date: ____________________',
    'Name: ______________________________     Title: ____________________',
    'Band Council Resolution No. (if applicable): ____________________'
  ].join('\n');

  function _fmtDateLong(){
    // Admin panel runs in a browser; Date is available here (unlike workflow scripts).
    var d = new Date();
    var mo = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return mo[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  function buildAgreementPdf(nationName, address){
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ unit: 'pt', format: 'letter' });
    var M = 56, W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    var maxW = W - M * 2, y = M;
    function ensure(h){ if (y + h > H - M - 20) { doc.addPage(); y = M; } }
    function block(text, o){
      o = o || {};
      doc.setFont('helvetica', o.style || 'normal');
      doc.setFontSize(o.size || 10);
      if (o.color) doc.setTextColor(o.color[0], o.color[1], o.color[2]); else doc.setTextColor(20, 20, 20);
      var indent = o.indent || 0;
      var lines = doc.splitTextToSize(text, maxW - indent);
      var lh = (o.size || 10) * 1.32;
      for (var i = 0; i < lines.length; i++){
        ensure(lh);
        if (o.align === 'center') doc.text(lines[i], W / 2, y, { align: 'center' });
        else doc.text(lines[i], M + indent, y);
        y += lh;
      }
      y += (o.after == null ? 6 : o.after);
    }
    var tpl = AGREEMENT_TPL
      .replace(/\{\{NATION\}\}/g, nationName)
      .replace(/\{\{ADDRESS\}\}/g, address || '______________________________')
      .replace(/\{\{DATE\}\}/g, _fmtDateLong());
    tpl.split('\n').forEach(function(raw){
      var line = raw;
      if (line === '') { y += 4; return; }
      if (line.charAt(0) === '>') { // disclaimer
        y += 2; block(line.slice(1), { style: 'italic', size: 9, color: [140, 90, 0], after: 10 });
        ensure(1); doc.setDrawColor(220); doc.line(M, y - 4, W - M, y - 4); y += 6; return;
      }
      if (line.slice(0, 1) === '#' && line.slice(0, 2) !== '##') { block(line.slice(1), { style: 'bold', size: 16, align: 'center', after: 3 }); return; }
      if (line.charAt(0) === '%') { block(line.slice(1), { size: 11, align: 'center', color: [90, 90, 90], after: 12 }); return; }
      if (line.slice(0, 3) === '###') { ensure(30); block(line.slice(3), { style: 'bold', size: 10.5, after: 3 }); return; }
      if (line.slice(0, 2) === '##') { ensure(40); y += 6; block(line.slice(2), { style: 'bold', size: 12.5, after: 5 }); return; }
      if (line.charAt(0) === '-') { block('•  ' + line.slice(1), { size: 10, indent: 14, after: 5 }); return; }
      block(line, { size: 10 });
    });
    // Footer: brand + page x of y.
    var pages = doc.internal.getNumberOfPages();
    for (var p = 1; p <= pages; p++){
      doc.setPage(p);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(130, 130, 130);
      doc.text('Home Land Homes - Software Subscription Agreement', M, H - 26);
      doc.text('Page ' + p + ' of ' + pages, W - M, H - 26, { align: 'right' });
    }
    return doc;
  }

  window.generateNationAgreement = function(id){
    var n = _nations.filter(function(x){ return String(x.id) === String(id); })[0];
    if (!n){ setMsg('cn-agr-msg', 'Nation not loaded.'); return; }
    var name = ((document.getElementById('cn-agr-name') || {}).value || n.display_name || '').trim();
    var addr = ((document.getElementById('cn-agr-addr') || {}).value || '').trim();
    if (!name){ setMsg('cn-agr-msg', 'Enter the nation legal name.'); return; }
    setMsg('cn-agr-msg', 'Generating...', 'ok');
    ensureJsPdf(async function(){
      try {
        var doc = buildAgreementPdf(name, addr);
        var safe = name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
        var fname = 'Subscription-Agreement-' + safe + '.pdf';
        doc.save(fname);                                   // download for immediate use
        var blob = doc.output('blob');
        await uploadDoc(n.subdomain, new File([blob], fname, { type: 'application/pdf' }), 'agreement');
        setMsg('cn-agr-msg', 'Generated and saved to the document library.', 'ok');
        renderNationDocsCard(n.subdomain);
      } catch (e){ setMsg('cn-agr-msg', 'Could not generate: ' + String(e && e.message || e)); }
    }, function(){ setMsg('cn-agr-msg', 'Could not load the PDF generator (offline?).'); });
  };

  // ---- Document library (control-plane Storage) ------------------------------
  function docPath(sub, filename){
    var safe = String(filename).replace(/[^a-z0-9._-]+/gi, '_');
    // No Math.random/Date entropy needed for uniqueness beyond time; use a short
    // random token from crypto (available in-browser) to avoid collisions.
    var tok = (self.crypto && self.crypto.randomUUID) ? self.crypto.randomUUID().slice(0, 8) : String(performance.now()).replace('.', '');
    return sub + '/' + tok + '_' + safe;
  }
  async function uploadDoc(sub, file, kind){
    var path = docPath(sub, file.name);
    var up = await fetch(STORE + '/object/' + DOC_BUCKET + '/' + encodeURI(path), {
      method: 'POST',
      headers: { apikey: ANON, Authorization: 'Bearer ' + getAT(), 'Content-Type': file.type || 'application/octet-stream' },
      body: file
    });
    if (!up.ok) { var t = await up.text(); throw new Error('upload failed: ' + t.slice(0, 120)); }
    var r = await api('POST', '/nation_documents', {
      subdomain: sub, name: file.name, path: path, kind: kind || 'other',
      size_bytes: file.size || null, uploaded_by: jwtEmail()
    }, 'return=minimal');
    if (!r.ok) throw new Error('metadata write failed');
    await audit('nation_doc_added', sub, file.name);
  }
  async function _signedDocUrl(path){
    var r = await fetch(STORE + '/object/sign/' + DOC_BUCKET + '/' + encodeURI(path), {
      method: 'POST',
      headers: { apikey: ANON, Authorization: 'Bearer ' + getAT(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 3600 })
    });
    if (!r.ok) return null;
    var d = await r.json();
    return (d && d.signedURL) ? d.signedURL : null;
  }
  // View: open inline in a new tab (PDFs/images render in the browser).
  window.viewNationDoc = async function(path){
    var s = await _signedDocUrl(path);
    if (s) window.open(STORE + s, '_blank', 'noopener'); else alert('Could not open the document.');
  };
  // Download: force a save via the &download flag on the signed URL.
  window.downloadNationDoc = async function(path, name){
    var s = await _signedDocUrl(path);
    if (!s){ alert('Could not create a download link.'); return; }
    var sep = s.indexOf('?') >= 0 ? '&' : '?';
    window.open(STORE + s + sep + 'download=' + encodeURIComponent(name || ''), '_blank', 'noopener');
  };
  window.deleteNationDoc = async function(id, path, sub){
    if (!confirm('Delete this document? This cannot be undone.')) return;
    await fetch(STORE + '/object/' + DOC_BUCKET + '/' + encodeURI(path), {
      method: 'DELETE', headers: { apikey: ANON, Authorization: 'Bearer ' + getAT() }
    }).catch(function(){});
    var r = await api('DELETE', '/nation_documents?id=eq.' + encodeURIComponent(id), null, 'return=minimal');
    if (r.ok){ await audit('nation_doc_deleted', sub, path); renderNationDocsCard(sub); }
  };
  function _docKindLabel(k){ return ({ agreement: 'Agreement', bcr: 'BCR', other: 'Other' })[k] || (k || 'Other'); }
  async function renderNationDocsCard(sub){
    var host = document.getElementById('cn-docs'); if (!host) return;
    var r = await api('GET', '/nation_documents?subdomain=eq.' + encodeURIComponent(sub) + '&order=uploaded_at.desc');
    var docs = r.ok ? await r.json().catch(function(){ return []; }) : [];
    if (!docs.length){ host.innerHTML = '<div class="empty">No documents yet.</div>'; return; }
    var rows = docs.map(function(d){
      var when = '';
      try { when = new Date(d.uploaded_at).toLocaleDateString(); } catch(e){}
      return '<tr>'
        + '<td><b>' + esc(d.name) + '</b></td>'
        + '<td style="font-size:11px;color:var(--muted);">' + esc(_docKindLabel(d.kind)) + '</td>'
        + '<td style="font-size:11px;color:var(--muted);">' + esc(when) + (d.uploaded_by ? ' &middot; ' + esc(d.uploaded_by) : '') + '</td>'
        + '<td><div class="row-actions">'
        +   '<button class="btn sm ghost" type="button" data-act="doc-view" data-path="' + esc(d.path) + '">View</button>'
        +   '<button class="btn sm ghost" type="button" data-act="doc-dl" data-path="' + esc(d.path) + '" data-name="' + esc(d.name) + '">Download</button>'
        +   '<button class="btn sm danger" type="button" data-act="doc-del" data-id="' + esc(d.id) + '" data-path="' + esc(d.path) + '" data-sub="' + esc(sub) + '">Delete</button>'
        + '</div></td></tr>';
    }).join('');
    host.innerHTML = '<table><thead><tr><th>Document</th><th>Type</th><th>Added</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
  }
  // Drag-and-drop + click-to-browse for the Documents uploader. Drag events
  // can't be delegated, so this is wired directly after Configure renders.
  function wireDocFileInput(){
    var input = document.getElementById('cn-doc-file');
    var dz = document.getElementById('cn-doc-drop');
    var nameEl = document.getElementById('cn-doc-name');
    if (!input || !dz) return;
    function hot(on){ dz.style.borderColor = on ? 'var(--accent)' : 'var(--hair)'; dz.style.background = on ? 'var(--accent-light)' : 'var(--bg)'; }
    async function handle(file){
      if (!file) return;
      var sub = input.getAttribute('data-sub');
      var kind = (document.getElementById('cn-doc-kind') || {}).value || 'other';
      if (nameEl) nameEl.textContent = file.name;
      setMsg('cn-doc-msg', 'Uploading ' + file.name + '...', 'ok');
      try { await uploadDoc(sub, file, kind); setMsg('cn-doc-msg', 'Uploaded.', 'ok'); if (nameEl) nameEl.textContent = ''; renderNationDocsCard(sub); }
      catch (e){ setMsg('cn-doc-msg', 'Upload failed: ' + String(e && e.message || e)); }
      input.value = '';
    }
    dz.addEventListener('click', function(){ input.click(); });
    input.addEventListener('change', function(){ handle(input.files && input.files[0]); });
    ['dragenter','dragover'].forEach(function(ev){ dz.addEventListener(ev, function(e){ e.preventDefault(); e.stopPropagation(); hot(true); }); });
    ['dragleave','dragend'].forEach(function(ev){ dz.addEventListener(ev, function(e){ e.preventDefault(); e.stopPropagation(); hot(false); }); });
    dz.addEventListener('drop', function(e){
      e.preventDefault(); e.stopPropagation(); hot(false);
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) handle(files[0]);
    });
  }

  // ==========================================================================
  // Nation Information Card: summary, notes, invoices
  // ==========================================================================
  function _money(n, cur){ return (cur || 'CAD') === 'CAD' ? '$' + (Number(n) || 0).toFixed(2) : (Number(n) || 0).toFixed(2) + ' ' + cur; }
  function _sumLbl(t){ return '<div style="color:var(--muted);text-transform:uppercase;letter-spacing:.4px;font-size:10px;font-weight:700;">' + t + '</div>'; }

  async function loadNicSummary(sub){
    try {
      var u = await api('GET', '/nation_usage?subdomain=eq.' + encodeURIComponent(sub));
      var usg = (u.ok ? await u.json().catch(function(){ return []; }) : [])[0];
      var el = document.getElementById('cn-sum-usage');
      if (el){
        el.style.color = usg ? '' : 'var(--muted)';
        el.innerHTML = usg
          ? esc(fmtBytes(usg.database_bytes)) + ' db &middot; ' + esc(fmtBytes(usg.storage_bytes)) + ' files'
          : 'not reported';
      }
    } catch(e){}
    try {
      var iv = await api('GET', '/nation_invoices?subdomain=eq.' + encodeURIComponent(sub) + '&select=total,status');
      var ivr = iv.ok ? await iv.json().catch(function(){ return []; }) : [];
      var out = ivr.filter(function(x){ return x.status === 'sent' || x.status === 'draft'; })
                   .reduce(function(a, x){ return a + Number(x.total || 0); }, 0);
      var iel = document.getElementById('cn-sum-inv');
      if (iel){ iel.style.color = ''; iel.innerHTML = _money(out); }
    } catch(e){}
  }

  // ---- Notes -----------------------------------------------------------------
  async function renderNationNotes(sub){
    var host = document.getElementById('cn-notes'); if (!host) return;
    var r = await api('GET', '/nation_notes?subdomain=eq.' + encodeURIComponent(sub) + '&order=created_at.desc');
    var notes = r.ok ? await r.json().catch(function(){ return []; }) : [];
    if (!notes.length){ host.innerHTML = '<div class="empty">No notes yet.</div>'; return; }
    host.innerHTML = notes.map(function(nt){
      var when = ''; try { when = new Date(nt.created_at).toLocaleString(); } catch(e){}
      return '<div style="padding:8px 0;border-bottom:1px solid var(--line);">'
        + '<div style="font-size:13px;white-space:pre-wrap;">' + esc(nt.body) + '</div>'
        + '<div style="font-size:11px;color:var(--muted);margin-top:3px;">' + esc(nt.author || '') + (when ? ' &middot; ' + esc(when) : '') + '</div>'
        + '</div>';
    }).join('');
  }
  window.addNationNote = async function(sub){
    var ta = document.getElementById('cn-note-body');
    var body = (ta && ta.value || '').trim();
    if (!body){ setMsg('cn-note-msg', 'Enter a note first.'); return; }
    var r = await api('POST', '/nation_notes', { subdomain: sub, body: body, author: jwtEmail() }, 'return=minimal');
    if (r.ok){ if (ta) ta.value = ''; setMsg('cn-note-msg', 'Note added.', 'ok'); await audit('nation_note_added', sub, ''); renderNationNotes(sub); }
    else { setMsg('cn-note-msg', 'Could not save the note.'); }
  };

  // ---- Invoices --------------------------------------------------------------
  var INV_STATUS = { draft: ['Draft', 'provisioning'], sent: ['Sent', 'provisioning'], paid: ['Paid', 'active'], void: ['Void', 'suspended'] };
  window.invAddLine = function(){
    var host = document.getElementById('cn-inv-lines'); if (!host) return;
    var row = document.createElement('div');
    row.className = 'inv-line';
    row.style.cssText = 'display:grid;grid-template-columns:1fr 64px 88px 30px;gap:6px;margin-bottom:6px;align-items:center;';
    row.innerHTML =
        '<input class="inv-desc" placeholder="Description" style="font-size:14px;padding:8px 10px;"/>'
      + '<input class="inv-qty" type="number" step="0.01" value="1" title="Quantity" style="font-size:14px;padding:8px 10px;"/>'
      + '<input class="inv-price" type="number" step="0.01" placeholder="Unit $" title="Unit price" style="font-size:14px;padding:8px 10px;"/>'
      + '<button class="btn sm danger" type="button" data-act="inv-del-line" title="Remove line" style="padding:6px 0;">&times;</button>';
    host.appendChild(row);
  };
  function _collectInvLines(){
    var out = [];
    Array.prototype.forEach.call(document.querySelectorAll('#cn-inv-lines .inv-line'), function(row){
      var desc = (row.querySelector('.inv-desc') || {}).value || '';
      var qty  = parseFloat((row.querySelector('.inv-qty') || {}).value || '0') || 0;
      var price = parseFloat((row.querySelector('.inv-price') || {}).value || '0') || 0;
      if (desc.trim() && (qty || price)) out.push({ description: desc.trim(), qty: qty, unit_price: price });
    });
    return out;
  }
  async function nextInvoiceNumber(){
    var year = new Date().getFullYear();
    var r = await api('GET', '/nation_invoices?select=number');
    var rows = r.ok ? await r.json().catch(function(){ return []; }) : [];
    var re = new RegExp('^HLH-' + year + '-(\\d+)$'), max = 0;
    rows.forEach(function(x){ var m = re.exec(String(x.number || '')); if (m){ var nn = parseInt(m[1], 10); if (nn > max) max = nn; } });
    return 'HLH-' + year + '-' + String(max + 1).padStart(2, '0');
  }
  async function renderNationInvoices(sub){
    var host = document.getElementById('cn-invoices'); if (!host) return;
    var r = await api('GET', '/nation_invoices?subdomain=eq.' + encodeURIComponent(sub) + '&order=issue_date.desc');
    var inv = r.ok ? await r.json().catch(function(){ return []; }) : [];
    if (!inv.length){ host.innerHTML = '<div class="empty">No invoices yet.</div>'; return; }
    var rows = inv.map(function(x){
      var st = INV_STATUS[x.status] || ['?', 'provisioning'];
      var acts = '';
      if (x.status === 'draft') acts += '<button class="btn sm ghost" type="button" data-act="inv-status" data-id="' + esc(x.id) + '" data-status="sent" data-sub="' + esc(sub) + '">Mark sent</button>';
      if (x.status === 'draft' || x.status === 'sent') acts += '<button class="btn sm ghost" type="button" data-act="inv-status" data-id="' + esc(x.id) + '" data-status="paid" data-sub="' + esc(sub) + '">Mark paid</button>';
      if (x.status !== 'void' && x.status !== 'paid') acts += '<button class="btn sm danger" type="button" data-act="inv-status" data-id="' + esc(x.id) + '" data-status="void" data-sub="' + esc(sub) + '">Void</button>';
      return '<tr>'
        + '<td><b>' + esc(x.number) + '</b></td>'
        + '<td style="font-size:11px;color:var(--muted);">' + esc(x.issue_date || '') + '</td>'
        + '<td style="font-variant-numeric:tabular-nums;">' + _money(x.total, x.currency) + '</td>'
        + '<td><span class="pill ' + st[1] + '">' + st[0] + '</span></td>'
        + '<td><div class="row-actions">' + acts + '</div></td></tr>';
    }).join('');
    host.innerHTML = '<table><thead><tr><th>Invoice</th><th>Issued</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
  }
  window.setInvoiceStatus = async function(id, status, sub){
    if (status === 'void' && !confirm('Void this invoice?')) return;
    var r = await api('PATCH', '/nation_invoices?id=eq.' + encodeURIComponent(id), { status: status, updated_at: new Date().toISOString() }, 'return=minimal');
    if (r.ok){ await audit('nation_invoice_' + status, sub, id); renderNationInvoices(sub); loadNicSummary(sub); }
  };
  window.createNationInvoice = function(sub, id){
    var n = _nations.filter(function(x){ return String(x.id) === String(id); })[0];
    var lines = _collectInvLines();
    if (!lines.length){ setMsg('cn-inv-msg', 'Add at least one line with a description and amount.'); return; }
    var taxRate = parseFloat((document.getElementById('cn-inv-tax') || {}).value || '0') || 0;
    var due = (document.getElementById('cn-inv-due') || {}).value || null;
    var inotes = (document.getElementById('cn-inv-notes') || {}).value || '';
    var subtotal = lines.reduce(function(a, l){ return a + (l.qty * l.unit_price); }, 0);
    var tax = Math.round(subtotal * taxRate) / 100;
    var total = Math.round((subtotal + tax) * 100) / 100;
    subtotal = Math.round(subtotal * 100) / 100;
    setMsg('cn-inv-msg', 'Creating...', 'ok');
    ensureJsPdf(async function(){
      try {
        var number = await nextInvoiceNumber();
        var today = new Date().toISOString().slice(0, 10);
        var inv = { subdomain: sub, number: number, issue_date: today, due_date: due, currency: 'CAD',
                    line_items: lines, subtotal: subtotal, tax_rate: taxRate, tax: tax, total: total,
                    status: 'draft', notes: inotes, created_by: jwtEmail() };
        var r = await api('POST', '/nation_invoices', inv, 'return=minimal');
        if (!r.ok){ var t = await r.text(); setMsg('cn-inv-msg', /duplicate|unique/i.test(t) ? 'Number collision, try again.' : 'Could not save invoice.'); return; }
        var doc = buildInvoicePdf(n, inv);
        var fname = number + '.pdf';
        doc.save(fname);
        try { await uploadDoc(sub, new File([doc.output('blob')], fname, { type: 'application/pdf' }), 'invoice'); } catch(e){}
        await audit('nation_invoice_created', sub, number);
        setMsg('cn-inv-msg', 'Invoice ' + number + ' created (PDF downloaded + filed in Documents).', 'ok');
        document.getElementById('cn-inv-lines').innerHTML = ''; invAddLine();
        var tn = document.getElementById('cn-inv-notes'); if (tn) tn.value = '';
        renderNationInvoices(sub); renderNationDocsCard(sub); loadNicSummary(sub);
      } catch (e){ setMsg('cn-inv-msg', 'Could not create: ' + String(e && e.message || e)); }
    }, function(){ setMsg('cn-inv-msg', 'Could not load the PDF generator (offline?).'); });
  };

  function buildInvoicePdf(nation, inv){
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ unit: 'pt', format: 'letter' });
    var M = 56, W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), y = M;
    function t(s, x, yy, o){ o = o || {}; doc.setFont('helvetica', o.style || 'normal'); doc.setFontSize(o.size || 10); if (o.color) doc.setTextColor(o.color[0], o.color[1], o.color[2]); else doc.setTextColor(20, 20, 20); doc.text(String(s), x, yy, o.align ? { align: o.align } : undefined); }
    // Header
    t('Home Land Homes', M, y, { style: 'bold', size: 16 });
    t('INVOICE', W - M, y, { style: 'bold', size: 18, align: 'right', color: [120, 120, 120] });
    y += 16; t('Housing Management Platform', M, y, { size: 10, color: [110, 110, 110] });
    t(inv.number, W - M, y, { size: 11, align: 'right' });
    y += 26; doc.setDrawColor(220); doc.line(M, y, W - M, y); y += 20;
    // Bill to + meta
    t('BILL TO', M, y, { style: 'bold', size: 9, color: [120, 120, 120] });
    t('DETAILS', W - 200, y, { style: 'bold', size: 9, color: [120, 120, 120] });
    y += 14;
    t(nation ? nation.display_name : '', M, y, { style: 'bold', size: 11 });
    t('Issue date: ' + (inv.issue_date || ''), W - 200, y, { size: 10 });
    y += 14;
    if (nation && nation.subdomain) t(nation.subdomain + '.fnhub.app', M, y, { size: 10, color: [110, 110, 110] });
    if (inv.due_date) { t('Due date:  ' + inv.due_date, W - 200, y, { size: 10 }); }
    y += 26;
    // Table header
    var cX = M, cQty = W - M - 190, cUnit = W - M - 110, cAmt = W - M;
    doc.setFillColor(245, 245, 242); doc.rect(M - 6, y - 12, W - M * 2 + 12, 22, 'F');
    t('Description', cX, y, { style: 'bold', size: 9, color: [90, 90, 90] });
    t('Qty', cQty, y, { style: 'bold', size: 9, align: 'right', color: [90, 90, 90] });
    t('Unit', cUnit, y, { style: 'bold', size: 9, align: 'right', color: [90, 90, 90] });
    t('Amount', cAmt, y, { style: 'bold', size: 9, align: 'right', color: [90, 90, 90] });
    y += 20;
    (inv.line_items || []).forEach(function(l){
      var amt = (Number(l.qty) || 0) * (Number(l.unit_price) || 0);
      var lines = doc.splitTextToSize(String(l.description), cQty - cX - 16);
      for (var i = 0; i < lines.length; i++){ t(lines[i], cX, y + i * 13, { size: 10 }); }
      t(String(l.qty), cQty, y, { size: 10, align: 'right' });
      t(_money(l.unit_price), cUnit, y, { size: 10, align: 'right' });
      t(_money(amt), cAmt, y, { size: 10, align: 'right' });
      y += Math.max(lines.length * 13, 16) + 4;
      if (y > H - 140) { doc.addPage(); y = M; }
    });
    doc.setDrawColor(225); doc.line(cQty - 10, y, cAmt, y); y += 16;
    function totalRow(label, val, bold){ t(label, cUnit, y, { size: bold ? 11 : 10, align: 'right', style: bold ? 'bold' : 'normal' }); t(val, cAmt, y, { size: bold ? 11 : 10, align: 'right', style: bold ? 'bold' : 'normal' }); y += bold ? 18 : 15; }
    totalRow('Subtotal', _money(inv.subtotal));
    if (Number(inv.tax_rate)) totalRow('Tax (' + inv.tax_rate + '%)', _money(inv.tax));
    totalRow('Total (' + inv.currency + ')', _money(inv.total), true);
    if (inv.notes){ y += 14; t('Notes', M, y, { style: 'bold', size: 9, color: [120, 120, 120] }); y += 14; doc.splitTextToSize(String(inv.notes), W - M * 2).forEach(function(ln){ t(ln, M, y, { size: 10 }); y += 13; }); }
    t('Home Land Homes - Housing Management Platform', M, H - 26, { size: 8, color: [130, 130, 130] });
    return doc;
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
      case 'gen-agreement': window.generateNationAgreement(id); break;
      case 'doc-view':      window.viewNationDoc(el.getAttribute('data-path') || ''); break;
      case 'doc-dl':        window.downloadNationDoc(el.getAttribute('data-path') || '', el.getAttribute('data-name') || ''); break;
      case 'doc-del':       window.deleteNationDoc(el.getAttribute('data-id') || '', el.getAttribute('data-path') || '', el.getAttribute('data-sub') || ''); break;
      case 'nic-tab':       window.nicTab(el.getAttribute('data-tab') || ''); break;
      case 'note-add':      window.addNationNote(el.getAttribute('data-sub') || ''); break;
      case 'inv-add-line':  window.invAddLine(); break;
      case 'inv-del-line':  { var lr = el.closest && el.closest('.inv-line'); if (lr) lr.remove(); break; }
      case 'inv-create':    window.createNationInvoice(el.getAttribute('data-sub') || '', id); break;
      case 'inv-status':    window.setInvoiceStatus(el.getAttribute('data-id') || '', el.getAttribute('data-status') || '', el.getAttribute('data-sub') || ''); break;
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
