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
| `field_employee` | Inventory + Renovations only: create/edit SOWs, complete work orders, edit progress. Sees only in-house work orders assigned to them (`assignedTeam=in_house` + `assignedTo=their email`). No apps; TIC read-only; no contractor step | None | Mark Complete only (no HM/ED approvals) | Maintenance crew / in-house labour. Assignment gated by `assignWorkOrder` authority |
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

## Phase B — Approval Flow Validation  ✅

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

## Phase F2 — Finance Supabase Schema  ✅

**Goal:** Design and deploy finance tables with `nation_id` columns
+ indexes. No code changes — just SQL migration.

### Decisions (locked and shipped)
- ✅ Tenant reference: new `tenants` platform table, FK from finance tables, sync trigger from `housing_units`
- ✅ Opening balances: ledger rows with `entry_type='opening_balance'`
- ✅ Audit immutability: trigger + RLS on BOTH `finance_audit_log` AND `housing_audit_log` (housing gap closed)
- ✅ Deletion pattern: void pattern for ledger tables, soft-delete (archived flag) for entity tables
- ✅ FK cascades: RESTRICT on tenant/loan/invoice, SET NULL for housing_units → ledger
- ✅ Money: `numeric(12,2)`, CAD assumed, no currency column

### Tables delivered (13 total)
**Platform table:**
- `tenants` — shared by housing + finance, trigger-synced from housing_units.assigned_name

**Finance tables (12):**
- `finance_rent_ledger` — all rent events, void pattern
- `finance_loans` + `finance_loan_payments` — entity + ledger
- `finance_invoices` — entity with lifecycle
- `finance_arrangements` + `finance_arr_payments` — entity + ledger
- `finance_collections` — case tracking
- `finance_journal` — generic manual entries
- `finance_utility_hydro` + `finance_utility_gas` — metered billing
- `finance_audit_log` — append-only

### Automation baked in
- Append-only triggers block UPDATE/DELETE on audit tables at DB level
- RLS policies + GRANT revocations prevent audit tampering
- Auto-maintained `updated_at` timestamps on entity tables
- `housing_units.assigned_name` changes trigger `tenants` sync automatically
- One-time backfill run at migration: every assigned unit now has a tenant row

### Post-deploy status
- 13 tables created in Supabase project `fkhzrbalumzeripzolph`
- Tenant backfill verified against `housing_units.assigned_name IS NOT NULL`
- User deployed via Supabase SQL Editor, single transaction, succeeded

### Schema gotcha (fixed during deploy)
First run failed with `incompatible types: uuid and text` because `housing_units.id` is `text`. Updated all 5 FK columns (`tenants.current_unit_id`, `finance_rent_ledger.unit_id`, `finance_invoices.unit_id`, `finance_utility_hydro.unit_id`, `finance_utility_gas.unit_id`) from `uuid` to `text`. Internal finance PKs remain `uuid`.

---

## Phase F3 — Finance Data Layer Port (session 1 of 2)  ✅

**Goal:** Replace localStorage-only persistence with Supabase-backed reads and
writes. Keep the existing synchronous call pattern so the ~125 call sites in
finance.html don't need to change.

### Design (locked this session)
- Load-everything-at-boot: one fetch per table at DOMContentLoaded; hydrate `_memStore`
- `getData()` / `loadData()` stay synchronous, return `_memStore` by reference
- `saveData(d)` stays synchronous from caller's view; internally diffs against
  the previous `_memStore` and fires async upserts/deletes to Supabase
- Fire-and-forget writes; success is silent, failures show persistent red toast
- UUIDs everywhere via `crypto.randomUUID()` — matches Supabase uuid columns
- Every saveData writes one audit row; richer per-action audit calls to be
  added in later phases using the public `writeAuditEntry()` helper

### Deliverables (done)
- ✅ `_FIN_TABLES` registry binding each in-memory collection to Supabase table + mappers
- ✅ Shape mappers for all 10 entities (camelCase ↔ snake_case, charge/payment ↔ signed amount):
  tenants, rentLedger, loanList, loanPayments, arrangements, arrPayments,
  collections, journalEntries, hydroLedger, gasLedger
