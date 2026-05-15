/* ============================================================
 * housing-views.js — CLFN Housing Suite
 * View navigation and render functions for housing.html
 *
 * Load order: ... shared-data.js → scoring.js → THIS FILE
 *
 * Exposes:
 *   showDash()              — navigate to dashboard/home
 *   showApp()               — navigate to application form
 *   showSettings()          — navigate to settings panel
 *   showFinance()           — navigate to finance module
 *   showEmployeeHome()      — render role-aware home/tile screen
 *   showTenantsForRole()    — show tenants or tenant search by role
 *   showInventoryForRole()  — show inventory or unit search by role
 *   renderInventoryView()   — render housing inventory table
 *   renderMatchView()       — render housing match table
 *   renderTenantsView()     — render tenants table
 * ============================================================ */

'use strict';

function showDash(){
  var path = window.location.pathname || '';
  var onHousingHome =
    path.endsWith('/housing.html') ||
    path === '/housing.html' ||
    path.endsWith('/') ||
    path === '';
  if (!onHousingHome) {
    // Fade out before navigating — eliminates the flash/jump on departure
    document.body.style.transition = 'opacity .15s ease';
    document.body.style.opacity = '0';
    setTimeout(function() { window.location.href = '/housing.html?view=home'; }, 150);
    return;
  }
  showEmployeeHome();
}
function showApp(){
  var _al=document.getElementById('appLayout');
  if(_al){ _al.style.display='flex'; _al.style.width='100%'; }
  hideAllViews('appLayout');
  setNavActive('tab_app');
  if(_al){ _al.style.display='flex'; _al.style.width='100%'; }
  var spb=document.getElementById('stepProgressBar');if(spb)spb.style.display='block';
  var apf=document.getElementById('appProgressFoot');if(apf)apf.style.display='block';
  var ta=document.getElementById('tab_app');if(ta)ta.classList.add('active');
  // Show sidebar with step nav
    var sn=document.getElementById('stepNav');if(sn)sn.style.display='block';
}

function showSettings(){
  var role = window.currentRole || 'housing_employee_l1';
  if(!APPROVAL_AUTHORITY.can('accessSettings', role)) {
    showToast('Settings are only accessible to the Housing Manager and Executive Director.');
    return;
  }
  // Settings view lives in housing.html — if we're on a sub-page (inventory,
  // tenants, match, renos, contractors), hand off so housing.html's ?view=
  // dispatcher can open it.
  if (!document.getElementById('settingsView')) {
    window.location.href = 'housing.html?view=settings';
    return;
  }
  if(!window._navSkipPush) pushNav('settings');
  _showView('settingsView');
  setNavActive('tab_settings');
  populateSettings();
  // Show Users tab first — each tab renders lazily when clicked via showSettingsSection
  showSettingsSection('sec_users');
  // Apply role-based locks after the Users tab has rendered
  setTimeout(applySettingsRoleLocks, 100);
}

// ── Finance Module ────────────────────────────────────────────────────────
// Gated by CLFN_MODULES.isEnabled('finance'). Stashes the current session
// into sessionStorage so finance.html (a separate single-file app) can read
// it, then navigates over.
function showFinance(){
  if(!(window.CLFN_MODULES && window.CLFN_MODULES.isEnabled('finance'))){
    console.warn('[housing] showFinance: finance module not enabled');
    showToast('Finance module is not enabled for this nation.');
    return;
  }
  // Gate on finance-role access. Use the same authoritative source as
  // showEmployeeHome(): HOUSING_SESSION.role takes priority, then _realRole,
  // then currentRole. This avoids races where the gate sees stale
  // window.currentRole while HOUSING_SESSION.role is already set.
  var gateRole = (typeof HOUSING_SESSION !== 'undefined' && HOUSING_SESSION && HOUSING_SESSION.role)
              || window._realRole
              || window.currentRole
              || 'housing_employee_l1';
  var canAccess = window.CLFN_PERMS.hasFinanceAccess(gateRole);
  if(!canAccess){
    console.warn('[housing] showFinance: role "'+gateRole+'" blocked from finance module');
    showToast('Your role does not have access to the Finance module.');
    return;
  }
  try {
    stashHousingSession();
  } catch(e) {
    // stashHousingSession already alerted the user; don't navigate.
    return;
  }
  window.location.href = 'finance.html';
}

// Writes the current user's session details into sessionStorage so that
// other same-origin HTML pages (finance.html today, renos.html in the
// future) can recover who is signed in without running the whole login
// flow again. Called on a successful login and whenever we hand off to a
// module in a separate HTML file.
//
// Reads from the globals the login flow actually populates:
//   - HOUSING_SESSION.accessToken  — set at login (line ~16400)
//   - HOUSING_SESSION.name          — set at login (line ~16399)
//   - HOUSING_SESSION.email         — set at login (line ~16398)
//   - HOUSING_SESSION.role          — set by resolveHousingRole()
//   - window._realRole              — also set by resolveHousingRole()
function stashHousingSession(){
  try {
    var token = '';
    var name  = '';
    var email = '';
    var role  = '';

    if (typeof HOUSING_SESSION !== 'undefined' && HOUSING_SESSION) {
      token = HOUSING_SESSION.accessToken || '';
      name  = HOUSING_SESSION.name || '';
      email = HOUSING_SESSION.email || '';
      role  = HOUSING_SESSION.role || '';
    }
    // _realRole takes precedence for role if set (it's the canonical role)
    if (window._realRole) role = window._realRole;

    if (!token) {
      console.warn('[housing] stashHousingSession: NO ACCESS TOKEN. Aborting handoff.');
      alert('Session handoff failed: no access token. Please sign out and sign back in.');
      throw new Error('no access token');
    }
    if (!role) {
      console.warn('[housing] stashHousingSession: NO ROLE. Aborting handoff.');
      alert('Session handoff failed: no role detected. Please sign out and sign back in.');
      throw new Error('no role');
    }

    var sess = {
      accessToken: token,
      role:        role,
      name:        name || email || 'Unknown User',
      email:       email
    };
    sessionStorage.setItem('HOUSING_SESSION', JSON.stringify(sess));
  } catch(e) {
    console.warn('[housing] stashHousingSession failed:', e);
    throw e;  // re-throw so showFinance() can abort navigation
  }
}



