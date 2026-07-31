# Bootstrap schema (for provisioning new nations)

`provision-nation` (P4) replays a **reproducible schema dump** of CLFN's project
onto each new nation's Supabase project, so every nation starts with the same
tables, RLS, triggers, functions, and sequences.

## Produce it (you run this)

With the Supabase CLI linked to the **CLFN** project:

```
supabase db dump --linked -f supabase/bootstrap/schema.sql
```

Commit `supabase/bootstrap/schema.sql`. The panel's provisioning wizard uploads
this file; its contents are sent to `provision-nation` and applied to the new
project via the Supabase Management API.

## Keep it current

Regenerate this dump whenever migrations land, or new nations will start behind
(Section 10, "Schema drift", in `docs/SUPER-ADMIN-PLAN.md`).

> `schema.sql` is intentionally **not committed yet** - produce it with the
> command above. Until it exists, the wizard's schema step reports "skipped".
