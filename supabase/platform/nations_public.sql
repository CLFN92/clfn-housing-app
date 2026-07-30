-- ============================================================================
-- FN Hub — public registry projection (runs on the "fnhub-platform" project,
-- AFTER schema.sql).
--
-- The nation app resolves which nation it is by reading this at boot. The base
-- `nations` table is super-admin-only (RLS), so we expose a READ-ONLY view of
-- just the PUBLISHABLE fields for ACTIVE nations. supabase_anon is a publishable
-- key, safe to serve to the browser. No service keys, no internal columns.
--
-- The view is SECURITY DEFINER (owner = postgres), so it bypasses the base
-- table's RLS; anon/authenticated get SELECT on the view only.
-- ============================================================================

create or replace view public.nations_public as
  select subdomain,
         display_name,
         short,
         supabase_url,
         supabase_anon,
         primary_color,
         email_domain,
         housing_email,
         modules_licensed
    from public.nations
   where status = 'active';

grant select on public.nations_public to anon, authenticated;

-- ── Seed the lead nation (CLFN) so the fleet list shows it. This row is
-- INFORMATIONAL for the app today: the nation app keeps CLFN hardcoded as its
-- _default fallback and the registry never overrides a hardcoded nation, so
-- this row cannot affect CLFN's boot. It becomes authoritative only if/when the
-- hardcoded fallback is retired (P6).
insert into public.nations
  (subdomain, display_name, short, supabase_url, supabase_anon,
   email_domain, housing_email, modules_licensed, status, provisioned_by)
values
  ('clfn', 'Constance Lake First Nation', 'CLFN',
   'https://fkhzrbalumzeripzolph.supabase.co',
   'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZraHpyYmFsdW16ZXJpcHpvbHBoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMTAwODYsImV4cCI6MjA5MDg4NjA4Nn0.0nazS2W-0xzxWyFOuSe2jHhamC0N2WqKgAjrlRY6NQo',
   'clfn.on.ca', 'housing@clfn.on.ca',
   '{"finance":true,"match":true,"contractors":true,"renovations":true,"rfq":true,"mapping":true,"inspections":true,"ai_assistant":true}'::jsonb,
   'active', 'seed')
on conflict (subdomain) do nothing;
