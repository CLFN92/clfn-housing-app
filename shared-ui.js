/* ============================================================
 * shared-ui.js — CLFN Housing Suite
 * UI primitives: toast, navigation stack, header, role switcher
 * ============================================================
 * Depends on: shared-config.js, shared-auth.js
 * Load order: shared.js → shared-config.js → shared-auth.js → THIS FILE → shared-data.js
 *
 * Exposes (as globals):
 *   showToast(msg, opts)           — notification toast
 *   pushNav(viewName)              — push to navigation stack
 *   goBack()                       — pop navigation stack and navigate
 *   setNavActive(id)               — highlight a sidebar nav button
 *   hideAllViews()                 — hide all page view containers
 *   updateHeaderUser(role)         — update header avatar/name/badge
 *   headerSignOut()                — prompt and sign out
 *   switchRole(role)               — set effective role + refresh UI
 *   updateRoleSwitcherVisibility() — no-op (handled by updateHeaderUser)
 *   edGuard(featureName, callback) — run callback if editScoreModel allowed, else toast and return false
 *   escapeHtml(v)                  — HTML-escape a value for safe innerHTML
 *   applyBrandingToHeader()        — patch nation-name placeholders in the page chrome from NATION_CONFIG
 *   applyNationOverrides()         — merge housing_settings.nation_config_override on top of NATION_CONFIG, then re-brand
 *   buildNationFooterStrip(opts)   — assemble a one-line Confidential footer from NATION_CONFIG contact fields
 *   _showView(id, renderFn)        — hide all + show one view + run renderFn
 *   _navStack                      — navigation history array
 * ============================================================ */

// ── Navigation stack ─────────────────────────────────────────────────────────
window._navStack = [];

// ── escapeHtml ───────────────────────────────────────────────────────────────
// Escape user-supplied data before interpolating it into innerHTML strings.
// Returns the empty string for null/undefined so template literals stay clean.
function escapeHtml(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── showToast ────────────────────────────────────────────────────────────────
// Unified toast for all pages.
// opts.duration  — ms before dismissal (default 2800)
// opts.position  — 'top' (default) | 'bottom'
// opts.type      — 'default' (default) | 'error'
function showToast(msg, opts) {
  opts = opts || {};
  var duration = opts.duration || 2800;
  var position = opts.position || 'top';
  var isError  = opts.type === 'error';
  var isInfo   = opts.type === 'info';

  // Reuse a single fixed-position stack so multiple toasts queue vertically
  // instead of stacking on top of each other at the same coordinates. Without
  // this, two errors fired back-to-back are completely unreadable.
  function _ensureStack() {
    var stackId = position === 'bottom' ? '_clfn_toast_stack_b' : '_clfn_toast_stack_t';
    var s = document.getElementById(stackId);
    if (s) return s;
    s = document.createElement('div');
    s.id = stackId;
    var posCss = position === 'bottom' ? 'bottom:24px;top:auto;' : 'top:20px;';
    s.style.cssText = [
      'position:fixed;', posCss,
      'left:50%;transform:translateX(-50%);',
      'display:flex;flex-direction:' + (position === 'bottom' ? 'column-reverse' : 'column') + ';gap:8px;',
      'align-items:center;z-index:99999;pointer-events:none;',
      'max-width:calc(100vw - 24px);'
    ].join('');
    return s;
  }

  var t = document.createElement('div');
  t.textContent = msg;
  var colors = isError
    ? 'background:#3b0a0a;color:#fca5a5;border:1.5px solid #7f1d1d;'
    : isInfo
      ? 'background:#0b1d3b;color:#bfdbfe;border:1.5px solid #1d4ed8;'
      : 'background:#111;color:#F8E41A;';
  t.style.cssText = [
    colors,
    'padding:10px 22px;border-radius:8px;',
    'font-size:13px;font-weight:600;font-family:DM Sans,sans-serif;',
    'box-shadow:0 4px 24px rgba(0,0,0,0.5);',
    'max-width:100%;text-align:center;pointer-events:auto;',
    // Multi-line allowed so long PostgREST errors aren't truncated.
    'white-space:pre-wrap;word-break:break-word;'
  ].join('');
  // Tap-to-dismiss on touch devices.
  t.addEventListener('click', function(){ if(t.parentNode) t.remove(); });

  function _mount() {
    if (!document.body) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _mount, { once: true });
      } else {
        setTimeout(_mount, 50);
      }
      return;
    }
    var stack = _ensureStack();
    if (!stack.parentNode) document.body.appendChild(stack);
    stack.appendChild(t);
    setTimeout(function() {
      if (t.parentNode) t.remove();
      if (stack.parentNode && !stack.children.length) stack.remove();
    }, duration);
  }
  _mount();
}


// ── pushNav ───────────────────────────────────────────────────────────────────
function pushNav(viewName) {
  var stack = window._navStack;
  if (stack.length && stack[stack.length - 1] === viewName) return; // no duplicates
  stack.push(viewName);
  if (stack.length > 20) stack.shift(); // cap
}

