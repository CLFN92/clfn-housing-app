# Super User Control Panel — Work Plan

Platform-level admin console to configure, provision, and manage nations on
FN Hub. This is the "super-user tooling" that CLAUDE.md kept out of the nation
app — we build it as an **isolated piece** so nation code and platform code stay
separate.

Status: **P1 done, P2 in progress.** P1 = control plane + panel shell (built,
wired to the fnhub-platform project). P2 = registry-driven `resolveNation`
(nation app reads `nations_public` at boot; CLFN `_default` stays as the
hardcoded fallback, never overridden). Rest of plan approved, not yet built.

## File structure (isolation boundary)

Platform code is kept **physically separate** from the nation app so the two
never entangle (Section 10 risk):

```
admin/                     platform SPA — its own deploy target (admin.fnhub.app)
  index.html               panel shell ("FN Hub — Platform Admin")
  admin.js                 auth + nations list + add-nation + admins + audit
  admin-config.js          control-plane Supabase URL/anon (publishable placeholders)
supabase/platform/
  schema.sql               control-plane DB: super_admins, nations, platform_audit + RLS
```

The panel loads **none** of the nation app's `shared-*.js` / `housing-*.js` and
talks only to the control-plane project. Nation code is untouched.

**Decisions locked (2026-07-30):**
1. Control plane → **dedicated "fnhub-platform" Supabase project** (separate from CLFN).
2. First provisioning build → **assisted (P4)**: operator creates the Supabase
   project manually; the panel automates schema → functions → secrets → auth →
   registry → first ED. Full one-click project creation is a later phase (P5).
3. Panel → **separate `admin.fnhub.app` SPA** with its own auth.

---

## 1. Goals

1. **Auto-add a new nation** — a wizard that stands up a nation with as few
   manual steps as safely possible (Supabase project, schema, storage, Edge
   Functions, secrets, auth config, domain, registry entry, first ED).
2. **Configure a nation** — branding (name/short/colors/logo), contact info,
   and **feature licensing** (which modules a nation may use) + enablement
   (on/off) in one place. This absorbs today's Settings → Nation → Modules.
3. **Super-admin access** — restricted to `kevint.proctor@gmail.com` to start;
   more platform admins added from within the panel.
4. **Manage the fleet** — list nations, health/status, suspend/resume, edit.

Principles: platform admins are a **separate population** from nation staff
(different auth, different data plane); no nation's data is ever mixed into
another; every provisioning action is auditable and reversible where possible.

---

## 2. Big picture

```
                       ┌─────────────────────────────┐
   super admin  ─────▶ │  admin.fnhub.app (panel)    │  gated to super_admins
 (kevint@gmail)        │  static SPA, its own auth   │
                       └───────────────┬─────────────┘
                                       │ calls (super-admin JWT)
                       ┌───────────────▼─────────────┐
                       │  CONTROL PLANE (platform     │
                       │  Supabase project)           │
                       │  • nations registry table    │
                       │  • super_admins table        │
                       │  • provision-nation function  │  holds Mgmt API +
                       │  • audit (platform_audit)     │  Cloudflare tokens
                       └───────────────┬─────────────┘
                                       │ Supabase Management API + Cloudflare API
             ┌─────────────────────────┼──────────────────────────┐
             ▼                         ▼                          ▼
     nation A project           nation B project            nation C project
     (clfn.fnhub.app)           (listuguj.fnhub.app)         (…)
     own DB + funcs + bucket    own DB + funcs + bucket      …
```

- **Control plane** = one small dedicated Supabase project that owns the fleet
  registry + provisioning logic. It never holds nation housing data.
- **Nation projects** = one Supabase project per nation (database-per-nation),
  exactly as today.
- The nation app (this repo) resolves its nation from the **registry** instead
  of the hardcoded `NATIONS_DIRECTORY`.

---

## 3. Control plane (new Supabase project: "fnhub-platform")

Tables:
- `nations` — one row per nation: `id`, `subdomain`, `display_name`, `short`,
  `supabase_url`, `supabase_anon`, `primary_color`, `email_domain`,
  `housing_email`, `modules_licensed` (jsonb), `status` (`provisioning` |
  `active` | `suspended`), `created_at`, `provisioned_by`. This is the source of
  truth that becomes `nations.json`.
