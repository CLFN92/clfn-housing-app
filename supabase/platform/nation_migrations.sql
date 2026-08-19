-- ============================================================================
-- FN Hub CONTROL PLANE -- fleet migration ledger.
-- Runs on the "fnhub-platform" project. Super-admins only. Run in the platform
-- SQL Editor.
--
-- Records which schema migration has been applied to which nation project, so
-- the run-nation-migration Edge Function can skip already-applied nations and
-- you can see fleet coverage at a glance. One row per (subdomain, migration);
-- re-running updates the row (status/detail/applied_at).
-- ============================================================================
create table if not exists public.nation_migrations (
  id         uuid primary key default gen_random_uuid(),
  subdomain  text not null references public.nations(subdomain) on delete cascade,
  migration  text not null,                 -- filename (e.g. 20260819_labels_module.sql) or a label for pasted SQL
  status     text not null,                 -- applied | failed
  detail     text,
  applied_by text,
  applied_at timestamptz not null default now(),
  unique (subdomain, migration)
);
create index if not exists nation_migrations_mig_idx on public.nation_migrations (migration);

alter table public.nation_migrations enable row level security;
drop policy if exists nation_migrations_all on public.nation_migrations;
create policy nation_migrations_all on public.nation_migrations for all
  using (public.is_super_admin()) with check (public.is_super_admin());

grant select, insert, update, delete on public.nation_migrations to authenticated, service_role;