// ── Cross-page navigation referrer ────────────────────────────────────────────
// In-memory _navStack resets on every page navigation, so a back button on
// housing.html can't know the user came from match.html. setNavReferrer is
// called just before a cross-page redirect; consumeNavReferrer reads-and-clears
// on the destination. Persisted in sessionStorage so it survives the page load.
var CLFN_NAV_REFERRER_KEY = 'clfn_nav_referrer';
// Page-key → URL mapping. Used by goBack / closeApplicationForm when there is
// no in-page back target to fall back on.
window.CLFN_PAGE_ROUTES = window.CLFN_PAGE_ROUTES || {
  'home':        'housing.html',
  'worklist':    'housing.html?view=worklist',
  'inventory':   'inventory.html',
  'match':       'match.html',
  'renovations': 'renos.html',
  'contractors': 'contractors.html',
  'tenants':     'tenants.html',
  'settings':    'housing.html?view=settings'
};
function setNavReferrer(pageKey) {
  if (!pageKey) return;
  try { sessionStorage.setItem(CLFN_NAV_REFERRER_KEY, String(pageKey)); } catch(e) {}
}
function peekNavReferrer() {
  try { return sessionStorage.getItem(CLFN_NAV_REFERRER_KEY) || ''; } catch(e) { return ''; }
}
function consumeNavReferrer() {
  var v = peekNavReferrer();
  try { sessionStorage.removeItem(CLFN_NAV_REFERRER_KEY); } catch(e) {}
  return v;
}

// ═══════════════════════════════════════════════════════════════════════════
// TABLE SORT + COLUMN-MENU FILTER — shared scaffolding (Phase 2)
// ═══════════════════════════════════════════════════════════════════════════
// Pattern: each <th> the page wants interactive carries data-sort-key="X"
// and class="std-th-sortable". Clicking ANY column header opens a small
// popover anchored to that column with:
//   • Sort: A→Z, Z→A, Clear
//   • Show values: a checklist of every value present in the current data
//     for that column, with counts. Tick/untick to filter that column.
// Sort and column-filters are combinable: one active sort across the table,
// plus per-column filter sets. Empty filter set = column passes through.
//
// State shape (persisted to sessionStorage so an in-tab reload preserves it):
//   { sort:    { key: '', dir: 1 },
//     filters: { colKey: ['valueA','valueB'], … }
//   }
//
// Per-page registration: the render fn calls tableRegisterColumns(page, config)
// each render so the menu has fresh accessor / row-source closures. The
// 'config' shape:
//   { columns: { colKey: { label, accessor: fn(row), filterable: bool } },
//     getRows: fn() → currentFilteredRows (pre-column-filter),
//     onChange: fn() // re-render }

var _TABLE_STATE_KEY = 'clfn_table_state';

function _tableStateAll() {
  try {
    var raw = sessionStorage.getItem(_TABLE_STATE_KEY);
    return raw ? (JSON.parse(raw) || {}) : {};
  } catch(e) { return {}; }
}
function _tableStateSave(all) {
  try { sessionStorage.setItem(_TABLE_STATE_KEY, JSON.stringify(all || {})); } catch(e) {}
}
function tableStateGet(page) {
  var all = _tableStateAll();
  if (!all[page]) all[page] = { sort: { key: '', dir: 1 }, filters: {} };
  if (!all[page].filters || typeof all[page].filters !== 'object') all[page].filters = {};
  return all[page];
}
function tableSetSort(page, key, dir) {
  var all = _tableStateAll();
  var st = all[page] || { sort: { key: '', dir: 1 }, filters: {} };
  if (dir === 0 || dir === null) {
    st.sort = { key: '', dir: 1 };
  } else if (dir === 1 || dir === -1) {
    st.sort = { key: key, dir: dir };
  } else {
    // No explicit dir → cycle asc → desc → off (legacy callers)
    if (st.sort.key !== key)       st.sort = { key: key, dir: 1 };
    else if (st.sort.dir > 0)      st.sort = { key: key, dir: -1 };
    else                            st.sort = { key: '',  dir: 1 };
  }
  all[page] = st;
  _tableStateSave(all);
}
function tableClearSort(page) { tableSetSort(page, '', 0); }