- ✅ `_bootLoadFinanceData()` — parallel fetch of all tables at DOMContentLoaded
- ✅ `saveData()` — diff-based upsert/delete, synchronous to caller, async to Supabase
- ✅ `loadData()` / `getData()` — return `_memStore` synchronously, localStorage fallback preserved
- ✅ `uid()` returns `crypto.randomUUID()` — 51 call sites auto-upgrade
- ✅ `_writeAuditEntry()` — writes to `finance_audit_log` on every save
- ✅ `writeAuditEntry()` — public wrapper for per-action audit
- ✅ `_toastSuccess()` / `_toastError()` — UI feedback
- ✅ `seedIfEmpty()` neutralized (demo tenants no longer created; real tenants come from F2 trigger)
- ✅ DOMContentLoaded awaits `_bootLoadFinanceData()` before first render
- ✅ Syntax verified, ships via present_files

### Known caveats (acceptable for F3 session 1)
- Demo tenants (Mary/George/Sandra/David) no longer auto-seed. Either rely on
  F2 trigger-sync from housing_units, or insert rows directly via Supabase SQL
  editor for dev testing.
- `tenants` table schema has slim mapping — housing-specific fields (unit type,
  rent amount, hydro account #, gas account #, autoPay, etc.) aren't in the new
  tenants table. They default to empty/false on load. Phase C housing→finance
  alignment or new tenant columns will reconcile.
- Diff-based write uses JSON.stringify for equality — fine for this scale but
  not optimal. Per-entity save functions (saveTenant, savePayment) can replace
  the blob save later if needed.

---

## Phase F3B — Finance Data Layer Port (session 2 of 2)  ✅

**Goal:** Surface the void pattern in the UI, replace "Delete" buttons with
"Void" buttons with reason prompt, add an Audit tab showing voided entries.

### Planned work
- Replace "Delete" buttons on rent_ledger/loan_payments/arr_payments/journal/hydro/gas with "Void"
- Void modal: prompts for reason, inserts reversing entry with `voids_id` FK
- Views filter out voided + void rows by default (both hidden)
- New "Audit" tab shows ALL rows including voids, for compliance viewing
- Per-action audit entries (approveLoan, postPayment, etc.) using `writeAuditEntry()`
- Optional: retry queue in localStorage for failed writes if operational need emerges

---

## Phase C — Refactor to shared.js  ✅

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

## Phase AI — Housing AI Assistant (staff chat + draft-note assist)  ✅ (shipped)

A conversational assistant for **staff**: a floating **chat panel** (questions
about applications, units, SOWs/maintenance, renovations, contractors,
inspections, policy, and how-to) plus a **"Draft with AI"** button that writes
approval-decision notes. Backed by the single **`ai-chat`** Edge Function.

### What shipped
- **Edge Function `supabase/functions/ai-chat/index.ts`** — context-stuffing
  design: the client supplies the data context. Calls Claude
  (`claude-sonnet-4-6`). Two modes: `chat` and `draft`. Chat mode also exposes a
  read-only **`query_database`** tool (per-table role allowlist + forced filters,
  caps `MAX_ROW_LIMIT=50` / `MAX_TOOL_TURNS=6`, no write tools) for exact counts /
  full lists / records not in the loaded context. A `HOW_TO` block answers
  procedural questions, tailored to the caller's role.
  - **Hardened (2026-06):** requires a **valid Supabase user JWT** (client sends
    `HOUSING_SESSION.accessToken`, not the anon key) and **active-staff** role
    resolution from the `staff` table (403 otherwise); the verified role
    overrides any client-supplied role. Stops anon-key abuse of the paid
    Anthropic call. `ANTHROPIC_API_KEY` lives only in function secrets.
    ASCII-only source.
- **Client `ai-assistant.js`** — gathers in-memory data (`applications`,
  `housingUnits`, `_sowCache`, `_rfqCache`, `_contractors`, `_renoProgress`),
  trims/flattens it, and POSTs as `context`. Globals: `toggleAIChat()`,
  `openAIChat()`, `aiSendMessage()`, `aiDraftNote()`. Loaded on `housing.html`
  + `inspections.html`. Header button synced by `_syncAIHeaderBtn`
  (`housing-init.js`); chat panel HTML in `housing.html`.
- **Module toggle** — `ai_assistant` in `CLFN_MODULES` (label "AI Assistant
  (Chat + Draft Notes)"), per-nation licensable.

### Deploy step (manual, like send-notification)
`supabase functions deploy ai-chat` and set `ANTHROPIC_API_KEY`. The function +
client must be deployed **together** (the hardened function rejects callers that
send the anon key instead of a user token). No client CSP change needed.

### Note on the two implementations
A second design (`ai-assistant` Edge Function, server-side `query_database`
tool-use) was built in a parallel session. Decision: keep `ai-chat` (draft-note
feature) + harden it + **fold its `query_database` tool onto `ai-chat`** (done);
the standalone `ai-assistant` function was retired. So `ai-chat` is now best of
both: context-stuffing for speed + the read-only role-scoped tool for exact data.

### Possible follow-ups (not built)
- Streaming responses; per-role suggested-question chips; an audit row per query.

---

## Phase INSP — Inspections module  ✅ (shipped 2026-06)

Unit-condition inspections: standalone page (`inspections.html` +
`inspections-init.js` + `inspections.css`) reached via the **Operations** nav
dropdown (which also groups Renovations / RFQ / Contractors). New `inspections`
table (typed Move-In/Move-Out/Annual/Routine/Emergency, room-by-room checklist
JSONB, photos, pass/fail/needs-repair, PDF, and **SOW creation** from findings).
Adds `housing_units.last_inspection_date` / `next_inspection_due` and
`tenants.lease_start_date` / `lease_end_date`. Introduced the reusable
`clfnSearchSelect` combobox (body-portaled to avoid modal clipping). Gated by the
`inspections` module. Migrations: `supabase/migrations/20260622_*.sql` (run by the
user in the SQL editor).

---

## Phase G — SMS / Text Notifications  ⬜

Extends the existing email pipeline (Edge Function → Microsoft Graph) with an SMS
channel so workflow notifications (starting with **work-order-assigned to a field
employee**, mirroring `sow_assigned_to_field_employee`) can also go out as a text.
Email infrastructure is done; this is a **net-new integration**, not a tweak.

### Why it's a separate project (not a quick add)
- **Microsoft Graph cannot send SMS** — Graph is email-only. A different provider is required.
- New **Edge Function** (`send-sms`) — the email function can't be reused; SMS is a different API/auth.
- **Provider + cost** — pick one of:
  - **Azure Communication Services (ACS) SMS** — same cloud as the rest of the stack, but needs a provisioned toll-free/short-code number (US/CA registration/verification, can take days–weeks) and per-message billing.
  - **Twilio** — fastest to stand up; per-message + per-number cost; separate vendor.
- **Phone numbers on staff records** — add a `mobile`/`sms` field to the `staff` table + the Settings → Users add/edit form. (Field employees need a mobile on file.)
- **Consent / CASL** — Canada's anti-spam law wants documented consent. Transactional work assignments to staff are usually covered by an employment agreement, but it should be a deliberate **per-person opt-in** flag on the staff record, and texts should be transactional only (no marketing).
- **Delivery + audit** — log each send (success/failure) to `housing_audit_log`; surface failures (no silent drops). Handle provider error codes, opt-outs (STOP keyword), and rate limits.

### Design sketch (when picked up)
- **Channel registry**: extend the notification model so an event can target `email`, `sms`, or both. Add a per-event SMS toggle + a short SMS body template (160-char-aware; SMS is plain text, no HTML) in **Settings → Notifications**.
- **Recipient resolution**: SMS recipient = the assignee's `mobile` (for `sow_assigned_to_field_employee`); reuse the existing recipient resolvers, swapping email→mobile.
- **Edge Function `send-sms`**: verifies caller JWT, sends via the chosen provider (secrets in Project Settings → Edge Functions), writes an audit row via service_role. ASCII-only source rule still applies.
- **Client wrapper**: `window.sendSms(opts)` mirroring `sendNotification`; per-event helpers call it alongside (or instead of) the email helper based on the channel config.
- **Opt-out**: store STOP/opt-out state on the staff record; the function skips opted-out numbers.

### Open decisions before building
1. Provider: **ACS** (same cloud, slower number provisioning) vs **Twilio** (fastest, separate vendor)?
2. Scope of v1: just the **work-order-assigned** event, or all workflow events with a per-event SMS toggle?
3. Who pays / budget for per-message cost, and expected monthly volume?
4. Consent capture: opt-in checkbox on the staff/Users form + policy text?

### Effort / risk
Medium-large. The engineering is moderate; the **number provisioning, billing, and consent/compliance** are the long poles. No impact on existing email until enabled.

---

## Phase N — Multi-Nation Onboarding & Control Panel

Turns the single-tenant CLFN app into the multi-nation platform. Architecture is
locked in Phase A0 (**database-per-nation**, **subdomain-per-nation**, superuser
tooling in a **separate codebase**). Hosting is platform-side — a nation never
needs its own Azure account; we host the one SPA and route by subdomain.

### N0 — App nation-awareness  ✅ (shipped)
- `shared-config.js` now carries a **`NATIONS_DIRECTORY`** (hostname → `{id,
  display_name, short, supabase_url, supabase_anon, role_labels,
  modules_licensed}`) and `window.resolveNation()`. At boot it resolves the
  current host (full host → subdomain label → `_default`) and sets
  `SUPABASE_URL` / `SUPABASE_ANON` / `NATION_CONFIG`, and applies per-nation
  module **licensing** onto `CLFN_MODULES._licensed`.
- Anon keys are publishable, so the directory is safe client-side. CLFN is
  `_default` → byte-identical until other nations are added. Adding a nation =
  adding a directory entry (later swappable for a fetched `nations.json` — same
  shape, no resolver change).
- Remaining N0 polish: finish replacing hardcoded `'CLFN'`/`'Constance Lake…'`
  strings with `NATION_CONFIG` (Phase 2/3 carryover).

### N1 — Repeatable provisioning  ⏳ (scaffold shipped)
Framework shipped under `supabase/`: `config.toml`, `seed.sql` (light — storage
bucket; settings use in-code defaults), `migrations/README.md` (schema-capture
process), and `README.md` (the full per-nation provisioning runbook incl.
per-nation email provider). **Email provider abstraction shipped:** `send-notification` now selects the
provider via the `EMAIL_PROVIDER` secret (`graph` default / `resend` / `sendgrid`),
and the client passes nation `brand`/`reply_to` from `NATION_CONFIG`. So a nation
without M365 just sets `EMAIL_PROVIDER=resend|sendgrid` + that provider's secrets.
CLFN unchanged (defaults to `graph`). **Remaining (needs the live DB + Supabase
CLI, run by the user):** `supabase db dump` CLFN → commit
`migrations/0001_init_schema.sql`, then adopt "every schema change is a new
numbered migration."

The hand-run SQL-editor workflow breaks at nation #2. Make a nation's backend a
**versioned, reproducible bundle**:
- **Versioned schema** via Supabase CLI migrations (numbered SQL) — single source
  of truth for every nation DB: tables, RLS, triggers, functions.
- **Seed pack** — default `housing_settings` (scoring model, approval authority,
  NOS table, module licensing), storage bucket, nation identity row.
- **Edge functions + secrets per project** — deploy `send-notification` (and
  future `send-sms`) and set Graph/SMS secrets per nation.
- **🔖 Email provider per nation** — current email is Microsoft Graph against
  CLFN's M365 mailbox. **Not every nation has M365.** Make the email channel a
  per-nation config: M365/Graph, or a generic SMTP/provider (e.g. Resend,
  SendGrid, Azure Communication Services). The `send-notification` function reads
  the nation's provider config; `from`/credentials become per-nation secrets.
- **First admin user** — create the nation's ED/super_user so they can log in.
- **Runbook** — documented manual steps end-to-end before automating.

### N2 — Control Panel MVP  ⬜ (separate repo — has a backend)
Superuser tool to onboard/manage nations. **Not** a static SPA and **not** this
repo: it holds the **Supabase Management API token** + per-project **service-role
keys**, so it must run server-side and stay secured. Screens:
- **Nations list** — status (active / provisioning / suspended), subdomain,
  licensed modules, user count, last activity.
- **Add-Nation wizard** — create Supabase project (Management API) → apply
  migrations (N1) → seed → set email provider → create first ED → register in the
  directory/`nations.json` → configure subdomain (wildcard DNS / SWA custom
  domain) → verify. Per-step progress + rollback.
- **Per-nation config & licensing** — branding, role labels, contact, and which
  modules they pay for (`modules_licensed`). (Distinct from the in-app ED on/off
  toggle, which is `_enabled`.)
- **Lifecycle** — suspend / reactivate, key rotation, delete with safeguards.

### N3 — Scale  ⬜
- **Fan-out migration runner** — apply a new schema version across all nation
  projects, with status/version tracking per nation.
- **Billing/licensing** wired to `_licensed`; **observability** (per-nation
  health, usage, audit); per-nation region/backup policy.

### Open decisions
1. Config delivery: embedded `NATIONS_DIRECTORY` (now) vs fetched `nations.json`
   vs a config endpoint — resolver supports all three; pick when nation #2 is near.
2. Subdomain strategy: wildcard `*.host` (one deployment serves all) vs per-nation
   deployment — wildcard + directory is the cheapest path.
3. Email: per-nation M365 vs a generic provider as the platform default for
   nations without M365.
4. Migration tooling: adopt Supabase CLI migrations now so the schema is versioned
   before onboarding anyone (foundational for N1+).

---

## Phase T — Tenant/Person model & BCR eligibility  ⬜

Evolve `tenants` from a **unit-derived** record into a **person-centric** one that
persists across the full lifecycle (applicant → housed → unassigned → BCR'd),
and add a **BCR'd** status that makes a person ineligible for housing.

### Why (current-state findings)
- `tenants` rows are **auto-synced from `housing_units.assigned_name`** by a DB
  trigger (the trigger is **not in the repo** — it's run via the SQL editor).
  The table is slim (name, email, phone, lease dates, hydro/gas accounts); there
  is **no status, eligibility, or BCR concept** anywhere.
- The TIC (`openTenantCard` / `_ticResolveTenant` in `housing-tic.js`) can open by
  tenant id **or** unit→`assigned_name`, but in practice tenant rows only exist
  for currently-assigned people, so the TIC is effectively **unit-linked**.
- **Applicants** live in `housing_applications` (separate) with no tenant row →
  **no TIC**.
- **On unassign:** the unit's `assigned_name` is cleared and a
  `tenant_movement_log` row records the move-out (name + unit + `move_out_date`,
  written from `housing-modals.js`). What happens to the tenant **row** depends on
  the DB trigger — **confirm whether it deletes/blanks the tenant** (which would
  drop the TIC + notes/lease/docs, leaving only the movement-log breadcrumb).
  **This is the first thing to verify.**

### Target model
- Person (tenant) becomes a **first-class record with a lifecycle/status**,
  decoupled from the unit trigger. Unit assignment becomes a **link** (one of
  possibly many over time), not the thing that creates/destroys the person.
- New fields on `tenants`: **`status`** (`applicant` | `active` | `former` |
  `bcrd`), **`bcrd_date`**, and a BCR **reason/notes**.
- **TIC for everyone** — applicants and former tenants, not just current
  occupants (it already opens by id; the gap is that records don't persist for
  non-assigned people).
- **BCR eligibility gate** surfaced at: **application approval**
  (housing-modals.js `confirmApprovalAction`), the **Match** flow (match.html),
  and the **assign-to-unit** action — "Ineligible — BCR'd on [date]". A person
  BCR'd from the community is not eligible for a house.

### Open decisions (before building)
1. **BCR enforcement:** hard block (cannot apply/be assigned) vs. flag-and-warn
   with an **ED override**? (Banishment is usually a hard block.)
2. **What BCR'd blocks:** unit assignment only, application submission, or both?
3. **Person scope:** unify applicants + tenants into one person record, or keep
   applications separate but add a shared **person link** + BCR status that
   applies across both? (Full refactor vs. additive.)
4. **Status set:** confirm canonical values (applicant / active / former / bcrd /
   deceased?).
5. **Keying:** applications + `tenant_movement_log` are **name-keyed** today; a
   reliable BCR check + persistent history really wants a stable **person id**
   linking application ↔ tenant ↔ assignments.

### Phased path (low-risk → structural)
- **T1 (additive):** add `status` + `bcrd_date` (+ reason) to `tenants`; show a
  clear **"BCR'd / ineligible"** banner in the TIC; add a **name-based** BCR check
  that at least **warns** in Match + approval. Migration: ALTER `tenants`.
- **T2:** decouple `tenants` from the unit trigger so records **persist on
  unassign** (→ `former`) and the TIC opens for applicants + former tenants.
  Requires reworking the DB trigger (link/unlink instead of create/delete).
- **T3:** introduce a stable **person id** and link applications ↔ tenants ↔
  assignments; move the BCR check from name-based to id-based.

---

## Phase CM — Commercial / Business Tenancy  ⬜
Lets the Nation place **businesses and departments** into commercial/admin/band
buildings, with a simple (non-scored) application and an admin-review approval —
parallel to the residential housing pipeline, reusing the same plumbing.

### Decisions (locked 2026-06)
- **Not scored.** Commercial applications are reviewed/approved by staff on
  availability + fit (discretionary), NOT ranked by a need score.
- **New application type** `commercial` in the existing applications pipeline
  (alongside `new_housing` / `transfer_request` / `existing_tenant`), routed to a
  SHORT commercial form — not the 8-step residential wizard.
- **Stored as a tenant** with `tenant_type` of `business` or `department` (+ org
  contact field) on the existing `tenants` table, so it flows into Finance,
  billing, the TIC, and unit assignment like any tenant.
- Commercial buildings already exist as unit types (`commercial_building`,
  `admin_building`, `band_building` — `_SECONDARY_TYPES`); reuse them.

### CM1 — Business/Department tenant  (in progress)
- `tenant_type` gains `business` / `department`; a `contact_person` field added.
- Recognized in every type label / pill (finance utils, profile, list, export)
  and selectable + editable in the Finance tenant form. For these, `full_name`
  holds the org/department name; `contact_person` holds the human contact.
- Schema: `alter table tenants add column if not exists contact_person text;`
  plus widen any `tenant_type` CHECK to include `business`/`department`.

### CM2 — Simple commercial application  (planned)
- "Business / Department" card on the Application Type step → short commercial
  form (org/dept name, contact, space type & size, intended use, preferred
  building, desired start/end, notes). Submit → `app_type='commercial'`,
  unscored, into an admin review queue. Approve / decline (no ranking).
- Schema: allow `commercial` in any `housing_applications.app_type` CHECK.

### CM3 — Assignment (NO matching model)  (done)
- **Decision (2026-06):** commercial space is **assignment-only** — there is NO
  matching/availability-ranking view. An approved commercial application is
  assigned directly to a commercial/admin/band building.
- Minimal "Assign to Building" action on an approved commercial application:
  pick a commercial/admin/band unit → set its `assigned_name` to the org/dept
  name + link the application, creating the business/department tenant
  (`tenant_type` business/department) via the existing secondary-unit
  assignment path. Reuses the unit edit modal's assignment mechanism.

### CM4 — Commercial occupancy agreement  (later)
- A `commercial_lease` document in the multi-doc lease generator.

---

## Rollback points
- Pre-refactor snapshots (Phase C)

## Follow-ups parked
- **Tenant / community-member portal** (saved for later). Limited-access surface
  for non-staff users (applicants: apply + check status; tenants: view unit/rent,
  submit maintenance, docs). **Hard prerequisite: real Supabase RLS** scoping every
  tenant-readable table to `auth.uid()` — the current model trusts the client
  (anon key + client-side gating), which is safe for vetted staff but unsafe for
  untrusted logins. Needs `auth_user_id` linkage on tenants/applications + a
  staff-invite/claim onboarding flow to prevent impersonation, and a separate
  minimal portal surface (own subdomain) rather than the staff SPA. Open decisions:
  audience-first, MVP scope, surface, onboarding. (See discussion 2026-06.)
- Finance module actual UI
- Supabase RLS
- Nation config distribution mechanism (CDN vs shared Supabase)
- Branding theming per nation (CSS vars from config)
- Superuser admin tools (separate codebase)