function renderInventoryView(){
  var showRenoCol = (ROLE.isManagement(window.currentRole));
  var th = document.getElementById('inv_reno_score_th');
  if(th) th.style.display = showRenoCol ? '' : 'none';
  var units = [];
  units = housingUnits.slice();
  if(!units.length) units=(typeof housingUnits!=='undefined'&&housingUnits.length)?housingUnits:(window.HOUSING_UNITS_DATA||[]);
  var search = (document.getElementById('inv_search')||{}).value||'';
  var _searchLc = (search || '').toLowerCase().trim();
  // Pre-filter (search bar only — every other filter is now in the column-
  // menu popovers via tableApplyFilterSort below). Archived units stay
  // hidden by default; users can re-include them via the Status column
  // menu (or — once we add an "Include archived" toggle).
  var filtered = units.filter(function(u){
    if(u.archived) return false;
    if(_searchLc) {
      // Scan every visible column: address, status, type, beds, tenant name.
      var hay = [
        u.num, u.street, u.status, u.type, u.bedrooms,
        u.assignedName, u.funder, u.foundation,
        (u.accessible ? 'accessible' : ''),
        (u.isElders ? 'elders' : '')
      ].filter(Boolean).join(' ').toLowerCase();
      if (hay.indexOf(_searchLc) === -1) return false;
    }
    return true;
  });

  var vacantCount = units.filter(function(u){return u.status==='vacant' && !u.archived;}).length;
  var el = document.getElementById('inv_count'); if(el) el.textContent = units.filter(function(u){return !u.archived;}).length;
  var ve = document.getElementById('inv_vacant_count'); if(ve) ve.textContent = vacantCount+' vacant';

  var tbody = document.getElementById('inv_tbody');
  if(!tbody) return;
  if(!filtered.length){ tbody.innerHTML='<tr><td colspan="10" style="padding:32px;text-align:center;color:var(--muted);">No units match the current filters.</td></tr>'; return; }

  var statusStyle = {
    vacant:      {bg:'#f0fdf4',c:'#15803d',label:'Vacant'},
    occupied:    {bg:'#eff6ff',c:'#1d4ed8',label:'Occupied'},
    under_repair:{bg:'#fffbeb',c:'#92400e',label:'Under Repair'},
    reserved:    {bg:'#faf5ff',c:'#7c3aed',label:'Reserved'},
    condemned:   {bg:'#fef2f2',c:'#b91c1c',label:'Condemned'},
    archived:    {bg:'#f4f4f0',c:'#888',   label:'Archived'}
  };

  // ── Column-menu sort + filter via the shared scaffolding (Phase 2A) ────
  // Each accessor defines how a column reads from a unit row, plus a
  // user-facing label and whether the column is worth showing a value
  // checklist for (Address/Reno Score skip the checklist — too many uniques).
  // Every column is filterable — even Address and Reno Score. The popover's
  // search box makes long value lists manageable.
  var _invColumns = {
    addr:        { label: 'Address',       accessor: function(u){ return ((u.num||'') + ' ' + (u.street||'')).trim(); } },
    bedrooms:    { label: 'Beds',          accessor: function(u){ return parseInt(u.bedrooms, 10) || 0; } },
    bathrooms:   { label: 'Baths',         accessor: function(u){ return parseInt(u.bathrooms, 10) || 0; } },
    type:        { label: 'Type',          accessor: function(u){ return (u.type && u.type !== '0' && u.type !== 'nan') ? u.type : '(none)'; } },
    foundation:  { label: 'Foundation',    accessor: function(u){ return (u.foundation && u.foundation !== '0' && u.foundation !== 'nan') ? u.foundation : '(none)'; } },
    accessible:  { label: 'Accessibility', accessor: function(u){ return u.accessible ? 'Accessible' : 'Non-accessible'; } },
    funder:      { label: 'Funder',        accessor: function(u){ return u.funder || '(none)'; } },
    status:      { label: 'Status',        accessor: function(u){ return (statusStyle[u.status]||{}).label || u.status || 'Unknown'; } },
    reno_score:  { label: 'Reno Score',    accessor: function(u){ try { return calcRenoScore(u.id).score; } catch(e){ return 0; } } }
  };
  // Build a plain accessor map for tableApplyFilterSort.
  var _invAccessors = {};
  Object.keys(_invColumns).forEach(function(k){ _invAccessors[k] = _invColumns[k].accessor; });

  var _invState = (typeof tableStateGet === 'function') ? tableStateGet('inventory') : { sort:{key:'',dir:1}, filters:{} };

  // Register the columns + a getter for the pre-sort row source so the
  // column menu can compute uniques + counts on demand.
  if (typeof tableRegisterColumns === 'function') {
    tableRegisterColumns('inventory', {
      columns:  _invColumns,
      getRows:  function(){ return filtered; },
      onChange: renderInventoryView
    });
  }

  // Apply per-column filters + sort → flat list.
  var _invRows = (typeof tableApplyFilterSort === 'function')
    ? tableApplyFilterSort(filtered, _invAccessors, _invState)
    : filtered;

  // ─────────────────────────────────────────────────────────────────────
  function _invRowHtml(u){
    var ss = statusStyle[u.status]||{bg:'#f0f0ec',c:'#888',label:u.status||'Unknown'};
    var addr = u.num+' '+u.street;
    var bath = (u.bathrooms&&u.bathrooms!=='0'&&u.bathrooms!=='nan') ? u.bathrooms : '—';
    var fnd  = (u.foundation&&u.foundation!=='nan'&&u.foundation!=='0') ? u.foundation : '—';
    var type = (u.type&&u.type!=='0'&&u.type!=='nan') ? u.type : '—';
    var funder = u.funder||'—';
    var uid = u.id.replace(/'/g,"\\'");
    return '<tr style="border-bottom:1px solid var(--border);transition:background .12s;" onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'\'">'
      +'<td style="padding:9px 14px;font-size:13px;font-weight:600;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" onclick="openUnitDetail(\''+uid+'\')">'+'<span style="text-decoration:underline;text-decoration-color:var(--border);text-underline-offset:2px;">'+addr+'</span>'
      +(u.isElders?' <span style="font-size:9px;background:var(--warn-amber-bg);color:var(--warn-amber);border:1px solid var(--warn-amber-border);padding:1px 5px;border-radius:6px;">ELDERS UNIT</span>':'')
      +'</td>'
      +'<td style="padding:9px 10px;text-align:center;font-size:13px;font-weight:700;color:var(--text);">'+u.bedrooms+'</td>'
      +'<td style="padding:9px 10px;text-align:center;font-size:12px;color:var(--muted);">'+bath+'</td>'
      +'<td style="padding:9px 10px;font-size:12px;color:var(--muted);text-transform:capitalize;">'+type+'</td>'
      +'<td class="col-hide-tablet" style="padding:9px 10px;font-size:12px;color:var(--muted);text-transform:capitalize;">'+fnd+'</td>'
      +'<td style="padding:9px 10px;text-align:center;font-size:14px;">'+(u.accessible?'<span title="Accessible">♿</span>':'<span style="color:var(--border);">—</span>')+'</td>'
      +'<td class="col-hide-tablet" style="padding:9px 10px;font-size:12px;color:var(--muted);">'+funder+'</td>'
      +'<td style="padding:9px 14px;"><span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:10px;background:'+ss.bg+';color:'+ss.c+';">'+ss.label+'</span>'
      +(u.assignedName?' <span class="js-lbl-sm">→ '+u.assignedName+'</span>':'')+'</td>'
      +(ROLE.isManagement(window.currentRole) ? (function(){
        var _hasSow = !!getSowData(u.id);
        var _hasProg = !!(window._renoProgress && window._renoProgress[u.id]);
        if(_hasSow||_hasProg){
          var _rs=calcRenoScore(u.id); var _sc=_rs.score;
          var _tier=_sc>=40?{label:'Critical',c:'#b91c1c',bg:'#fef2f2'}:_sc>=25?{label:'High',c:'#7a6000',bg:'#fef9ec'}:_sc>=12?{label:'Medium',c:'#1d4ed8',bg:'#eff6ff'}:{label:'Low',c:'#15803d',bg:'#f0fdf4'};
          return '<td style="padding:9px 10px;">'
            +'<div data-inv-reno-sow="'+uid+'" style="display:flex;align-items:center;gap:5px;cursor:pointer;" title="Open Scope of Work">'
            +'<span style="font-size:14px;font-weight:800;color:var(--text);">'+_sc+'</span>'
            +'<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;background:'+_tier.bg+';color:'+_tier.c+';">'+_tier.label+'</span>'
            +'</div></td>';
        }
        return '<td style="padding:9px 10px;"><span style="font-size:11px;color:var(--border);">—</span></td>';
      })() : '')
      +'<td style="padding:9px 10px;text-align:center;width:1%;white-space:nowrap;">'
      +'<div style="display:flex;align-items:center;justify-content:center;gap:6px;">'
      +'<button type="button" onclick="event.stopPropagation();openSowModal(\''+uid+'\')" title="Scope of Work" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:14px;padding:4px;">🔨</button>'
      +'<button type="button" onclick="event.stopPropagation();openUnitEditModal(\''+uid+'\')" title="Edit unit" style="background:none;border:1px solid var(--border);color:var(--muted);border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px;transition:all .15s;" onmouseover="this.style.borderColor=\'var(--yellow)\';this.style.color=\'var(--yellow)\'" onmouseout="this.style.borderColor=\'var(--border)\';this.style.color=\'var(--muted)\'">'
      +'<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
      +'</button>'
      +'</div>'
      +'</td>'
      +'</tr>';
  }

  // Empty-state path
  if (!_invRows.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="padding:32px;text-align:center;color:var(--muted);">No units match the current filters.</td></tr>';
  } else {
    tbody.innerHTML = _invRows.map(_invRowHtml).join('');
  }

  // Wire column-menu click + sort indicators on the table header.
  var thead = document.getElementById('inv_thead');
  if (typeof tableBindColumnMenuClicks === 'function') tableBindColumnMenuClicks(thead, 'inventory');
  if (typeof tableRefreshSortIndicators === 'function') tableRefreshSortIndicators(thead, 'inventory');

  // Wire action buttons
  tbody.querySelectorAll('[data-inv-reno-sow]').forEach(function(cell){
    cell.addEventListener('click', function(e){ e.stopPropagation(); openSowModal(cell.getAttribute('data-inv-reno-sow')); });
  });
  tbody.querySelectorAll('[data-sow-uid]').forEach(function(btn){
    btn.addEventListener('click', function(e){ e.stopPropagation(); openSowModal(btn.getAttribute('data-sow-uid')); });
  });
  tbody.querySelectorAll('[data-uid]').forEach(function(row){
    row.addEventListener('click', function(){ openUnitDetail(row.getAttribute('data-uid')); });
  });
}

// ── Unit Edit Modal ──────────────────────────────────────

function renderMatchView(){
  var allApps = (typeof applications !== 'undefined' ? applications : []);
  var allUnits = (typeof housingUnits !== 'undefined' && housingUnits.length) ? housingUnits : (window.HOUSING_UNITS_DATA || []);
  var vacantUnits = allUnits.filter(function(u){ return u.status==='vacant' && !u.archived; });

  // Search-bar pre-filter. All other filtering happens via the column-menu
  // popovers (see tableApplyFilterSort below).
  var search = (document.getElementById('match_search')||{}).value||'';
  var _searchLc = (search || '').toLowerCase().trim();
  var filtered = allApps.filter(function(a){
    if(a.archived) return false;
    // File-update applications normally don't belong on Match — they're
    // updates to an existing tenant's record, not housing requests. BUT a
    // file update WITHOUT an assignedUnit is a data anomaly and should
    // surface so a unit can be attached.
    if(a.appType === 'existing_tenant' && a.assignedUnit) return false;
    if(a.status===APP_STATUS.DRAFT||a.status===APP_STATUS.ARCHIVED||a.status===APP_STATUS.FILE_UPDATE) return false;
    // Hide already-housed applicants from the Match list by default.
    var isHoused = a.status==='assigned' || !!a.assignedUnit;
    if(isHoused) return false;
    if(_searchLc){
      var hay = [
        a.fn, a.ln, a.id, a.tier, a.status, a.reserve,
        a.score, a.classification, a.assignedAddress
      ].filter(function(v){ return v != null; }).join(' ').toLowerCase();
      if (hay.indexOf(_searchLc) === -1) return false;
    }
    return true;
  });

  var content = document.getElementById('match_content');
  if(!content) return;

  // For each applicant find their best matching vacant unit
  function bestUnit(app){
    var needsBeds = 1;
    if(app.habitants) needsBeds = Math.max(1, 1 + (app.coApp?1:0) + app.habitants.length);
    var needsAccess = app.accessibility && app.accessibility!=='None' && app.accessibility!=='0' && app.accessibility!==0;
    var age = app.dob ? Math.floor((new Date()-new Date(app.dob))/(365.25*24*3600*1000)) : 0;
    var isElders = age >= 55;

    var scored = vacantUnits.map(function(u){
      var sc = 0;
      if(u.bedrooms === needsBeds)      sc += 10;
      else if(u.bedrooms > needsBeds)   sc += 5;
      else if(u.bedrooms === needsBeds-1) sc += 3;
      if(needsAccess && u.accessible)   sc += 8;
      if(needsAccess && !u.accessible)  sc -= 4;
      if(isElders && u.isElders)        sc += 6;
      if(!isElders && u.isElders)       sc -= 2;
      return {unit:u, score:sc, maxPossible:24};
    }).sort(function(a,b){ return b.score-a.score; });

    return scored[0] || null;
  }

  var tierColor = {
    'Critical Priority': '#15803d',
    'High Priority':   '#1d4ed8',
    'Medium Priority': '#d97706',
    'Low Priority':    '#6b7280'
  };
  var statusLabel = {
    'submitted':    'Pending HM',
    'ed_approved':  'ED Approved',
    'mgr_approved': 'Mgr Approved',
    'assigned':     'Assigned'
  };

  // ── Column-menu sort + filter via the shared scaffolding (Phase 2B) ────
  function _bestUnitAddr(app){
    var b = bestUnit(app);
    return b && b.unit ? (b.unit.num + ' ' + b.unit.street) : '';
  }
  var _matchColumns = {
    applicant:   { label: 'Applicant',  accessor: function(a){ return ((a.fn||'') + ' ' + (a.ln||'')).trim(); } },
    score:       { label: 'Score',      accessor: function(a){ return a.score || 0; } },
    tier:        { label: 'Tier',       accessor: function(a){ return (a.tier || 'Low Priority').replace(' Priority',''); } },
    reserve:     { label: 'Reserve',    accessor: function(a){ return a.reserve || '(none)'; } },
    bestUnit:    { label: 'Best Unit',  accessor: function(a){ return _bestUnitAddr(a) || '(no match)'; } },
    status:      { label: 'Status',     accessor: function(a){ return statusLabel[a.status] || a.status || 'Unknown'; } }
  };
  var _matchAccessors = {};
  Object.keys(_matchColumns).forEach(function(k){ _matchAccessors[k] = _matchColumns[k].accessor; });

  var _matchState = (typeof tableStateGet === 'function') ? tableStateGet('match') : { sort:{key:'score',dir:-1}, filters:{} };

  if (typeof tableRegisterColumns === 'function') {
    tableRegisterColumns('match', {
      columns:  _matchColumns,
      getRows:  function(){ return filtered; },
      onChange: renderMatchView
    });
  }

  var _matchRows = (typeof tableApplyFilterSort === 'function')
    ? tableApplyFilterSort(filtered, _matchAccessors, _matchState)
    : filtered.slice().sort(function(a,b){ return (b.score||0)-(a.score||0); });

  if(!_matchRows.length){
    content.innerHTML='<div class="card" style="text-align:center;padding:40px;color:var(--muted);">No applicants match the current filters.</div>';
    return;
  }

  var rows = _matchRows.map(function(app, i){
    var best = bestUnit(app);
    var name = ((app.fn||'')+' '+(app.ln||'')).trim();
    var tCol = tierColor[app.tier] || '#6b7280';
    var tier = (app.tier||'Low Priority').replace(' Priority','');
    var needsBeds = 1;
    if(app.habitants) needsBeds = Math.max(1, 1+(app.coApp?1:0)+app.habitants.length);
    var needsAccess = app.accessibility && app.accessibility!=='None' && app.accessibility!=='0' && app.accessibility!==0;

    var matchPct = best ? Math.round(Math.max(0,best.score)/24*100) : 0;
    var unitCell = best
      ? '<div onclick="openMatchScorecard(\''+app.id+'\',\''+best.unit.id+'\')" style="cursor:pointer;">'
        +'<div style="font-weight:600;font-size:13px;color:var(--text);text-decoration:underline;text-underline-offset:2px;">'+(best.unit.num+' '+best.unit.street)+'</div>'
        +'<div style="display:flex;align-items:center;gap:8px;margin:3px 0;">'
        +'<div style="height:4px;width:80px;background:var(--border);border-radius:3px;overflow:hidden;"><div style="height:100%;width:'+matchPct+'%;background:'+tCol+';border-radius:3px;"></div></div>'
        +'<span class="js-lbl-sm">'+matchPct+'% match</span>'
        +'</div>'
        +'<div class="js-lbl-sm">'+best.unit.bedrooms+'bed · '+(best.unit.type||'—')+'</div>'
        +'</div>'
      : '<span class="js-txt-muted-sm">No suitable vacant units</span>';

    var reqs = [];
    if(needsAccess) reqs.push('<span style="font-size:10px;color:var(--info-blue);">Needs accessible unit</span>');
    var age = app.dob ? Math.floor((new Date()-new Date(app.dob))/(365.25*24*3600*1000)) : 0;
    if(age>=55) reqs.push('<span style="font-size:10px;color:var(--warn-amber);">Elders eligible</span>');

    var sl = statusLabel[app.status] || app.status || '';
    var appDateStr = app.appDate ? 'Applied '+app.appDate : '';

    // "Has a unit" is the source of truth — an app with an assignedUnit is
    // housed regardless of stored status. Conversely, anything WITHOUT a unit
    // that has cleared approval (mgr/ed/hm) — or is marked 'assigned' due to
    // a data anomaly — gets the Assign button so a unit can be attached.
    var hasUnit    = !!app.assignedUnit;
    var isAssigned = hasUnit;
    var canAssign  = !hasUnit && (
                       app.status === APP_STATUS.ED_APPROVED ||
                       app.status === APP_STATUS.MGR_APPROVED ||
                       app.status === APP_STATUS.HM_APPROVED ||
                       app.status === 'assigned'
                     );
    var assignCell = isAssigned
      ? '<div style="font-size:11px;font-weight:700;color:var(--success);">✓ '+(app.assignedAddress||'Assigned')+'</div>'
      : (canAssign
          ? '<button data-assign-app="'+app.id+'" data-assign-unit="'+(best?best.unit.id:'')+'" style="background:var(--yellow);border:none;color:var(--dark);padding:6px 14px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700;font-family:DM Sans,sans-serif;white-space:nowrap;">Assign →</button>'
          : '<span class="js-lbl-sm">Awaiting approval</span>');

    return '<tr style="border-bottom:1px solid var(--border);transition:background .12s;">'
      +'<td style="padding:12px 14px;color:var(--muted);font-size:12px;font-weight:600;width:32px;">'+(i+1)+'</td>'
      +'<td style="padding:12px 10px;cursor:pointer;" onclick="openAppFromMatch(\''+app.id+'\');">'
        +'<div style="font-weight:700;font-size:13px;color:var(--text);text-decoration:underline;text-underline-offset:2px;">'+name+'</div>'
        +'<div class="js-lbl-sm">'+app.id+'</div>'
      +'</td>'
      +'<td style="padding:12px 10px;white-space:nowrap;font-size:18px;font-weight:800;color:'+tCol+';">'+(app.score||0)+'</td>'
      +'<td style="padding:12px 10px;white-space:nowrap;font-size:11px;font-weight:700;color:'+tCol+';">'+tier+'</td>'
      +'<td style="padding:12px 10px;white-space:nowrap;font-size:12px;color:var(--muted);">'+(app.reserve||'—')+'</td>'
      +'<td style="padding:12px 10px;max-width:180px;">'+unitCell+'</td>'
      +'<td style="padding:12px 14px;">'
        +'<div style="font-size:12px;font-weight:700;color:'+tCol+';">'+sl+'</div>'
        +(appDateStr?'<div style="font-size:11px;color:var(--muted);margin-top:2px;">'+appDateStr+'</div>':'')
        +(reqs.length?'<div style="margin-top:3px;">'+reqs.join(' ')+'</div>':'')
      +'</td>'
      +'<td style="padding:12px 14px;">'+assignCell+'</td>'
      +'</tr>';
  }).join('');


  content.innerHTML = '<div class="std-table-card">'
    +'<div class="doclib-table-wrap">'
    +'<table class="std-table" style="min-width:650px;">'
    +'<thead id="match_thead"><tr>'
    +'<th>#</th>'
    +'<th class="std-th-sortable" data-sort-key="applicant">Applicant</th>'
    +'<th class="std-th-sortable" data-sort-key="score">Score</th>'
    +'<th class="std-th-sortable" data-sort-key="tier">Tier</th>'
    +'<th class="std-th-sortable" data-sort-key="reserve">Reserve</th>'
    +'<th class="std-th-sortable" data-sort-key="bestUnit">Best Unit Match</th>'
    +'<th class="std-th-sortable" data-sort-key="status">Status</th>'
    +'<th>Action</th>'
    +'</tr></thead>'
    +'<tbody id="match_tbody" data-table-page="match">'+rows+'</tbody>'
    +'</table></div></div>';
  // Wire column-menu click + sort indicators on the table header.
  var matchThead = document.getElementById('match_thead');
  if (typeof tableBindColumnMenuClicks === 'function') tableBindColumnMenuClicks(matchThead, 'match');
  if (typeof tableRefreshSortIndicators === 'function') tableRefreshSortIndicators(matchThead, 'match');
  // Wire assign buttons
  var matchContent = document.getElementById('match_content');
  if(matchContent) matchContent.querySelectorAll('[data-assign-app]').forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      openAssignModal(btn.getAttribute('data-assign-app'), btn.getAttribute('data-assign-unit'));
    });
  });
}