// Per-column filter helpers. Three states:
//   • missing (no filter set)    → show every row (default)
//   • [] empty array              → show nothing (every box unchecked)
//   • ['a','b']                   → show only rows where this column ∈ {a,b}
// tableClearColumnFilter removes the filter entirely (back to default).
// Passing an explicit [] keeps the filter active but with no values selected.
function tableSetColumnFilter(page, colKey, values) {
  var all = _tableStateAll();
  var st = all[page] || { sort: { key: '', dir: 1 }, filters: {} };
  if (!st.filters) st.filters = {};
  if (values == null) delete st.filters[colKey];
  else st.filters[colKey] = (values || []).map(String);
  all[page] = st;
  _tableStateSave(all);
}
function tableToggleColumnFilterValue(page, colKey, value) {
  var st = tableStateGet(page);
  var cur = (st.filters[colKey] || []).slice();
  var k   = String(value);
  var idx = cur.indexOf(k);
  if (idx === -1) cur.push(k);
  else cur.splice(idx, 1);
  tableSetColumnFilter(page, colKey, cur);
}
function tableClearColumnFilter(page, colKey) {
  tableSetColumnFilter(page, colKey, null);
}

// Refresh ▲/▼ indicators on every <th data-sort-key> inside the given thead.
// Active column also gets the .is-sorted class so the CSS can paint the
// yellow background. Non-active columns clear it.
function tableRefreshSortIndicators(thead, page) {
  if (!thead) return;
  var state = tableStateGet(page);
  thead.querySelectorAll('th[data-sort-key]').forEach(function(th){
    var key = th.getAttribute('data-sort-key');
    var existing = th.querySelector('.std-sort-arrow');
    if (existing) existing.remove();
    // Mark columns that have an active filter so they get an indicator.
    // An explicit empty array (Clear → uncheck all) also counts as filtered.
    var hasFilter = !!(state.filters && state.filters[key] != null);
    th.classList.toggle('is-filtered', hasFilter);
    if (state.sort.key === key) {
      th.classList.add('is-sorted');
      var arrow = document.createElement('span');
      arrow.className = 'std-sort-arrow';
      arrow.textContent = state.sort.dir > 0 ? ' ▲' : ' ▼';
      th.appendChild(arrow);
    } else {
      th.classList.remove('is-sorted');
    }
  });
}

// Apply per-column filters + sort. Returns a flat sorted array.
// accessors = { colKey: fn(row) → value }.
function tableApplyFilterSort(rows, accessors, state) {
  state = state || { sort: { key: '', dir: 1 }, filters: {} };
  accessors = accessors || {};
  var filtered = (rows || []).slice();
  // Per-column filters (AND across columns, OR within each column).
  // Missing key = no filter on this column. Empty array = explicit "show
  // nothing" (every box unchecked in the menu — user clicked Clear).
  if (state.filters && typeof state.filters === 'object') {
    Object.keys(state.filters).forEach(function(colKey){
      var values = state.filters[colKey];
      if (values == null) return; // no filter on this column
      var get = accessors[colKey];
      if (typeof get !== 'function') return;
      if (!values.length) { filtered = []; return; } // explicit empty = show nothing
      var allowed = {};
      values.forEach(function(v){ allowed[String(v)] = true; });
      filtered = filtered.filter(function(r){
        var v = get(r);
        if (v == null || v === '') v = '(none)';
        return !!allowed[String(v)];
      });
    });
  }
  // Sort
  if (state.sort && state.sort.key && typeof accessors[state.sort.key] === 'function') {
    var getS = accessors[state.sort.key];
    var dir = state.sort.dir;
    filtered.sort(function(a, b){
      var av = getS(a), bv = getS(b);
      var aN = (av == null || av === '');
      var bN = (bv == null || bv === '');
      if (aN && bN) return 0;
      if (aN) return 1;
      if (bN) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      var as = String(av).toLowerCase(), bs = String(bv).toLowerCase();
      if (as < bs) return -1 * dir;
      if (as > bs) return  1 * dir;
      return 0;
    });
  }
  return filtered;
}

// ── Column-menu popover ─────────────────────────────────────────────────
// One reusable popover element. Each open() rebuilds its content for the
// requested column. Click-outside / Escape close it.
window._tableRegistry = window._tableRegistry || {};
function tableRegisterColumns(page, config) {
  window._tableRegistry[page] = config || {};
}

function _ensureColumnMenu() {
  var menu = document.getElementById('std_col_menu');
  if (menu) return menu;
  menu = document.createElement('div');
  menu.id = 'std_col_menu';
  menu.className = 'std-col-menu';
  menu.style.display = 'none';
  document.body.appendChild(menu);
  return menu;
}

function tableCloseColumnMenu() {
  var menu = document.getElementById('std_col_menu');
  if (menu) { menu.style.display = 'none'; menu.innerHTML = ''; menu.removeAttribute('data-page'); menu.removeAttribute('data-col-key'); }
  document.removeEventListener('click',  _tableMenuOutsideClick, true);
  document.removeEventListener('keydown', _tableMenuKeydown,     true);
}

function _tableMenuOutsideClick(e) {
  var menu = document.getElementById('std_col_menu');
  if (!menu || menu.style.display === 'none') return;
  if (menu.contains(e.target)) return;
  if (e.target.closest('th[data-sort-key]')) return; // header clicks reopen the menu
  tableCloseColumnMenu();
}
function _tableMenuKeydown(e) {
  if (e.key === 'Escape') tableCloseColumnMenu();
}

