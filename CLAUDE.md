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
- `shared-data.js` — Supabase REST wrappers (`sbLoadApplications`, `sbSaveUnit`, `sbLoadAuditLog`, …), role mapping, `auditEntry()` writing to both in-memory `auditLog[]` and `housing_audit_log` table. All functions are fire-and-forget safe (catch + warn, never throw). Also owns `renderWorklist()` and all contractor modal/print logic (so contractors.html can call it without loading housing-specific modules).
- `shared-ui.js` — view show/hide helpers (`hideAllViews`, `_showView`), nav, toast.
- `approval-authority.js` — single source of truth for who can approve what. Use `APPROVAL_AUTHORITY.can(action, role)` / `.who(action)` / `.get(key)` instead of inline `role === 'ed'` checks. Defaults are merged with overrides from `housing_settings` at login.
- `scoring.js` — V2 ED-adjustable scoring model (applications + reno scoring).
- `shared.js` — base utilities loaded first on every page. Also hosts the **`DocLibrary`** component (see below) and the raw-`fetch()` Supabase helper layer.

### housing.html sub-modules
The biggest page is split into JS files loaded in this order:
```
housing-views.js → housing-settings.js → housing-modals.js → housing-modals-sow.js → housing-tic.js → housing-app.js → housing-init.js
```
(`notifications.js` is also loaded between `housing-views.js` and `housing-settings.js`.) `housing-init.js` runs last and owns DOMContentLoaded / login flow / data load.

- `housing-modals-sow.js` — SOW (Statement of Work) modal: open/save/approve, work-order email firing, `sowApproveInline()` (see Worklist below).
- `housing-tic.js` — the **Tenant Information Card (TIC)** full-screen modal (see its own section below). Loaded on both `housing.html` and `tenants.html` so the TIC can be opened from the worklist and from tenant rows.

### My Worklist (`renderWorklist()` in `shared-data.js`)
The landing-page action queue is a single function that renders grouped sections for every item type requiring action. It lives in `shared-data.js` (not housing-init.js) so that all pages that load shared-data can trigger a refresh via `if (typeof renderWorklist === 'function') renderWorklist()`.

**Current sections (in order):**
1. **My Drafts** — draft applications/SOWs/RFQs created by the logged-in user. Each row has two buttons: "Continue →" (yellow) and "Archive" (ghost). Archive helpers are attached to `window` so inline `onclick` strings can reach them: `window._wlArchiveSow(uid, pn)`, `window._wlArchiveApp(appId)`, `window._wlCancelRfq(rfqId)`.
2. **Applications** — submitted/mgr_approved apps for management; returned apps for the owner.
3. **Renovations Waiting Approval** — SOWs needing HM or ED sign-off. HM sees `''`/`'draft'`/`'signed'`/`'submitted'`; ED sees `'hm_approved'` (and can also act on earlier statuses). Clicking opens the SOW modal in-place via `openSowModal()` when available, otherwise navigates to renos.html.
4. **RFQs Open for Bids** — `status === 'issued'` RFQs for management.
5. **Contractors Waiting Approval** — `pending_review` (HM verifies) → `hm_recommended` (ED approves).
6. **Inventory Approvals** — units where `unitHmSig` is set but `decision` is blank (HM pending), or `unitEdSig` pending / HM deferred to ED. Links to `inventory.html?unit=<id>` which auto-opens the unit detail panel.
7. **Ready to Match** — `ed_approved`/`mgr_approved` apps with no assigned unit.

**IMPORTANT — SOW `approval_status` stored values:** The values stored in the database are `''` (empty string, means new/draft), `'draft'`, `'signed'`, `'submitted'`, `'hm_approved'`, `'ed_approved'`, `'completed'`. The labels shown in the renos.html approval table ("Pending HM", "HM Approved", etc.) are **computed from** these stored values — they are never stored. Do not check for `'pending_hm'` or `'pending_ed'` in worklist logic; those strings do not exist in the data.

**`sowApproveInline()`** in `housing-modals-sow.js` — allows HM/ED to approve a SOW from the worklist without leaving the landing page. Shows a confirm dialog, sets the appropriate sig fields (`sow_hm_name`/`sow_hm_date` or `sow_ed_name`/`sow_ed_date`), then calls `sowSaveClicked()` which handles the approval_status transition and triggers a work-order email if applicable. After final approval the modal closes and `renderWorklist()` refreshes the queue.