- `super_admins` — `email`, `added_by`, `added_at`. **Seeded with
  `kevint.proctor@gmail.com`.** Membership gates the panel + the provisioning
  function.
- `platform_audit` — append-only trail of every super-admin action
  (nation created/edited/suspended, admin added, module licensed…).

Edge Functions (control plane):
- `provision-nation` — the orchestrator (Section 7). Holds the **Supabase
  Management API token** and **Cloudflare API token** as secrets. Verifies the
  caller is in `super_admins` before doing anything.
- `nations-json` — emits the public `nations.json` (subdomain → url/anon/branding
  /modules) that the nation app fetches at boot. Only publishable fields; no
  service keys.

---

## 4. Access & security

- **Super-admin auth** is on the control-plane project (magic link), separate
  from every nation. Seed allow-list = `kevint.proctor@gmail.com`.
- The panel checks `super_admins` on load; the `provision-nation` function
  re-checks server-side (never trust the client). Non-admins get nothing.
- **Manage Admins** section adds/removes emails in `super_admins` (audited).
- Secrets that must NEVER reach the browser (Supabase Management API token,
  Cloudflare API token, nation service-role keys) live only in control-plane
  function secrets. The panel only ever sends a super-admin JWT + form data.
- Note: `kevint.proctor@gmail.com` is a personal address; fine to seed now, but
  a dedicated platform mailbox is recommended before go-live.

---

## 5. Nation registry (replaces hardcoded NATIONS_DIRECTORY)

Today `resolveNation()` reads a hardcoded object. To add nations **without a
code deploy**, it reads a fetched registry:

- Build/publish `nations.json` from the `nations` table (via the `nations-json`
  function or a generated static file on the CDN).
- `shared-config.js`: `resolveNation()` uses a **cached `nations.json`**
  (localStorage) for a synchronous first paint, and refreshes it in the
  background. The hardcoded `_default` (CLFN) stays as the offline/first-run
  fallback so nothing breaks if the fetch fails.
- Adding a nation in the panel → writes the `nations` row → republishes
  `nations.json` → the new subdomain resolves. No app redeploy.

This is the one change that touches the nation app itself; everything else is
new/isolated.

---

## 6. Feature licensing + enablement (the module toggles)

Two levels, cleanly split:
- **Licensing (super-admin, control plane):** which optional modules a nation is
  *allowed* — `nations.modules_licensed`. Set on this panel. (finance, match,
  contractors, renovations, rfq, mapping, inspections, ai_assistant, …)
- **Enablement (nation admin, in-app):** which *licensed* modules the nation has
  turned on — today's `housing_settings.module_enablement`, unchanged.

The panel's per-nation **Modules** card mirrors the existing
`CLFN_MODULES.listOptional()` UI (so registering a new module key still
auto-surfaces a toggle) but writes **licensing**. The nation still governs
enablement. `CLFN_MODULES.isEnabled()` already = licensed AND enabled, so both
levels compose with no code change.

---

## 7. Nation provisioning — the orchestrator

The `provision-nation` function runs these steps for a new nation. The honest
automation boundary is marked.

| # | Step | How | Auto? |
|---|------|-----|-------|
| 1 | Create Supabase project | Supabase Management API `POST /v1/projects` (org token + billing) | ⚠️ heaviest — see decisions |
| 2 | Wait for project ready | poll Management API | ✅ |
| 3 | Run bootstrap schema | Management API SQL endpoint, from `supabase/bootstrap/schema.sql` | ✅ (needs the schema file first) |
| 4 | Create `housing-files` bucket | Storage API | ✅ |
| 5 | Deploy the 4 Edge Functions | Management API function deploy (bundled from repo) | ✅ |
| 6 | Set function secrets | Management API secrets (email provider, APP_URL, brand…) | ✅ |
| 7 | Auth config | Site URL = `https://<sub>.fnhub.app`, redirect `https://*.fnhub.app/**` | ✅ |
| 8 | Domain | **wildcard Worker route `*.fnhub.app/*` set up ONCE** → new subdomain just works, no per-nation Cloudflare call | ✅ (one-time) |
| 9 | Registry row + republish `nations.json` | control-plane insert | ✅ |
| 10 | Seed first ED staff row | insert into new project's `staff` | ✅ |