function renderTenantsView(){
  var showRenoCol = (ROLE.isManagement(window.currentRole));
  var th = document.getElementById('ten_reno_score_th');
  if(th) th.style.display = showRenoCol ? '' : 'none';
  // File counts loaded asynchronously — see getTenantFiles (Supabase Storage)
  function hasSowOrReno(uid){
    try{
      var sow = getSowData(uid);
      var prog = (window._renoProgress && window._renoProgress[uid]) || null;
      return !!(sow&&sow!=='null') || !!(prog&&prog!=='null');
    }catch(e){return false;}
  }
  // Always read from localStorage so assignedName saved via saveUnitEdit is reflected
  var allUnits = [];
  try {
    var _stored = JSON.stringify(housingUnits);
    allUnits = _stored ? JSON.parse(_stored) : [];
  } catch(e) {}
  if (!allUnits.length) {
    allUnits = (typeof housingUnits !== 'undefined' && housingUnits.length)
      ? housingUnits : (window.HOUSING_UNITS_DATA || []);
  }
  var units = allUnits.filter(function(u){return (u.status==='occupied'||u.status==='reserved') && !u.archived;});
  var search = ((document.getElementById('tenant_search')||{}).value||'').toLowerCase().trim();
  if(search) units = units.filter(function(u){
    // Scan every visible column on the Tenants row.
    var hay = [
      u.num, u.street, u.assignedName, u.assignedDate, u.status,
      u.bedrooms, u.type, u.classification
    ].filter(function(v){ return v != null; }).join(' ').toLowerCase();
    return hay.indexOf(search) !== -1;
  });
  setText('tenant_count',units.length);

  // Default sort — address ascending. Preserved when no column-menu sort
  // is active (tableApplyFilterSort leaves order alone when state.sort.key
  // is empty).
  units.sort(function(a,b){
    var av = ((a.num||'')+' '+(a.street||'')).toLowerCase();
    var bv = ((b.num||'')+' '+(b.street||'')).toLowerCase();
    return av < bv ? -1 : av > bv ? 1 : 0;
  });

  // ── Column-menu sort + filter (Phase 2B) ─────────────────────
  var _tenColumns = {
    address:    { label: 'Unit / Address', accessor: function(u){ return ((u.num||'')+' '+(u.street||'')).trim(); } },
    tenant:     { label: 'Tenant Name',    accessor: function(u){ return u.assignedName || '(unassigned)'; } },
    move_in:    { label: 'Move-In Date',   accessor: function(u){ return u.assignedDate || '(none)'; } },
    status:     { label: 'Status',         accessor: function(u){ return u.status === 'reserved' ? 'Reserved' : 'Occupied'; } },
    reno_score: { label: 'Reno Score',     accessor: function(u){ return hasSowOrReno(u.id) ? (calcRenoScore(u.id).score || 0) : 0; } }
  };
  var _tenAccessors = {};
  Object.keys(_tenColumns).forEach(function(k){ _tenAccessors[k] = _tenColumns[k].accessor; });

  var _tenState = (typeof tableStateGet === 'function') ? tableStateGet('tenants') : { sort:{key:'',dir:1}, filters:{} };

  if (typeof tableRegisterColumns === 'function') {
    tableRegisterColumns('tenants', {
      columns:  _tenColumns,
      getRows:  function(){ return units; },
      onChange: renderTenantsView
    });
  }

  units = (typeof tableApplyFilterSort === 'function')
    ? tableApplyFilterSort(units, _tenAccessors, _tenState)
    : units;

  var tbody=document.getElementById('tenants_tbody');
  if(!tbody) return;
  if(!units.length){
    tbody.innerHTML='<tr><td colspan="7" style="padding:32px;text-align:center;color:var(--muted);">No tenants match the current filters.</td></tr>';
    var _tenTheadEmpty = document.getElementById('tenants_thead');
    if (typeof tableBindColumnMenuClicks === 'function')   tableBindColumnMenuClicks(_tenTheadEmpty, 'tenants');
    if (typeof tableRefreshSortIndicators === 'function') tableRefreshSortIndicators(_tenTheadEmpty, 'tenants');
    return;
  }
  tbody.innerHTML=units.map(function(u){
    var name=u.assignedName||'<span style="color:var(--muted);font-style:italic;">No tenant assigned</span>';
    var date=u.assignedDate||'—';
    var fileCount=0; // loaded async when panel opens
    var statusBg=u.status==='reserved'?'#faf5ff':'#eff6ff';
    var statusC=u.status==='reserved'?'#7c3aed':'#1d4ed8';
    var renoCell='';
    var _showRenoScore=(ROLE.isManagement(window.currentRole));
    if(_showRenoScore && hasSowOrReno(u.id)){
      var rs=calcRenoScore(u.id); var s=rs.score;
      var tier=s>=40?{label:'Critical',c:'#b91c1c',bg:'#fef2f2'}:s>=25?{label:'High',c:'#7a6000',bg:'#fef9ec'}:s>=12?{label:'Medium',c:'#1d4ed8',bg:'#eff6ff'}:{label:'Low',c:'#15803d',bg:'#f0fdf4'};
      renoCell='<div data-reno-sow="'+u.id+'" style="display:flex;align-items:center;gap:5px;cursor:pointer;" title="Open Scope of Work"><span style="font-size:14px;font-weight:800;color:var(--text);">'+s+'</span><span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;background:'+tier.bg+';color:'+tier.c+';">'+tier.label+'</span></div>';
    } else if(_showRenoScore) {
      renoCell='<span style="font-size:11px;color:var(--border);">—</span>';
    }
    // fileCount already set above
    return '<tr class="clickable" data-tuid="'+escapeHtml(u.id)+'">'
      +'<td><div class="std-cell-primary">'+escapeHtml(u.num)+' '+escapeHtml(u.street)+(u.isElders?' <span style="font-size:9px;background:var(--warn-amber-bg);color:var(--warn-amber);border:1px solid var(--warn-amber-border);padding:1px 5px;border-radius:6px;">ELDERS UNIT</span>':'')+'</div><div class="tbl-sub">'+escapeHtml(String(u.bedrooms||''))+'-bed'+(u.accessible?' · Accessible':'')+'</div></td>'
      +'<td class="std-cell-primary">'+escapeHtml(name)+'</td>'
      +'<td class="std-cell-dash">'+date+'</td>'
      +'<td><span class="std-pill std-pill-info">'+(u.status==='reserved'?'Reserved':'Occupied')+'</span></td>'
      +(_showRenoScore?'<td>'+renoCell+'</td>':'')
      +'<td>'
        +'<button type="button" data-files-uid="'+u.id+'" title="Tenant Files" style="background:none;border:none;cursor:pointer;display:flex;align-items:center;gap:4px;color:var(--muted);font-size:12px;font-weight:600;padding:3px 6px;border-radius:5px;">'
          +'\uD83D\uDCCE '+(fileCount>0?'<span style="background:var(--yellow);color:var(--dark);font-size:10px;font-weight:800;padding:1px 5px;border-radius:8px;">'+fileCount+'</span>':'<span style="color:var(--border);font-size:11px;">—</span>')
        +'</button>'
      +'</td>'
      +'<td style="padding:10px 10px;text-align:right;white-space:nowrap;">'
        +'<button type="button" data-tic-uid="'+u.id+'" title="Tenant Information Card" class="tic-tenant-card-btn">🪪</button>'
        +'<button type="button" data-sow-uid="'+u.id+'" title="Scope of Work" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:14px;">🔨</button>'
      +'</td>'
      +'</tr>';
  }).join('');
  tbody.querySelectorAll('[data-tuid]').forEach(function(row){
    row.addEventListener('click',function(e){
      if(e.target.closest('[data-sow-uid]') || e.target.closest('[data-tic-uid]')) return;
      openUnitEditModal(row.getAttribute('data-tuid'));
    });
  });
  tbody.querySelectorAll('[data-sow-uid]').forEach(function(btn){
    btn.addEventListener('click',function(e){e.stopPropagation();openSowModal(btn.getAttribute('data-sow-uid'));});
  });
  tbody.querySelectorAll('[data-tic-uid]').forEach(function(btn){
    btn.addEventListener('click',function(e){
      e.stopPropagation();
      if(typeof openTenantCard === 'function') openTenantCard(btn.getAttribute('data-tic-uid'));
    });
  });
  tbody.querySelectorAll('[data-reno-sow]').forEach(function(cell){
    cell.addEventListener('click',function(e){e.stopPropagation();openSowModal(cell.getAttribute('data-reno-sow'));});
  });
  tbody.querySelectorAll('[data-files-uid]').forEach(function(btn){
    btn.addEventListener('click',function(e){e.stopPropagation();openTenantFilesPanel(btn.getAttribute('data-files-uid'));});
  });

  // Column-menu click + sort indicators
  var _tenThead = document.getElementById('tenants_thead');
  if (typeof tableBindColumnMenuClicks === 'function')   tableBindColumnMenuClicks(_tenThead, 'tenants');
  if (typeof tableRefreshSortIndicators === 'function') tableRefreshSortIndicators(_tenThead, 'tenants');
}




