**Post-save SOW navigation:** After `sowSaveClicked()` completes, the page does NOT show a "Renovation request updated" dialog. Instead it shows a toast and does a smart refresh: if `#worklist_body` exists → `renderWorklist()`; else if reno approvals view is open → `showRenoApprovals()`. This avoids stranding the user on renos.html when approval was triggered from the landing page.

### Roles & permissions
Canonical roles (see `shared-config.js` `ROLE` and the role matrix in `PLAN.md` Phase A):
`ed`, `housing_manager`, `housing_employee_l2`, `housing_employee_l1`, `field_employee`, `cfo`, `finance_l1`.

- **`field_employee`** — maintenance crew (in-house labour). Renovations-execution role: accesses **Inventory** + **Renovations** only, can create/edit SOWs, **complete work orders**, and edit **progress reports** (`editRenoProgress`). Excluded from applications (`canCreateApp`/`canEditApp` false), all approvals, finance, settings, and tenant edits — the **TIC is read-only** for this role (gated in `_ticWrite`/`_ticOnBodyChange`). No contractor step on its work orders (`.sow-ct-row` hidden). Granted housing access via `hasHousingAccess`/`ROLE.hasAccess`; **not** in `ROLE.isManagement`. Home tiles are a dedicated Field-Employee set in `showEmployeeHome`.

- ED is the only role with override authority and view-as switching (`window._viewAsRole`). `currentRole` is the *effective* role; `_realRole` is the actual authenticated role.
- Legacy strings (`employee`, `staff`, `hm`, `manager`) are normalized via `CLFN_PERMS.normalizeRole()` — don't hand-write fallbacks for them in new code.
- For approval gates, prefer `APPROVAL_AUTHORITY.can(...)` over raw role comparisons. Phase B work is migrating remaining inline checks.
- `unlockSignatures` is an ED-only approval action (in `approval-authority.js`) reserved for unlocking applicant signatures after an application is submitted. The authority is defined but not yet wired to a UI firing point.

