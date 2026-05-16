# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multi-tenant SaaS housing management platform for First Nations. First customer is **Constance Lake First Nation (CLFN)**; the architecture is being prepared to onboard additional nations (database-per-nation, subdomain-per-nation, per-nation module licensing). Superuser admin tooling lives in a **separate codebase** and is out of scope here.

The active roadmap and phase status (A0/A/B/C/D/E + F1/F2/F3/F3B for the Finance module) are tracked in `PLAN.md` — read it before starting non-trivial work to know what's locked, in-progress, or deferred.

## Build / Run / Deploy

- **No build step, no package manager, no test runner.** This is a static-files SPA: vanilla JS (no framework), plain CSS, served as-is.
- **Local dev:** open the HTML files directly or serve the project root with any static server (e.g. `python -m http.server`, `npx serve .`). All inter-page navigation is `window.location.href` to other `.html` files in the same directory.
- **Deploy:** Azure Static Web Apps via the workflow in `.github/workflows/azure-static-web-apps-white-ground-0635e2610.yml`. `app_location: "/"`, `output_location: "."` — every push to `main` deploys the repo root. Routes are declared in `staticwebapp.config.json`.
- **Backend:** Supabase project `fkhzrbalumzeripzolph` (URL + anon key hardcoded in `shared-config.js`). Auth, staff lookup, applications, units, audit, finance tables — all REST/PostgREST calls from the browser. There is no API server in this repo.
- **Schema changes:** SQL migrations are run by the user via the Supabase SQL Editor (not via this repo). Phase F2 in `PLAN.md` documents the finance schema that's already deployed.
- **Edge Functions:** Source lives under `supabase/functions/`. Deployed manually via the Supabase Dashboard (paste into the function editor) or via `supabase functions deploy <name>` (CLI install on Windows is via Scoop, not npm — `npm i -g supabase` is explicitly blocked). Secrets go in Project Settings → Edge Functions → Secrets, never in code.

## Architecture

### Page model
Each top-level feature is a separate HTML file that the user navigates between via full page loads:

- `index.html` — sign-in screen and post-login employee landing
- `housing.html` — Applications & Worklist, Dashboard, Settings (the main hub)
- `inventory.html`, `tenants.html`, `match.html` — housing inventory views
- `renos.html` — Renovations / SOWs / Progress / Reno Approvals
- `contractors.html` — contractor registry (auto-enabled when Renovations is on)
- `finance.html` — Finance module (rent ledger, loans, invoices, arrangements, collections, journal, hydro/gas — see Phase F1–F3 in `PLAN.md`)

Auth state crosses page loads via `sessionStorage` (`HOUSING_SESSION` is stashed by `housing.html` and rehydrated by sub-pages). On any page load the boot sequence resolves the role from the Supabase `staff` table via `resolveHousingRole()`.

### Shared layer (loaded by every page in this order)
```
shared.js  →  shared-config.js  →  shared-auth.js  →  shared-ui.js  →  shared-data.js
```
Order matters: later files reference globals (`SUPABASE_URL`, `HOUSING_SESSION`, `CLFN_PERMS`, `sbMapRole`) declared by earlier ones. `shared-config.js` sets a `window.CLFN_CONFIG_LOADED` sentinel checked downstream.

- `shared-config.js` — Supabase URL/anon key, `ROLE` enum, `APP_STATUS` enum, `CLFN_MODULES` (per-nation feature flags), `NATION_CONFIG`
- `shared-auth.js` — `CLFN_AUTH` state object, `HOUSING_SESSION`, `HOUSING_HEADERS`, `resolveHousingRole()`, `doLogout()`, `_clearLocalClientState()`. Pages register `window._onLogout` for page-specific teardown.
- `shared-data.js` — Supabase REST wrappers (`sbLoadApplications`, `sbSaveUnit`, `sbLoadAuditLog`, …), role mapping, `auditEntry()` writing to both in-memory `auditLog[]` and `housing_audit_log` table. All functions are fire-and-forget safe (catch + warn, never throw).
- `shared-ui.js` — view show/hide helpers (`hideAllViews`, `_showView`), nav, toast.
- `approval-authority.js` — single source of truth for who can approve what. Use `APPROVAL_AUTHORITY.can(action, role)` / `.who(action)` / `.get(key)` instead of inline `role === 'ed'` checks. Defaults are merged with overrides from `housing_settings` at login.
- `scoring.js` — V2 ED-adjustable scoring model (applications + reno scoring).

