# CLFN / Multi-Nation Housing App — Plan

## Product context
- Multi-tenant SaaS platform for First Nations housing management
- First customer: Constance Lake First Nation (CLFN)
- Goal: sell to other nations with isolated data + branding + module licensing
- Superuser admin tools live in a SEPARATE codebase (out of scope here)

## Status legend
✅ done · ⏳ in progress · ⬜ pending · ⚠️ blocked · 🔖 note

---

## Phase A0 — Multi-tenancy & Module Gating  ✅

### Architecture decisions (locked)
- **Database per nation** — each nation has its own Supabase project. Nation ID = config value, not a query filter. No cross-nation data contamination possible; isolation is physical.
- **Subdomain per nation** — `clfn.housingapp.com`, `nation2.housingapp.com`. Hostname → nation detection at boot. No nation picker on login.
- **Superuser tools live in a separate codebase** — this app has no superuser concerns baked in.

### Nation config shape (loaded at boot)
```
window.NATION_CONFIG = {
  id:             'clfn',
  display_name:   'Constance Lake First Nation',
  supabase_url:   'https://fkhzrbalumzeripzolph.supabase.co',
  supabase_anon:  '<anon key>',
  branding: {
    primary_color:    '#F8E41A',
    logo_url:         '...',
    font_family:      'DM Serif Display / DM Sans',
  },
  modules_enabled: {
    renovations:  true,
    finance:      false,
    contractors:  true,
    match:        true
  }
};
```

### Module catalog (locked)
**Core modules — always on, cannot be disabled:**
- Applications & Worklist
- Applications Dashboard
- Scoring Model (V2, ED-adjustable)
- Housing Inventory
- Tenants
- Audit log viewer
- Exports (CSV/Excel/PDF) — available on every view
- Reports
- Settings, Users, Auth (infrastructure)

**Optional modules — per-nation toggle:**
- Renovations (SOWs, Progress, Reno Approvals)
- Finance (new module, UI built later)
- Contractors
- Match

**Dependency rules:**
- Renovations → auto-enables Contractors (SOWs reference contractors)

### Nation config delivery (how it gets to client)
For now: **embed in each deployment build** as `window.NATION_CONFIG`. Simplest — one config per deployment. Live CDN lookup is a future step when we have >2 nations.

### Deliverables
- [ ] `window.NATION_CONFIG` loaded at boot (CLFN as first entry)
- [ ] Nation detection from `window.location.hostname` (fallback to CLFN for localhost/preview)
- [ ] `window.CLFN_MODULES` API:
  - `isEnabled(moduleName)` — returns `true` for core modules always, false/true for optional based on config
  - `assertModule(moduleName)` — throws on unknown module name
- [ ] Core-vs-optional registry (frozen)
- [ ] Renovations→Contractors dependency rule auto-enforced
- [ ] Nav / tile hiding driven by `CLFN_MODULES.isEnabled()`
- [ ] Settings UI for ED: read-only "Enabled modules" display
- [ ] Verification

### Open questions
- 🔖 Live module-toggle reactivity mid-session? → No, refresh required. Simpler.

---

## Phase A — Role Model  ✅

### Role matrix (authoritative)
| Role key | Housing App | Finance Module | SOW Approvals | Notes |
|---|---|---|---|---|
| `ed` | Full + override | Full | All, reopen completed | Only role with override authority |
| `housing_manager` | Full | Full | HM-level, Mark Complete | |
| `housing_employee_l2` | Full edit | Full | None | No signatures, no approvals |
| `housing_employee_l1` | Read-only + create new apps (own drafts only) | None | None | |
| `cfo` | None | Full | None | Finance owner |
| `finance_l1` | None | Data-entry | None | No approvals |

### Backwards compat
- Legacy `'employee'` / `'staff'` → normalized to `housing_employee_l1`
- Legacy `'hm'` / `'manager'` → normalized to `housing_manager`

### Deliverables
- [ ] Centralized `CLFN_PERMS` module (strict enum, throws on unknown role)
  - `ROLES` frozen enum
  - `assertRole(r)`, `isValidRole(r)`
  - `hasHousingAccess`, `hasFinanceAccess`
  - `canCreateApp`, `canEditApp`, `canEditSow`, `canEditProgressForUnit`
  - `canApproveSowHm`, `canApproveSowEd`, `canMarkSowComplete`, `canReopenSow`
  - `effectiveRole()`, `realRole()`, `getViewAsOptions(role)`
- [ ] ED view-as dropdown with all new roles
- [ ] Finance Module landing tile placeholder with title
- [ ] Verification

---

## Phase B — Approval Flow Validation  ⏳

- Inventory all raw `role === '...'` checks across 3 HTML files
- Migrate to `CLFN_PERMS.*` helpers
- SOW chain validation: draft → signed → hm_approved → ed_approved → completed (+ reopen)
- Progress chain validation with new HE levels
- UI gate audit vs role matrix
- Verification

---

## Phase C — Refactor to shared.js  ⬜

### Pre-flight
- Snapshot `housing.html.pre-refactor`, `renos.html.pre-refactor`

### Moves to shared.js
- `CLFN_PERMS`, `CLFN_NATION` / `CLFN_MODULES`
- Multi-SOW helpers
- Audit log
- Supabase wrappers
- Session mgmt
- Utilities

### Stays inline
- Page-specific renderers, DOM structure

---

## Phase D — Audit & Debug  ⬜

- Full diagnostic sweep
- Dead code removal
- console.log cleanup
- Silent `.catch()` cleanup
- Bugs from refactor

---

## Phase E — Client-side Security  ⬜

- XSS audit on innerHTML
- Input validation on Save paths
- Module-enablement bypass prevention
- RLS deferred (user choice Q4=D3)

---

## Rollback points
- Pre-refactor snapshots (Phase C)

## Follow-ups parked
- Finance module actual UI
- Supabase RLS
- Nation config distribution mechanism (CDN vs shared Supabase)
- Branding theming per nation (CSS vars from config)
- Superuser admin tools (separate codebase)
