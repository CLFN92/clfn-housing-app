# Security Review — CLFN Housing App (2026-07-03)

Four parallel security passes (Edge Functions, XSS/DOM injection, authorization/RLS/storage,
injection/CSP/supply-chain). Every finding re-read from the code. This is a
static-SPA + Supabase app: the anon key is public **by design** — the real
boundary is Row Level Security (RLS). Two classes of finding below:
**CONFIRMED-from-code** (exploitable, fixable in this repo) and
**CANNOT-VERIFY-from-repo** (depends on whether RLS is deployed in the live
Supabase project — must be checked there).

Legend: ☐ open · ☑ fixed

---

## TIER 0 — VERIFY IN SUPABASE FIRST (potentially catastrophic; not verifiable from repo)

### ◐ S0. RLS is absent from the repo — migration AUTHORED (needs to be RUN in Supabase)
**Update (2026-07-03):** `supabase/migrations/20260703_rls_lockdown.sql` authored + validated
end-to-end on a real Postgres 16 (applies cleanly + idempotent; proved a field_employee
cannot self-escalate/forge approvals/rewrite settings, inactive accounts are locked out,
ED writes succeed, and the audit/note append-only triggers fire even under RLS-bypass).
**Still OPEN until you RUN it in the live Supabase project(s)** — see the file header.

`migrations/README.md` says the full schema + all RLS lives in
`0001_init_schema.sql` — **that file does not exist in the repo.** The
migrations present define **zero** RLS policies except:
- `rfq-migration.sql` → `housing_rfq`: **confirmed permissive** (`to authenticated using(true)` for select/insert/update/delete).
- `supabase/sql/…housing_application_notes.sql` → correctly append-only.

Every other browser-written table (`staff`, `housing_applications`,
`housing_units`, `housing_sow`, `housing_settings`, `tenants`, `tenant_notes`,
`inspections`, `housing_audit_log`, `finance_*`, `bcr_registry`, storage objects…)
has **no policy in the repo**. The app sends the user JWT on every REST call, so
PostgREST enforces whatever RLS exists *in the live project* — which can't be
confirmed here. **If RLS is not actually deployed (or is `using(true)` like
housing_rfq), the following are exploitable TODAY by anyone with one valid
staff login + the public anon key:**

- **CRITICAL self-escalation:** `PATCH /rest/v1/staff?email=eq.<self>` → set
  `role:'ed'`, `is_active:true`; reload → you are the ED (full override + view-as).
- **Forge approvals:** `PATCH /rest/v1/housing_applications?id=eq.X` →
  `status:'ed_approved'`; same for `housing_sow.approval_status`,
  `housing_contractors.status`, `inspections.approved_by`.
- **Award contracts:** `PATCH /rest/v1/housing_rfq` → `status:'awarded'` +
  `award_amount` (CONFIRMED open — the RFQ policy is `using(true)`).
- **Rewrite governance:** `POST/PATCH /rest/v1/housing_settings` →
  overwrite `approval_authority` (grant yourself any action), `score_model_v2`,
  `email_templates`, `module_enablement`.
- **Finance:** post/void `finance_journal`, approve `finance_loans`, adjust
  `finance_rent_ledger` directly.
- **Erase your tracks:** `DELETE /rest/v1/housing_audit_log` — the repo proves
  append-only triggers only for `housing_application_notes`, NOT for
  `housing_audit_log`/`finance_audit_log`.

**Action:** in the live Supabase project, confirm role-scoped RLS exists on
`staff`, `housing_applications`, `housing_sow`, `housing_settings`, `finance_*`,
`housing_contractors`, `inspections`, `bcr_registry`, `storage.objects`, and that
append-only triggers exist on both audit tables. **Then commit the real policies
into `0001_init_schema.sql`** so this is reproducible/verifiable per nation. Any
table found on the `using(true)` pattern is a live hole.

### ☐ S0b. Storage: private bucket, but no object-level policy in repo + guessable paths
`seed.sql` makes bucket `housing-files` `public:false` (good — no anon URLs).
But object paths are derived from IDs the UI already exposes
(`applications/<appId>`, `units/<id>/utility-bills`, `tenants/<unitId>`,
`inspections/<id>/photos`), and `sbListFiles(prefix)`/`sbGetSignedUrl(path)`
exist. With no `storage.objects` path-scoping policy (none in repo), any
authenticated user can enumerate + sign URLs for **any** entity's files — ID
scans, income proof, utility bills. `x-upsert:true` on uploads also lets a
reacher overwrite another entity's stored PDF. Verify the storage policy in
Supabase.

---

## TIER 1 — CONFIRMED exploitable, fixable in this repo