// (showScores removed — was calling getElementById with a missing argument and had zero callers anywhere. Dead code from an earlier scoring view design.)

var _scoresSortKey='score', _scoresSortDir=-1;




// ── Application Scores view ──

// ── Scorecard document functions ──────────────────────────────────────────────


// ── Scorecard docs — DocLibrary instance (Phase C Turn 3) ────────────
// Uses the factory with customLoader + customDelete because the scorecard
// merges two data sources:
//   1. app_documents table — manually-assigned migrated files
//   2. applications/{appId}/ storage folder — directly-uploaded files
// The factory's default audit-log loader doesn't know about this dual
// model, so we hand-roll the loader/delete. Everything else (render,
// upload, filter, view) is standard factory behavior.
//
// Note on upload behavior: the factory's built-in upload writes a
// file_uploaded audit row keyed by entity_type='application'. The storage
// listing in our customLoader picks that file up on the next refresh.

// ── Step 6 Document Library ───────────────────────────────────────────────────
// Initialised once when the user navigates to the Documents step.
// Re-uses the same DocLibrary factory as the scorecard panel.
var _step6DocLib = null;

function showTenantsForRole() {
  var role = window.currentRole || 'housing_employee_l1';
  if(ROLE.isManagement(role)) {
    showTenants();
  } else {
    openTenantSearch();
  }
}

function openTenantSearch() {
  // tenantSearchModal was replaced by unitSearchModal — delegate to working version
  openUnitSearch();
}

function closeTenantSearch() {
  var m = document.getElementById('unitSearchModal');
  if(m) m.style.display='none';
  document.body.classList.remove('modal-open');
}

// Called when an employee clicks a tenant row in tenantSearchFilter results.
// Opens the tenant files panel for the selected unit, or the application if linked.
function selectTenantRecord(rec) {
  closeTenantSearch();
  if (!rec) return;
  if (rec.appId) {
    // Has a linked application — open it in the worklist viewer
    if (typeof wlOpenApp === 'function') { wlOpenApp(rec.appId); return; }
  }
  if (rec.id && typeof openTenantFilesPanel === 'function') {
    // No application — open tenant files by unit ID
    openTenantFilesPanel(rec.id);
  }
}

function tenantSearchFilter(q) {
  // Search both housing units (occupied/reserved) AND applications (for names)
  var allUnits = [];
  try {
    var stored = JSON.stringify(housingUnits);
    allUnits = stored ? JSON.parse(stored) : [];
  } catch(e) {}
  if (!allUnits.length) {
    allUnits = (typeof housingUnits !== 'undefined' && housingUnits.length)
      ? housingUnits : (window.HOUSING_UNITS_DATA || []);
  }

  var allApps = (typeof applications !== 'undefined') ? applications : [];
  var qq = q.trim().toLowerCase();

  // Build tenant records from applications that are assigned, plus occupied units
  var tenantRecords = [];

  // From assigned applications — primary source
  allApps.filter(function(a){ return a.assignedUnit && !a.archived; }).forEach(function(a){
    var name = ((a.fn||'')+' '+(a.ln||'')).trim();
    var unit = allUnits.find(function(u){ return u.id === a.assignedUnit; });
    var addr = unit ? (unit.num+' '+unit.street) : (a.assignedAddress||'—');
    tenantRecords.push({ id: a.assignedUnit||a.id, name: name, addr: addr,
      status: 'occupied', appId: a.id, unitObj: unit });
  });

  // Also catch any occupied units not linked to an application
  allUnits.filter(function(u){ return (u.status==='occupied'||u.status==='reserved') && u.assignedName; })
    .forEach(function(u){
      // Skip if already added via application
      if(tenantRecords.find(function(r){ return r.id === u.id; })) return;
      tenantRecords.push({ id: u.id, name: u.assignedName||'', addr: (u.num+' '+u.street),
        status: u.status, appId: null, unitObj: u });
    });

  var filtered = qq
    ? tenantRecords.filter(function(r){
        return r.name.toLowerCase().includes(qq) || r.addr.toLowerCase().includes(qq);
      })
    : tenantRecords.slice(0, 20);

  var container = document.getElementById('tenant_search_results');
  if(!container) return;
  container.style.background = '#f4f4f0';
  container.style.borderRadius = '8px';
  container.style.padding = filtered.length ? '8px' : '0';

  if(!filtered.length) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px;font-style:italic;">'
      + (q ? 'No tenants found matching "'+q+'"' : 'No assigned tenants on file.')
      + '</div>';
    return;
  }

  container.innerHTML = filtered.map(function(r) {
    var bg = r.status==='reserved' ? '#faf5ff' : '#eff6ff';
    return '<div onclick="selectTenantRecord('+JSON.stringify({id:r.id,name:r.name,addr:r.addr,appId:r.appId}).replace(/"/g,"'")+')" '
      + 'style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:7px;cursor:pointer;background:'+bg+';margin-bottom:6px;transition:opacity .1s;" '
      + 'onmouseover="this.style.opacity=\'0.8\'" onmouseout="this.style.opacity=\'1\'">'
      + '<div style="width:36px;height:36px;border-radius:50%;background:var(--yellow);color:var(--dark);font-size:13px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;">'
      + (r.name ? r.name.charAt(0).toUpperCase() : '?') + '</div>'
      + '<div><div class="js-txt-bold">'+r.name+'</div>'
      + '<div class="js-lbl-sm">'+r.addr+'</div></div>'
      + '</div>';
  }).join('');
}