function tableOpenColumnMenu(page, colKey, anchorTh) {
  var cfg = window._tableRegistry[page];
  if (!cfg || !cfg.columns || !cfg.columns[colKey]) return;
  var col = cfg.columns[colKey];
  var state = tableStateGet(page);

  var menu = _ensureColumnMenu();
  menu.setAttribute('data-page', page);
  menu.setAttribute('data-col-key', colKey);

  // Compute unique values + counts from the page's current row source.
  var rows = (typeof cfg.getRows === 'function') ? (cfg.getRows() || []) : [];
  var get  = col.accessor;
  var counts = {};
  rows.forEach(function(r){
    var v = (typeof get === 'function') ? get(r) : null;
    if (v == null || v === '') v = '(none)';
    v = String(v);
    counts[v] = (counts[v] || 0) + 1;
  });
  var valuesList = Object.keys(counts).sort();
  // Three states for selected:
  //   • undefined (filter absent) → all boxes checked (default — show all)
  //   • []                          → all boxes unchecked (user clicked Clear)
  //   • ['vacant', …]               → only those boxes checked
  var hasFilter  = !!(state.filters && state.filters[colKey]);
  var selected   = hasFilter ? state.filters[colKey] : [];
  var selSet     = {}; selected.forEach(function(v){ selSet[v] = true; });
  // allChecked = no explicit filter set yet. Show every value as checked.
  var allChecked = !hasFilter;

  var isFilterable = col.filterable !== false;
  var activeSort   = state.sort.key === colKey ? state.sort.dir : 0;

  // Build HTML
  var html = ''
    + '<div class="std-col-menu-header">' + _esc(col.label || colKey) + '</div>'
    + '<div class="std-col-menu-section">'
    +   '<button type="button" class="std-col-menu-action' + (activeSort === 1 ? ' is-active' : '') + '" data-action="sort-asc">▲ Sort A → Z</button>'
    +   '<button type="button" class="std-col-menu-action' + (activeSort === -1 ? ' is-active' : '') + '" data-action="sort-desc">▼ Sort Z → A</button>'
    +   '<button type="button" class="std-col-menu-action" data-action="sort-clear"' + (activeSort === 0 ? ' disabled' : '') + '>✕ Clear sort</button>'
    + '</div>';
  if (isFilterable && valuesList.length) {
    html += '<div class="std-col-menu-divider"></div>'
          + '<div class="std-col-menu-section std-col-menu-section-values">';
    // Always show a search box inside the popover — even for short lists
    // it's a quick filter, and on long lists (e.g. every address) it's
    // essential. Kept lightweight via a debounced filter on the values list.
    html += '<input type="text" class="std-col-menu-search" placeholder="🔍 Find..." />';
    html += '<div class="std-col-menu-values">';
    valuesList.forEach(function(v){
      var checked = allChecked || !!selSet[v];
      html += '<label class="std-col-menu-value">'
            +   '<input type="checkbox" data-value="' + _esc(v).replace(/"/g, '&quot;') + '"' + (checked ? ' checked' : '') + '/>'
            +   '<span class="std-col-menu-value-label">' + _esc(v) + '</span>'
            +   '<span class="std-col-menu-value-count">' + counts[v] + '</span>'
            + '</label>';
    });
    html += '</div>'
          + '<div class="std-col-menu-footer">'
          +   '<button type="button" class="std-col-menu-link" data-action="select-all">Select all</button>'
          +   '<button type="button" class="std-col-menu-link" data-action="clear-filter">Clear</button>'
          + '</div>'
          + '</div>';
  }
  menu.innerHTML = html;

  // Position the popover near the anchor th. Below the header, right-aligned
  // so it doesn't overflow on far-right columns.
  menu.style.display = 'block';
  menu.style.visibility = 'hidden';
  var rect = anchorTh ? anchorTh.getBoundingClientRect() : null;
  if (rect) {
    var menuW = menu.offsetWidth;
    var menuH = menu.offsetHeight;
    var top   = rect.bottom + window.scrollY + 4;
    var left  = rect.left   + window.scrollX;
    // Prefer left-aligned with the column; if that would overflow the viewport,
    // pull the menu left until it fits.
    if (left + menuW > window.scrollX + document.documentElement.clientWidth - 8) {
      left = Math.max(window.scrollX + 8, window.scrollX + document.documentElement.clientWidth - menuW - 8);
    }
    // If the menu would go off the bottom, flip it above the header.
    if (top + menuH > window.scrollY + document.documentElement.clientHeight - 8) {
      top = Math.max(window.scrollY + 8, rect.top + window.scrollY - menuH - 4);
    }
    menu.style.top  = top  + 'px';
    menu.style.left = left + 'px';
  }
  menu.style.visibility = '';

  // Wire menu interactions
  menu.querySelectorAll('[data-action]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var action = btn.getAttribute('data-action');
      if (action === 'sort-asc')   { tableSetSort(page, colKey, 1); }
      else if (action === 'sort-desc')  { tableSetSort(page, colKey, -1); }
      else if (action === 'sort-clear') { tableClearSort(page); }
      else if (action === 'select-all') {
        // Select all = remove the filter entirely (default state: show every row).
        tableClearColumnFilter(page, colKey);
        menu.querySelectorAll('.std-col-menu-value input[type="checkbox"]').forEach(function(cb){ cb.checked = true; });
      }
      else if (action === 'clear-filter') {
        // Clear = uncheck every box. User can now tick the values they want.
        // Stored as an explicit empty filter so the table shows nothing until
        // they pick at least one value.
        tableSetColumnFilter(page, colKey, []);
        menu.querySelectorAll('.std-col-menu-value input[type="checkbox"]').forEach(function(cb){ cb.checked = false; });
      }
      if (typeof cfg.onChange === 'function') cfg.onChange();
      // For sort actions, close the menu after applying. For filter changes,
      // leave it open so the user can adjust multiple values.
      if (action === 'sort-asc' || action === 'sort-desc' || action === 'sort-clear') {
        tableCloseColumnMenu();
      }
    });
  });
  // Checkbox toggles — apply immediately, leave menu open.
  menu.querySelectorAll('.std-col-menu-value input[type="checkbox"]').forEach(function(cb){
    cb.addEventListener('change', function(){
      // Capture the full current selection from the menu and write it back.
      var newSel = [];
      menu.querySelectorAll('.std-col-menu-value input[type="checkbox"]').forEach(function(cb2){
        if (cb2.checked) newSel.push(cb2.getAttribute('data-value'));
      });
      // If all values are checked, that's the same as "no filter".
      if (newSel.length === valuesList.length) tableClearColumnFilter(page, colKey);
      else tableSetColumnFilter(page, colKey, newSel);
      if (typeof cfg.onChange === 'function') cfg.onChange();
    });
  });
  // Search box within the values list (only present when >8 values)
  var search = menu.querySelector('.std-col-menu-search');
  if (search) {
    search.addEventListener('input', function(){
      var q = (search.value || '').toLowerCase().trim();
      menu.querySelectorAll('.std-col-menu-value').forEach(function(row){
        var label = (row.textContent || '').toLowerCase();
        row.style.display = (!q || label.indexOf(q) !== -1) ? '' : 'none';
      });
    });
    setTimeout(function(){ search.focus(); }, 0);
  }

  // Install outside-click + Escape handlers
  setTimeout(function(){
    document.addEventListener('click',  _tableMenuOutsideClick, true);
    document.addEventListener('keydown', _tableMenuKeydown,     true);
  }, 0);
}

