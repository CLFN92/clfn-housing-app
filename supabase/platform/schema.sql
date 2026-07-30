-- ============================================================================
-- FN Hub — CONTROL PLANE schema (runs on the dedicated "fnhub-platform"
-- Supabase project, NOT on any nation's project).
--
-- Holds the nations registry, the super-admin allow-list, and a platform audit
-- trail. Access is gated to super-admins (allow-list) via RLS. Provisioning
-- secrets (Supabase Management API / Cloudflare tokens, nation service keys)
-- NEVER live here — they stay in the provision-nation Edge Function's secrets.
-- ============================================================================

-- ── Super-admin allow-list ──────────────────────────────────────────────────
create table if not exists public.super_admins (
  email     text primary key,
  added_by  text,
  added_at  timestamptz not null default now()
);
-- Seed the first platform admin (as requested). Others are added in-panel.
insert into public.super_admins (email, added_by)
  values ('kevint.proctor@gmail.com', 'seed')
  on conflict (email) do nothing;

-- Membership check used by every policy below.
create or replace function public.is_super_admin() returns boolean
  language sql stable as $$
  select exists (
    select 1 from public.super_admins sa
    where lower(sa.email) = lower(auth.jwt() ->> 'email')
  );
$$;

-- ── Nations registry (source of truth; becomes nations.json) ────────────────
create table if not exists public.nations (
  id               uuid primary key default gen_random_uuid(),
  subdomain        text unique not null,               -- e.g. 'clfn' -> clfn.fnhub.app
  display_name     text not null,
  short            text not null,
  supabase_url     text,                                -- the nation's own project (publishable)
  supabase_anon    text,                                -- publishable anon key (safe client-side)
  primary_color    text,
  email_domain     text,                                -- staff email gate for that nation
  housing_email    text,
  modules_licensed jsonb not null default '{}'::jsonb,  -- which optional modules the nation MAY use
  status           text not null default 'provisioning',-- provisioning | active | suspended
  provisioned_by   text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists nations_status_idx on public.nations (status);

-- ── Platform audit (append-only) ────────────────────────────────────────────
create table if not exists public.platform_audit (
  id         uuid primary key default gen_random_uuid(),
  actor      text,
  action     text,
  target     text,
  detail     text,
  created_at timestamptz not null default now()
);
create index if not exists platform_audit_ts_idx on public.platform_audit (created_at desc);

-- ── RLS: super-admins only ──────────────────────────────────────────────────
alter table public.super_admins  enable row level security;
alter table public.nations        enable row level security;
alter table public.platform_audit enable row level security;

drop policy if exists super_admins_read   on public.super_admins;
drop policy if exists super_admins_insert on public.super_admins;
drop policy if exists super_admins_delete on public.super_admins;
create policy super_admins_read   on public.super_admins for select using (public.is_super_admin());
create policy super_admins_insert on public.super_admins for insert with check (public.is_super_admin());
create policy super_admins_delete on public.super_admins for delete using (public.is_super_admin());

drop policy if exists nations_all on public.nations;
create policy nations_all on public.nations for all
  using (public.is_super_admin()) with check (public.is_super_admin());

drop policy if exists platform_audit_read   on public.platform_audit;
drop policy if exists platform_audit_insert on public.platform_audit;
create policy platform_audit_read   on public.platform_audit for select using (public.is_super_admin());
create policy platform_audit_insert on public.platform_audit for insert with check (public.is_super_admin());

-- Note: nations.supabase_anon is a PUBLISHABLE key, safe to expose to the nation
-- app via nations.json. Service-role keys are never stored in this table.
