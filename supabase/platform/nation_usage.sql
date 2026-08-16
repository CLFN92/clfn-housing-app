-- ============================================================================
-- FN Hub CONTROL PLANE -- per-nation data & storage usage (push model).
-- Runs on the "fnhub-platform" project (NOT a nation project).
--
-- Each nation's app reports its own database + file-storage byte counts up to
-- this table when a manager opens Settings -> Nation. The numbers are written
-- ONLY by the report-nation-usage Edge Function (service_role, which bypasses
-- RLS); that function first proves the caller is a real management user of the
-- nation by round-tripping their token through the nation's own, management-
-- gated hs_data_usage() function -- so nothing here is client-forgeable and no
-- nation service-role key is ever stored.
--
-- Super-admins read it in the admin panel. Run in the platform SQL Editor.
-- ============================================================================

create table if not exists public.nation_usage (
  subdomain      text primary key
                   references public.nations(subdomain) on delete cascade,
  database_bytes bigint,
  storage_bytes  bigint,
  reported_by    text,
  reported_at    timestamptz not null default now()
);

alter table public.nation_usage enable row level security;

-- Read: super-admins only (mirrors nations / platform_audit).
drop policy if exists nation_usage_read on public.nation_usage;
create policy nation_usage_read on public.nation_usage
  for select using (public.is_super_admin());

-- No INSERT/UPDATE/DELETE policy: the only writer is the Edge Function using
-- the service_role key, which bypasses RLS. Browser clients (anon/authenticated)
-- therefore cannot write here directly.