// Wire <th> click handlers — every sortable header opens the column menu.
// Idempotent: dedupes via a data-attribute flag on the thead.
function tableBindColumnMenuClicks(thead, page) {
  if (!thead || thead.getAttribute('data-col-menu-bound') === '1') return;
  thead.setAttribute('data-col-menu-bound', '1');
  thead.addEventListener('click', function(e){
    var th = e.target.closest('th[data-sort-key]');
    if (!th || !thead.contains(th)) return;
    e.stopPropagation();
    tableOpenColumnMenu(page, th.getAttribute('data-sort-key'), th);
  });
}

// Legacy alias — old callers expect tableBindSortClicks.
function tableBindSortClicks(thead, page) { tableBindColumnMenuClicks(thead, page); }

// Local HTML-escape helper (reuses the existing escapeHtml if available).
function _esc(s) {
  if (typeof escapeHtml === 'function') return escapeHtml(s == null ? '' : String(s));
  return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
  });
}

// ── goBack ────────────────────────────────────────────────────────────────────
// Pops the navigation stack and navigates to the previous view.
// Pages register their view→function map via window._navMap.
// Default map covers the common views; pages can extend it.
function goBack() {
  // Cross-page referrer wins — if a sibling page stamped one before the
  // current page loaded, route back to that page instead of falling through
  // to the in-memory stack (which resets on every navigation).
  var ref = consumeNavReferrer();
  if (ref) {
    var routes = window.CLFN_PAGE_ROUTES || {};
    if (routes[ref]) { window.location.href = routes[ref]; return; }
  }
  var stack = window._navStack;
  if (stack.length) stack.pop();
  while (stack.length && stack[stack.length - 1] === 'app') stack.pop();
  var prev    = stack.length ? stack[stack.length - 1] : null;
  var navMap  = window._navMap || {};
  var handler = prev && navMap[prev];
  if (typeof handler === 'function') {
    handler();
  } else if (typeof showEmployeeHome === 'function') {
    showEmployeeHome();
  }
}

