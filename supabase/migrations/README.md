# Database migrations (versioned schema)

Until now the schema was hand-applied in the Supabase SQL editor. For the
multi-nation platform (PLAN.md Phase N) the schema must be **versioned and
reproducible** so every nation's project is provisioned identically.

## The base schema is captured from the lead nation (CLFN)

CLFN's live database already contains the complete, current schema (every table,
RLS policy, trigger, function, and storage policy that has ever been applied —
including the historical one-off SQL in `../sql/` and `../../rfq-migration.sql`).
So the canonical migration is a **dump of CLFN**, not a hand-rebuild.

Generate it once (requires the Supabase CLI, linked to CLFN):

```bash
supabase login
supabase link --project-ref fkhzrbalumzeripzolph        # CLFN
# Schema only (no data) — this becomes migration 0001:
supabase db dump --schema public,storage -f supabase/migrations/0001_init_schema.sql
```

Commit `0001_init_schema.sql`. From then on, **every schema change is a new
numbered migration file** here (e.g. `0002_add_x.sql`), applied to *all* nations
— never hand-edited in the SQL editor again. Use `supabase migration new <name>`
to scaffold each one.

## Historical SQL (already baked into CLFN, kept for reference)

- `../sql/2026-05-13_housing_application_notes.sql`
- `../../rfq-migration.sql`

These are part of CLFN's current schema, so they're already inside the
`0001_init_schema.sql` dump. They're retained only as change history — you do
**not** re-apply them when standing up a new nation.

## Edge Functions & secrets

`supabase/functions/` (e.g. `send-notification`) deploy per project with
`supabase functions deploy`; secrets are set per project. See
`../README.md` for the full per-nation provisioning runbook.
