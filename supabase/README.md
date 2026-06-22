# Provisioning a new nation (runbook)

Multi-nation platform — **database-per-nation**, **subdomain-per-nation** (see
PLAN.md Phase N). Hosting is platform-side: one SPA deployment serves every
nation, routed by subdomain via `NATIONS_DIRECTORY` in `shared-config.js`. A
nation does **not** need its own Azure or Microsoft 365 account.

This is the manual runbook (Phase N1). Phase N2 automates it in a separate
control-panel app via the Supabase Management API.

## Prerequisites
- Supabase CLI installed and logged in (`supabase login`).
- The captured base schema exists: `supabase/migrations/0001_init_schema.sql`
  (see `migrations/README.md` — dumped once from CLFN).

## Steps

### 1. Create the nation's Supabase project
New project in the Supabase dashboard (or `supabase projects create`). Pick the
**region** appropriate for the nation (data residency / OCAP). Record the
**project ref**, **project URL**, and **anon (publishable) key**.

### 2. Apply the schema
```bash
supabase link --project-ref <NEW_PROJECT_REF>
supabase db push                 # applies every migration in supabase/migrations
```
This creates all tables, RLS policies, triggers, functions, and storage policies
identically to CLFN.

### 3. Seed
Run `supabase/seed.sql` against the new project (SQL editor or
`supabase db execute`). Creates the `housing-files` storage bucket; settings use
in-code defaults until the ED customises them.

### 4. Deploy Edge Functions + secrets
```bash
supabase functions deploy send-notification --project-ref <NEW_PROJECT_REF>
```
Then set this nation's **email provider** secrets in Project Settings → Edge
Functions → Secrets. `send-notification` selects the provider from
`EMAIL_PROVIDER` (default `graph`), so nations without M365 just pick a different
provider — no code change:
- **Microsoft 365** (`EMAIL_PROVIDER=graph`, the default): `GRAPH_TENANT_ID`,
  `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`, `GRAPH_FROM_USER` (their shared mailbox).
- **Resend** (`EMAIL_PROVIDER=resend`): `RESEND_API_KEY`, `EMAIL_FROM`
  (verified sender email), `EMAIL_FROM_NAME` (optional).
- **SendGrid** (`EMAIL_PROVIDER=sendgrid`): `SENDGRID_API_KEY`, `EMAIL_FROM`,
  `EMAIL_FROM_NAME` (optional).
- Optional for any provider: `EMAIL_REPLY_TO` (reply-to override) and
  `EMAIL_BRAND` (footer brand). The client also passes `reply_to`/`brand` from
  `NATION_CONFIG`, so secrets are only needed to override.

Redeploying the function does not change CLFN: `EMAIL_PROVIDER` defaults to
`graph` and the Graph path is unchanged.

Deploy the **Housing Assistant** function the same way and set its key:
```bash
supabase functions deploy ai-assistant --project-ref <NEW_PROJECT_REF>
```
- Required secret: `ANTHROPIC_API_KEY`.
- Optional: `ANTHROPIC_MODEL` (default `claude-sonnet-4-6`).
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` are
  auto-injected. The function is read-only and role-scoped (see PLAN.md Phase AI).
  Disable the assistant for a nation by turning the `ai_assistant` module off in
  Settings → Nation → Modules (or omit the secret — the function returns a 500
  the widget surfaces as an error).

### 5. Create the first ED / super_user
- Create the user in **Supabase Auth** (email + temp password / invite).
- Insert/confirm their row in `staff` with `role = 'ed'` (or `'super_user'` to
  also expose the Nation/Modules super-user controls) and `is_active = true`.

### 6. Register the nation in the app directory
Add an entry to `NATIONS_DIRECTORY` in `shared-config.js`, keyed by the nation's
**hostname** (and/or subdomain label):
```js
'efn.housingapp.ca': {
  id: 'efn', display_name: 'Example First Nation', short: 'EFN',
  supabase_url: 'https://<NEW_PROJECT_REF>.supabase.co',
  supabase_anon: '<publishable anon key>',
  role_labels: {},
  modules_licensed: { finance: false, match: true }   // what they pay for; null = all
}
```
Commit + deploy. (Anon keys are publishable, so this is safe client-side. Later
this directory can be served as a fetched `nations.json` of the same shape — no
resolver change.)

### 7. Configure the subdomain
Point `efn.housingapp.ca` at the SPA host. With a **wildcard** custom domain on
the static host, one deployment serves all nations; otherwise add the custom
domain per nation.

### 8. Verify
On the nation's subdomain: sign in as the ED, confirm branding/modules resolve,
create a test application + SOW, confirm an email sends, and confirm the audit
log records the login. Data must appear **only** in this nation's project.

## What's intentionally NOT per-nation
- The **SPA build** (shared by all nations; behaviour differs only by resolved
  config).
- **Storage bucket id** (`housing-files`) — same id inside each nation's own
  isolated project.

## Decommissioning
Suspend = remove the directory entry (app stops routing there) + disable the
project. Delete the Supabase project only after exporting/handing over the
nation's data per the data-sharing agreement (OCAP).
