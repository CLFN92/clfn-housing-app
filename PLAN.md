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

## Phase F1 — Finance Module Infrastructure Shell  ✅

**Goal:** Retrofit the existing CLFN finance module (`finance-module_76.html`) into the
multi-nation architecture. No data layer changes yet — localStorage stays put.
Just wrap it properly.

### Decisions (locked this session)
- Full retrofit path chosen (F1 + F2 + F3 across multiple sessions) — required before Nation 2
- Finance lives in `finance.html` (separate file, like `renos.html`)
- No existing localStorage data to migrate (CLFN hasn't used it for real)
- Kevin trusts schema judgment in F2 but will review SQL before running

### Deliverables (done)
- ✅ `NATION_CONFIG` + `CLFN_MODULES` + `CLFN_PERMS` boot blocks injected in finance.html
- ✅ Auth handoff: finance.html reads `HOUSING_SESSION` from sessionStorage; bounces on missing session or insufficient role
- ✅ Role alignment: `housing_staff` → `housing_employee_l1`, `housing_staff_l2` → `housing_employee_l2`, `finance_clerk` → `finance_l1`; `readonly` removed
- ✅ `PERMISSIONS` matrix rewritten with canonical role names (16 fine-grained permissions)
- ✅ `_currentRole` / `CURRENT_USER` now session-driven, not hardcoded defaults
- ✅ Client-side "Switch Role (Testing)" menu removed; `setRole`/`toggleRoleMenu` rewritten as no-op stubs
- ✅ Inline CLFN base64 logo moved from HTML markup → `NATION_LOGOS` registry in JS
- ✅ Hardcoded "Constance Lake First Nation" / "CLFN Housing" strings replaced with `NATION_CONFIG.display_name` / `short_name` throughout print templates, voucher, cash receipt, tenant profile, reports
- ✅ Hardcoded fiscal-year notice → dynamic from `NATION_CONFIG.fiscal_year_start_month` with end-month calculated
- ✅ `<title>` tag generic; updated dynamically at runtime via `applyBrandingToHeader()`
- ✅ `housing.html` has `stashHousingSession()` helper + wired into `showFinance()`
- ✅ `showFinance()` gates on `CLFN_MODULES.isEnabled('finance')` AND `CLFN_PERMS.hasFinanceAccess(role)` before navigating
- ✅ `modules_enabled.finance = true` flipped for CLFN
- ✅ Verification: 10/10 permission matrix tests pass; JS syntax clean on both files

### Known limitations shipped in F1
- Finance data still lives in `localStorage` under key `clfn_finance_v6` — per-browser, not shared across users
- Same-browser testing with multiple roles requires logging in/out (no more self-promotion menu — this is correct)
- Finance module data is NOT reconciled with housing.html tenants/applications (different data stores)

### F1 → F2 transition notes
- Boot blocks in finance.html mirror housing.html/renos.html structure exactly — add new nations in only one place (`NATION_REGISTRY` in all three files, which should collapse into `shared.js` in Phase C)
- `FINANCE_HEADERS` already built from `SUPABASE_ANON` + session `accessToken` — ready for F3 to use
- `SUPABASE_URL` already pulled from `NATION_CONFIG` — ready for F2's new tables

---

## Phase F2 — Finance Supabase Schema  ⬜

**Goal:** Design and deploy ~12 finance tables with `nation_id` columns
+ indexes. No code changes — just SQL migration.

### Tables to design
- `finance_tenants` — tenant ledger (separate from housing `tenants` table? Or FK? Decision needed in F2)
- `finance_rent_ledger` — rent owing / paid entries
- `finance_loans` — loan headers (principal, term, status, approvals)
- `finance_loan_payments` — loan payment line items
- `finance_invoices` — invoice headers
- `finance_arrangements` — payment arrangements
- `finance_arr_payments` — arrangement payment line items
- `finance_collections` — collections flags/notes
- `finance_journal` — generic journal entries
- `finance_utility_hydro` — hydro meter readings / charges
- `finance_utility_gas` — gas meter readings / charges
- `finance_audit_log` — append-only audit trail

### Design decisions needed in F2 (walk through before SQL)
- `finance_tenants` as separate table vs FK to `tenants` in housing schema
- How to model opening balances
- Audit log: append-only or immutable via trigger
- RLS posture (deferred per F1 decisions, but nation_id indexes MUST exist)
- Soft-delete vs hard-delete for voided entries
- Foreign-key cascades for tenant deletion

---

## Phase F3 — Finance Data Layer Port  ⬜

**Goal:** Replace every `localStorage.getItem('clfn_finance_v6')` / `saveData()`
call with `fetch()` against Supabase. ~40+ locations. Likely 2-3 sessions.

### Scope
- `saveData(d)` → per-table upsert calls
- `loadData()` → login-time fetch with in-memory cache (mirror housing's `window._contractors`)
- Every add/edit/delete form submission → async Supabase POST/PATCH
- Every render function → read from cache, not localStorage
- Audit log writes → direct insert to `finance_audit_log`
- Reconcile tenant references with housing `tenants` table (decision from F2)

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