**Two prerequisites that unlock automation:**
- **`supabase/bootstrap/schema.sql`** — a single reproducible schema (all tables
  + RLS + triggers + functions + sequences). Doesn't exist yet; produced with
  `supabase db dump` on CLFN's project (I flagged this in NATION-ONBOARDING.md).
  Without it, step 3 can't be automated.
- **Wildcard Worker route `*.fnhub.app/*`** — set once so subdomains need no
  Cloudflare API per nation. Big simplifier.

Step 1 (project creation) is the only piece with cost/quota/billing weight and a
very privileged token. See Open Decisions for whether to automate it now or make
it the single manual step.

---

## 8. The Super Admin Panel (UI)

New static SPA at `admin.fnhub.app` (own repo folder or route). Sections:
1. **Sign in** — magic link (control-plane auth); allow-list gate.
2. **Nations** — table of nations (subdomain, status, modules, created).
   Row actions: Configure, Suspend/Resume, Open (`https://<sub>.fnhub.app`).
3. **Add New Nation** — wizard: name/short/subdomain → pick licensed modules →
   email provider config → review → **Provision** (calls `provision-nation`,
   streams step progress) → done.
4. **Configure Nation** — branding (name/short/color/logo), contact/mailing,
   **module licensing** toggles, auth/email settings, danger zone (suspend).
5. **Admins** — list/add/remove super-admins (seeded `kevint.proctor@gmail.com`).
6. **Platform Audit** — the `platform_audit` trail.

Branding uses the same nation-agnostic patterns as the app (no hardcoded CLFN).

---

## 9. Phased delivery

- **P0 — Prerequisites** (unlock everything): produce `supabase/bootstrap/schema.sql`
  (your one `supabase db dump`), set up the `*.fnhub.app/*` wildcard Worker route,
  create the control-plane Supabase project, obtain a Supabase Management API
  token + Cloudflare API token (stored as control-plane secrets).
- **P1 — Control plane + panel shell**: `nations` + `super_admins` +
  `platform_audit` tables & RLS; `admin.fnhub.app` sign-in gated to
  `kevint.proctor@gmail.com`; Nations list (read); Admins management.
- **P2 — Registry-driven resolveNation**: `nations-json` function + client
  `resolveNation()` reads cached `nations.json` (CLFN `_default` stays as
  fallback). No behavior change for CLFN.
- **P3 — Configure Nation**: branding + contact + **module licensing** editing
  (writes registry + the nation's settings); nation enablement stays in-app.
- **P4 — Provisioning (assisted)**: `provision-nation` does steps 3–10
  automatically against a Supabase project **you created manually** (you paste
  its ref + keys). This is the safe MVP of "auto add a nation."
- **P5 — Provisioning (full auto)**: add step 1–2 (Management API project
  creation + poll) so it's truly one-click. Gated behind billing/quota checks.
- **P6 — Polish**: suspend/resume, health checks, per-nation email test, audit
  export, retire the hardcoded `NATIONS_DIRECTORY`.

Each phase is independently shippable; CLFN keeps running throughout.

---

## 10. Costs & risks

- **Supabase project per nation** = its own billing line. Auto-creation needs an
  org with billing configured; quotas cap how many projects an org can hold.
- **Very privileged tokens** (Management API, Cloudflare) — must live only in
  control-plane function secrets, never client-side; rotate periodically.
- **Registry fetch at boot** — must fail safe (cached + `_default` fallback) so a
  registry outage never blocks a nation from loading.
- **Schema drift** — the bootstrap schema must be kept in sync as migrations
  land, or new nations start behind. Mitigate: regenerate the dump each release.
- Building platform tooling in/near the nation repo — keep it a separate folder
  and deploy target so the two never entangle.

---

## 11. Open decisions (settle before building)

1. **Control plane**: dedicated new "fnhub-platform" Supabase project (recommended,
   clean separation) vs. reuse CLFN's project.
2. **Provisioning automation level for the first build**: assisted (P4 — you
   create the Supabase project, panel does the rest) vs. full auto (P5 — panel
   creates the project too via Management API).
3. **Panel location**: `admin.fnhub.app` separate SPA (recommended) vs. a gated
   route inside the existing app.
4. **P0 prerequisites** — are you able to (a) run the one `supabase db dump` for
   the bootstrap schema, (b) generate a Supabase Management API token + Cloudflare
   API token for the control plane, (c) confirm the Supabase org has billing for
   multiple projects?
