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

function _fmtUnitType(type) {
  if (!type || type === '0' || type === 'nan') return '';
  return type.replace(/_/g, ' ').replace(/\b\w/g, function(c){ return c.toUpperCase(); });
}

var _FUNDER_LABELS = {
  'ISC':              'ISC',
  'CMHC_95':         'CMHC Sec. 95',
  'section_10':      'Section 10',
  'rent_to_own':     'Rent-to-Own',
  'band_house':      'Band House',
  'privately_owned': 'Privately Owned',
  'Other':           'Other',
};
function _fmtFunder(val) {
  if (!val) return '';
  return _FUNDER_LABELS[val] || val.replace(/_/g, ' ');
}
function _roomBedLabel(u) {
  var n = u ? u.bedrooms : null;
  if (n == null || n === '') return '';
  var isBldg = ['admin_building','band_building','commercial_building'].indexOf(u.type) >= 0;
  return isBldg ? n + (n == 1 ? ' room' : ' rooms') : n + '-bed';
}
// Assignment Type badge — Temporary (urgent/emergency) and Transition
// (probationary) units, set via the Edit Unit modal. Mirrors the ELDERS UNIT
// badge markup pattern used alongside it. See liveMatchPriorityModel
// (scoring.js) for how each type affects Match placement order.
function _assignmentTypeBadge(u) {
  if (!u || !u.assignmentType) return '';
  if (u.assignmentType === 'temporary') return '<span style="font-size:9px;background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;padding:1px 5px;border-radius:6px;">TEMPORARY</span>';
  if (u.assignmentType === 'transition') return '<span style="font-size:9px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;padding:1px 5px;border-radius:6px;">TRANSITION</span>';
  return '';
}