// ── setNavActive ──────────────────────────────────────────────────────────────
function setNavActive(id) {
  var allTabs = [
    'tab_app','tab_dash','tab_scores','tab_settings','tab_match',
    'tab_inventory','tab_contractors','tab_tenants','tab_renos','tab_budget'
  ];
  allTabs.forEach(function(tid) {
    var b = document.getElementById(tid);
    if (b) { b.classList.remove('nav-active'); b.style.background = ''; b.style.color = ''; b.style.borderColor = ''; }
  });
  var el = document.getElementById(id);
  if (!el) return;
  if (id === 'tab_settings') {
    el.style.background   = 'rgba(248,228,26,0.12)';
    el.style.color        = 'var(--yellow)';
    el.style.borderColor  = 'var(--yellow)';
  } else {
    el.style.background   = 'var(--yellow)';
    el.style.color        = '#111';
    el.style.borderColor  = 'var(--yellow)';
  }
  el.classList.add('nav-active');
}

// ── hideAllViews ──────────────────────────────────────────────────────────────
// Hides every top-level view container. Pages can extend window._viewIds
// to include page-specific view IDs.
function hideAllViews(keepId) {
  var base = [
    'appLayout','settingsView','scorecardView',
    'dashView','employeeHomeView','worklistView','landingView',
    'inventoryView','matchView','tenantsView',
    'renoApprovalsView','renosView','contractorsView',
    'renosLoadingView'
  ];
  var extra = window._extraViewIds || [];
  base.concat(extra).forEach(function(id) {
    if (id === keepId) return; // keep the target visible during transition
    var el = document.getElementById(id);
    if (el) { el.style.display = 'none'; el.style.flex = ''; }
  });
  var spb = document.getElementById('stepProgressBar'); if (spb) spb.style.display = 'none';
  var sn  = document.getElementById('stepNav');          if (sn)  sn.style.display  = 'none';
  var apf = document.getElementById('appProgressFoot'); if (apf) apf.style.display = 'none';
}

// ── _showView ─────────────────────────────────────────────────────────────────
// Show target view first (before hiding others) so there's never a blank frame.
function _showView(id, renderFn) {
  var el = document.getElementById(id);
  // Show target before hiding others — eliminates blank-frame flash
  if (el) { el.style.display = 'flex'; el.style.width = '100%'; }
  hideAllViews(id);
  // Restore after hideAllViews in case it touched the kept element
  if (el) { el.style.display = 'flex'; el.style.width = '100%'; }
  if (typeof renderFn === 'function') renderFn();
}