function showInventoryForRole() {
  var role = window.currentRole || 'housing_employee_l1';
  if(ROLE.isManagement(role)) {
    showInventory();
  } else {
    openUnitSearch();
  }
}

function openUnitSearch() {
  unitSearchFilter('');
  var m = document.getElementById('unitSearchModal');
  if(m){ m.style.setProperty('display','flex','important'); document.body.classList.add('modal-open'); }
  setTimeout(function(){ var i=document.getElementById('unit_search_input'); if(i){i.value='';i.focus();} }, 150);
}

function closeUnitSearch() {
  var m = document.getElementById('unitSearchModal');
  if(m) m.style.display='none';
  document.body.classList.remove('modal-open');
}

function unitSearchFilter(q) {
  var allUnits = (typeof housingUnits!=='undefined'&&housingUnits.length)?housingUnits:(window.HOUSING_UNITS_DATA||[]);
  var filtered = q.trim().length > 0
    ? allUnits.filter(function(u){ return (u.num+' '+u.street).toLowerCase().includes(q.toLowerCase()); })
    : allUnits.slice(0,20);

  var statusStyle = {
    vacant:      {bg:'#f0fdf4',c:'#15803d',label:'Vacant'},
    occupied:    {bg:'#eff6ff',c:'#1d4ed8',label:'Occupied'},
    under_repair:{bg:'#fffbeb',c:'#92400e',label:'Under Repair'},
    reserved:    {bg:'#faf5ff',c:'#7c3aed',label:'Reserved'},
    condemned:   {bg:'#fef2f2',c:'#b91c1c',label:'Condemned'}
  };

  var container = document.getElementById('unit_search_results');
  if(!container) return;

  if(!filtered.length) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px;font-style:italic;">No units found matching "'+escapeHtml(q)+'"</div>';
    return;
  }

  container.innerHTML = filtered.map(function(u) {
    var ss = statusStyle[u.status]||{bg:'#f0f0ec',c:'#888',label:u.status};
    return '<div onclick="closeUnitSearch();openUnitEditModal(\''+u.id.replace(/'/g,"\\'")+'\')" '
      +'style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border:1px solid var(--border);border-radius:8px;cursor:pointer;background:var(--bg);transition:border-color .12s;" '
      +'onmouseover="this.style.borderColor=\'var(--yellow)\'" onmouseout="this.style.borderColor=\'var(--border)\'">'
      +'<div>'
        +'<div style="font-weight:700;font-size:13px;">'+escapeHtml(u.num)+' '+escapeHtml(u.street)+'</div>'
        +'<div class="js-lbl-sm">'+escapeHtml(String(u.bedrooms||''))+'-bed · '+escapeHtml(u.type||'—')+'</div>'
      +'</div>'
      +'<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:8px;background:'+ss.bg+';color:'+ss.c+';">'+escapeHtml(ss.label)+'</span>'
      +'</div>';
  }).join('');
}

// ── Global Header Export ──
window._currentExportView = null; // set by each showXxx function







// ── Shared export engine ──


// ── Inventory export ──


// ── Match export ──



// ── Landing view (Phase B) ────────────────────────────────────────────────
// Replaces the old employeeHomeView + worklistView with a single unified
// landing. Stop-A version: render greeting + role tag + active-nav state.
// Lookup wiring, collapsible state, count pills, and worklist body are
// populated in Stop B (housing-init.js).
function showLanding() {
  if (!document.getElementById('landingView')) {
    // Sub-page navigation: bounce back to housing.html.
    if (!window.location.pathname.includes('housing.html') &&
        !window.location.pathname.endsWith('/') &&
        window.location.pathname !== '/') {
      document.body.style.transition = 'opacity .15s ease';
      document.body.style.opacity = '0';
      setTimeout(function(){ window.location.href = 'housing.html'; }, 150);
      return;
    }
  }
  if(!window._navSkipPush) pushNav('home');
  setExportView(null);

  if (typeof hideAllViews === 'function') hideAllViews('landingView');
  var lv = document.getElementById('landingView');
  if (lv) { lv.style.display = 'flex'; lv.style.width = '100%'; }
  if (typeof setNavActive === 'function') setNavActive('tab_dash');
  if (typeof setHeaderNavActive === 'function') setHeaderNavActive('home');

  // Greeting — same population logic as the old showEmployeeHome.
  var role = (typeof HOUSING_SESSION !== 'undefined' && HOUSING_SESSION && HOUSING_SESSION.role)
          || window._realRole || window.currentRole || 'housing_employee_l1';
  var roleLabels = {
    employee:            'Staff',
    housing_employee_l1: 'Staff',
    housing_employee_l2: 'Staff',
    housing_manager:     (typeof CLFN_PERMS !== 'undefined') ? CLFN_PERMS.roleLabel(ROLE.HOUSING_MANAGER) : 'Housing Manager',
    ed:                  (typeof CLFN_PERMS !== 'undefined') ? CLFN_PERMS.roleLabel(ROLE.ED) : 'Executive Director',
    cfo:                 (typeof CLFN_PERMS !== 'undefined') ? CLFN_PERMS.roleLabel(ROLE.CFO) : 'CFO',
    finance_l1:          (typeof CLFN_PERMS !== 'undefined') ? CLFN_PERMS.roleLabel(ROLE.FINANCE_L1) : 'Finance Clerk'
  };
  var subtitles = {
    employee:            'Pick up where you left off.',
    housing_employee_l1: 'Pick up where you left off.',
    housing_employee_l2: 'Pick up where you left off.',
    housing_manager:     "Here's a snapshot of your housing portfolio.",
    ed:                  "Here's a snapshot of your housing portfolio.",
    cfo:                 "Here's an overview of finance activity.",
    finance_l1:          'Pick up where you left off.'
  };

  // Date line
  var dateEl = document.getElementById('emp_home_date');
  if (dateEl) {
    var d = new Date();
    var dayStr  = d.toLocaleDateString('en-US', { weekday: 'long' });
    var dateStr = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    dateEl.textContent = dayStr + ' · ' + dateStr;
  }

  // Greeting name (first name only)
  var nameEl = document.getElementById('emp_home_name');
  if (nameEl) {
    var userName = (typeof HOUSING_SESSION !== 'undefined' && HOUSING_SESSION.name) ? HOUSING_SESSION.name : '';
    var firstName = userName ? userName.split(/\s+/)[0] : (roleLabels[role] || 'there');
    nameEl.textContent = firstName;
  }

  // Role tag pill next to the name
  var tagEl = document.getElementById('emp_home_role_tag');
  if (tagEl) {
    tagEl.textContent = roleLabels[role] || 'Staff';
    tagEl.style.display = 'inline-flex';
  }

  // Subtitle
  var subEl = document.getElementById('emp_home_subtitle');
  if (subEl) subEl.textContent = subtitles[role] || '';

  // KPI strip — housing-only metrics from the in-memory caches.
  _renderLandingKpis();
}

// _renderLandingKpis — Open Apps · Critical · Vacant · Awaiting Match.
// All counts come from the in-memory `applications` and `housingUnits`
// arrays so no extra Supabase round-trips run on every landing render.
// Finance metrics intentionally excluded — landing stays housing-only.
function _renderLandingKpis(){
  function setKpi(id, val){
    var el = document.getElementById(id);
    if (el) el.textContent = (val == null ? '—' : String(val));
  }
  var apps  = (typeof applications !== 'undefined' && applications) ? applications : [];
  var units = (typeof housingUnits  !== 'undefined' && housingUnits)  ? housingUnits  : [];

  var STATUS = (typeof APP_STATUS !== 'undefined') ? APP_STATUS : {
    SUBMITTED: 'submitted', FILE_UPDATE: 'file_update',
    MGR_APPROVED: 'mgr_approved', ED_APPROVED: 'ed_approved'
  };

  var openApps = apps.filter(function(a){
    if(!a || a.archived) return false;
    return a.status === STATUS.SUBMITTED
        || a.status === STATUS.FILE_UPDATE
        || a.status === STATUS.MGR_APPROVED;
  }).length;

  var critical = apps.filter(function(a){
    return a && !a.archived && (a.tier === 'Critical Priority' || a.tier_v2 === 'Critical Priority');
  }).length;

  var vacant = units.filter(function(u){
    return u && !u.archived && u.status === 'vacant';
  }).length;

  var awaitingMatch = apps.filter(function(a){
    if(!a || a.archived) return false;
    var approved = a.status === STATUS.ED_APPROVED || a.status === STATUS.MGR_APPROVED;
    return approved && !a.assignedUnit;
  }).length;

  setKpi('kpi_open_apps',       openApps);
  setKpi('kpi_critical',        critical);
  setKpi('kpi_vacant',          vacant);
  setKpi('kpi_awaiting_match',  awaitingMatch);
}

