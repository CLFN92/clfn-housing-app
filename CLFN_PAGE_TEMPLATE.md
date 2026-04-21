# CLFN Housing Suite — Standard Page Template

All layout, typography, tables, pills, progress bars, responsive behaviour,
and design tokens come from **`shared.css`** and **`shared-data.js`**.
Do not duplicate these in page files — reference the classes below.

---

## 1. View Container

Every full-page view is a direct child of `<div class="content-area">`.
`housing.css` overrides `content-area` to `display:block` so `margin:0 auto`
works correctly on children.

```html
<div id="myView"
     style="display:none;width:100%;flex-direction:column;
            padding:clamp(14px,3vw,28px);box-sizing:border-box;
            max-width:1200px;margin:0 auto;">

  <!-- Back button -->
  <div class="page-back-row">
    <button onclick="goBack()" class="back-btn-yellow">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2.5">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
      Back
    </button>
  </div>

  <!-- Page header -->
  <div class="page-header-bar">
    <div class="phb-title">
      <h1>Page Title</h1>
      <p>Subtitle / description text</p>
    </div>
    <div class="phb-actions">
      <!-- Optional: action buttons, filters, selects -->
      <button class="btn btn-primary">+ Add Something</button>
    </div>
  </div>

  <!-- Optional: stat chips row -->
  <div class="dash-stats" style="gap:12px;">
    <div class="stat-card">
      <div class="stat-num" style="color:var(--yellow);">42</div>
      <div class="stat-lbl">Total Items</div>
    </div>
    <!-- repeat stat-card as needed -->
  </div>

  <!-- Optional: filter bar -->
  <div class="filter-bar">
    <input type="text" placeholder="🔍 Search..." oninput="renderMyView()"/>
    <select onchange="renderMyView()">
      <option value="">All Statuses</option>
      <option value="active">Active</option>
    </select>
  </div>

  <!-- Table -->
  <div class="std-table-card">
    <div class="doclib-table-wrap">
      <table class="std-table" style="min-width:600px;">
        <thead><tr>
          <th>Column A</th>
          <th>Column B</th>
          <th style="width:80px;"></th>
        </tr></thead>
        <tbody id="my_tbody">
          <tr><td colspan="3" class="empty-state">Loading…</td></tr>
        </tbody>
      </table>
    </div>
  </div>

</div>
```

---

## 2. Key CSS Classes (all from shared.css)

### Layout
| Class | Purpose |
|---|---|
| `.content-area` | Scroll container — `display:block` (housing.css override) |
| `.app-wrapper` | Sidebar + content-area row |
| `.page-back-row` | Back button row with top padding |
| `.back-btn-yellow` | Standard yellow back button |
| `.page-header-bar` | Title row with yellow left accent bar |
| `.phb-title` | Left side of header (h1 + p) |
| `.phb-actions` | Right side of header (buttons, selects) |
| `.dash-view` | Padded view with max-width:1200px and margin:0 auto |

### Tables
| Class | Purpose |
|---|---|
| `.std-table-card` | White card wrapper with border and radius |
| `.std-table-hdr` | Optional header inside card (title + count) |
| `.doclib-table-wrap` | `overflow-x:auto` scroll wrapper |
| `.std-table` | Standardised table: dark thead, hover rows |
| `.std-table tr.clickable` | Adds `cursor:pointer` and hover bg |
| `.std-cell-primary` | Bold text cell |
| `.std-cell-right` | Right-aligned cell |
| `.std-cell-tail` | Small muted right-aligned tail cell |
| `.std-row-avatar` | 32px circular avatar cell |
| `.empty-state` | Centred empty/loading message cell |
| `.col-hide-mobile` | Hidden at ≤700px |

### Pills & Badges
| Class | Purpose |
|---|---|
| `.pill` | Status pill with dot indicator |
| `.pill-submitted` | Blue — awaiting review |
| `.pill-approved` | Green — approved |
| `.pill-declined` | Red — declined |
| `.pill-returned` | Orange — returned |
| `.pill-draft` | Grey — draft |
| `.pill-assigned` | Green — assigned |
| `.std-pill` | Finance-style pill (no dot) |
| `.std-pill-paid` | Green |
| `.std-pill-pending` | Amber |
| `.std-pill-overdue` | Red |
| `.std-pill-info` | Blue |
| `.badge`, `.pill` | Generic badge with colour variants |
| `.badge-yellow/green/red/blue/purple/gray` | Colour variants |

### Stats & Progress
| Class | Purpose |
|---|---|
| `.dash-stats` | Responsive stat grid (5-col desktop → 1-col mobile) |
| `.stat-card` | Individual stat tile |
| `.stat-num` | Large number |
| `.stat-lbl` | Label below number |
| `.stat-bar` | Progress bar track |
| `.stat-fill` | Progress bar fill (set `width` inline) |

### Grids
| Class | Purpose |
|---|---|
| `.fg.c2` / `.c2` | 2-column grid |
| `.fg.c3` / `.c3` | 3-column grid |
| `.fg.c4` | 4-column grid (housing.css) |
| `.fg` | flex column stack |

### Filter Bars
| Class | Purpose |
|---|---|
| `.filter-bar` | Standard filter row (flex, gap, border-bottom) |
| `.dash-filters` | Dashboard filter row |
| `.std-filter-row` | DocLib-style filter row |
| `.std-filter-label` | Uppercase label in filter row |
| `.std-filter-control` | Input/select inside filter row |