// ── updateHeaderUser ──────────────────────────────────────────────────────────
// Updates avatar initials, name label, role badge, and conditional buttons.
// Uses CLFN_PERMS.roleLabel() for display names when available.
function updateHeaderUser(role) {
  var perms = window.CLFN_PERMS;

  // Display label — use CLFN_PERMS if available, fall back to simple map
  var label = (perms && perms.roleLabel) ? perms.roleLabel(role) : (
    { housing_employee_l1: 'Housing Staff', housing_employee_l2: 'Housing Staff',
      housing_manager: 'Housing Manager', ed: 'Executive Director',
      cfo: 'CFO', finance_l1: 'Finance Clerk' }[role] || 'Staff'
  );

  // Short badge (shown next to name). Only management-tier roles get one;
  // for those, derive the letters from the (possibly renamed) label so
  // a rename in Settings -> Nation flows through automatically. Skips
  // common joiners (of, and, the, &) so "Lands & Housing Director" -> "LH".
  function _initialsFromLabel(s) {
    if (!s) return '';
    var words = String(s).trim().split(/\s+/).filter(function(w){
      return w && !/^(of|the|and|a|an|&)$/i.test(w);
    });
    if (!words.length) return '';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  var BADGE_ROLES = { housing_manager: 1, ed: 1, cfo: 1 };
  var badge = BADGE_ROLES[role] ? _initialsFromLabel(label) : '';

  // Avatar initials — name initials if a session name exists, else
  // derive from the (renamed) label so the avatar tracks the rename
  // even when sessions lack a display name.
  var initials = _initialsFromLabel(label) || '?';
  if (HOUSING_SESSION && HOUSING_SESSION.name) {
    var parts = HOUSING_SESSION.name.trim().split(/\s+/);
    initials = parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : HOUSING_SESSION.name.slice(0, 2).toUpperCase();
  }

  var av     = document.getElementById('header_avatar');     if (av)     av.textContent = initials;
  var nameEl = document.getElementById('header_user_name');  if (nameEl) nameEl.textContent = HOUSING_SESSION.name || label;
  var badgeEl= document.getElementById('header_role_badge');
  if (badgeEl) { badgeEl.textContent = badge; badgeEl.style.display = badge ? '' : 'none'; }

  // Show Settings only for HM / ED
  var settingsBtn = document.getElementById('header_settings_btn');
  if (settingsBtn) settingsBtn.style.display =
    (ROLE.isManagement(role)) ? 'flex' : 'none';

  // Add Staff entry now lives under Settings → Admin → Users (gated via
  // applyRoleVisibility on data-roles="ed,housing_manager"); no header pill.
}

// ── headerSignOut ─────────────────────────────────────────────────────────────
function headerSignOut() {
  if (HOUSING_SESSION && HOUSING_SESSION.accessToken) {
    showConfirm({
      title:       'Sign out?',
      message:     'You will be returned to the sign-in screen.',
      confirmText: 'Sign Out'
    }).then(function(ok){ if (ok) doLogout(); });
  } else {
    switchRole('housing_employee_l1');
    showToast('Signed out.');
  }
}

// ── switchRole ────────────────────────────────────────────────────────────────
// Sets the effective role (honours view-as). Pages that need post-switch
// rendering should register window._onSwitchRole = function(role){...}
function switchRole(role) {
  window.currentRole = role;
  updateHeaderUser(role);
  updateRoleSwitcherVisibility();

  // Update nav dashboard label
  var dashLabel = document.getElementById('tab_dash_label');
  if (dashLabel) dashLabel.textContent =
    (ROLE.isManagement(role)) ? 'Dashboard' : 'Home';

  // Hide Settings nav for HE-L1/L2
  var settingsBtn = document.getElementById('tab_settings');
  if (settingsBtn) settingsBtn.style.display =
    (ROLE.isManagement(role)) ? '' : 'none';

  // Notify page — skip during boot to prevent flash back to landing page
  // window._booting is set true before resolveHousingRole and cleared after
  // initHousingPage completes. Interactive role switches (My Role dropdown)
  // happen after boot so _booting is false and _onSwitchRole fires normally.
  if (!window._booting && typeof window._onSwitchRole === 'function') {
    try { window._onSwitchRole(role); } catch(e) { console.warn('[ui] _onSwitchRole error:', e); }
  }
}

// ── updateRoleSwitcherVisibility ──────────────────────────────────────────────
// No-op — handled by updateHeaderUser. Kept as a stub so any residual calls
// in older modules don't throw. Safe to delete once all callers are gone.
function updateRoleSwitcherVisibility() { /* handled by updateHeaderUser */ }

// ── applyBrandingToHeader ────────────────────────────────────────────────────
// Replaces nation-name placeholders in the static page chrome with the values
// from NATION_CONFIG, so the same HTML can ship to any nation.
//
// Hooks (no-ops if the element/marker isn't present on the current page):
//   - <span class="hbrand-sub">              → NATION_CONFIG.display_name
//   - data-nation="display_name"             → NATION_CONFIG.display_name
//   - data-nation="short"                    → NATION_CONFIG.short
//   - data-nation-template="{NATION} — Housing Department"
//                                            → "{display_name} — Housing Department"
//                                              ({SHORT} → short, {NATION} → display)
//   - <title> — only updated if it contains the placeholder token
//                {NATION_DISPLAY_NAME}
//
// Idempotent: safe to call repeatedly; the boot wiring at the bottom of this
// file invokes it once on DOMContentLoaded.
function applyBrandingToHeader() {
  var cfg = window.NATION_CONFIG;
  if (!cfg) return;
  var disp  = cfg.display_name || cfg.name || '';
  var short = cfg.short        || '';

  // .hbrand-sub appears in the header strip on every top-level page.
  document.querySelectorAll('.hbrand-sub').forEach(function(el){
    if (disp) el.textContent = disp;
  });

  // data-nation="display_name" / data-nation="short" — generic hook for any
  // place we want to inject the nation label without hard-coding a class.
  document.querySelectorAll('[data-nation="display_name"]').forEach(function(el){
    if (disp) el.textContent = disp;
  });
  document.querySelectorAll('[data-nation="short"]').forEach(function(el){
    if (short) el.textContent = short;
  });
  // data-nation-template — supports {NATION} and {SHORT} placeholders so
  // markup can read e.g. "{NATION} — Housing Department" and stay nation-agnostic.
  document.querySelectorAll('[data-nation-template]').forEach(function(el){
    var t = el.getAttribute('data-nation-template') || '';
    el.textContent = t.replace(/\{NATION\}/g, disp).replace(/\{SHORT\}/g, short);
  });

  // data-role-label="ed" → resolves via CLFN_PERMS.roleLabel(role), which
  // honors NATION_CONFIG.role_labels overrides. Keeps inline HTML text
  // ("Executive Director") nation-overridable without hardcoded strings.
  if (window.CLFN_PERMS && window.CLFN_PERMS.roleLabel) {
    document.querySelectorAll('[data-role-label]').forEach(function(el){
      var key = el.getAttribute('data-role-label');
      if (key) el.textContent = window.CLFN_PERMS.roleLabel(key);
    });
  }

  // Document title — only swap if a placeholder token is present so we don't
  // clobber pages that intentionally set a static title (e.g. "Sign In").
  // Supports {NATION_DISPLAY_NAME} and {NATION_SHORT} placeholders.
  if (document.title && /\{NATION_(DISPLAY_NAME|SHORT)\}/.test(document.title)) {
    document.title = document.title
      .replace(/\{NATION_DISPLAY_NAME\}/g, disp)
      .replace(/\{NATION_SHORT\}/g,        short);
  }
}

// Run once at boot. Pages that re-render the header later can call this again.
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyBrandingToHeader);
  } else {
    // Document already parsed (deferred shared-ui.js load) — apply immediately.
    applyBrandingToHeader();
  }
}

