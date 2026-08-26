-- BCR registry: one ACTIVE row per person (case-insensitive name).
-- Complements the client-side server-check dedupe in sbAddBcr — without this
-- index, two truly simultaneous adds (or a stale tab racing the Tenant-Card
-- stub) can still both insert, and "Lift" then only deactivates one row while
-- the duplicate keeps the person blocked.
--
-- Run per nation (SQL Editor or Fleet Migrations).

-- 1. Deactivate historical duplicates first (keep the newest active row per
--    name) so the unique index can be created.
update public.bcr_registry b
   set active = false,
       lifted_at = now(),
       lifted_by = 'migration-dedupe-20260826'
 where b.active = true
   and exists (
     select 1
       from public.bcr_registry b2
      where b2.active = true
        and lower(trim(b2.full_name)) = lower(trim(b.full_name))
        and (b2.created_at > b.created_at
             or (b2.created_at = b.created_at and b2.id > b.id))
   );

-- 2. Enforce going forward.
create unique index if not exists bcr_registry_active_name_uniq
  on public.bcr_registry (lower(trim(full_name)))
  where active = true;