### Cards & Modals
| Class | Purpose |
|---|---|
| `.card` | White surface card with border + radius |
| `.card-dark` | Dark variant |
| `.modal-hdr` | Dark header inside modal/card with yellow underline |
| `.modal-hdr.spacious` | More padding variant |
| `.modal-hdr.sticky` | Sticky positioned |
| `.modal-close` | × close button |

### Tabs
| Class | Purpose |
|---|---|
| `.tabs` | Flex tab row with yellow border-bottom |
| `.tab-btn` | Individual tab button |
| `.tab-btn.active` | Active state (yellow underline) |
| `.settings-tab` | Alias for `.tab-btn` (settings page) |

### Forms
| Class | Purpose |
|---|---|
| `.f` | Form field (label + input stack) |
| `.fg.c2` inside `.f` | 2-column form row |
| `.settings-form` | 2-col settings grid → 1-col on mobile |

### Typography
| Class | Purpose |
|---|---|
| `.ctitle` | Section title (uppercase, muted, 12px) |
| `.sec-hdr h1` | Section heading (serif) |
| `.std-page-title` | Page title (serif clamp) |
| `.std-page-subtitle` | Subtitle (muted 13px) |

---

## 3. Responsive Breakpoints (shared.css + housing.css)

| Breakpoint | Key behaviours |
|---|---|
| `≥1024px` | Larger header logo and padding |
| `≤960px` | Sidebar narrows, stat grids 2-col |
| `≤700px` | Sidebar becomes slide-out drawer, views collapse to single column, `.col-hide-mobile` hides columns, filter inputs stack |
| `≤480px` | Extra tight padding, modals full-width, stat grids 1-col |

**All view containers** are handled automatically by:
```css
/* shared.css */
#worklistView, #dashView, #inventoryView, #matchView, #tenantsView,
#renoApprovalsView, #renosView, #contractorsView, #scorecardView,
#employeeHomeView { padding-top: 0 !important; }

/* mobile padding override */
@media (max-width: 700px) {
  #worklistView, #dashView, ... { padding-left: 14px !important; ... }
}
```

**New views** must be added to the `shared.css` view list and to `housing.css`
responsive overrides if they use custom grids.

---

## 4. Design Tokens (CSS Variables)

```css
--yellow:   #F8E41A   /* primary accent */
--dark:     #111110   /* header / modal-hdr background */
--dark2:    #1c1c1a   /* table header background */
--surface:  #ffffff   /* card / input background */
--bg:       #f8f8f6   /* page background */
--border:   #e5e5e0   /* dividers */
--text:     #111110   /* body text */
--muted:    #888884   /* secondary text */
--radius:   10px      /* card border-radius */
--sans:     DM Sans   /* body font */
--serif:    DM Serif Display  /* heading font */
--tr:       all .15s ease     /* transition */
```

---

## 5. Standard JS Render Pattern

Every view follows this pattern. Helper functions must be defined in
**`shared-data.js`** (not inside page files) to work across both
`housing.html` and `renos.html`.

```javascript
// In shared-data.js:
function showMyView() {
  if(!window._navSkipPush) pushNav('myview');
  setNavActive('tab_myview');
  _showView('myView', renderMyView);   // _showView hides others, shows target
}

function renderMyView() {
  var tbody = document.getElementById('my_tbody');
  if(!tbody) return;

  var items = window._myData || [];
  if(!items.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-state">' +
      '<div class="empty-icon">📋</div><p>No items found.</p></td></tr>';
    return;
  }

  tbody.innerHTML = items.map(function(item) {
    return '<tr class="clickable" onclick="openItem(\'' + item.id + '\')">' +
      '<td class="std-cell-primary">' + item.name + '</td>' +
      '<td><span class="pill pill-' + item.status + '">' +
        '<span class="pill-dot"></span>' + item.status +
      '</span></td>' +
      '<td class="std-cell-tail">' +
        '<button class="btn btn-ghost" onclick="event.stopPropagation();editItem(\'' + item.id + '\')">Edit</button>' +
      '</td>' +
      '</tr>';
  }).join('');
}
```

---

## 6. Rules for Adding New Pages

1. **View div:** Direct child of `content-area`, `display:none`, `max-width:1200px`, `margin:0 auto`, `width:100%`
2. **Back button:** Always `<div class="page-back-row"><button class="back-btn-yellow">`
3. **Header:** Always `<div class="page-header-bar"><div class="phb-title"><h1>` + optional `.phb-actions`
4. **Tables:** Always `std-table-card` → `doclib-table-wrap` → `std-table`
5. **Pills:** Use `.pill .pill-{status}` with `.pill-dot` for status, `.std-pill .std-pill-{variant}` for values
6. **No inline font sizes** for headings — use the shared classes
7. **No inline grid columns** — use `.fg.c2`, `.fg.c3`, `.c2`, `.c3`
8. **Helper functions** that are called from dynamic renders must be in `shared-data.js`, never scoped inside page-level functions
9. **Register new view IDs** in `shared.css` padding-top list and `housing.css` responsive rules
10. **Add to nav map:** `window._navMap` in the page file and `hideAllViews()` list in `shared-ui.js`