// Compat shims — old call sites continue to work.
function showEmployeeHome(){
  if (document.getElementById('landingView')) return showLanding();
  // Sub-page fallback (renos.html etc.) keeps the original bounce behaviour.
  if (!document.getElementById('employeeHomeView')) {
    if (!window.location.pathname.includes('housing.html') &&
        !window.location.pathname.endsWith('/') &&
        window.location.pathname !== '/') {
      document.body.style.transition = 'opacity .15s ease';
      document.body.style.opacity = '0';
      setTimeout(function() { window.location.href = 'housing.html'; }, 150);
      return;
    }
  }
  if(!window._navSkipPush) pushNav('home');
  setExportView(null);
  var _ehv = document.getElementById('employeeHomeView');
  if(_ehv){ _ehv.style.display='flex'; _ehv.style.width='100%'; }
  hideAllViews('employeeHomeView');
  if(_ehv){ _ehv.style.display='flex'; _ehv.style.width='100%'; }
  setNavActive('tab_dash');
  // Authoritative role resolution. HOUSING_SESSION.role is set by
  // resolveHousingRole() at login and is the canonical source. Fall back to
  // window.currentRole (legacy writers still touch this) and finally to
  // 'employee' if neither is populated (very first render before login
  // completes — should never actually render visible tiles in that case).
  var role = (typeof HOUSING_SESSION !== 'undefined' && HOUSING_SESSION && HOUSING_SESSION.role)
          || window._realRole
          || window.currentRole
          || 'housing_employee_l1';
  // Role-key → display label. Source of truth is CLFN_PERMS.roleLabel(); the
  // HE_L1/HE_L2 keys collapse to a generic "Staff" string for the Home greeting.
  var roleLabels = {
    employee:            'Staff',
    housing_employee_l1: 'Staff',
    housing_employee_l2: 'Staff',
    housing_manager:     CLFN_PERMS.roleLabel(ROLE.HOUSING_MANAGER),
    ed:                  CLFN_PERMS.roleLabel(ROLE.ED),
    cfo:                 CLFN_PERMS.roleLabel(ROLE.CFO),
    finance_l1:          CLFN_PERMS.roleLabel(ROLE.FINANCE_L1)
  };
  var subtitles = {
    employee: 'Select a tile below to get started.',
    housing_employee_l1: 'Select a tile below to get started.',
    housing_employee_l2: 'Select a tile below to get started.',
    housing_manager: "Here's what's happening across housing today.",
    ed: "Here's what's happening across housing today.",
    cfo: "Here's an overview of finance activity.",
    finance_l1: 'Select a tile below to get started.'
  };

  // Today's date — formatted "THURSDAY · APRIL 17, 2026" for the uppercase meta line.
  var dateEl = document.getElementById('emp_home_date');
  if(dateEl){
    var d = new Date();
    var dayStr   = d.toLocaleDateString('en-US', { weekday: 'long' });
    var dateStr  = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    dateEl.textContent = dayStr + ' · ' + dateStr;
  }

  var nameEl = document.getElementById('emp_home_name');
  if(nameEl) {
    var userName = (typeof HOUSING_SESSION !== 'undefined' && HOUSING_SESSION.name) ? HOUSING_SESSION.name : '';
    var roleLbl  = roleLabels[role] || 'Staff';
    if(userName) {
      nameEl.innerHTML = userName + '<span style="color:var(--muted);font-weight:400;font-size:0.7em;font-style:italic;margin-left:10px;">' + roleLbl + '</span>';
    } else {
      nameEl.textContent = roleLbl;
    }
  }
  var subEl = document.getElementById('emp_home_subtitle');
  if(subEl) subEl.textContent = subtitles[role] || '';

  // Build role-appropriate tile grid
  var tilesEl = document.getElementById('emp_tiles_grid');
  if(!tilesEl) { var view2=document.getElementById('employeeHomeView'); if(view2){view2.style.display='flex';view2.style.flexDirection='column';} return; }

  if(ROLE.isManagement(role)) {
    // ── Rich stat tiles for HM / ED ──
    var apps  = (typeof applications !== 'undefined') ? applications : [];
    var units = (typeof housingUnits  !== 'undefined') ? housingUnits  : [];

    var pending     = apps.filter(function(a){return a.status===APP_STATUS.SUBMITTED||a.status===APP_STATUS.FILE_UPDATE;}).length;
    var awaitingED  = apps.filter(function(a){return a.status===APP_STATUS.MGR_APPROVED;}).length;
    var totalApps   = apps.filter(function(a){return !a.archived;}).length;
    var critical   = apps.filter(function(a){return a.tier==='Critical Priority'&&!a.archived;}).length;

    var vacant      = units.filter(function(u){return u.status==='vacant';}).length;
    var occupied    = units.filter(function(u){return u.status==='occupied';}).length;
    var totalUnits  = units.length;

    var readyMatch  = apps.filter(function(a){return (a.status===APP_STATUS.ED_APPROVED||a.status===APP_STATUS.MGR_APPROVED)&&!a.assignedUnit&&!a.archived;}).length;
    var matched     = apps.filter(function(a){return !!a.assignedUnit;}).length;

    var tenanted    = units.filter(function(u){return u.status==='occupied'||u.status==='reserved';}).length;
    var underRepair = units.filter(function(u){return u.status==='under_repair';}).length;
    var condemned   = units.filter(function(u){return u.status==='condemned';}).length;
    var ctCount = 0;

    function makeStat(label, value, type) {
      var c = type==='alert'?'#b91c1c':type==='good'?'#15803d':type==='info'?'#1d4ed8':'var(--muted)';
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);">'
        +'<span class="js-lbl-sm">'+label+'</span>'
        +'<span style="font-size:16px;font-weight:800;color:'+c+';">'+value+'</span>'
        +'</div>';
    }
    function tile(icon, label, fn, accentColor, statsHtml) {
      var hover = 'onmouseover="this.style.boxShadow=\'0 4px 20px rgba(0,0,0,0.1)\';this.style.borderColor=\'' + accentColor + '\'"';
      var out   = 'onmouseout="this.style.boxShadow=\'\';this.style.borderColor=\'var(--border)\'"';
      return '<div onclick="'+fn+'" style="background:var(--surface);border:1px solid var(--border);border-top:3px solid '+accentColor+';border-radius:12px;padding:18px 20px;cursor:pointer;transition:box-shadow .15s,border-color .15s;display:flex;flex-direction:column;gap:12px;" '+hover+' '+out+'>'
        +'<div class="flex-g10"><span style="font-size:22px;">'+icon+'</span>'
        +'<span style="font-weight:700;font-size:15px;">'+label+'</span></div>'
        +'<div>'+statsHtml+'</div>'
        +'</div>';
    }

    // New Application — dark accent tile
        var newAppTile = '<div onclick="newApp()" style="background:var(--dark);border:2px solid var(--yellow);border-radius:12px;padding:20px;cursor:pointer;transition:background .15s;display:flex;flex-direction:column;gap:8px;"'
      +' onmouseover="this.style.background=&quot;#1c1c1a&quot;" onmouseout="this.style.background=&quot;var(--dark)&quot;">'
      +'<span style="font-size:26px;">📝</span>'
      +'<span style="font-weight:700;font-size:15px;color:var(--yellow);">New Application</span>'
      +'<span style="font-size:12px;color:var(--muted);">Enter a housing application for a community member</span>'
      +'</div>';

    var _canFinalApprove = APPROVAL_AUTHORITY.can('finalApproveApp', role);
    var _canReviewApp    = APPROVAL_AUTHORITY.can('reviewApplication', role);
    var _wlActionCount = (_canReviewApp && !_canFinalApprove)
      ? apps.filter(function(a){return (a.status===APP_STATUS.SUBMITTED||a.status===APP_STATUS.FILE_UPDATE)&&!a.archived;}).length
      : apps.filter(function(a){return a.status===APP_STATUS.MGR_APPROVED&&!a.archived;}).length;
    var _wlReturnCount = apps.filter(function(a){return a.status==='returned'&&!a.archived;}).length;
    var worklistTile = tile('📋','My Worklist','showWorklist()','#F8E41A',
      makeStat(_canFinalApprove?'Awaiting Final Approval':'Awaiting Your Review', _wlActionCount, _wlActionCount>0?'alert':'neutral') +
      makeStat('Returned for Info', _wlReturnCount, _wlReturnCount>0?'alert':'neutral') +
      makeStat('Total Active', totalApps, 'neutral'));
    // Applications tile removed — the My Worklist tile above and the
    // worklist section on the home page are now the canonical list view.

    var invTile = tile('🏠','Inventory','showInventory()','#7c3aed',
      makeStat('Vacant', vacant,   vacant>0?'good':'alert') +
      makeStat('Occupied', occupied, 'info') +
      makeStat('Total Units', totalUnits, 'neutral'));

    var matchTile = tile('🔗','Match','showMatch()','#15803d',
      makeStat('Ready to Match', readyMatch, readyMatch>0?'good':'neutral') +
      makeStat('Matched', matched, matched>0?'good':'neutral') +
      makeStat('Vacant Units', vacant, vacant>0?'good':'alert'));

    var tenantTile = tile('👥','Tenants','showTenants()','#0ea5e9',
      makeStat('Occupied / Reserved', tenanted, 'info') +
      makeStat('Total Units', totalUnits, 'neutral'));

    // Reno approval workflow stats
    var sowPendingHM=0, sowPendingED=0, sowApproved=0, sowNoSow=0, sowInProgress=0;
    try {
      var allU=(typeof housingUnits!=='undefined'&&housingUnits.length)?housingUnits:(window.HOUSING_UNITS_DATA||[]);
      var renoUnits=allU.filter(function(u){return (u.status==='under_repair'||u.status==='condemned')&&!u.archived;});
      var hmLimit2=parseFloat(((window._appSettings||{}).hmBudgetLimit)||25000);
      renoUnits.forEach(function(u){
        var sow=null; sow = getSowData(u.id);
        var prog = (window._renoProgress && window._renoProgress[u.id]) || null;
        if(!sow){sowNoSow++;return;}
        var cost=parseFloat((sow.totalCost||'').toString().replace(/[^0-9.]/g,''))||0;
        var hmDec=(u.unitHmSig&&u.unitHmSig.decision)||'';
        var edDec=(u.unitEdSig&&u.unitEdSig.decision)||'';
        var needsED=cost>hmLimit2;
        if(prog&&(prog.overallPct||0)>=100){sowInProgress++; return;}
        if(prog&&(prog.overallPct||0)>0){sowInProgress++; return;}
        if(edDec==='approved'||(hmDec==='approved'&&!needsED)){sowApproved++;}
        else if(hmDec==='approved'&&needsED){sowPendingED++;}
        else{sowPendingHM++;}
      });
    }catch(e){}
    var renoTile = tile('🔨','Renovations','showRenos()','#d97706',
      makeStat('Under Repair', underRepair, underRepair>0?'alert':'good') +
      makeStat('Condemned',    condemned,   condemned>0?'alert':'good') +
      makeStat('Pending HM Approval',  sowPendingHM,  sowPendingHM>0?(APPROVAL_AUTHORITY.can('approveSowUnderThreshold', role)?'alert':'info'):'neutral') +
      makeStat('Pending ED Approval',  sowPendingED,  sowPendingED>0?(APPROVAL_AUTHORITY.can('approveSowOverThreshold', role)?'alert':'info'):'neutral') +
      makeStat('SOW Approved',         sowApproved,   sowApproved>0?'good':'neutral') +
      makeStat('In Progress',          sowInProgress, sowInProgress>0?'good':'neutral'));

    var ctPending = 0, ctAwaitingED = 0, ctApproved = 0, ctDeclined = 0;
    try {
      var ctList = window._contractors || [];
      ctCount = ctList.length;
      ctPending    = ctList.filter(function(c){ return (c.status||'pending_review')==='pending_review'||(c.status||'')==='returned'; }).length;
      ctAwaitingED = ctList.filter(function(c){ return c.status==='hm_recommended'; }).length;
      ctApproved   = ctList.filter(function(c){ return c.status==='approved'; }).length;
      ctDeclined   = ctList.filter(function(c){ return c.status==='declined'; }).length;
    } catch(e){}

    var ctTile = tile('🧰','Contractors','showContractorsForRole()','#6b7280',
      makeStat('Pending HM Review',  ctPending,    ctPending>0?(APPROVAL_AUTHORITY.can('recommendContractor', role)?'alert':'info'):'neutral') +
      makeStat('Awaiting ED Approval', ctAwaitingED, ctAwaitingED>0?(APPROVAL_AUTHORITY.can('approveContractor', role)?'alert':'info'):'neutral') +
      makeStat('Approved',           ctApproved,   ctApproved>0?'good':'neutral') +
      (ctDeclined>0?makeStat('Declined', ctDeclined, 'alert'):''));

        // Settings tile removed — Settings is accessible via the gear icon in the header.

    tilesEl.style.gridTemplateColumns = 'repeat(auto-fill,minmax(240px,1fr))';

    // ── Module gating (Phase A0) ─────────────────────────────────────
    // Optional-module tiles only render if CLFN_MODULES.isEnabled() returns true.
    // Core-module tiles (Applications, Worklist, Inventory, Tenants) always render.
    var mods = window.CLFN_MODULES;
    var matchTileOut = (mods && mods.isEnabled('match'))        ? matchTile : '';
    var renoTileOut  = (mods && mods.isEnabled('renovations'))  ? renoTile  : '';
    var ctTileOut    = (mods && mods.isEnabled('contractors')) ? ctTile    : '';

    // Finance module placeholder — real UI comes in a later phase.
    // Shown when the nation has the Finance module licensed AND the user has
    // finance access (ED, HM, HE-L2, CFO, Finance L1 — actual check comes in Phase A).
    var financeTile = '';
    if(mods && mods.isEnabled('finance')){
      financeTile = '<div onclick="showFinance()" style="background:var(--surface);border:1px solid var(--border);border-top:3px solid var(--info-blue);border-radius:12px;padding:18px 20px;cursor:pointer;transition:box-shadow .15s;"'
        +' onmouseover="this.style.boxShadow=&quot;0 4px 20px rgba(0,0,0,0.1)&quot;" onmouseout="this.style.boxShadow=&quot;&quot;">'
        +'<div style="display:flex;align-items:center;gap:12px;"><span style="font-size:22px;">💰</span>'
        +'<div><div style="font-weight:700;font-size:14px;">Finance Module</div>'
        +'<div class="js-txt-muted-sm">Budgets, payments &amp; financial reporting</div></div></div>'
        +'</div>';
    }

    tilesEl.innerHTML = newAppTile + worklistTile + invTile + matchTileOut + tenantTile + renoTileOut + ctTileOut + financeTile;

  } else {
    // ── Employee: simple tiles ──
    tilesEl.style.gridTemplateColumns = 'repeat(auto-fill,minmax(200px,1fr))';
    var mods2 = window.CLFN_MODULES;
    var empTiles = [
      {icon:'📝', label:'New Application', desc:'Start a new housing application', fn:'newApp()', accent:true, module:'applications'},
      {icon:'📋', label:'My Worklist',     desc:'Track applications you have submitted', fn:'showWorklist()', module:'applications'},
      {icon:'👥', label:'Tenants',         desc:'Search and update tenant records',   fn:'showTenantsForRole()', module:'tenants'},
      {icon:'🔨', label:'Renovations',     desc:'Renovation progress and requests',   fn:'showRenosForRole()', module:'renovations'},
      {icon:'🧰', label:'Contractors',     desc:'Browse contractor directory',         fn:'showContractorsForRole()', module:'contractors'}
    ].filter(function(t){ return !t.module || !mods2 || mods2.isEnabled(t.module); });
    tilesEl.innerHTML = empTiles.map(function(t) {
      var ab = t.accent ? 'background:var(--dark);border:2px solid var(--yellow);' : 'background:var(--surface);border:1px solid var(--border);';
      var lc = t.accent ? 'color:var(--yellow);' : '';
      var dc = t.accent ? 'color:#888;' : 'color:var(--muted);';
            return '<div onclick="'+t.fn+'" style="'+ab+'border-radius:12px;padding:22px;cursor:pointer;transition:box-shadow .15s;display:flex;flex-direction:column;gap:10px;"'
        +' onmouseover="this.style.boxShadow=&quot;0 4px 16px rgba(0,0,0,0.1)&quot;" onmouseout="this.style.boxShadow=&quot;&quot;">'
        +'<div style="font-size:28px;">'+t.icon+'</div>'
        +'<div style="font-weight:700;font-size:14px;'+lc+'">'+t.label+'</div>'
        +'<div style="font-size:12px;'+dc+'">'+t.desc+'</div>'
        +'</div>';
    }).join('');
  }

  var view = document.getElementById('employeeHomeView');
  if(view){ view.style.display='flex'; view.style.flexDirection='column'; }

  // Populate recent activity
  renderRecentActivity(role);
}