// ── List / Cards view toggle (Inventory, Match) ─────────────────────────────
// Mirrors the worklist's List/Cards pattern (clfn_worklist_view in
// shared-data.js renderWorklist) — persisted per device, defaults to List.
// Kept as its own small set of helpers here (not shared with the worklist's
// locally-scoped wlGrid/wlPill/wlCard) since those are private to
// renderWorklist(); this is the shared home for every OTHER page's table.
function _viewMode(key) {
  try { return localStorage.getItem('clfn_' + key + '_view') === 'cards' ? 'cards' : 'list'; } catch(e) { return 'list'; }
}
function _viewToggleHtml(key, setFnName) {
  var cur = _viewMode(key);
  function b(v, label, icon) {
    var on = cur === v;
    return '<button type="button" onclick="' + setFnName + '(\'' + v + '\')" style="display:flex;align-items:center;gap:5px;padding:5px 12px;'
      + 'border:1px solid ' + (on ? 'var(--yellow)' : 'var(--border)') + ';background:' + (on ? 'var(--yellow)' : 'var(--surface)') + ';'
      + 'color:' + (on ? 'var(--dark)' : 'var(--muted)') + ';font-size:11px;font-weight:700;font-family:DM Sans,sans-serif;cursor:pointer;'
      + 'border-radius:' + (v === 'list' ? '7px 0 0 7px' : '0 7px 7px 0') + ';' + (v === 'cards' ? 'margin-left:-1px;' : '') + '">' + icon + ' ' + label + '</button>';
  }
  return '<div style="display:flex;justify-content:flex-end;margin-bottom:10px;"><div style="display:flex;">' + b('list', 'List', '&#9776;') + b('cards', 'Cards', '&#9638;') + '</div></div>';
}
// Card-grid builders — used by any page's Cards view. o = {title, pill:{text,bg,color},
// badges:[html], metas:[{k,v}], open:'onclick js', actions:[{text,onclick,ghost} | {html}]}.
function _cardGrid(cards) { return '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;">' + cards + '</div>'; }
function _cardPill(text, bg, color) {
  if (!text) return '';
  return '<span style="flex-shrink:0;font-size:10px;font-weight:700;color:' + (color||'var(--muted)') + ';background:' + (bg||'var(--bg)') + ';border:1px solid var(--border);border-radius:20px;padding:2px 8px;white-space:nowrap;">' + text + '</span>';
}
function _cardTile(o) {
  var metas = (o.metas||[]).filter(function(m){ return m && m.v != null && String(m.v) !== ''; }).map(function(m){
    return '<div style="display:flex;justify-content:space-between;gap:10px;font-size:12px;margin-top:5px;">'
      + '<span style="color:var(--muted);flex-shrink:0;">' + m.k + '</span>'
      + '<span style="color:var(--text);font-weight:600;text-align:right;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + m.v + '</span></div>';
  }).join('');
  var badges = (o.badges||[]).join(' ');
  var actions = (o.actions||[]).map(function(a){
    if (a.html) return a.html;
    return '<button type="button" onclick="' + a.onclick + '" style="flex:1;background:' + (a.ghost ? 'none' : 'var(--yellow)') + ';color:' + (a.ghost ? 'var(--muted)' : 'var(--dark)') + ';'
      + 'border:' + (a.ghost ? '1px solid var(--border)' : 'none') + ';border-radius:7px;padding:8px 10px;font-size:12px;font-weight:700;font-family:DM Sans,sans-serif;cursor:pointer;white-space:nowrap;">' + a.text + '</button>';
  }).join('');
  return '<div style="border:1px solid var(--border);border-radius:10px;background:var(--surface);padding:13px 14px;display:flex;flex-direction:column;">'
    + '<div ' + (o.open ? 'onclick="' + o.open + '"' : '') + ' style="cursor:' + (o.open ? 'pointer' : 'default') + ';">'
    +   '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">'
    +     '<span style="font-size:14px;font-weight:700;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-decoration:underline;text-decoration-color:var(--border);text-underline-offset:2px;">' + o.title + '</span>'
    +     _cardPill(o.pill && o.pill.text, o.pill && o.pill.bg, o.pill && o.pill.color)
    +   '</div>'
    +   (badges ? '<div style="margin-top:4px;">' + badges + '</div>' : '')
    +   metas
    + '</div>'
    + (actions ? '<div style="display:flex;gap:6px;margin-top:11px;">' + actions + '</div>' : '')
    + '</div>';
}

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
  var ta=document.getElementById('tab_app');if(ta)ta.classList.add('active');
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
  // Scroll-collapse: shrink the page header to a compact title bar once the
  // list scrolls, freeing space on tablet/mobile (shared-ui.js). Idempotent —
  // safe to call on every render.
  (function(){
    var _hdr = document.querySelector('#inventoryView .page-header-bar');
    var _area = document.querySelector('.content-area');
    if (_hdr && _area && typeof _initScrollCollapse === 'function') _initScrollCollapse(_area, _hdr);
  })();
  var showRenoCol = (ROLE.isManagement(window.currentRole));
  var th = document.getElementById('inv_reno_score_th');
  if(th) th.style.display = showRenoCol ? '' : 'none';
  var units = getAllUnits().slice();
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
        (u.isElders ? 'elders' : ''),
        (u.monthlyRent != null ? String(u.monthlyRent) : '')
      ].filter(Boolean).join(' ').toLowerCase();
      if (hay.indexOf(_searchLc) === -1) return false;
    }
    return true;
  });

  var vacantCount = units.filter(function(u){return u.status==='vacant' && !u.archived;}).length;
  var el = document.getElementById('inv_count'); if(el) el.textContent = units.filter(function(u){return !u.archived;}).length;
  var ve = document.getElementById('inv_vacant_count'); if(ve) ve.textContent = vacantCount+' vacant';

  var _invMode = _viewMode('inventory');
  var toggleEl = document.getElementById('inv_view_toggle');
  if (toggleEl) toggleEl.innerHTML = _viewToggleHtml('inventory', '_invSetView');
  var tableWrapEl = document.getElementById('inv_table_wrap');
  var cardsEl     = document.getElementById('inv_cards');
  if (tableWrapEl) tableWrapEl.style.display = (_invMode === 'cards') ? 'none' : '';
  if (cardsEl)     cardsEl.style.display     = (_invMode === 'cards') ? '' : 'none';

  var tbody = document.getElementById('inv_tbody');
  if(!tbody) return;
  if(!filtered.length){
    var _emptyHtml = '<tr><td colspan="11" style="padding:32px;text-align:center;color:var(--muted);">No units match the current filters.</td></tr>';
    if (_invMode === 'cards') { if (cardsEl) cardsEl.innerHTML = '<div class="card" style="text-align:center;padding:40px;color:var(--muted);">No units match the current filters.</div>'; }
    else tbody.innerHTML = _emptyHtml;
    return;
  }

  var statusStyle = {
    vacant:      {bg:'#f0fdf4',c:'#15803d',label:'Vacant'},
    occupied:    {bg:'#eff6ff',c:'#1d4ed8',label:'Occupied'},
    under_repair:{bg:'var(--warn-amber-bg)',c:'var(--warn-amber-text)',label:'Vacant'},
    reserved:    {bg:'#faf5ff',c:'#7c3aed',label:'Reserved'},
    condemned:   {bg:'#fef2f2',c:'#b91c1c',label:'Condemned'},
    archived:    {bg:'#f4f4f0',c:'var(--gray)',   label:'Archived'}
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
    type:        { label: 'Type',          accessor: function(u){ return _fmtUnitType(u.type) || '(none)'; } },
    foundation:  { label: 'Foundation',    accessor: function(u){ return (u.foundation && u.foundation !== '0' && u.foundation !== 'nan') ? u.foundation : '(none)'; } },
    accessible:  { label: 'Accessibility', accessor: function(u){ return u.accessible ? 'Accessible' : 'Non-accessible'; } },
    funder:      { label: 'Funder',        accessor: function(u){ return _fmtFunder(u.funder) || '(none)'; } },
    status:      { label: 'Status',        accessor: function(u){ return (statusStyle[u.status]||{}).label || u.status || 'Unknown'; } },
    rent:        { label: 'Rent',          accessor: function(u){ return (u.monthlyRent != null && u.monthlyRent !== '') ? Number(u.monthlyRent) : -1; } },
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
    var ss = statusStyle[u.status]||{bg:'#f0f0ec',c:'var(--gray)',label:u.status||'Unknown'};
    var addr = u.num+' '+u.street;
    var bath = (u.bathrooms&&u.bathrooms!=='0'&&u.bathrooms!=='nan') ? u.bathrooms : '—';
    var fnd  = (u.foundation&&u.foundation!=='nan'&&u.foundation!=='0') ? u.foundation : '—';
    var type = _fmtUnitType(u.type) || '—';
    var funder = _fmtFunder(u.funder)||'—';
    var uid = u.id.replace(/'/g,"\\'");
    return '<tr style="border-bottom:1px solid var(--border);transition:background .12s;" onmouseover="this.style.background=\'var(--bg)\'" onmouseout="this.style.background=\'\'">'
      +'<td style="padding:9px 14px;font-size:13px;font-weight:600;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" onclick="openUnitEditModal(\''+uid+'\')">'+'<span style="text-decoration:underline;text-decoration-color:var(--border);text-underline-offset:2px;">'+addr+'</span>'
      +(u.isElders?' <span style="font-size:9px;background:var(--warn-amber-bg);color:var(--warn-amber);border:1px solid var(--warn-amber-border);padding:1px 5px;border-radius:6px;">ELDERS UNIT</span>':'')
      +' '+_assignmentTypeBadge(u)
      +'</td>'
      +'<td style="padding:9px 10px;text-align:center;font-size:13px;font-weight:700;color:var(--text);">'+u.bedrooms+'</td>'
      +'<td style="padding:9px 10px;text-align:center;font-size:12px;color:var(--muted);">'+bath+'</td>'
      +'<td style="padding:9px 10px;font-size:12px;color:var(--muted);text-transform:capitalize;">'+type+'</td>'
      +'<td class="col-hide-tablet" style="padding:9px 10px;font-size:12px;color:var(--muted);text-transform:capitalize;">'+fnd+'</td>'
      +'<td style="padding:9px 10px;text-align:center;font-size:14px;">'+(u.accessible?'<span title="Accessible">♿</span>':'<span style="color:var(--border);">—</span>')+'</td>'
      +'<td class="col-hide-tablet" style="padding:9px 10px;font-size:12px;color:var(--muted);">'+funder+'</td>'
      +'<td style="padding:9px 14px;"><span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:10px;background:'+ss.bg+';color:'+ss.c+';">'+ss.label+'</span>'
      +(u.under_renovation?' <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;background:var(--warn-amber-bg);color:var(--warn-amber-text);margin-left:4px;">🔨 Reno</span>':'')
      +(u.assignedName?' <span class="js-lbl-sm">→ '+u.assignedName+'</span>':'')+'</td>'
      +(function(){
        var r = (u.monthlyRent != null && u.monthlyRent !== '') ? Number(u.monthlyRent) : null;
        return '<td class="col-hide-tablet" style="padding:9px 10px;text-align:right;font-size:13px;font-weight:600;color:var(--text);">'
          + (r != null ? '$' + r.toFixed(2) : '<span style="color:var(--border);">—</span>')
          + '</td>';
      })()
      +(ROLE.isManagement(window.currentRole) ? (function(){
        var _hasSow = !!getSowData(u.id);
        var _hasProg = !!(window._renoProgress && window._renoProgress[u.id]);
        if(_hasSow||_hasProg){
          var _rs=calcRenoScore(u.id); var _sc=_rs.score;
          var _tier=_sc>=40?{label:'Critical',c:'#b91c1c',bg:'#fef2f2'}:_sc>=25?{label:'High',c:'#7a6000',bg:'#fef9ec'}:_sc>=12?{label:'Medium',c:'#1d4ed8',bg:'#eff6ff'}:{label:'Low',c:'#15803d',bg:'#f0fdf4'};
          return '<td style="padding:9px 10px;">'
            +'<div data-inv-reno-sow="'+uid+'" style="display:flex;align-items:center;gap:5px;cursor:pointer;" title="Open Maintenance Request">'
            +'<span style="font-size:14px;font-weight:800;color:var(--text);">'+_sc+'</span>'
            +'<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;background:'+_tier.bg+';color:'+_tier.c+';">'+_tier.label+'</span>'
            +'</div></td>';
        }
        return '<td style="padding:9px 10px;"><span style="font-size:11px;color:var(--border);">—</span></td>';
      })() : '')
      +'<td style="padding:9px 10px;text-align:center;width:1%;white-space:nowrap;">'
      +'<div style="display:flex;align-items:center;justify-content:center;gap:6px;">'
      +'<button type="button" onclick="event.stopPropagation();openSowModal(\''+uid+'\')" title="Maintenance Request" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:14px;padding:4px;">🔨</button>'
      +'<button type="button" onclick="event.stopPropagation();openUnitEditModal(\''+uid+'\')" title="Edit unit" style="background:none;border:1px solid var(--border);color:var(--muted);border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px;transition:all .15s;" onmouseover="this.style.borderColor=\'var(--yellow)\';this.style.color=\'var(--yellow)\'" onmouseout="this.style.borderColor=\'var(--border)\';this.style.color=\'var(--muted)\'">'
      +'<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
      +'</button>'
      +'</div>'
      +'</td>'
      +'</tr>';
  }

  // Card renderer — same statusStyle/uid/badge logic as the table row, laid
  // out as a _cardTile instead of a <tr>.
  function _invCardHtml(u){
    var ss = statusStyle[u.status]||{bg:'#f0f0ec',c:'var(--gray)',label:u.status||'Unknown'};
    var addr = u.num+' '+u.street;
    var bath = (u.bathrooms&&u.bathrooms!=='0'&&u.bathrooms!=='nan') ? u.bathrooms : '';
    var uid = u.id.replace(/'/g,"\\'");
    var badges = [];
    if(u.isElders) badges.push('<span style="font-size:9px;background:var(--warn-amber-bg);color:var(--warn-amber);border:1px solid var(--warn-amber-border);padding:1px 5px;border-radius:6px;">ELDERS UNIT</span>');
    if(_assignmentTypeBadge(u)) badges.push(_assignmentTypeBadge(u));
    if(u.under_renovation) badges.push('<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;background:var(--warn-amber-bg);color:var(--warn-amber-text);">🔨 Reno</span>');
    var r = (u.monthlyRent != null && u.monthlyRent !== '') ? Number(u.monthlyRent) : null;
    var metas = [
      {k:'Beds / Baths', v: u.bedrooms + ' bd' + (bath ? ' · ' + bath + ' ba' : '')},
      {k:'Type',   v: _fmtUnitType(u.type) || '—'},
      {k:'Funder', v: _fmtFunder(u.funder) || '—'},
      {k:'Rent',   v: r != null ? '$'+r.toFixed(2) : '—'},
      {k:'Tenant', v: u.assignedName || ''}
    ];
    if (ROLE.isManagement(window.currentRole)) {
      var _hasSow = !!getSowData(u.id);
      var _hasProg = !!(window._renoProgress && window._renoProgress[u.id]);
      if (_hasSow || _hasProg) metas.push({k:'Reno Score', v: calcRenoScore(u.id).score});
    }
    return _cardTile({
      title: addr,
      pill: {text: ss.label, bg: ss.bg, color: ss.c},
      badges: badges,
      metas: metas,
      open: "openUnitEditModal('"+uid+"')",
      actions: [
        {text:'🔨 Maintenance', onclick:"event.stopPropagation();openSowModal('"+uid+"')", ghost:true},
        {text:'✏️ Edit', onclick:"event.stopPropagation();openUnitEditModal('"+uid+"')"}
      ]
    });
  }

  if (_invMode === 'cards') {
    if (cardsEl) cardsEl.innerHTML = _cardGrid(_invRows.map(_invCardHtml).join(''));
    if (cardsEl) cardsEl.querySelectorAll('[data-inv-reno-sow]').forEach(function(cell){
      cell.addEventListener('click', function(e){ e.stopPropagation(); openSowModal(cell.getAttribute('data-inv-reno-sow')); });
    });
    // Column-menu registration still needs to happen so the popovers (opened
    // from the table header) reflect the current filtered set once the user
    // switches back to List — but there's no header to bind clicks to here.
    return;
  }

  // Empty-state path
  if (!_invRows.length) {
    tbody.innerHTML = '<tr><td colspan="11" style="padding:32px;text-align:center;color:var(--muted);">No units match the current filters.</td></tr>';
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
    row.addEventListener('click', function(){ openUnitEditModal(row.getAttribute('data-uid')); });
  });
}
window._invSetView = function(v){
  try { localStorage.setItem('clfn_inventory_view', v === 'cards' ? 'cards' : 'list'); } catch(e){}
  renderInventoryView();
};

