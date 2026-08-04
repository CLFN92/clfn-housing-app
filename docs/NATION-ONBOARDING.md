# Onboarding runbook — fnhub.app (Cloudflare Pages) + adding nations

This is the operational guide for the **FN Hub** housing platform. It has two
parts:

- **Part A — one-time platform setup** (Cloudflare Pages + the fnhub.app domain).
  You do this once.
- **Part B — add a new nation** (the repeatable checklist). One subdomain, one
  Supabase project, one directory entry.

The architecture is **subdomain-per-nation + database-per-nation**: every nation
lives at `<nation>.fnhub.app` and has its **own Supabase project** (its own data,
never shared). The single static site is served to all subdomains; at boot
`resolveNation()` (`shared-config.js`) reads the subdomain and loads that
nation's Supabase URL/key + branding from `NATIONS_DIRECTORY`.

---

## Part A — one-time platform setup

### A1. Cloudflare Pages project
1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
2. Repository: `clfn92/clfn-housing-app`, production branch **main**.
3. Build settings:
   - Framework preset: **None**
   - Build command: **(leave empty)** — this is a static app, no build step
   - Build output directory: **`/`**
4. Save & Deploy. You get a `*.pages.dev` URL — test the app there first.

Response headers come from the repo's `_headers`, and `.assetsignore` keeps
internal files (`.git`, `supabase/`, docs, schema SQL) from being served. This
is a multi-page static app, so no SPA redirect/fallback is needed. No other
config is required.

### A2. Domain + wildcard (fnhub.app is already in this Cloudflare account)
On the Pages project → **Custom domains → Set up a custom domain**, add:
- `clfn.fnhub.app`   — CLFN's live URL
- `*.fnhub.app`      — **wildcard**: every future nation subdomain works with no
  further DNS/cert work
- (optional) `fnhub.app` and `www.fnhub.app` for a future landing page

Because fnhub.app is already on Cloudflare, each entry auto-creates its DNS
record and TLS certificate. `.app` is HTTPS-only by design; Cloudflare handles it.

### A3. Supabase Auth (applicant portal magic links)
In **each nation's** Supabase project (for CLFN, the existing project):
**Authentication → URL Configuration**
- **Site URL:** `https://<nation>.fnhub.app` (e.g. `https://clfn.fnhub.app`)
- **Redirect URLs:** add `https://*.fnhub.app/**` (covers every nation) plus the
  `*.pages.dev` URL while testing.

### A3b. Route Supabase Auth system emails through Resend (Custom SMTP)
App notifications, maintenance, applications, and the applicant magic link all
send through the Edge Functions (EMAIL_PROVIDER=resend). Supabase's OWN auth
emails (staff password reset, email confirmations) are separate and use
Supabase's default sender unless you also set Custom SMTP. To make 100% of
outbound mail come from fnhub.app:

Supabase -> **Authentication -> Emails -> SMTP Settings** -> Enable Custom SMTP:
- Sender email: `noreply@fnhub.app`   Sender name: `<Nation> Housing`
- Host: `smtp.resend.com`   Port: `465` (or `587`)
- Username: `resend`   Password: a Resend API key (`re_...`)

Optional: raise the auth email rate limit (Authentication -> Rate Limits) and
brand the templates (Authentication -> Email Templates). The sending domain must
be Verified in Resend (same domain as EMAIL_FROM).

### A4. Azure — decommissioned
Azure Static Web Apps has been fully retired. The static host is now **Cloudflare
Workers** (`.github/workflows/deploy-cloudflare.yml` + `wrangler.jsonc`); response
headers/CSP live in `_headers`. The Azure deploy workflow and `staticwebapp.config.json`
have been deleted from the repo. Remaining Azure teardown is on the Azure side only:
delete the Static Web App resource in the Azure Portal and remove the
`AZURE_STATIC_WEB_APPS_API_TOKEN_*` GitHub Actions secret.

- The Supabase Edge Function CI (`.github/workflows/deploy-supabase-functions.yml`)
  is independent of the static host — leave it.

---

## Part B — add a new nation

> Prerequisite: **the fresh-DB bootstrap script must exist** (see "Make it easy",
> item 1). Without it, "create the DB" below is a manual, error-prone schema
> rebuild. With it, the whole nation stands up in ~30 minutes.

### B1. Create the nation's Supabase project
1. Supabase → **New project** (name it for the nation). Choose a region close to
   the nation. Save the project ref (e.g. `abcd1234...`) and the **anon** key
   (Settings → API → `anon`/`publishable` — safe to ship client-side).