### Multi-nation gating
- Optional modules registered in `CLFN_MODULES._enabled` / `_licensed` (`shared-config.js`): `finance`, `match`, `contractors`, `renovations`, `rfq`, `mapping`. Core modules (applications, inventory, tenants, worklist) cannot be disabled.
- `CLFN_MODULES.isEnabled(mod)` gates nav tiles and entry points; `isEnabled` is true only when the module is both licensed and enabled (or is CORE). Super users toggle modules in **Settings → Nation → Modules** — the table auto-renders one row per `listOptional()` entry, so registering a new key in `_enabled`/`_licensed` is all that's needed to surface a toggle. State persists to `housing_settings` key `module_enablement` and is audited (`_onModuleToggle` in `scoring.js`).
- **`moduleOn(mod)`** (in `shared-config.js`) is the convenience gate to use at feature firing points. It fails open (returns `true` if the registry/settings aren't loaded) and **lazily hydrates** saved overrides from `_appSettings` on sub-pages — only `housing.html` calls `initModuleEnablement()` at login, so renos/inventory/tenants/rfq rely on `moduleOn()` (or a manual `initModuleEnablement()` call) to see the persisted state.
- **`rfq` module** gates every RFQ entry point: worklist "RFQs Open for Bids" + draft RFQs, the RFQ button in Reno Approvals (`renos.html`) and the SOW modal/list (`housing-modals-sow.js`), the "RFQs & Contracts" section on the inventory unit panel (`udpRenderRfqSection`), and a page-level redirect at the top of `rfq.js` (bounces to `housing.html` when off).
- **`mapping` module** gates the Unit Location & Photo feature: the TIC Overview map widget + "Set Location & Photo" (SLP) button are hidden when off (`_ticRenderOverview` in `housing-tic.js` skips the right-hand column and `_ticInitMap`).
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

### Housing unit fields
Unit records (`housing_units`) have these non-obvious fields:
- `deptNumber` — Department Number (cost-centre for capital budget tracking)
- `acctNumber` — Account Number for recurring charges (rent, utilities). Has a tooltip in the UI.
- `insuredValue` — Insured Value (formerly "Construction Cost"). All unit types.
- `cmhcValue` — CMHC Value. Only enabled when `funder === 'CMHC_95'`; null otherwise. `ueFunderChanged()` in `housing-modals.js` enforces this gate.
- `unitHmSig` / `unitEdSig` — HM/ED approval decisions on the unit's renovation budget. Each is `{name, date, decision, notes, savedAt}`. Decision values: `'approved'`, `'declined'`, `'deferred'` (HM only — escalates to ED). These are saved only when a name or decision is entered in the unit edit modal; null means no approval has been initiated. The approval blocks in the unit edit modal are shown/hidden by `ueUpdateBudgetRouting()` based on SOW total cost vs. the HM budget limit (`hmBudgetLimit` in settings, default $25k).
- `latitude` / `longitude` — decimal map coordinates for the unit. Set via the TIC "Set Location & Photo" (SLP) flow or the bulk geocode script (see TIC section). The TIC Overview tab renders an OpenStreetMap embed from these; null shows a "Coordinates not yet set" placeholder.
- `hydro_meter_number` / `gas_meter_number` — utility meter numbers. These live on `housing_units` (not `tenants`); the hydro/gas **account** numbers still live on `tenants`. Edited from the TIC Utilities tab; fields with `saveTarget: 'unit'` PATCH to `housing_units`.

### Tenant Information Card (TIC) & maps (`housing-tic.js`)
The TIC is a self-contained IIFE full-screen modal opened via `window.openTenantCard(idOrUnitId)` / closed with `window.closeTenantCard()`. It's triggered from tenant rows on `tenants.html` and from the worklist on `housing.html` (which is why `housing-tic.js` loads on both). Loaded after `housing-modals.js` so the footer "New Work Order" button can hand off to `openSowModal()`.

**Tabs:** Overview, Utilities, Documents, Unit History (and tenant detail fields). `_ticRenderOverview()` / `_ticRenderUtilities()` render the panels; a known footgun is the DocLibrary not mounting until its tab is actually shown (several fixes around tab-switch mounting).

**Field save routing:** TIC fields carry a `saveTarget` (`'unit'` → PATCH `housing_units`; otherwise the `tenants` row). On `'unit'` save success the in-memory `housingUnits[]` cache is kept in sync. Hydro/gas **meter** numbers save to `housing_units`; hydro/gas **account** numbers save to `tenants`.

**Maps — two distinct widgets:**
- **TIC Overview map (read-only)** — a static OpenStreetMap `export/embed.html` **iframe** built from the unit's `latitude`/`longitude`. No Leaflet on this widget. Requires `frame-src https://www.openstreetmap.org` in CSP (`staticwebapp.config.json`).
- **Set Location & Photo (SLP) modal (interactive)** — an ED/admin tool to set a unit's pin + photo. Lazy-loads **Leaflet 1.9.4** (cdnjs) and **exifr** (`cdn.jsdelivr.net`) on demand via `_slpLoadScript()`. Coordinates can be set three ways: clicking/dragging the Leaflet pin, the browser Geolocation API, or **EXIF GPS** auto-extracted from an uploaded photo (`exifr.gps(file)`). `_slpSave()` PATCHes `latitude`/`longitude` to `housing_units` and uploads the photo. Self-contained so it works when launched from the worklist.

**Bulk geocoding:** `geocode-units.ps1` (run by the user on Windows, **not** in CI) back-fills coordinates for units missing them. Uses the **OSM Nominatim** API (OCAP-friendly: no Google, no API key), rate-limited to ~1 req/sec, authenticating to Supabase with the **service-role** key (passed via `-ServiceRoleKey`). Unmatched units are listed for manual entry.

### DocLibrary (shared document component, `shared.js`)
`window.DocLibrary.create(mountEl, opts)` is the reusable per-entity file manager used across the app: application Step 6 docs, the scorecard, TIC tenant + utility-bill docs, unit detail panels, finance tenant profiles, and RFQ documents. Files go to Supabase **Storage** (bucket `STORAGE_BUCKET`, default `'housing-files'`) under an entity-scoped `pathPrefix` (e.g. `units/<id>/utility-bills`); every upload/delete/category-change writes an audit row to `housing_audit_log` (`file_uploaded` / `file_deleted` / `file_category_changed`).

- **Categories** come from `opts.categories` (key/label/icon) and drive the filter chips. An **`Image`** category (`🖼️`) is in every document-type dropdown so photos can be filed alongside PDFs.
- **Inline category editing:** when not `readOnly`, each file row shows a category `<select>`; changing it calls `_updateCategory()` which re-files the doc and writes the audit row.

### Degraded mode (slow / flaky cell connections, `shared-data.js`)
Every save promise is wrapped by `_withSaveTimeout()` with a hard **10 s** timeout (`_SAVE_TIMEOUT_MS`). A timeout while the device still reports `navigator.onLine === true` calls `_enterDegradedMode()`, which sets a **30 s** cooldown (`_DEGRADED_COOLDOWN_MS`), queues saves locally via `saveQueueAdd()`, and toasts "Slow connection — saving locally…". During the cooldown all saves skip the network and queue immediately. `_runDegradedProbe()` HEAD-pings Supabase after the cooldown: success exits degraded mode and flushes the queue; another timeout extends the cooldown. The browser `online` event also clears degraded mode immediately and syncs. Implemented with a simple `Promise.race` + `setTimeout` — no `AbortController` or `navigator.connection`.

### Renovation fund sources (`RENO_FUND_RULES`)
Defined in both `scoring.js` and `renos.html` (two copies — keep in sync). Current valid pool IDs:
- `'cmhc_95'` — CMHC Section 95 (all unit types)
- `'cmhc_56'` — **REMOVED** (do not re-add)
- `'section_10'` — Section 10 (all unit types)
- `'band_house'` — Band Housing (formerly the blank `''` key — renamed)
- `'band_rep'` — Band Rep Funds (all unit types)
- `'fncfs'` — FNCFS Funds (only homes with dependants under age 17)

Each pool has an `eligible(unit, app)` predicate. `FNCFS` checks `app.children > 0` or `app.dependants > 0`. The fund source dropdown in the SOW modal is built by `_sowPopulateFundSourceDropdown()` which filters to eligible options for the current unit/application pair.

### RFQ module (`rfq.html` + `rfq.js`)
RFQs (Requests for Quotes) link a SOW to one or more contractors who are invited to bid.

**Data:** Stored in `housing_rfq` table. Loaded at boot into `window._rfqCache` (keyed by `rfq.id`) in both `housing-init.js` (for the worklist/search) and `rfq.js` (for the full RFQ page). `rfq.data` is a JSON blob holding all the form fields that aren't top-level columns.

**Status flow:** `draft` → `issued` → `awarded` (or `cancelled` at any non-awarded stage). The worklist shows `issued` RFQs. Only `draft` RFQs can be edited. The Issue button is disabled for non-draft RFQs.

**Tabs on `rfq.html`:**
- **Details** — RFQ number (auto-generated), linked SOW/unit, issue date, closes date, contact info, scope description
- **Scope** — structured scope-of-work items (checkboxes per category)
- **Recipients** — contractor selection (`_rfqSelectedCts` keyed by contractor id). Selecting contractors here populates `recipient_contractor_ids[]` on the RFQ record and drives the RFQ letter email.
- **Documents** (`_rfqDocLib`) — `DocLibrary` instance attached to this RFQ's unit. Files uploaded here also appear on the unit card in inventory. Selected documents can be attached to the RFQ email sent to contractors.
- **Contracting** — Contract Details (contract number, scope, pricing breakdown, milestone payments), dynamic rows (materials/specs, exclusions, nation-supplied items), signature blocks (nation rep + contractor). **No witness signature block.** Generate Contract button produces a jsPDF document.

**Contract numbers:** Auto-assigned format `CON-YYYY-NNNN` (4-digit sequential). `generateContractNumber()` in `rfq.js` scans `_rfqCache` for the highest existing `CON-{year}-` number and increments. Stored in `rfq.data.contract_number`; the field is readonly in the UI.

**Contracting tab dynamic rows:** Materials & Specifications, Exclusions, and Items Supplied by Nation all use dynamic row arrays (add/remove rows). These live in `rfq.data` as arrays and are rendered by `render*Rows()` functions.

**Generated contract PDF:** Uses jsPDF with the standard nation header (logo + contact info from Settings → Nation) and footer (Page X of Y). Contract body includes all Contracting tab sections. Saved contracts are uploaded to the unit's document library so they appear on the inventory unit card.

### Application scoring model
Urgent need categories (in `scoring.js` `DEFAULT_V2_SCORE_MODEL.urgent_need` and `scoreApplicationLocally()`):
- `overcrowded`, `structural`, `no_running_water`, `mold_health_hazard`, `caregiver`, `homeless` (added — 25 pts)

The scoring model is ED-adjustable via Settings → App Settings → Scoring. Changes persist in `housing_settings` key `'score_model_v2'`.

### SOW project numbers
Format: `SOW-YYYY-NN` where `NN` is a global sequential counter across all units for that year. `nextProjectNumber()` in `shared-sow.js` scans the entire `_sowCache` to find the highest existing `NN` for the current year and increments it. Numbers are NOT per-unit — a unit can have multiple SOWs but each gets a unique global number.

### Audit log attribution
`auditEntry(appId, action, detail, user)` stores the logged-in user's **email** (from `HOUSING_SESSION.email`) in the `actor` column, not the role string. `sbLoadMyRecentActivity(limit)` queries with `?actor=eq.<email>` to return only the current user's entries. This means audit entries created before the email-attribution change will not appear in "Recent Activity" (they have role strings instead of emails in the `actor` column).

### Idle timeout
`_idleLogout()` in `shared-auth.js` clears `sessionStorage` tokens **immediately and synchronously**, then fires `doLogout()` as a detached async (fire-and-forget), then redirects to `index.html?timeout=1` synchronously. Do NOT await any network call before redirecting — the blank-page bug was caused by awaiting the Supabase sign-out before navigation. `auth-login.js` checks `?timeout=1` on load and shows `#timeout-banner`.

### Email notifications
- Outbound transactional email goes through a Supabase Edge Function at `supabase/functions/send-notification/index.ts`. The function verifies the caller's JWT, sends via **Microsoft Graph** (`/users/{from}/sendMail`) using OAuth2 client_credentials against the Entra app `CLFN Housing App — Notifications`, and writes an audit row via service_role. FROM is the `housing@clfn.on.ca` shared mailbox; sent items appear in its Sent folder. Application Access Policy NOT yet applied (Mail.Send is tenant-wide; PowerShell snippet ready but hardening item is open).
- Required Edge Function secrets: `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_FROM_USER`. The Graph token is cached in-memory per Edge Function instance.
- Function accepts an optional `attachments[]` payload field (`{name, contentType, contentBytes}` per item) — passed through to Graph as `#microsoft.graph.fileAttachment` entries. Used today for the applicant PDF copy. Graph caps a single fileAttachment at ~3MB.
- Edge Function source must stay **ASCII-only**. Em-dashes, box-drawing, and other non-ASCII chars have broken the dashboard editor's parser before. Verify with `grep -P "[^\x00-\x7F]"` before pasting.
- **Client API** is `window.sendNotification(opts)` in `shared-data.js` — generic Edge Function wrapper. Per-event composition + recipient resolution lives in `notifications.js` (`EMAIL_EVENT_REGISTRY`, per-entity token builders, `_renderEmailTemplate`, `notify<Event>()` helpers). Add a new workflow notification = add a registry entry (incl. `defaultRecipientRoles` + `defaultCcRoles`) + a `notify<Event>(entity)` helper that calls `_sendSerially` + invoke it from the firing point with a `typeof === 'function'` guard. The Settings → Notifications tab auto-renders the registry for editing.
- **All sends serialize** via `_sendSerially(recipients, payloadBuilder, eventKey)`. Microsoft Graph throttles ~4 concurrent sendMail per app per mailbox; busting it returns 429 `ApplicationThrottled`. Parallel `forEach`/`Promise.all` fan-out is forbidden for sends — use the helper.
- **Recipient resolution** combines primary + CC roles via `_resolveActiveStaffForRoles` (deduped by lowercased email). Roles must match canonical strings: `ed`, `housing_manager`, `housing_employee_l2`, `housing_employee_l1`, `cfo`, `finance_l1`. Legacy strings like `'hm'` won't match — normalise via SQL.
- **Settings → Admin → Notifications tab** (ED-only, gated via `data-roles="ed"` + role check in `saveNotificationTemplate`) lets the ED edit subject/body/recipients per event. Unified two-section layout across every event: **Recipients** (primary role checkboxes; `recipientType: 'applicant'` / `'tenant'` / `'contractor'` events also show a fixed "always sends to …" info line above the grid and the "pick at least one role" validation is skipped) + **Optional CC** (role checkboxes, always optional). Rich text body editor: `contentEditable` + `document.execCommand` for B/I/U + lists + links. Sanitiser whitelists `P/BR/DIV/SPAN/STRONG/B/EM/I/U/UL/OL/LI/A`; links forced to `target=_blank rel=noopener` with `http(s)/mailto` only. Saved overrides live in `housing_settings` row `key='email_templates'` as `{subject, bodyHtml, recipientRoles[], ccRoles[]}` per event, cached as `_appSettings.email_templates`.
- **Wired events (15):**
  - `application_submitted` + `file_update_submitted` — housing-app.js `finalSubmit`, default `housing_manager`
  - `sow_created` — housing-modals-sow.js, first-save only (edits do not re-fire), default `housing_manager`
  - `contractor_submitted` — shared-data.js `saveContractor`, only on `pending_review` (not draft), default `housing_manager`
  - `application_confirmation_to_applicant` — housing-app.js `finalSubmit`, **only when the applicant ticks the inline checkbox** on the submit confirmation modal (`showConfirm` extended with `checkbox: {label, defaultChecked}` returning `{ok, checked}`). `recipientType: 'applicant'`. Sends a **PDF attachment** generated client-side via the flow below.
  - `sow_tenant_copy` — housing-modals-sow.js `sowSaveClicked` → `saveSOW({sendTenantCopy})`, **submit mode only AND only when the preparer ticks the inline checkbox** on the submit confirmation. `recipientType: 'tenant'`. Tenant email resolved via `_resolveTenantEmailForUnit(unit)` (Supabase REST `tenants?full_name=eq.<assignedName>&select=email`); silent skip with no prompt if no email on file. PDF generated client-side by `_generateSowPdfBase64` (mirrors application PDF — vector text, ~20–60 KB).
  - `sow_work_order_to_contractor` — housing-modals-sow.js `saveSOW`, fires when a save transitions the SOW into `hm_approved`/`ed_approved` from a non-approved state. Detached async prompt: `_resolveContractorForEmail(contractorId)` (in-memory `window._contractors` cache, falls back to REST), then `showConfirm` with default-on checkbox. `recipientType: 'contractor'`. Silent skip if no contractor assigned or no email on file. PDF generated by `_generateWorkOrderPdfBase64` (mirrors `printWorkOrder` — contractor-facing variant with quoted prices + work authorization notice + blank signature lines).
  - `application_mgr_recommended`, `application_hm_approved`, `application_ed_approved`, `application_declined`, `application_returned` — housing-modals.js `confirmApprovalAction()`, fired via `notifyApplicationStatusChange(app, action, notes)` after save + audit. Action mapped to event key via `_APP_ACTION_EVENT_KEY`. Default recipients configured per event in registry.
  - `contractor_hm_recommended`, `contractor_approved`, `contractor_declined`, `contractor_returned` — shared-data.js `confirmCtAction()`, fired via `notifyContractorStatusChange(ct, action, notes)` after save + audit. Action mapped to event key via `_CT_ACTION_EVENT_KEY`. Default recipients configured per event in registry.
- **Applicant PDF flow:** `_generateApplicationPdfBase64` in `notifications.js` walks the live form fields the same way `printApplicationPreview()` does and emits a **text-rendered (vector) PDF** using jsPDF's native `text()` / `line()` / `splitTextToSize()` primitives. Selectable text, sharp at any zoom, typically 20–60 KB. Signature canvases are embedded as small PNG `addImage()` calls (the only raster content). Lazy-loads jsPDF only — html2canvas is no longer used. PDF bytes extracted via `doc.output('datauristring')` + strip prefix. **Do NOT use `btoa(doc.output())`** — has encoding edge cases with arbitrary PDF bytes.
- `notifications.js` is loaded on housing/contractors/inventory/match/renos/tenants. Add to any new page that has a notification firing point.
- **EmailJS is gone.** The legacy `<script>` tags, `emailjs.init()` calls, `sendWorkflowEmail`, `sendTestEmail`, and `_sendCtWorkflowEmail` were removed. `emailContractorAgreement` is a stub that toasts "coming soon" until wired into the new pipeline.

## Conventions

- **Vanilla JS only.** No bundler, no transpiler, no JSX, no TypeScript. Use ES5-compatible patterns (`var` is fine and matches existing code; arrow functions and `async/await` are used where they already appear).
- **No new top-level HTML files without a route.** Add an entry to `staticwebapp.config.json` `routes` for any new page, or it'll 404 in production.
- **External CDNs are CSP-allowlisted, not bundled.** The few third-party libs (jsPDF, Leaflet 1.9.4, exifr) load from `cdnjs.cloudflare.com` / `cdn.jsdelivr.net`, and the TIC Overview map embeds an `openstreetmap.org` iframe. Any new CDN host, connect target, or frame source must be added to the `Content-Security-Policy` header in `staticwebapp.config.json` or the browser will block it. Prefer lazy-loading heavy libs on first use (as the SLP modal does) over global `<script>` tags.
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