### ☐ S1. Stored XSS — applicant-supplied name executes in the Match queue *(highest untrusted reach)*
`housing-views.js` `renderMatchView`: applicant `name` (`app.fn`/`app.ln`, :552),
unit street (:513), `app.assignedAddress` (:544), `curAddr` (:554/:567) all
interpolated raw into `content.innerHTML` (:575). `fn`/`ln` come from **applicant
self-service intake** — fully external input. Last name =
`<img src=x onerror=...>` detonates in staff's Match queue (sessions live in
`sessionStorage`, readable by the payload). `<script>` won't run via innerHTML
but `<img onerror>`/`<svg onload>` do — and CSP `'unsafe-inline'` (S6) lets them.

### ☐ S2. Stored XSS — audit-log `detail`/`name` unescaped in 3 render paths
`housing_audit_log.detail` embeds free text (note bodies, applicant/tenant names,
e.g. `unit_edit` detail = `'… tenant: '+assignedName`) and renders unescaped in:
- Settings → Audit Log table — `housing-settings.js:805` (name), `:812` (detail) → tbody innerHTML :815 (auto-refreshes ~15s, ED-facing)
- Landing "Recent Activity" — `housing-views.js:1756` → :1649 (every login)
- SOW audit render — `shared-data.js:4407/4408` → :4400
Highest-leverage single fix: escape `e.detail`/`e.name`/`e.user` at all three.

### ☐ S3. Stored XSS — `assigned_name` / addresses unescaped across inventory
- Inventory list: `housing-views.js:287` (`u.assignedName`), :269 (addr) → :323
- Unit-detail panel: `housing-modals.js:1792` (`u.assignedName`)
- SOW picker card: `housing-modals-sow.js:671` contractor, :672 scope/description, :687 street → :683
- SOW attachment list: `housing-modals-sow.js:74` uploaded `f.name` (attacker names a file `<img onerror>.pdf`)
- App print preview (`housing-modals.js` `row()` :1101 → shared-data.js:6621) and work-order print (`housing-modals-sow.js:1982-1986` → :2120)
Fix: wrap each in the canonical `escapeHtml()` (already covers `& < > " '`).

### ☐ S4. Edge Function — `query_database` `select` embedding escapes the role allowlist  (HIGH)
`ai-chat/index.ts:148-150`: the `select` regex permits `( ) , . :` — PostgREST's
foreign-table embedding chars — and only the **top-level** `table` is role-checked.
So `table=housing_units&select=*,housing_applications(*)` (FK
`assigned_unit_id→id`) lets a `field_employee` read the whole
`housing_applications` table (applicant PII, MGMT-only); a `housing_manager` can
pivot `tenants→finance_rent_ledger(*)` into FINANCE-only data. Reachable via
**prompt injection** too (malicious text in a note returned by an earlier tool
turn steering a later query). **Fix:** reject any `select` containing `(`/`)`
(no embedding), or validate each embedded resource name against the caller's
allowlist. (Also caps `MAX_ROW_LIMIT` — embedding multiplies child rows.)

