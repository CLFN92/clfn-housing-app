# provision-nation (control plane, P4 assisted)

Stands up a new nation on FN Hub against a Supabase project **you have already
created** (assisted mode). Deployed on the **fnhub-platform** project, gated to
`super_admins`.

## Prerequisites (P0)

1. **Bootstrap schema** — a reproducible dump of CLFN's schema, committed to
   `supabase/bootstrap/schema.sql`:
   ```
   supabase db dump --linked -f supabase/bootstrap/schema.sql
   ```
   The panel wizard uploads this file; its contents are sent as `schema_sql` and
   replayed on the new project via the Supabase Management API.

2. **Management API token** — a Supabase **account/organization access token**
   (Supabase dashboard -> Account -> Access Tokens). Set it as a function secret:
   ```
   supabase secrets set SB_MGMT_TOKEN=sbp_xxx --project-ref <platform-ref>
   ```
   Without it, Step 1 (schema) is skipped and reported as such.

## Deploy

```
supabase functions deploy provision-nation --project-ref <platform-ref>
```
`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically; only `SB_MGMT_TOKEN` must be set manually.

## Request (from the panel, super-admin JWT as bearer)

```jsonc
{
  "nation":  { "subdomain":"listuguj", "display_name":"...", "short":"LMG",
               "email_domain":"listuguj.ca", "housing_email":"housing@listuguj.ca",
               "primary_color":"#f8e41a",
               "modules_licensed": { "finance":true, "match":true } },
  "target":  { "ref":"<new-project-ref>", "url":"https://<ref>.supabase.co",
               "anon":"<publishable anon key>", "service_role":"<service key, used once>" },
  "first_ed": { "email":"ed@listuguj.ca", "name":"..." },
  "schema_sql": "<contents of supabase/bootstrap/schema.sql>"
}
```

## What it does (each step reported back, best-effort)

1. **bootstrap_schema** - runs `schema_sql` on the new project (Management API).
2. **storage_bucket**  - creates the `housing-files` bucket (new project service key).
3. **seed_first_ed**   - inserts the first `ed` staff row (new project service key).
4. **registry_row**    - upserts the `nations` row on the control plane; status
   `active` when a URL + anon key are supplied, else `provisioning`.
5. **edge_functions**  - **manual today**: deploy the 4 nation functions
   (`send-notification`, `tenant-mr`, `applicant-intake`, `ai-chat`) to the new
   project and set their secrets. Automated in P5.

## Security notes

- Super-admin gate is server-side (the JWT email must be in `super_admins`);
  the client role is never trusted.
- The new project's **service_role key** is passed in the request and used once
  (bucket + ED seed); it is never stored. Rotate it after go-live if desired.
  P5 (full auto) removes manual service-key handling by creating the project via
  the Management API.
- Every run writes a `platform_audit` row (`nation_provisioned`).
- Source is ASCII-only (Supabase dashboard editor requirement).
