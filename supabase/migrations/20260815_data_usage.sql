-- Data & Storage usage reporting for Settings -> Nation.
-- Returns real byte sizes (PostgREST can't measure bytes on its own), so staff
-- can watch the two Supabase tiers this app can actually exceed: database disk
-- (8 GB) and file storage (100 GB). Management only.
--
-- Gate is SELF-CONTAINED: it resolves the caller's role directly from the
-- staff table by JWT email, so it does NOT depend on any RLS helper function
-- (the hs_is_mgmt() / hs_role() family was dropped by 20260703b, which is why
-- an earlier version of this function created cleanly but failed at runtime).
--
-- Run in the Supabase SQL Editor.

create or replace function public.hs_data_usage()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_email  text;
  caller_role   text;
  db_bytes      bigint;
  storage_bytes bigint;
  tables        jsonb;
begin
  -- Gate: active management staff only (ED / super_user / Housing Manager).
  -- Resolved from the staff table, tolerant of legacy role strings.
  caller_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  select lower(coalesce(role, ''))
    into caller_role
    from public.staff
   where lower(email) = caller_email
     and coalesce(is_active, true) = true
   limit 1;

  if caller_role is null
     or caller_role not in ('ed','super_user','housing_manager','hm','manager') then
    raise exception 'not permitted';
  end if;

  select pg_database_size(current_database()) into db_bytes;

  -- Largest public tables by total on-disk size (table + indexes + toast).
  select jsonb_agg(t) into tables from (
    select c.relname::text as "table",
           pg_total_relation_size(c.oid) as bytes
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by pg_total_relation_size(c.oid) desc
    limit 15
  ) t;

  -- Sum of stored file sizes across all Storage buckets.
  begin
    select coalesce(sum((metadata->>'size')::bigint), 0)
      into storage_bytes
    from storage.objects;
  exception when others then
    storage_bytes := null;   -- storage schema not reachable / empty
  end;

  return jsonb_build_object(
    'database_bytes', db_bytes,
    'storage_bytes',  storage_bytes,
    'tables',         coalesce(tables, '[]'::jsonb),
    'generated_at',   now()
  );
end;
$$;

grant execute on function public.hs_data_usage() to authenticated;
