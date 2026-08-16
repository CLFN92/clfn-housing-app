-- Data & Storage usage reporting for Settings -> Nation.
-- Returns real byte sizes (PostgREST can't measure bytes on its own), so staff
-- can watch the two Supabase tiers this app can actually exceed: database disk
-- (8 GB) and file storage (100 GB). Management only.
--
-- Run in the Supabase SQL Editor.

create or replace function public.hs_data_usage()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  db_bytes      bigint;
  storage_bytes bigint;
  tables        jsonb;
begin
  -- Gate: management (ED / super_user / Housing Manager) only.
  if not public.hs_is_mgmt() then
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