### housing.html sub-modules
The biggest page is split into JS files loaded in this order:
```
housing-views.js  →  housing-settings.js  →  housing-modals.js  →  housing-app.js  →  housing-init.js
```
`housing-init.js` runs last and owns DOMContentLoaded / login flow / data load.

### Roles & permissions
Canonical roles (see `shared-config.js` `ROLE` and the role matrix in `PLAN.md` Phase A):
`ed`, `housing_manager`, `housing_employee_l2`, `housing_employee_l1`, `cfo`, `finance_l1`.

- ED is the only role with override authority and view-as switching (`window._viewAsRole`). `currentRole` is the *effective* role; `_realRole` is the actual authenticated role.
- Legacy strings (`employee`, `staff`, `hm`, `manager`) are normalized via `CLFN_PERMS.normalizeRole()` — don't hand-write fallbacks for them in new code.
- For approval gates, prefer `APPROVAL_AUTHORITY.can(...)` over raw role comparisons. Phase B work is migrating remaining inline checks.

### Multi-nation gating
- `CLFN_MODULES.isEnabled('renos' | 'finance' | 'contractors' | 'match')` gates nav tiles and entry points. Core modules (applications, inventory, tenants, worklist) cannot be disabled.
- Renovations enabling auto-enables Contractors (SOWs reference contractors).
- Hardcoded `'Constance Lake First Nation'` strings are being replaced with `NATION_CONFIG.display_name` / `short` — finance.html is already fully retrofitted (Phase F1); other pages still have inline strings.

### Finance module data layer (Phase F3, shipped)
- `_FIN_TABLES` registry maps each in-memory collection (tenants, rentLedger, loanList, …) to its Supabase table + camelCase↔snake_case mapper.
- `_bootLoadFinanceData()` fetches all tables in parallel at DOMContentLoaded and hydrates `_memStore`.
- `loadData()` / `getData()` stay synchronous and return `_memStore` by reference — ~125 call sites in `finance.html` were not rewritten.
- `saveData(d)` is synchronous to the caller; internally diffs vs previous `_memStore` and fires async upserts/deletes. Failures show a persistent red toast; success is silent.
- `uid()` returns `crypto.randomUUID()` (matches Supabase `uuid` columns).
- Every `saveData` writes one audit row to `finance_audit_log` via `_writeAuditEntry()`. Per-action audit (approveLoan, postPayment, …) uses the public `writeAuditEntry()` wrapper.
- Audit tables (`finance_audit_log`, `housing_audit_log`) are append-only at the DB level via triggers + RLS — UPDATE/DELETE are blocked.
- Voids vs deletes: ledger tables use a void pattern (reversing entry with `voids_id` FK); entity tables use soft-delete (archived flag). The UI surfacing of this is Phase F3B (pending).

### Tenant data
- `tenants` is a platform-level table shared by housing + finance, trigger-synced from `housing_units.assigned_name`. Backfill ran at the F2 migration. Don't insert tenant rows by hand for production data — change `housing_units.assigned_name` and the trigger handles it.
- The current `tenants` schema is slim: housing-specific fields (unit type, rent amount, hydro/gas accounts, autoPay, …) aren't there yet and default to empty/false on load. Phase C will reconcile.

### Email notifications
- Outbound transactional email goes through a Supabase Edge Function at `supabase/functions/send-notification/index.ts`. The function verifies the caller's JWT, sends via **Microsoft Graph** (`/users/{from}/sendMail`) using OAuth2 client_credentials against the Entra app `CLFN Housing App — Notifications`, and writes an audit row via service_role. FROM is the `housing@clfn.on.ca` shared mailbox; sent items appear in its Sent folder. The Application Access Policy locks the app to that mailbox only.
- Required Edge Function secrets: `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_FROM_USER`. The Graph token is cached in-memory per Edge Function instance.
- **Client API** is `window.sendNotification(opts)` in `shared-data.js` — generic Edge Function wrapper. Per-event composition + recipient resolution lives in `notifications.js` (`EMAIL_EVENT_REGISTRY`, `_renderEmailTemplate`, `notifyApplication<Event>` helpers). Add a new workflow notification = add a registry entry + a `notify…()` helper + call it from the firing point. The Settings → Notifications tab (Phase 2) will auto-render the registry for editing.
- Wired events today: `application_submitted`, `file_update_submitted` (both fire from `finalSubmit()` in housing-app.js, both target active `housing_manager` rows in the `staff` table). Pending wiring: `mgr_approved`, `hm_approved`, `ed_approved`, `declined`, `returned`, contractor workflow events. TODO comments mark the firing points in housing-modals.js (application actions) and shared-data.js (contractor actions).
- **EmailJS is gone.** The legacy `<script>` tags, `emailjs.init()` calls, `sendWorkflowEmail`, `sendTestEmail`, and `_sendCtWorkflowEmail` were removed. `emailContractorAgreement` is a stub that toasts "coming soon" until wired into the new pipeline.