async function renderRecentActivity(role) {
  var el = document.getElementById('emp_recent_activity');
  if(!el) return;

  // Load from Supabase if we don't already have entries in memory
  var log = (typeof auditLog !== 'undefined' && auditLog && auditLog.length) ? auditLog.slice() : [];
  if(!log.length && typeof sbLoadAuditLog === 'function') {
    el.innerHTML = '<div style="color:var(--muted);font-style:italic;font-size:13px;">Loading activity…</div>';
    try {
      var loaded = await sbLoadAuditLog(200);
      if(Array.isArray(loaded)) {
        log = loaded;
        if(typeof auditLog !== 'undefined') { try { auditLog = loaded.slice(); } catch(e){} }
      }
    } catch(e) { console.warn('[RECENT ACTIVITY] load failed:', e); }
  }

  var apps  = (typeof applications !== 'undefined') ? applications : [];
  var units = (typeof housingUnits  !== 'undefined') ? housingUnits  : [];

  // ── Define which events each role sees ─────────────────────────────────────
  var roleFilters = {
    employee: function(e) {
      // Employees see only their own submissions, draft saves, and signatures
      return ['application_submitted','file_update_submitted','draft_saved','signature_captured'].indexOf(e.action) >= 0;
    },
    housing_manager: function(e) {
      // HM sees submissions awaiting action, approvals, unit edits, SOW events, reno updates
      return ['application_submitted','file_update_submitted','status_change','status',
              'hm_approved','sow_created','sow_updated','sow_hm_approval','sow_tenant_signed',
              'sow_staff_signed','sow_accountability','unit_edit',
              'settings_scoring_change','settings_scoring_add','settings_scoring_delete',
              'settings_unit_score_save','settings_reno_score_save',
              'settings_budget_save','settings_user_add','settings_user_remove'].indexOf(e.action) >= 0;
    },
    ed: function(e) {
      // ED sees everything except raw draft saves and individual signature captures
      return e.action !== 'draft_saved' && e.action !== 'signature_captured' && e.action !== 'settings_saved';
    }
  };

  var filterFn = roleFilters[role] || roleFilters.employee;
  var filtered = log.filter(filterFn).slice(0, 40); // more entries since we group them

  if(!filtered.length) {
    el.innerHTML = '<div style="color:var(--muted);font-style:italic;font-size:13px;">No recent activity yet.</div>';
    return;
  }

  // ── Icon + colour map ──────────────────────────────────────────────────────
  var icons = {
    'application_submitted':    {icon:'📨', color:'#15803d', label:'Application Submitted'},
    'file_update_submitted':    {icon:'📨', color:'#15803d', label:'File Update Submitted'},
    'draft_saved':              {icon:'💾', color:'var(--muted)', label:'Draft Saved'},
    'signature_captured':       {icon:'✍️', color:'var(--muted)', label:'Signature Captured'},
    'status_change':            {icon:'🔄', color:'#1d4ed8', label:'Status Changed'},
    'status':                   {icon:'🔄', color:'#1d4ed8', label:'Status Changed'},
    'application_opened':       {icon:'📂', color:'var(--muted)', label:'Opened for Edit'},
    'declined':                 {icon:'✕',  color:'#b91c1c', label:'Declined'},
    'archived':                 {icon:'📦', color:'var(--muted)', label:'Archived'},
    'unarchived':               {icon:'📤', color:'var(--muted)', label:'Unarchived'},
    'ed_adjustment':            {icon:'⭐', color:'#7a5c00', label:'Score Adjusted'},
    'unit_edit':                {icon:'🏠', color:'#7c3aed', label:'Unit Updated'},
    'unit_assigned':            {icon:'🔑', color:'#15803d', label:'Unit Assigned'},
    'unit_archived':            {icon:'🏚️', color:'#888',    label:'Unit Archived'},
    'unit_unarchived':          {icon:'📤', color:'#1d4ed8', label:'Unit Restored'},
    'sow_created':              {icon:'🔨', color:'#d97706', label:'SOW Created'},
    'sow_updated':              {icon:'🔨', color:'#d97706', label:'SOW Updated'},
    'sow_hm_approval':          {icon:'✅', color:'#15803d', label:'SOW Approved'},
    'sow_ed_approval':          {icon:'✅', color:'#15803d', label:'SOW Approved (ED)'},
    'sow_tenant_signed':        {icon:'✍️', color:'#1d4ed8', label:'Tenant Signed SOW'},
    'sow_staff_signed':         {icon:'✍️', color:'var(--muted)', label:'Staff Signed SOW'},
    'sow_accountability':       {icon:'⚠️', color:'#b91c1c', label:'Accountability Flagged'},
    'ct_submitted':             {icon:'🧰', color:'#15803d', label:'Contractor Application'},
    'ct_updated':               {icon:'🧰', color:'#888',    label:'Contractor Updated'},
    'hm_recommended':           {icon:'✅', color:'#1d4ed8', label:'HM Recommended'},
    'approved':                 {icon:'✅', color:'#15803d', label:'Approved'},
    'returned':                 {icon:'↩️', color:'#7c3aed', label:'Returned for Info'},
    'settings_scoring_change':  {icon:'⚙️', color:'#7c3aed', label:'Rubric Value Changed'},
    'settings_scoring_add':     {icon:'⚙️', color:'#15803d', label:'Rubric Criteria Added'},
    'settings_scoring_delete':  {icon:'⚙️', color:'#b91c1c', label:'Rubric Criteria Removed'},
    'settings_scoring_reset':   {icon:'⚙️', color:'#b91c1c', label:'Scoring Model Reset'},
    'settings_unit_score_save': {icon:'⚙️', color:'#7c3aed', label:'Unit Scoring Updated'},
    'settings_reno_score_save': {icon:'⚙️', color:'#d97706', label:'Reno Scoring Updated'},
    'settings_budget_save':     {icon:'💰', color:'#15803d', label:'Budget Saved'},
    'settings_user_add':        {icon:'👤', color:'#15803d', label:'User Added'},
    'settings_user_remove':     {icon:'👤', color:'#b91c1c', label:'User Removed'},
    'settings_saved':           {icon:'⚙️', color:'var(--muted)', label:'Settings Saved'}
  };

  // ── Group by calendar day (LOCAL time, not UTC) ────────────────────────────
  // Using toISOString().slice(0,10) here was giving us a UTC date string while
  // dayLabel() parses it back as local — so an event at 9 PM yesterday in EDT
  // (= 1 AM UTC today) was bucketed under "Today". Build the key from local
  // date components so the bucket matches what dayLabel will show.
  var today     = new Date(); today.setHours(0,0,0,0);
  var yesterday = new Date(today); yesterday.setDate(yesterday.getDate()-1);

  function _localDateKey(ts){
    var d = new Date(ts);
    var y  = d.getFullYear();
    var m  = String(d.getMonth()+1).padStart(2,'0');
    var dd = String(d.getDate()).padStart(2,'0');
    return y + '-' + m + '-' + dd;
  }

  var groups = {}; // key = YYYY-MM-DD (local), value = []
  var order  = [];
  filtered.forEach(function(e) {
    var key = _localDateKey(e.ts);
    if(!groups[key]) { groups[key] = []; order.push(key); }
    groups[key].push(e);
  });

  function dayLabel(key) {
    var d = new Date(key + 'T00:00:00');
    d.setHours(0,0,0,0);
    if(d.getTime() === today.getTime())     return 'Today';
    if(d.getTime() === yesterday.getTime()) return 'Yesterday';
    return d.toLocaleDateString('en-CA', {weekday:'long', month:'short', day:'numeric'});
  }

  function timeStr(ts) {
    var d = new Date(ts);
    return d.toLocaleTimeString('en-CA', {hour:'2-digit', minute:'2-digit', hour12:true});
  }

  function renderEntry(e) {
    var meta = icons[e.action] || {icon:'•', color:'var(--muted)', label: e.action.replace(/_/g,' ')};
    var appId = e.appId || '';
    var displayId = appId;
    var extraName = '';
    if(appId && !appId.startsWith('SOW:') && !appId.startsWith('UNIT:') && !appId.startsWith('CT:') && appId !== 'SETTINGS') {
      var linkedApp = apps.find(function(a){ return a.id === appId; });
      if(linkedApp) extraName = ((linkedApp.fn||'') + ' ' + (linkedApp.ln||'')).trim();
    } else if(appId.startsWith('SOW:')) {
      var uid = appId.slice(4);
      var linkedUnit = units.find(function(u){ return u.id === uid; });
      if(linkedUnit) extraName = linkedUnit.num + ' ' + linkedUnit.street;
      displayId = 'SOW';
    } else if(appId.startsWith('UNIT:')) {
      displayId = appId.slice(5);
    } else if(appId.startsWith('CT:')) {
      displayId = appId.slice(3);
    }
    return '<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0 8px 0;">'
      + '<div style="width:28px;height:28px;border-radius:7px;background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;margin-top:1px;border:1px solid var(--border);">'+meta.icon+'</div>'
      + '<div style="flex:1;min-width:0;">'
        + '<div style="font-size:12px;font-weight:600;color:var(--text);">'
          + (extraName ? '<span style="color:'+meta.color+';">'+extraName+'</span> · ' : '')
          + meta.label
        + '</div>'
        + '<div style="font-size:11px;color:var(--muted);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+(e.detail||'—')+'</div>'
        + (displayId && displayId!=='SETTINGS' ? '<div style="font-size:10px;color:var(--muted);margin-top:1px;font-family:monospace;opacity:.7;">'+displayId+'</div>' : '')
      + '</div>'
      + '<div style="font-size:10px;color:var(--muted);white-space:nowrap;flex-shrink:0;padding-top:3px;">'+timeStr(e.ts)+'</div>'
      + '</div>';
  }

  el.innerHTML = order.map(function(key, i) {
    var groupId = 'act_group_' + key.replace(/-/g,'');
    var isToday = dayLabel(key) === 'Today';
    return '<div style="margin-bottom:'+(i<order.length-1?'8px':'0')+'">'
      // Day header — clickable
      + '<div onclick="var g=document.getElementById(\''+groupId+'\');var ch=document.getElementById(\''+groupId+'_ch\');var open=g.style.display!==\'none\';g.style.display=open?\'none\':\'block\';ch.style.transform=open?\'rotate(-90deg)\':\'rotate(0deg)\';" '
        + 'style="display:flex;align-items:center;gap:10px;padding:6px 0;cursor:pointer;user-select:none;">'
        + '<svg id="'+groupId+'_ch" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="2.5" style="flex-shrink:0;transition:transform .2s;transform:'+(isToday?'rotate(0deg)':'rotate(-90deg)')+'"><polyline points="6 9 12 15 18 9"/></svg>'
        + '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--muted);">'+dayLabel(key)+'</div>'
        + '<div style="flex:1;height:1px;background:var(--border);"></div>'
        + '<div class="js-lbl-xs">'+groups[key].length+' event'+(groups[key].length!==1?'s':'')+'</div>'
      + '</div>'
      // Entries — today open by default, previous days collapsed
      + '<div id="'+groupId+'" style="display:'+(isToday?'block':'none')+';padding-left:12px;border-left:2px solid var(--border);">'
        + groups[key].map(renderEntry).join('')
      + '</div>'
      + '</div>';
  }).join('');

  // Update the section count pill — show TODAY's event count only (post role
  // filter), so the header reflects "what happened today" rather than the full
  // visible window. Reuses the local date key so the pill matches the "Today"
  // group rendered above.
  var rcp = document.getElementById('recent_count_pill');
  if(rcp){
    var todayKey = _localDateKey(today);
    var todayCount = (groups[todayKey] || []).length;
    rcp.textContent = todayCount;
  }
}