// ── Unit Edit Modal ──────────────────────────────────────

function renderMatchView(){
  // Scroll-collapse: shrink the page header to a compact title bar once the
  // list scrolls, freeing space on tablet/mobile (shared-ui.js). Idempotent —
  // safe to call on every render.
  (function(){
    var _hdr = document.querySelector('#matchView .page-header-bar');
    var _area = document.querySelector('.content-area');
    if (_hdr && _area && typeof _initScrollCollapse === 'function') _initScrollCollapse(_area, _hdr);
  })();
  var allApps = (typeof applications !== 'undefined' ? applications : []);
  var allUnits = getAllUnits();
  var vacantUnits = allUnits.filter(function(u){ return u.status==='vacant' && !u.archived; });

  // Tenancy is authoritative on the UNIT (housing_units.assigned_name) and is
  // NOT reliably synced back onto the application record: assignedUnit/status
  // are only written when a unit is assigned to a tenant whose assignedTo ===
  // the application id (see housing-modals.js saveUnitEdit). So an applicant can
  // be housed in reality while their application still looks unassigned --
  // backfilled/legacy tenants, names typed directly, existing-tenant
  // assignments, or a duplicate approved app. Map current tenancy (unit address)
  // by linked app-id and by tenant name so the Match view can both flag housed
  // applicants and decide who genuinely belongs in the queue.
  var _mNorm = function(s){ return (s||'').toString().toLowerCase().replace(/\s+/g,' ').trim(); };
  var _housedAddrByAppId = {};
  var _housedAddrByName  = {};
  allUnits.forEach(function(u){
    if(u.archived) return;
    var occupied = u.status==='occupied' || u.status==='reserved' || !!u.assignedName;
    if(!occupied) return;
    var addr = ((u.num||'') + ' ' + (u.street||'')).trim();
    if(u.assignedTo)   _housedAddrByAppId[u.assignedTo] = addr;
    if(u.assignedName) _housedAddrByName[_mNorm(u.assignedName)] = addr;
  });
  // Address of the applicant's CURRENT home, when housed via a unit that is not
  // this application's own assignment (i.e. a real, separate tenancy). '' = not
  // currently housed elsewhere. Used to flag transfer/upgrade applicants.
  function _currentTenancyAddr(a){
    return _housedAddrByAppId[a.id]
        || _housedAddrByName[_mNorm((a.fn||'')+' '+(a.ln||''))]
        || '';
  }

  // Search-bar pre-filter. All other filtering happens via the column-menu
  // popovers (see tableApplyFilterSort below).
  var search = (document.getElementById('match_search')||{}).value||'';
  var _searchLc = (search || '').toLowerCase().trim();
  var filtered = allApps.filter(function(a){
    if(a.archived) return false;
    // Existing-tenant FILE UPDATES are record updates, not housing requests, and
    // are never scored/ranked -> they must never appear on Match, regardless of
    // unit or status.
    if(a.appType === 'existing_tenant') return false;
    if(a.status===APP_STATUS.DRAFT||a.status===APP_STATUS.ARCHIVED||a.status===APP_STATUS.FILE_UPDATE) return false;
    // This application already resulted in a placement -> it's done, not a
    // pending match.
    if(a.status==='assigned' || !!a.assignedUnit) return false;
    // Match shows only applications that have cleared approval and are awaiting
    // placement. Not-yet-approved (submitted / Pending HM), returned, and
    // declined applications are hidden from the queue. The approval rule is the
    // shared appIsAssignable() so Match, confirmAssignment, the unit-edit gate,
    // and the Add-Tenant modal stay in lockstep.
    if(typeof appIsAssignable === 'function'){
      if(!appIsAssignable(a)) return false;
    } else if(a.status!==APP_STATUS.MGR_APPROVED
       && a.status!==APP_STATUS.HM_APPROVED
       && a.status!==APP_STATUS.ED_APPROVED) return false;
    // The Application Type decides who gets matched. Two of the three types are
    // SCORED + RANKED and so belong on Match:
    //   new_housing      - applicant seeking a new unit
    //   transfer_request - current tenant applying for a different unit
    // (existing_tenant "file update" is NOT scored and is excluded above by the
    // file_update status.) A scored applicant who is currently housed (a
    // transfer) stays in the queue and is flagged with the "On Rez" identifier
    // in the row. A housed person surfacing via any OTHER, non-scored record
    // (e.g. a stale existing-tenant anomaly) is suppressed -- they already have
    // a home and aren't being ranked.
    var _scored = (a.appType === 'new_housing' || a.appType === 'transfer_request');
    if(_currentTenancyAddr(a) && !_scored) return false;
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
  var _eldersMin = (window._appSettings && window._appSettings.eldersAgeMin) || 65;
  function bestUnit(app){
    var needsBeds = 1;
    if(app.habitants) needsBeds = Math.max(1, 1 + (app.coApp?1:0) + app.habitants.length);
    var needsAccess = app.accessibility && app.accessibility!=='None' && app.accessibility!=='0' && app.accessibility!==0;
    var age = app.dob ? Math.floor((new Date()-new Date(app.dob))/(365.25*24*3600*1000)) : 0;
    var isElders = age >= _eldersMin;

    var eligible = isElders ? vacantUnits : vacantUnits.filter(function(u){ return !u.isElders; });
    var scored = eligible.map(function(u){
      var sc = 0;
      // One size up (needsBeds+1) is a fine, freely-assignable match; two or
      // more sizes up (e.g. a 3-bed for someone who needs 1) is heavily
      // penalized here to match the hard "requires ED approval" gate in
      // confirmAssignment() (housing-init.js) — see _isOversizedUnit() there.
      if(u.bedrooms === needsBeds)          sc += 10;
      else if(u.bedrooms === needsBeds + 1) sc += 5;
      else if(u.bedrooms === needsBeds - 1) sc += 3;
      else if(u.bedrooms >= needsBeds + 2)  sc -= 50;
      if(needsAccess && u.accessible)     sc += 8;
      if(needsAccess && !u.accessible)    sc -= 4;
      if(isElders && u.isElders)          sc += 6;
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
  // Status wording comes from the shared 'match' variant of
  // formatAppStatusLabel (shared-data.js) — raw-status fallback preserved.

  // ── Column-menu sort + filter via the shared scaffolding (Phase 2B) ────
  function _bestUnitAddr(app){
    var b = bestUnit(app);
    return b && b.unit ? (b.unit.num + ' ' + b.unit.street) : '';
  }
  // Placement order — combines "has a matching unit" + that unit's
  // Assignment Type + reserve status + current-house status (see
  // liveMatchPriorityModel, scoring.js) on top of the raw score, so who gets
  // matched first is a distinct, ED-adjustable decision from need/urgency.
  // Ranked highest bonus to lowest:
  //   1. Has a suitable vacant unit at all (bestUnit() != null) — an
  //      applicant nobody can place today shouldn't sit at the top of the
  //      queue ahead of someone who can be placed right now.
  //   2. Best-matching unit is a Temporary (urgent/emergency) unit — jumps
  //      the queue outright, stacking on top of the tier below.
  //   3. On-Reserve+NoHouse > Off-Reserve+NoHouse > On-Reserve+HasHouse >
  //      Off-Reserve+HasHouse — house status dominates, reserve status is
  //      the secondary tiebreak, so an off-reserve applicant with no house
  //      outranks an on-reserve applicant who already has one. If the
  //      best-matching unit is a Transition unit (demonstrating the tenant
  //      can care for a unit — lower urgency), the applicant's real reserve/
  //      house status is ignored and they're scored at the bottom of this
  //      tier (as if off-reserve with a house) regardless of their own status.
  // Within any tier, score still wins since every bonus dwarfs the
  // ~100-point max application score.
  function _matchPriorityOf(a){
    var w = window.liveMatchPriorityModel || DEFAULT_MATCH_PRIORITY_MODEL;
    var best = bestUnit(a);
    var hasMatch = !!best;
    var assignType = (best && best.unit) ? (best.unit.assignmentType||'') : '';
    var isTemporary = assignType === 'temporary';
    var isTransition = assignType === 'transition';
    var onReserve = !isTransition && a.reserve === 'On Reserve';
    var hasHouse = isTransition || !!(a.assignedUnit || a.appType==='transfer_request' || _currentTenancyAddr(a));
    var bonus = (hasMatch ? (w.hasMatchBonus||0) : 0)
              + (isTemporary ? (w.temporaryBonus||0) : 0)
              + (onReserve ? (w.onReserveBonus||0) : 0)
              + (!hasHouse ? (w.noHouseBonus||0) : 0);
    return bonus + (a.score||0);
  }
  var _matchColumns = {
    applicant:     { label: 'Applicant',      accessor: function(a){ return ((a.fn||'') + ' ' + (a.ln||'')).trim(); } },
    score:         { label: 'Score',          accessor: function(a){ return a.score || 0; } },
    tier:          { label: 'Tier',           accessor: function(a){ return (a.tier || 'Low Priority').replace(' Priority',''); } },
    reserve:       { label: 'Reserve',        accessor: function(a){ return a.reserve || '(none)'; } },
    bestUnit:      { label: 'Best Unit',      accessor: function(a){ return _bestUnitAddr(a) || '(no match)'; } },
    status:        { label: 'Status',         accessor: function(a){ return formatAppStatusLabel(a.status, {variant:'match'}) || a.status || 'Unknown'; } },
    hasHouse:      { label: 'Has House',      accessor: function(a){ return (a.assignedUnit || a.appType==='transfer_request' || _currentTenancyAddr(a)) ? 1 : 0; } },
    matchPriority: { label: 'Match Priority', accessor: _matchPriorityOf },
    action:        { label: 'Action',         accessor: function(a){ var ready = !a.assignedUnit && (a.status==='ed_approved'||a.status==='mgr_approved'||a.status==='hm_approved'); return ready ? 1000 + (a.score||0) : (a.score||0); } }
  };
  var _matchAccessors = {};
  Object.keys(_matchColumns).forEach(function(k){ _matchAccessors[k] = _matchColumns[k].accessor; });

  var _matchState = (typeof tableStateGet === 'function') ? tableStateGet('match') : { sort:{key:'matchPriority',dir:-1}, filters:{} };
  if (_matchState.sort && (!_matchState.sort.key || _matchState.sort.key === 'action')) _matchState.sort = { key: 'matchPriority', dir: -1 };

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

  var _matchMode = _viewMode('match');
  var _matchToggleHtml = _viewToggleHtml('match', '_matchSetView');

  if(!_matchRows.length){
    content.innerHTML = _matchToggleHtml + '<div class="card" style="text-align:center;padding:40px;color:var(--muted);">No applicants match the current filters.</div>';
    return;
  }

  var rows = _matchRows.map(function(app, i){
    var best = bestUnit(app);
    var name = ((app.fn||'')+' '+(app.ln||'')).trim();
    var curAddr = _currentTenancyAddr(app);   // current home address, if resolvable
    var isTransfer = (app.appType === 'transfer_request') || !!curAddr;  // current tenant moving
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
        +'<div class="js-lbl-sm">'+_roomBedLabel(best.unit)+' · '+(_fmtUnitType(best.unit.type)||'—')+'</div>'
        +'</div>'
      : '<span class="js-txt-muted-sm">No suitable vacant units</span>';

    var reqs = [];
    if(needsAccess) reqs.push('<span style="font-size:10px;color:var(--info-blue);">Needs accessible unit</span>');
    var age = app.dob ? Math.floor((new Date()-new Date(app.dob))/(365.25*24*3600*1000)) : 0;
    if(age>=_eldersMin) reqs.push('<span style="font-size:10px;color:var(--warn-amber);">Elders eligible</span>');

    var sl = formatAppStatusLabel(app.status, {variant:'match'}) || app.status || '';
    var appDateStr = app.appDate ? 'Applied '+app.appDate : '';

    // "Has a unit" is the source of truth — an app with an assignedUnit is
    // housed regardless of stored status. Conversely, anything WITHOUT a unit
    // that has cleared approval (mgr/ed/hm) — or is marked 'assigned' due to
    // a data anomaly — gets the Assign button so a unit can be attached.
    var hasUnit    = !!app.assignedUnit;
    var hasHouseReal = hasUnit || isTransfer;   // real tenancy, incl. transfer applicants
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
        +(isTransfer?'<div style="margin-top:4px;"><span style="display:inline-block;font-size:10px;font-weight:700;background:var(--warn-amber);color:#111;padding:1px 7px;border-radius:4px;white-space:nowrap;">🏠 On Rez'+(curAddr?' · '+curAddr:'')+'</span> <span style="font-size:10px;color:var(--muted);font-weight:600;">transfer</span></div>':'')
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
      +'<td style="padding:12px 14px;white-space:nowrap;">'
        +(hasHouseReal
          ? '<span style="font-size:12px;font-weight:700;color:var(--success);">Yes</span>'+(curAddr?'<div class="js-lbl-sm">'+curAddr+'</div>':'')
          : '<span style="font-size:12px;color:var(--muted);">No</span>')
      +'</td>'
      +'<td style="padding:12px 14px;">'+assignCell+'</td>'
      +'</tr>';
  }).join('');

  // Card renderer — same per-applicant computation as the table row, laid
  // out as a _cardTile. The Assign button uses the same data-assign-app/
  // data-assign-unit + addEventListener wiring as the table (below) rather
  // than an inline onclick, so both views share one wiring path.
  function _matchCardHtml(app, i){
    var best = bestUnit(app);
    var name = ((app.fn||'')+' '+(app.ln||'')).trim();
    var curAddr = _currentTenancyAddr(app);
    var isTransfer = (app.appType === 'transfer_request') || !!curAddr;
    var tCol = tierColor[app.tier] || '#6b7280';
    var tier = (app.tier||'Low Priority').replace(' Priority','');
    var matchPct = best ? Math.round(Math.max(0,best.score)/24*100) : 0;
    var sl = formatAppStatusLabel(app.status, {variant:'match'}) || app.status || '';
    var hasUnit = !!app.assignedUnit;
    var hasHouseReal = hasUnit || isTransfer;
    var canAssign = !hasUnit && (
      app.status === APP_STATUS.ED_APPROVED ||
      app.status === APP_STATUS.MGR_APPROVED ||
      app.status === APP_STATUS.HM_APPROVED ||
      app.status === 'assigned'
    );
    var badges = [];
    if (isTransfer) badges.push('<span style="display:inline-block;font-size:10px;font-weight:700;background:var(--warn-amber);color:#111;padding:1px 7px;border-radius:4px;white-space:nowrap;">🏠 On Rez'+(curAddr?' · '+curAddr:'')+'</span>');
    var metas = [
      {k:'Score',     v: app.score||0},
      {k:'Reserve',   v: app.reserve||''},
      {k:'Best Unit', v: best ? (best.unit.num+' '+best.unit.street+' · '+matchPct+'% match') : 'No suitable unit'},
      {k:'Status',    v: sl},
      {k:'Has House', v: hasHouseReal ? ('Yes'+(curAddr?' — '+curAddr:'')) : 'No'}
    ];
    var actions = [];
    if (hasUnit) {
      actions.push({html:'<div style="flex:1;text-align:center;font-size:11px;font-weight:700;color:var(--success);padding:8px 0;">✓ '+(app.assignedAddress||'Assigned')+'</div>'});
    } else if (canAssign) {
      actions.push({html:'<button type="button" data-assign-app="'+app.id+'" data-assign-unit="'+(best?best.unit.id:'')+'" style="flex:1;background:var(--yellow);border:none;color:var(--dark);padding:8px 10px;border-radius:7px;cursor:pointer;font-size:12px;font-weight:700;font-family:DM Sans,sans-serif;white-space:nowrap;">Assign →</button>'});
    }
    return _cardTile({
      title: name,
      pill: {text: tier, bg:'var(--bg)', color: tCol},
      badges: badges,
      metas: metas,
      open: "openAppFromMatch('"+app.id+"')",
      actions: actions
    });
  }

  if (_matchMode === 'cards') {
    content.innerHTML = _matchToggleHtml + _cardGrid(_matchRows.map(_matchCardHtml).join(''));
  } else {
    content.innerHTML = _matchToggleHtml + '<div class="std-table-card">'
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
      +'<th class="std-th-sortable" data-sort-key="hasHouse">Has House</th>'
      +'<th class="std-th-sortable" data-sort-key="action">Action</th>'
      +'</tr></thead>'
      +'<tbody id="match_tbody" data-table-page="match">'+rows+'</tbody>'
      +'</table></div></div>';
    // Wire column-menu click + sort indicators on the table header (list mode only).
    var matchThead = document.getElementById('match_thead');
    if (typeof tableBindColumnMenuClicks === 'function') tableBindColumnMenuClicks(matchThead, 'match');
    if (typeof tableRefreshSortIndicators === 'function') tableRefreshSortIndicators(matchThead, 'match');
  }
  // Wire assign buttons — shared by both views, since both render
  // [data-assign-app] buttons into the same #match_content mount.
  var matchContent = document.getElementById('match_content');
  if(matchContent) matchContent.querySelectorAll('[data-assign-app]').forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      openAssignModal(btn.getAttribute('data-assign-app'), btn.getAttribute('data-assign-unit'));
    });
  });
}
window._matchSetView = function(v){
  try { localStorage.setItem('clfn_match_view', v === 'cards' ? 'cards' : 'list'); } catch(e){}
  renderMatchView();
};
window._tenSetView = function(v){
  try { localStorage.setItem('clfn_tenants_view', v === 'cards' ? 'cards' : 'list'); } catch(e){}
  renderTenantsView();
};


function renderTenantsView(){
  // Scroll-collapse: shrink the page header to a compact title bar once the
  // list scrolls, freeing space on tablet/mobile (shared-ui.js). Idempotent —
  // safe to call on every render.
  (function(){
    var _hdr = document.querySelector('#tenantsView .page-header-bar');
    var _area = document.querySelector('.content-area');
    if (_hdr && _area && typeof _initScrollCollapse === 'function') _initScrollCollapse(_area, _hdr);
  })();
  var showRenoCol = (ROLE.isManagement(window.currentRole));
  var th = document.getElementById('ten_reno_score_th');
  if(th) th.style.display = showRenoCol ? '' : 'none';
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
    allUnits = getAllUnits();
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

  var _tenMode = _viewMode('tenants');
  var _tenToggleEl = document.getElementById('ten_view_toggle');
  if (_tenToggleEl) _tenToggleEl.innerHTML = _viewToggleHtml('tenants', '_tenSetView');
  var _tenTableWrapEl = document.getElementById('ten_table_wrap');
  var _tenCardsEl     = document.getElementById('ten_cards');
  if (_tenTableWrapEl) _tenTableWrapEl.style.display = (_tenMode === 'cards') ? 'none' : '';
  if (_tenCardsEl)     _tenCardsEl.style.display     = (_tenMode === 'cards') ? '' : 'none';

  // Card renderer — same status/badge/reno-score logic as the table row,
  // laid out as a _cardTile instead of a <tr>.
  function _tenCardHtml(u){
    var _showRenoScore = (ROLE.isManagement(window.currentRole));
    var uid = String(u.id).replace(/'/g,"\\'");
    var badges = [];
    if(u.isElders) badges.push('<span style="font-size:9px;background:var(--warn-amber-bg);color:var(--warn-amber);border:1px solid var(--warn-amber-border);padding:1px 5px;border-radius:6px;">ELDERS UNIT</span>');
    if(_assignmentTypeBadge(u)) badges.push(_assignmentTypeBadge(u));
    var metas = [
      {k:'Beds', v: u.bedrooms ? (u.bedrooms + '-bed' + (u.accessible ? ' · Accessible' : '')) : ''},
      {k:'Move-In Date', v: u.assignedDate || ''}
    ];
    if (_showRenoScore) {
      if (hasSowOrReno(u.id)) metas.push({k:'Reno Score', v: calcRenoScore(u.id).score});
    }
    var _openCall = u.assignedName ? "openTenantCard('"+uid+"')" : "openUnitEditModal('"+uid+"')";
    return _cardTile({
      title: u.assignedName || 'No tenant assigned',
      pill: {text: (u.status==='reserved'?'Reserved':'Occupied'), bg: (u.status==='reserved'?'#faf5ff':'#eff6ff'), color: (u.status==='reserved'?'#7c3aed':'#1d4ed8')},
      badges: badges,
      metas: [{k:'Address', v: ((u.num||'')+' '+(u.street||'')).trim()}].concat(metas),
      open: _openCall,
      actions: [
        {text:'🪪 Card', onclick:"event.stopPropagation();"+_openCall, ghost:true},
        {text:'🔨 Maintenance', onclick:"event.stopPropagation();openSowModal('"+uid+"')", ghost:true},
        {text:'📎 Files', onclick:"event.stopPropagation();openTenantFilesPanel('"+uid+"')", ghost:true}
      ]
    });
  }

  if (_tenMode === 'cards') {
    if (_tenCardsEl) _tenCardsEl.innerHTML = units.length
      ? _cardGrid(units.map(_tenCardHtml).join(''))
      : '<div class="card" style="text-align:center;padding:40px;color:var(--muted);">No tenants match the current filters.</div>';
    return;
  }

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
      renoCell='<div data-reno-sow="'+u.id+'" style="display:flex;align-items:center;gap:5px;cursor:pointer;" title="Open Maintenance Request"><span style="font-size:14px;font-weight:800;color:var(--text);">'+s+'</span><span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;background:'+tier.bg+';color:'+tier.c+';">'+tier.label+'</span></div>';
    } else if(_showRenoScore) {
      renoCell='<span style="font-size:11px;color:var(--border);">—</span>';
    }
    // fileCount already set above
    return '<tr class="clickable" data-tuid="'+escapeHtml(u.id)+'">'
      +'<td><div class="std-cell-primary">'+escapeHtml(u.num)+' '+escapeHtml(u.street)+(u.isElders?' <span style="font-size:9px;background:var(--warn-amber-bg);color:var(--warn-amber);border:1px solid var(--warn-amber-border);padding:1px 5px;border-radius:6px;">ELDERS UNIT</span>':'')+' '+_assignmentTypeBadge(u)+'</div><div class="tbl-sub">'+escapeHtml(String(u.bedrooms||''))+'-bed'+(u.accessible?' · Accessible':'')+'</div></td>'
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
        +'<button type="button" data-sow-uid="'+u.id+'" title="Maintenance Request" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:14px;">🔨</button>'
      +'</td>'
      +'</tr>';
  }).join('');
  tbody.querySelectorAll('[data-tuid]').forEach(function(row){
    row.addEventListener('click',function(e){
      if(e.target.closest('[data-sow-uid]') || e.target.closest('[data-tic-uid]')
         || e.target.closest('[data-files-uid]') || e.target.closest('[data-reno-sow]')) return;
      var uid = row.getAttribute('data-tuid');
      // Clicking a tenant row opens their Tenant Information Card (from which the
      // application can be opened/updated). If the unit has no tenant assigned
      // yet, fall back to the unit editor.
      var u = (window.housingUnits||[]).find(function(x){ return String(x.id) === String(uid); });
      if(u && u.assignedName && typeof openTenantCard === 'function') openTenantCard(uid);
      else openUnitEditModal(uid);
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
var _step6DocLibAppId = null; // tracks which app the current lib was built for

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
    allUnits = getAllUnits();
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
  var allUnits = getAllUnits();
  var filtered = q.trim().length > 0
    ? allUnits.filter(function(u){ return (u.num+' '+u.street).toLowerCase().includes(q.toLowerCase()); })
    : allUnits.slice(0,20);

  var statusStyle = {
    vacant:      {bg:'#f0fdf4',c:'#15803d',label:'Vacant'},
    occupied:    {bg:'#eff6ff',c:'#1d4ed8',label:'Occupied'},
    under_repair:{bg:'#f0fdf4',c:'#15803d',label:'Vacant'},
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
    var ss = statusStyle[u.status]||{bg:'#f0f0ec',c:'var(--gray)',label:u.status};
    return '<div onclick="closeUnitSearch();openUnitEditModal(\''+u.id.replace(/'/g,"\\'")+'\')" '
      +'style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border:1px solid var(--border);border-radius:8px;cursor:pointer;background:var(--bg);transition:border-color .12s;" '
      +'onmouseover="this.style.borderColor=\'var(--yellow)\'" onmouseout="this.style.borderColor=\'var(--border)\'">'
      +'<div>'
        +'<div style="font-weight:700;font-size:13px;">'+escapeHtml(u.num)+' '+escapeHtml(u.street)+'</div>'
        +'<div class="js-lbl-sm">'+escapeHtml(_roomBedLabel(u))+' · '+escapeHtml(_fmtUnitType(u.type)||'—')+'</div>'
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

  // Refresh the action worklist so freshly created/submitted items (e.g. a new
  // application just submitted) appear immediately on return to the landing page,
  // instead of only after a full reload / re-login.
  if (typeof renderWorklist === 'function' && document.getElementById('worklist_body')) renderWorklist();

  // Recent Activity — kick off the role-aware render so the count pill
  // (#recent_count_pill) reflects today's events on first paint, not just
  // after the user expands the section. The body update happens against
  // a hidden element (section defaults collapsed) and primes the
  // auditLog cache so the eventual expand renders instantly.
  if (typeof renderRecentActivity === 'function') renderRecentActivity(role);
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

  var vacant = units.filter(function(u){
    return u && !u.archived && u.status === 'vacant';
  }).length;

  // Application-type breakdown (active = non-archived, not declined):
  //   new_housing      → New Applications (seeking a new unit)
  //   existing_tenant  → File Updates
  //   transfer_request → House Requests (existing tenant transfer)
  function _activeOfType(pred){
    return apps.filter(function(a){
      if(!a || a.archived || a.status === 'declined') return false;
      return pred(a.appType || 'new_housing');
    }).length;
  }
  var newApps       = _activeOfType(function(t){ return t !== 'existing_tenant' && t !== 'transfer_request'; });
  var fileUpdates   = _activeOfType(function(t){ return t === 'existing_tenant'; });
  var houseRequests = _activeOfType(function(t){ return t === 'transfer_request'; });

  setKpi('kpi_open_apps',       openApps);
  setKpi('kpi_vacant',          vacant);
  setKpi('kpi_new_apps',        newApps);
  setKpi('kpi_file_updates',    fileUpdates);
  setKpi('kpi_house_requests',  houseRequests);

  // Scroll-collapse: shrink the KPI strip to icon-only once the page scrolls,
  // freeing space on tablet/mobile (shared-ui.js). _initScrollCollapse is
  // itself idempotent, so calling it on every render is safe.
  var _kpiStrip = document.getElementById('landing_kpi_strip');
  var _contentArea = document.querySelector('.content-area');
  if (_kpiStrip && _contentArea && typeof _initScrollCollapse === 'function') {
    _initScrollCollapse(_contentArea, _kpiStrip);
  }
}

var _kpiDrillData = null; // { title, headers, rows, colWidths, filename }

function showHousingKpiDrilldown(type) {
  var apps  = (typeof applications !== 'undefined' && applications) ? applications : [];
  var units = (typeof housingUnits  !== 'undefined' && housingUnits)  ? housingUnits  : [];

  // Status wording: shared 'kpi' variant of formatAppStatusLabel
  // (shared-data.js) — raw-status fallback for unmapped statuses (e.g. draft).
  function STATUS_LBL(a){ return formatAppStatusLabel(a.status, {variant:'kpi'}) || a.status || ''; }
  var URGENT_LABELS = {
    'homeless':'Homeless','domestic_violence':'Domestic Violence','fire_disaster':'Fire / Disaster',
    'homeless_eviction':'Homeless / Eviction','eviction_risk':'Eviction Risk','separation':'Separation',
    'none':'','':''
  };
  function tierPill(tier) {
    var colors = {'Critical Priority':'var(--danger)','High Priority':'#d97706','Medium Priority':'#0891b2'};
    var c = colors[tier] || 'var(--muted)';
    return '<span style="font-size:11px;font-weight:700;color:'+c+';">'+(tier||'—')+'</span>';
  }
  function daysSince(dateStr) {
    if (!dateStr) return '—';
    var d = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
    return d >= 0 ? d + 'd' : '—';
  }
  function daysSinceRaw(dateStr) {
    if (!dateStr) return '';
    var d = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
    return d >= 0 ? d + ' days' : '';
  }
  function appRow(a, cols) {
    var sid = (a.id||'').replace(/'/g,"\\'");
    return '<tr class="clickable" onclick="_closeHousingKpiDrill();if(typeof window.openEditModal===\'function\')window.openEditModal(\''+sid+'\');">'
      + cols + '</tr>';
  }

  var title, html, exportHeaders, exportRows, exportColWidths;
  var today = new Date().toISOString().slice(0,10);

  if (type === 'open') {
    title = 'Open Applications';
    var rows = apps.filter(function(a){
      if (!a || a.archived) return false;
      return a.status==='submitted' || a.status==='file_update' || a.status==='mgr_approved';
    }).slice().sort(function(a,b){ return (b.score||0)-(a.score||0); });
    exportHeaders = ['Applicant','App ID','Status','Tier','Score','Days Waiting'];
    exportColWidths = [28,16,14,22,8,12];
    exportRows = rows.map(function(a){
      return [(a.fn||'')+' '+(a.ln||''), a.id||'', STATUS_LBL(a),
              a.tier_v2||a.tier||'', a.score||0, daysSinceRaw(a.appDate)];
    });
    html = '<table class="tbl"><thead><tr>'
      + '<th>Applicant</th><th>Status</th><th>Tier</th><th class="std-cell-right">Score</th><th>Waiting</th>'
      + '</tr></thead><tbody>'
      + (rows.length ? rows.map(function(a){
          return appRow(a,
            '<td style="font-weight:600;">'+escapeHtml((a.fn||'')+' '+(a.ln||''))+'</td>'
            +'<td>'+escapeHtml(STATUS_LBL(a))+'</td>'
            +'<td>'+tierPill(a.tier_v2||a.tier)+'</td>'
            +'<td class="std-cell-right" style="font-weight:700;">'+(a.score||0)+'</td>'
            +'<td class="std-cell-muted">'+daysSince(a.appDate)+'</td>'
          );
        }).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:24px;">No open applications.</td></tr>')
      + '</tbody></table>';

  } else if (type === 'vacant') {
    title = 'Vacant Units';
    var rows = units.filter(function(u){ return u && !u.archived && u.status==='vacant'; })
      .slice().sort(function(a,b){ return ((a.street||'')+(a.num||'')).localeCompare((b.street||'')+(b.num||'')); });
    exportHeaders = ['Address','Bedrooms','Type','Classification','Accessible','Elders Unit'];
    exportColWidths = [28,10,16,20,12,12];
    exportRows = rows.map(function(u){
      return [(u.num||'')+' '+(u.street||''), u.bedrooms||'',
              _fmtUnitType(u.type)||'', u.classification||'',
              u.accessible?'Yes':'', u.isElders?'Yes':''];
    });
    html = '<table class="tbl"><thead><tr>'
      + '<th>Address</th><th class="std-cell-right">Beds</th><th>Type</th><th>Classification</th>'
      + '</tr></thead><tbody>'
      + (rows.length ? rows.map(function(u){
          var sid = (u.id||'').replace(/'/g,"\\'");
          return '<tr class="clickable" onclick="_closeHousingKpiDrill();window.location.href=\'inventory.html?unit='+sid+'\'">'
            +'<td style="font-weight:600;">'+escapeHtml((u.num||'')+' '+(u.street||''))+'</td>'
            +'<td class="std-cell-right">'+(u.bedrooms||'—')+'</td>'
            +'<td class="std-cell-muted">'+escapeHtml(_fmtUnitType(u.type)||'—')+'</td>'
            +'<td class="std-cell-muted">'+escapeHtml(u.classification||'—')+'</td>'
            +'</tr>';
        }).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:24px;">No vacant units.</td></tr>')
      + '</tbody></table>';

  } else if (type === 'new_apps' || type === 'file_updates' || type === 'house_requests') {
    var _typeCfg = {
      new_apps:       { title:'New Applications',                          pred:function(t){ return t!=='existing_tenant' && t!=='transfer_request'; }, empty:'No active new applications.' },
      file_updates:   { title:'File Updates — Existing Tenant',            pred:function(t){ return t==='existing_tenant'; },   empty:'No active file updates.' },
      house_requests: { title:'House Requests — Existing Tenant Transfer', pred:function(t){ return t==='transfer_request'; },  empty:'No active house requests.' }
    }[type];
    title = _typeCfg.title;
    var rows = apps.filter(function(a){
      if (!a || a.archived || a.status==='declined') return false;
      return _typeCfg.pred(a.appType || 'new_housing');
    }).slice().sort(function(a,b){ return (b.score||0)-(a.score||0); });
    exportHeaders = ['Applicant','App ID','Tier','Score','Status','Days Waiting'];
    exportColWidths = [28,16,22,8,14,12];
    exportRows = rows.map(function(a){
      return [(a.fn||'')+' '+(a.ln||''), a.id||'', a.tier_v2||a.tier||'',
              a.score||0, STATUS_LBL(a), daysSinceRaw(a.appDate)];
    });
    html = '<table class="tbl"><thead><tr>'
      + '<th>Applicant</th><th>Status</th><th>Tier</th><th class="std-cell-right">Score</th><th>Waiting</th>'
      + '</tr></thead><tbody>'
      + (rows.length ? rows.map(function(a){
          return appRow(a,
            '<td style="font-weight:600;">'+escapeHtml((a.fn||'')+' '+(a.ln||''))+'</td>'
            +'<td>'+escapeHtml(STATUS_LBL(a))+'</td>'
            +'<td>'+tierPill(a.tier_v2||a.tier)+'</td>'
            +'<td class="std-cell-right" style="font-weight:700;">'+(a.score||0)+'</td>'
            +'<td class="std-cell-muted">'+daysSince(a.appDate)+'</td>'
          );
        }).join('') : '<tr><td colspan="5" style="text-align:center;color:var(--muted);padding:24px;">'+_typeCfg.empty+'</td></tr>')
      + '</tbody></table>';
  }

  _kpiDrillData = {
    title:     title,
    headers:   exportHeaders,
    rows:      exportRows,
    colWidths: exportColWidths,
    filename:  'CLFN_' + (title||type).replace(/[^a-zA-Z0-9]+/g,'_') + '_' + today
  };

  var existing = document.getElementById('modalHousingKpiDrill');
  if (existing) existing.remove();
  var mo = document.createElement('div');
  mo.className = 'modal-ov';
  mo.id = 'modalHousingKpiDrill';
  mo.innerHTML =
    '<div class="modal" style="max-width:860px;width:96%;">'
    + '<div class="modal-hdr modal-hdr-stack">'
    +   '<div><h2>' + title + '</h2>'
    +   (exportRows && exportRows.length ? '<div style="font-size:11px;opacity:.7;margin-top:2px;">' + exportRows.length + ' record' + (exportRows.length===1?'':'s') + '</div>' : '')
    +   '</div>'
    +   '<div class="flex-gap8 flex-wrap" style="align-items:center;">'
    +     '<button class="btn btn-ghost-dark" onclick="_kpiDrillPrint()">&#128438; Print</button>'
    +     '<div class="export-dropdown">'
    +       '<button onclick="toggleExportMenu(this)" class="btn btn-primary">&#128196; Export</button>'
    +       '<div class="header-export-menu">'
    +         '<button onclick="_kpiDrillExport(\'pdf\')"   class="header-export-item">Save as PDF</button>'
    +         '<button onclick="_kpiDrillExport(\'excel\')" class="header-export-item">Excel (.xlsx)</button>'
    +         '<button onclick="_kpiDrillExport(\'csv\')"   class="header-export-item">CSV</button>'
    +       '</div>'
    +     '</div>'
    +     '<button class="modal-close" onclick="_closeHousingKpiDrill()">&#x2715;</button>'
    +   '</div>'
    + '</div>'
    + '<div class="modal-body" style="padding:0;"><div class="tbl-wrap">'+html+'</div></div>'
    + '</div>';
  mo.addEventListener('click', function(e){ if (e.target === mo) _closeHousingKpiDrill(); });
  document.body.appendChild(mo);
  mo.style.display = '';
  mo.classList.add('on');
}

function _closeHousingKpiDrill() {
  var m = document.getElementById('modalHousingKpiDrill');
  if (m) m.remove();
}

function _kpiDrillExport(format) {
  if (!_kpiDrillData || !_kpiDrillData.rows) return;
  if (typeof _doExport === 'function') {
    _doExport(format, _kpiDrillData.headers, _kpiDrillData.rows,
              _kpiDrillData.filename, _kpiDrillData.colWidths, false);
  }
}

function _kpiDrillPrint() {
  if (!_kpiDrillData) return;
  var d = _kpiDrillData;
  var nation = nationDisplay();
  var dateStr = new Date().toLocaleDateString('en-CA', {year:'numeric',month:'long',day:'numeric'});
  var thead = '<tr>' + d.headers.map(function(h){ return '<th>'+h+'</th>'; }).join('') + '</tr>';
  var tbody = (d.rows && d.rows.length)
    ? d.rows.map(function(r){ return '<tr>' + r.map(function(c){ return '<td>'+(c==null?'':c)+'</td>'; }).join('') + '</tr>'; }).join('')
    : '<tr><td colspan="'+d.headers.length+'" style="text-align:center;padding:20px;color:#666;">No records.</td></tr>';
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>'+d.title+'</title>'
    + '<style>'
    + 'body{font-family:Arial,sans-serif;font-size:12px;color:#111;margin:24px;}'
    + 'h1{font-size:16px;margin:0 0 2px;}p{margin:0 0 14px;font-size:11px;color:#555;}'
    + 'table{width:100%;border-collapse:collapse;}'
    + 'th{background:#111;color:#fff;padding:6px 8px;text-align:left;font-size:11px;}'
    + 'td{padding:5px 8px;border-bottom:1px solid #e5e5e5;font-size:11px;}'
    + 'tr:nth-child(even) td{background:#f9f9f9;}'
    + '@media print{body{margin:12px;}}'
    + '</style></head><body>'
    + '<h1>'+d.title+'</h1>'
    + '<p>'+nation+' &mdash; Generated '+dateStr+(d.rows?' &mdash; '+d.rows.length+' record'+(d.rows.length===1?'':'s'):'')+'</p>'
    + '<table><thead>'+thead+'</thead><tbody>'+tbody+'</tbody></table>'
    + '<script>window.onload=function(){window.print();}<\/script>'
    + '</body></html>';
  var w = window.open('', '_blank', 'width=960,height=700');
  if (w) { w.document.write(html); w.document.close(); }
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
    var underRepair = units.filter(function(u){return u.under_renovation;}).length;
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
      var allU=getAllUnits();
      var renoUnits=allU.filter(function(u){return (u.under_renovation||u.status==='condemned')&&!u.archived;});
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
      makeStat('Maintenance Requests Approved', sowApproved,   sowApproved>0?'good':'neutral') +
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
    var empTiles;
    if (role === ROLE.FIELD_EMPLOYEE) {
      // Maintenance crew: inventory + the renovation work queue only. No
      // applications, tenants edit, contractors, finance, or settings.
      empTiles = [
        {icon:'🏠', label:'Inventory',   desc:'View units and complete work',        fn:'showInventory()',     module:'inventory'},
        {icon:'🔨', label:'Work Orders', desc:'Maintenance requests, work orders & progress reports', fn:'showRenosForRole()', module:'renovations'}
      ];
    } else {
      empTiles = [
        {icon:'📝', label:'New Application', desc:'Start a new housing application', fn:'newApp()', accent:true, module:'applications'},
        {icon:'📋', label:'My Worklist',     desc:'Track applications you have submitted', fn:'showWorklist()', module:'applications'},
        {icon:'👥', label:'Tenants',         desc:'Search and update tenant records',   fn:'showTenantsForRole()', module:'tenants'},
        {icon:'🔨', label:'Renovations',     desc:'Renovation progress and requests',   fn:'showRenosForRole()', module:'renovations'},
        {icon:'🧰', label:'Contractors',     desc:'Browse contractor directory',         fn:'showContractorsForRole()', module:'contractors'}
      ];
    }
    empTiles = empTiles.filter(function(t){ return !t.module || !mods2 || mods2.isEnabled(t.module); });
    tilesEl.innerHTML = empTiles.map(function(t) {
      var ab = t.accent ? 'background:var(--dark);border:2px solid var(--yellow);' : 'background:var(--surface);border:1px solid var(--border);';
      var lc = t.accent ? 'color:var(--yellow);' : '';
      var dc = t.accent ? 'color:var(--gray);' : 'color:var(--muted);';
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

  var myEmail = (typeof HOUSING_SESSION !== 'undefined' && HOUSING_SESSION ? HOUSING_SESSION.email : '') || '';
  var myName  = (typeof HOUSING_SESSION !== 'undefined' && HOUSING_SESSION ? HOUSING_SESSION.name  : '') || '';

  // ── Load activity scoped to the current user ──────────────────────────────
  // The in-memory auditLog[] is already per-session (only this user's actions
  // from the current page load). When loading from Supabase use the user-scoped
  // query so one HM/ED does not see another's recent activity.
  var log = (typeof auditLog !== 'undefined' && auditLog && auditLog.length) ? auditLog.slice() : [];
  if(!log.length) {
    el.innerHTML = '<div style="color:var(--muted);font-style:italic;font-size:13px;">Loading activity…</div>';
    try {
      var loader = (typeof sbLoadMyRecentActivity === 'function') ? sbLoadMyRecentActivity : sbLoadAuditLog;
      var loaded = await loader(150);
      if(Array.isArray(loaded)) {
        log = loaded;
        if(typeof auditLog !== 'undefined') { try { auditLog = loaded.slice(); } catch(e){} }
      }
    } catch(e) { console.warn('[RECENT ACTIVITY] load failed:', e); }
  }

  // ── Per-user filter: only show entries that belong to the current user ────
  // New entries store email in actor; legacy entries store the role string.
  // For legacy entries, fall back to name matching when available.
  function isMyEntry(e) {
    if (!myEmail && !myName) return true; // no identity — show all (shouldn't happen post-login)
    if (e.user && e.user === myEmail) return true;  // email match (new entries)
    if (e.name && myName && e.name === myName) return true; // name match (legacy entries)
    // Legacy entries with only a role string — include only if from in-memory log
    // (which is per-session). Supabase-loaded role-string entries are ambiguous;
    // exclude them to prevent showing another user's actions.
    if (!myEmail && e.user && e.user.indexOf('@') === -1 && e.name === myName) return true;
    return false;
  }

  var apps  = (typeof applications !== 'undefined') ? applications : [];
  var units = (typeof housingUnits  !== 'undefined') ? housingUnits  : [];

  // ── Action-type filters (what kinds of actions are relevant per role) ──────
  var roleFilters = {
    employee: function(e) {
      return ['application_submitted','file_update_submitted','draft_saved','signature_captured'].indexOf(e.action) >= 0;
    },
    housing_manager: function(e) {
      return ['application_submitted','file_update_submitted','status_change','status',
              'hm_approved','sow_created','sow_updated','sow_hm_approval','sow_tenant_signed',
              'sow_staff_signed','sow_accountability','unit_edit',
              'settings_scoring_change','settings_scoring_add','settings_scoring_delete',
              'settings_unit_score_save','settings_reno_score_save',
              'settings_budget_save','settings_user_add','settings_user_remove'].indexOf(e.action) >= 0;
    },
    ed: function(e) {
      return e.action !== 'draft_saved' && e.action !== 'signature_captured' && e.action !== 'settings_saved';
    }
  };

  var filterFn = roleFilters[role] || roleFilters.employee;
  var filtered = log.filter(function(e){ return filterFn(e) && isMyEntry(e); }).slice(0, 40);

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
    'unit_archived':            {icon:'🏚️', color:'var(--gray)',    label:'Unit Archived'},
    'unit_unarchived':          {icon:'📤', color:'#1d4ed8', label:'Unit Restored'},
    'sow_created':              {icon:'🔨', color:'#d97706', label:'Request Created'},
    'sow_updated':              {icon:'🔨', color:'#d97706', label:'Request Updated'},
    'sow_hm_approval':          {icon:'✅', color:'#15803d', label:'Request Approved'},
    'sow_ed_approval':          {icon:'✅', color:'#15803d', label:'Request Approved (ED)'},
    'sow_tenant_signed':        {icon:'✍️', color:'#1d4ed8', label:'Tenant Signed Request'},
    'sow_staff_signed':         {icon:'✍️', color:'var(--muted)', label:'Staff Signed Request'},
    'sow_accountability':       {icon:'⚠️', color:'#b91c1c', label:'Accountability Flagged'},
    'ct_submitted':             {icon:'🧰', color:'#15803d', label:'Contractor Application'},
    'ct_updated':               {icon:'🧰', color:'var(--gray)',    label:'Contractor Updated'},
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

  // View mode shared with the worklist toggle (one preference drives both).
  var _view = (function(){ try { return localStorage.getItem('clfn_worklist_view') === 'cards' ? 'cards' : 'list'; } catch(e){ return 'list'; } })();
  function _recentToggleBar(){
    function b(v, label, icon){
      var on = _view === v;
      var click = 'if(typeof _wlSetView===\'function\'){_wlSetView(\''+v+'\');}else{try{localStorage.setItem(\'clfn_worklist_view\',\''+v+'\');}catch(e){}if(typeof renderRecentActivity===\'function\')renderRecentActivity(\''+role+'\');}';
      return '<button type="button" onclick="'+click+'" style="display:flex;align-items:center;gap:5px;padding:5px 12px;'
        + 'border:1px solid '+(on?'var(--yellow)':'var(--border)')+';background:'+(on?'var(--yellow)':'var(--surface)')+';'
        + 'color:'+(on?'var(--dark)':'var(--muted)')+';font-size:11px;font-weight:700;font-family:DM Sans,sans-serif;cursor:pointer;'
        + 'border-radius:'+(v==='list'?'7px 0 0 7px':'0 7px 7px 0')+';'+(v==='cards'?'margin-left:-1px;':'')+'">'+icon+' '+label+'</button>';
    }
    return '<div style="display:flex;justify-content:flex-end;margin-bottom:8px;"><div style="display:flex;">'
      + b('list','List','&#9776;') + b('cards','Cards','&#9638;') + '</div></div>';
  }

  // Resolve the entity name / display id / icon meta for an audit entry.
  function _resolveEntry(e) {
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
      displayId = 'MR';
    } else if(appId.startsWith('UNIT:')) {
      displayId = appId.slice(5);
    } else if(appId.startsWith('CT:')) {
      displayId = appId.slice(3);
    }
    return { meta: meta, extraName: extraName, displayId: displayId };
  }

  function renderEntry(e) {
    var r = _resolveEntry(e);
    return '<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0 8px 0;">'
      + '<div style="width:28px;height:28px;border-radius:7px;background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;margin-top:1px;border:1px solid var(--border);">'+r.meta.icon+'</div>'
      + '<div style="flex:1;min-width:0;">'
        + '<div style="font-size:12px;font-weight:600;color:var(--text);">'
          + (r.extraName ? '<span style="color:'+r.meta.color+';">'+r.extraName+'</span> · ' : '')
          + r.meta.label
        + '</div>'
        + '<div style="font-size:11px;color:var(--muted);margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+(e.detail||'—')+'</div>'
        + (r.displayId && r.displayId!=='SETTINGS' ? '<div style="font-size:10px;color:var(--muted);margin-top:1px;font-family:monospace;opacity:.7;">'+r.displayId+'</div>' : '')
      + '</div>'
      + '<div style="font-size:10px;color:var(--muted);white-space:nowrap;flex-shrink:0;padding-top:3px;">'+timeStr(e.ts)+'</div>'
      + '</div>';
  }

  function renderEntryCard(e) {
    var r = _resolveEntry(e);
    return '<div style="border:1px solid var(--border);border-radius:10px;background:var(--surface);padding:10px 11px;">'
      + '<div style="display:flex;align-items:center;gap:8px;">'
      +   '<div style="width:26px;height:26px;border-radius:7px;background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;border:1px solid var(--border);">'+r.meta.icon+'</div>'
      +   '<span style="font-size:11px;font-weight:700;color:'+r.meta.color+';flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+r.meta.label+'</span>'
      +   '<span style="font-size:10px;color:var(--muted);white-space:nowrap;flex-shrink:0;">'+timeStr(e.ts)+'</span>'
      + '</div>'
      + (r.extraName ? '<div style="font-size:13px;font-weight:700;color:var(--text);margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+r.extraName+'</div>' : '')
      + '<div style="font-size:11px;color:var(--muted);margin-top:'+(r.extraName?'2px':'6px')+';">'+(e.detail||'—')+'</div>'
      + (r.displayId && r.displayId!=='SETTINGS' ? '<div style="font-size:10px;color:var(--muted);margin-top:4px;font-family:monospace;opacity:.7;">'+r.displayId+'</div>' : '')
      + '</div>';
  }

  el.innerHTML = _recentToggleBar() + order.map(function(key, i) {
    var groupId = 'act_group_' + key.replace(/-/g,'');
    var isToday = dayLabel(key) === 'Today';
    // Cards: a responsive grid of tiles; List: the timeline rows.
    var entriesHtml = (_view === 'cards')
      ? '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;padding-top:6px;">' + groups[key].map(renderEntryCard).join('') + '</div>'
      : groups[key].map(renderEntry).join('');
    var entriesWrapStyle = (_view === 'cards')
      ? 'display:'+(isToday?'block':'none')+';'
      : 'display:'+(isToday?'block':'none')+';padding-left:12px;border-left:2px solid var(--border);';
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
      + '<div id="'+groupId+'" style="'+entriesWrapStyle+'">'
        + entriesHtml
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
  { key:'image',       label:'Image',           icon:'\uD83D\uDDBC\uFE0F' },
  { key:'other',       label:'Other',           icon:'\uD83D\uDCCE' }
];

// Retained as a thin compat wrapper: udpRenderFilePreviews still calls
// this. Once that path is fully migrated to DocLibrary, this can go away.
// ── Settings page patches ─────────────────────────────────────────────────
// Runs once after DOMContentLoaded so that housing.html's inline
// showSettingsSection has already been defined.
document.addEventListener('DOMContentLoaded', function(){

  // Patch showSettingsSection so switching to Nation tab calls
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

