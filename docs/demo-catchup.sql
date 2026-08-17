-- ============================================================================
-- DEMO (nation) project — catch-up SQL
-- Run this in the DEMO project's Supabase SQL Editor
--   (project ref rokjjamexbicwqloyaly, https://rokjjamexbicwqloyaly.supabase.co).
--
-- Brings a nation provisioned before these additions up to date. Every
-- statement is idempotent (create-or-replace / if-not-exists / drop-then-
-- create), so it is SAFE to run even if the project already has some of these.
--
-- Fixes: the /rpc/hs_data_usage 404 (Settings -> Nation data-usage panel), plus
-- a few later columns/tables fresh nations can be missing.
--
-- NOTE: this is NATION-side only. Control-plane SQL (nation_ai_key.sql,
-- nation_billing.sql, nation_invoices_amount_paid.sql) runs on the SEPARATE
-- fnhub-platform project, not here.
-- ============================================================================

-- ---- 1) Data & Storage usage RPC (the 404 fix) -----------------------------
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

  select jsonb_agg(t) into tables from (
    select c.relname::text as "table",
           pg_total_relation_size(c.oid) as bytes
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by pg_total_relation_size(c.oid) desc
    limit 15
  ) t;

  begin
    select coalesce(sum((metadata->>'size')::bigint), 0)
      into storage_bytes
    from storage.objects;
  exception when others then
    storage_bytes := null;
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

-- ---- 2) staff: optional access columns --------------------------------------
alter table public.staff
  add column if not exists magic_link         boolean not null default false;
alter table public.staff
  add column if not exists access_expires_at  date;
alter table public.staff
  add column if not exists feature_access      jsonb;

-- ---- 3) tenants: allow the 'applicant' status -------------------------------
alter table public.tenants drop constraint if exists tenants_status_check;
alter table public.tenants add constraint tenants_status_check
  check (status = any (array['applicant','active','former','deceased','evicted']));

-- ---- 4) applicant_invites (applicant-portal invite flow) --------------------
create table if not exists public.applicant_invites (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  app_id      text,
  invited_by  text,
  invited_at  timestamptz not null default now(),
  consumed_at timestamptz
);
create index if not exists applicant_invites_email_idx on public.applicant_invites (email, consumed_at);
alter table public.applicant_invites enable row level security;
drop policy if exists applicant_invites_staff_read on public.applicant_invites;
create policy applicant_invites_staff_read on public.applicant_invites
  for select using (
    exists (select 1 from public.staff s
            where lower(s.email) = lower(auth.jwt() ->> 'email') and s.is_active)
  );

-- Done. Reload the app; Settings -> Nation data usage should now report.