// ══════════════════════════════════════════════════════
// TENANT FILES
// ══════════════════════════════════════════════════════
// Migrated to window.DocLibrary (shared.js) in Phase C.
// The modal shell (id="tenantFilesPanel", header w/ tfp_title) stays;
// DocLibrary mounts into #tfp_mount. The factory handles upload, list,
// view, delete, and categories.
var _tenantFilesUnitId = null;
var _tenantFilesLib = null;

// Categories for housing-side tenant documents. Shared between the
// tenant-files-unit modal and the Unit Detail Panel preview below.
var _HOUSING_TENANT_DOC_CATEGORIES = [
  { key:'id',          label:'ID',              icon:'\uD83E\uDDFE' },
  { key:'lease',       label:'Lease',           icon:'\uD83D\uDCC4' },
  { key:'application', label:'Application',     icon:'\uD83D\uDCDD' },
  { key:'inspection',  label:'Inspection',      icon:'\uD83D\uDD0D' },
  { key:'insurance',   label:'Insurance',       icon:'\uD83D\uDEE1\uFE0F' },
  { key:'notice',      label:'Notice / Letter', icon:'\uD83D\uDCEC' },
  { key:'other',       label:'Other',           icon:'\uD83D\uDCCE' }
];

// Retained as a thin compat wrapper: udpRenderFilePreviews still calls
// this. Once that path is fully migrated to DocLibrary, this can go away.
async function getTenantFiles(unitId){
  return await sbLoadFileMeta('tenant', unitId);
}

// ── Settings page patches ─────────────────────────────────────────────────
// Runs once after DOMContentLoaded so that housing.html's inline
// showSettingsSection has already been defined.
document.addEventListener('DOMContentLoaded', function(){

  // 1. Remove the Contacts tab — workflow emails are driven by the staff
  //    table; the manual contacts config is redundant and removed.
  var tabs = document.querySelectorAll('.settings-tab,[data-sec="sec_contacts"]');
  tabs.forEach(function(t){
    if(t.textContent && t.textContent.trim().toLowerCase().indexOf('contact') !== -1){
      t.style.display = 'none';
    }
  });
  // Also hide the contacts section itself in case it's already visible
  var secContacts = document.getElementById('sec_contacts');
  if(secContacts) secContacts.style.display = 'none';

  // 2. Patch showSettingsSection so switching to Nation tab calls
  //    renderNationPanel() automatically, without touching housing.html.
  var _origSSS = window.showSettingsSection;
  window.showSettingsSection = function(secId){
    if(typeof _origSSS === 'function') _origSSS(secId);
    if(secId === 'sec_nation' && typeof renderNationPanel === 'function'){
      renderNationPanel();
    }
    if(secId === 'sec_themes' && typeof renderThemesPanel === 'function'){
      renderThemesPanel();
    }
    if(secId === 'sec_required_fields' && typeof renderRequiredFieldsPanel === 'function'){
      renderRequiredFieldsPanel();
    }
  };
});