## Conventions

- **Vanilla JS only.** No bundler, no transpiler, no JSX, no TypeScript. Use ES5-compatible patterns (`var` is fine and matches existing code; arrow functions and `async/await` are used where they already appear).
- **No new top-level HTML files without a route.** Add an entry to `staticwebapp.config.json` `routes` for any new page, or it'll 404 in production.
- **Page layout, tables, pills, forms, and breakpoints are defined in `shared.css`.** Do not duplicate. The full template + class catalog is in `CLFN_PAGE_TEMPLATE.md` — read it before adding a new view. New view IDs must be added to the `shared.css` padding-top list and `housing.css` responsive overrides.
- **Helper functions called from dynamic renders must live in `shared-data.js`** (not scoped inside page-level functions) so both `housing.html` and `renos.html` can call them.
- **No `@supabase/supabase-js`** — all Supabase calls are raw `fetch()` to REST/Auth/Storage endpoints (see `shared.js:941`). The `window._sb = null` lines in `housing-init.js`, `contractors.html`, and `renos.html` are dead code — the SDK is never loaded so `_sb` stays null forever. The actual session access token lives at `HOUSING_SESSION.accessToken`. Don't reference `_sb`.
- **Refactor moves to `shared.js` are deferred to Phase C** (`PLAN.md`). Don't preemptively hoist things; snapshot files first as documented.
- **`finance.html` is ~12 MB** because it bundles a large base64 logo and a lot of inline UI. Read it with `offset`/`limit` rather than wholesale.

### Buttons & Export dropdowns (shared design — do not re-derive)

Always pair `.btn` (the size/family base) with one variant. Don't mix the `.btn-*` family with the legacy `.btn-header-ghost` (page-top header only) — their padding and font-size differ and the buttons will look mismatched side-by-side.

| Class                         | Surface                | Visual                                      | Use for                              |
| ----------------------------- | ---------------------- | ------------------------------------------- | ------------------------------------ |
| `.btn .btn-primary`           | any                    | yellow fill, dark text                      | the primary action in a row          |
| `.btn .btn-ghost`             | light cards            | transparent, text-coloured border           | secondary on light surfaces          |
| `.btn .btn-ghost-dark`        | dark `.modal-hdr`      | transparent until hover (rgba white tint)   | secondary on dark card headers       |
| `.btn-header-ghost`           | page-top dark header   | grey border, yellow on hover                | only the top header strip            |

Multiple buttons in a `.modal-hdr` use the existing flex row — don't invent a new wrapper:
```
<div class="flex-gap8 flex-wrap">
  <button class="btn btn-ghost-dark">Secondary</button>
  <button class="btn btn-primary">Primary</button>
</div>
```

**Inline Export dropdown.** When a card needs its own Export button (audit log, future panels), reuse the shared `.export-dropdown` wrap with the existing `.header-export-menu` / `.header-export-item` styling. Toggle helper is `toggleExportMenu(this)` in `shared-data.js`. Export logic flows through `_doExport(format, headers, data, filename, colWidths)` — also shared. Page-level Export (Inventory, Match, Renos, Contractors) uses `setExportView(name)` + `headerExport(format)`; don't wire new views into that unless they're top-level page views.

When two action buttons sit side-by-side in a `.modal-hdr`, **both should use `.btn .btn-primary`** (yellow) — mixing primary + ghost reads as visual noise on the dark card header.

Reference markup (audit log, `housing.html` `#sec_audit`):
```
<div class="flex-gap8 flex-wrap">
  <div class="export-dropdown">
    <button onclick="toggleExportMenu(this)" class="btn btn-primary">📤 Export</button>
    <div class="header-export-menu">
      <button onclick="exportAudit('csv')"   class="header-export-item">CSV</button>
      <button onclick="exportAudit('excel')" class="header-export-item">Excel</button>
    </div>
  </div>
  <button onclick="renderAuditLog()" class="btn btn-primary">↻ Refresh</button>
</div>
```