2. **Run the bootstrap schema** in the SQL editor (one paste — see item 1 below):
   all tables, RLS, triggers, functions, sequences.
3. **Storage:** create the `housing-files` bucket (private).

### B2. Deploy the Edge Functions to the new project
Each Supabase project has its own functions. Either:
- **Manually (once):** `supabase functions deploy <fn> --project-ref <newref>`
  for `ai-chat`, `send-notification`, `tenant-mr`, `applicant-intake`, **or**
- **Via CI:** add the new project ref to the deploy matrix (see item 2 below).

Then set that project's **Edge Function secrets** (Project Settings → Edge
Functions → Secrets):
- Email provider: `EMAIL_PROVIDER` (`graph` | `resend` | `sendgrid`) + its keys.
  A nation without M365 can use Resend/SendGrid (`RESEND_API_KEY`/`SENDGRID_API_KEY`
  + `EMAIL_FROM`).
- `EMAIL_BRAND`, `EMAIL_REPLY_TO` — that nation's brand + reply-to.
- `APP_URL` = `https://<nation>.fnhub.app` (so email links point to their site).
- `ANTHROPIC_API_KEY` if the AI assistant module is licensed for them.
- Optional: `HOUSING_MR_NOTIFY_TO`, `HOUSING_APP_NOTIFY_TO` to route the
  maintenance/application notifications to a shared mailbox.

### B3. Auth URL config for the new project
Repeat **A3** in the new project (Site URL = their subdomain; Redirect URLs
include `https://*.fnhub.app/**`).

### B4. Add the directory entry (the only code change)
In `shared-config.js`, add one entry to `NATIONS_DIRECTORY` keyed by the
subdomain label:

```js
'listuguj': {                                  // -> listuguj.fnhub.app
  id:            'listuguj',
  display_name:  'Listuguj Mi\'gmaq Government',
  short:         'LMG',
  supabase_url:  'https://<newref>.supabase.co',
  supabase_anon: '<their anon key>',
  portal_base:   'https://listuguj.fnhub.app',   // canonical URL for QR codes / public links
  email_domain:  'listuguj.ca',
  housing_email: 'housing@listuguj.ca',
  landlord_committee: 'Housing Committee',
  mailing_po_box: 'P.O. Box ...', mailing_postal: '...', province: 'Quebec',
  role_labels:   {},
  modules_licensed: { finance:false, match:true, rfq:true }   // null = all licensed
}
```

Commit + push → CI redeploys the site. `*.fnhub.app` already routes the
subdomain, so `listuguj.fnhub.app` is now live.

### B5. Seed + verify
1. Add the nation's first **staff** rows (their `staff` table): at least one ED,
   with `is_active = true`. Staff sign in with those emails.
2. Confirm branding (name/short/colors) shows correctly on their subdomain.
3. Load a unit + an application to sanity-check the flow.
4. If they use the tenant QR / applicant portal, confirm a magic link returns to
   `https://<nation>.fnhub.app/...`.

**Per-nation checklist:** ☐ Supabase project ☐ bootstrap schema ☐ storage bucket
☐ functions deployed ☐ function secrets ☐ auth URLs ☐ directory entry ☐ staff
seeded ☐ verified.

---

## Make it easy (recommended enablers)

These turn Part B from "careful manual work" into a short checklist:

1. **Fresh-DB bootstrap script (highest priority).** Today the repo has only
   *incremental* migrations, not a full schema. Capture the complete schema once
   from the CLFN project and commit it as `supabase/bootstrap/schema.sql`, so
   step B1.2 is a single paste. Produce it with:
   ```
   supabase db dump --project-ref fkhzrbalumzeripzolph --schema public -f supabase/bootstrap/schema.sql
   ```
   (or `pg_dump --schema-only --no-owner --no-privileges` against the project's
   connection string). Review it, strip any CLFN-specific seed data, commit.

2. **Multi-project function deploy.** Extend
   `.github/workflows/deploy-supabase-functions.yml` to loop over a list of
   `{project_ref, access_token}` pairs (GitHub secret or a JSON matrix) so a push
   deploys every nation's functions at once, instead of deploying each new
   project by hand.

3. **Nation config as data (later).** `NATIONS_DIRECTORY` can be swapped for a
   fetched `nations.json` (same shape) so adding a nation needs no code deploy at
   all — just a config update. The resolver already supports this shape.