// ── applyNationOverrides ─────────────────────────────────────────────────────
// Merges window._appSettings.nation_config_override (a {display_name, short,
// role_labels} object saved via Settings → Nation) on top of the build-time
// NATION_CONFIG, then re-runs applyBrandingToHeader() so any new values land
// in the page chrome immediately. Logo overrides ride along on the existing
// theme.logo settings key (handled by _applyTheme), not on this key.
//
// Call this AFTER housing_settings has been hydrated into _appSettings (i.e.
// from the same boot point that runs initApprovalAuthority and _applyTheme).
// Safe to call multiple times — each call overwrites the previous merge.
function applyNationOverrides() {
  try {
    var saved = window._appSettings && window._appSettings['nation_config_override'];
    if (!saved) return;
    var parsed = (typeof saved === 'string') ? JSON.parse(saved) : saved;
    if (!parsed || typeof parsed !== 'object') return;
    if (!window.NATION_CONFIG) window.NATION_CONFIG = {};
    // Logo lives in _appSettings.theme.logo (managed by _applyTheme), NOT here —
    // applyNationOverrides only owns nation identity, contact info, and labels.
    ['display_name', 'name', 'short',
     'mailing_address', 'website', 'phone', 'email'].forEach(function(k){
      if (parsed[k]) window.NATION_CONFIG[k] = parsed[k];
    });
    if (parsed.role_labels && typeof parsed.role_labels === 'object') {
      window.NATION_CONFIG.role_labels = Object.assign(
        {}, window.NATION_CONFIG.role_labels || {}, parsed.role_labels
      );
    }
    if (parsed.socials && typeof parsed.socials === 'object') {
      window.NATION_CONFIG.socials = Object.assign(
        {}, window.NATION_CONFIG.socials || {}, parsed.socials
      );
    }
    applyBrandingToHeader();
  } catch (e) {
    console.warn('[applyNationOverrides] failed:', e);
  }
}

// ── buildNationFooterStrip ───────────────────────────────────────────────────
// Returns a single-line "Confidential" footer string assembled from the saved
// NATION_CONFIG contact fields. Used by every print template (contractor
// agreement, work order, SOW, application snapshot, reno report) so they all
// render the same "{Nation} Housing Department · {address} · {phone} · {email}
// · {website} · Confidential" strip. Empty fields are skipped.
//
//   opts.includeConfidential — when true (default), appends "· Confidential"
//   opts.suffix              — extra trailing text (e.g. "Work Order")
function buildNationFooterStrip(opts) {
  opts = opts || {};
  var cfg = window.NATION_CONFIG || {};
  var disp = cfg.display_name || cfg.name || '';
  // Collapse multi-line addresses to comma-separated for single-line footers.
  var addr = (cfg.mailing_address || '').replace(/\s*\n+\s*/g, ', ').trim();
  var parts = [];
  if (disp)        parts.push(disp + ' Housing Department');
  if (addr)        parts.push(addr);
  if (cfg.phone)   parts.push(cfg.phone);
  if (cfg.email)   parts.push(cfg.email);
  if (cfg.website) parts.push(cfg.website);
  if (opts.suffix) parts.push(opts.suffix);
  if (opts.includeConfidential !== false) parts.push('Confidential');
  return parts.join(' · ');
}

// ── edGuard ───────────────────────────────────────────────────────────────────
// Wraps a callback with the editScoreModel approval gate. If the current role
// is allowed, the callback is invoked and the function returns true (or the
// callback's return value when it returns one). Otherwise a toast is shown
// and false is returned.
// Usage: edGuard('scoring model changes', function(){ ...do edit... });
function edGuard(featureName, callback) {
  var role = window.currentRole;
  if (window.APPROVAL_AUTHORITY && APPROVAL_AUTHORITY.can('editScoreModel', role)) {
    if (typeof callback === 'function') {
      var rv = callback();
      return (rv === undefined) ? true : rv;
    }
    return true;
  }
  showToast((featureName || 'This action') + ' requires Executive Director access.');
  return false;
}

// ── Tip popover toggle (shared) ─────────────────────────────────────────────
// Drives the `.tip-panel` open/close state used on form fields and table
// headers. Wired into markup via onclick="toggleTip('id')" or closeTip('id').
function toggleTip(id){
  var el = document.getElementById(id);
  if(el) el.classList.toggle('is-open');
}
function closeTip(id){
  var el = document.getElementById(id);
  if(el) el.classList.remove('is-open');
}