### ☐ S5. Edge Function — `send-notification` has NO active-staff gate  (HIGH)
`send-notification/index.ts:227-238`: auth stops at `getUser()` (verifies *some*
Supabase auth user) — unlike `ai-chat` it does **no** `staff`/`is_active` lookup.
Any valid project JWT (a deactivated ex-employee whose auth row survives, or any
account if signups are enabled) can send mail. Combined with fully client-
controlled `to` (:245) and raw unescaped `bodyHtml` (:271, "NOT escaped —
sanitized client-side" — no server backstop), this is **arbitrary phishing from
`housing@clfn.on.ca`**, a trusted government domain. **Fix:** mirror ai-chat's
active-staff gate; constrain recipients to on-file addresses; sanitize HTML
server-side; bound attachment size/count/type (currently unbounded, :254).

---

## TIER 2 — Hardening (high value; not all one-line)

### ☐ S6. CSP `script-src 'unsafe-inline'` + no SRI + wildcard-CDN hosts
`staticwebapp.config.json:70`. Two compounding gaps:
- **No SRI anywhere** (grep `integrity=` → 0). Every CDN `<script>` (leaflet,
  jsPDF, autotable, xlsx, exifr, pdf-lib, Chart.js — on cdnjs/jsdelivr, incl.
  runtime `s.src=` injects) trusts the whole host. One compromised CDN package
  = arbitrary JS with full Supabase-session privilege on every page.
- **`'unsafe-inline'`** over **494 innerHTML sinks / 41 files** is the multiplier
  that turns every S1–S3 sink into execution. Removing it (nonce/hash the few
  real inline blocks, move `on*=` handlers to `addEventListener`) neutralizes the
  whole stored-XSS class.
Fix: pin `integrity="sha384-…"` + `crossorigin` on every tag; drop `'unsafe-inline'`.

### ☐ S7. Vulnerable / floating CDN libs
`xlsx` (SheetJS) **0.18.5** — CVE-2023-30533 (prototype pollution) + CVE-2024-22363
(ReDoS), fixed ≥0.20.2; it parses user-uploaded spreadsheets → reachable. `exifr`
loaded **unpinned** (`tenants.html:31`, floating latest) → auto-pulls a future
malicious release. Pin exact versions + SRI; upgrade/replace xlsx.

### ☐ S8. Predictable initial password in shipped client JS
`housing-init.js:1630`: `defaultPassword = nationShort()+firstName+'2026!'` (e.g.
`CLFNJohn2026!`), disclosed to admins and POSTed to `/auth/v1/signup`. The formula
is public in the bundle → every freshly-provisioned account has a guessable
credential until changed. Fix: random initial password + forced reset on first login.

### ☐ S9. JWT leaked in a Storage URL query string
`shared.js:1735-1739` `sbGetFileUrl` appends the raw access token as `?token=<jwt>`
and assigns it to `img.src` (housing-tic.js:822). The token then leaks via browser
history, disk cache, and the `Referer` header to the CDN/OSM hosts loaded on the
same view. Fix: use header-authenticated fetch → blob URL, or short-lived signed
URLs; never put the bearer token in a URL.

### ☐ S10. Missing response headers; broad `img-src`
`staticwebapp.config.json` sets X-Frame-Options/nosniff/frame-ancestors (clickjacking
covered) but lacks **`Referrer-Policy`** (default leaks full URLs incl. `?openApp=`,
recovery-token context, to OSM/CDN) and **HSTS**. `img-src … https:` allows an image
beacon to any https host (exfil channel for an injected `<img>`). Add
`Referrer-Policy: strict-origin-when-cross-origin` + HSTS; scope `img-src`.

### ☐ S11. Defense-in-depth consistency
- ai-chat: the advertised per-role "forced row filters" are never implemented
  (`forced:[]` everywhere) — no row-level backstop if a table is later added
  expecting one. (ai-chat:121-152)
- A few raw (unencoded) values concatenated into REST URLs — `staff?id=eq.`+id
  (shared-data.js:2831 etc.), `?entity_type=eq.`+type (shared.js:1951): not
  free-text today, but wrap in `encodeURIComponent` for consistency.
- `mailto:`+email unencoded (finance-vouchers.js:405).

---

## Verified SOUND (so they're not re-chased)
- **Secret hygiene:** no service-role / Anthropic / Graph / Resend / SendGrid key
  or private token committed. All live in Edge Function env; client holds only the
  anon (publishable) key + non-secret Graph tenant/client IDs; the config UI refuses
  to render secrets; deploy uses GitHub Actions secrets.
- **Edge Function auth ordering:** no paid Anthropic call / service-role query runs
  before JWT verification; `role` is resolved from the verified JWT, never client
  `ctx.role`; `MAX_TOOL_TURNS` enforced; unknown tools rejected; audit `actor` is
  the verified email (not forgeable).
- **query_database `table`/`order`/filter `column`/`op`/`value`** are strictly
  validated + `encodeURIComponent`'d (only `select` embedding, S4, escapes).
- **Data layer** REST URLs are overwhelmingly `encodeURIComponent`-wrapped; **no
  open redirect** (relative paths + whitelist route lookups); no `postMessage`
  receivers; OSM iframe coords are `.toFixed()` numeric (no URL injection).
- **XSS-safe render paths:** AI chat reply (`textContent`), DocLibrary file list,
  Council dashboard, the entire TIC, all rfq.js tables, contractor registry, tenants
  table — all correctly escaped.
- **Session teardown:** 401 interceptor + idle logout clear tokens synchronously,
  no await-before-redirect, no loop; refresh token posted only to the Supabase auth host.
- **Multi-nation:** isolation = database-per-nation + separate auth; no code path
  reaches another nation's DB with this nation's credentials.

---

## Recommended remediation order
1. **VERIFY RLS in Supabase (S0/S0b)** — the whole model rests on it; if open, everything
   in Tier 1's authz column is live. Author + commit the real RLS into `0001_init_schema.sql`.
2. **Fix the 2 Edge Function issues (S4, S5)** — small code changes, high impact, then redeploy the functions.
3. **Escape the XSS sinks (S1–S3)** — ~10 render sites through `escapeHtml()`.
4. **CSP hardening (S6)** — SRI + drop `'unsafe-inline'` (biggest, do deliberately),
   then S7 (xlsx/exifr), S9 (URL token), S8 (password), S10 (headers).
5. **Consistency (S11).**
