-- ============================================================================
-- FN Hub CONTROL PLANE -- add nations.email (per-nation email delivery config).
-- Runs on the "fnhub-platform" project SQL Editor. Idempotent.
--
-- The jsonb object mirrors the shape the nation app already consumes
-- (shared-config.js _mapNationRow -> NATION_CONFIG.email_config):
--   { "provider": "graph" | "resend" | "sendgrid",
--     "from": "demo@fnhub.app", "from_name": "FN Hub Demo Housing",
--     "reply_to": "someone@monitored.example" }
-- NO SECRETS live here -- API keys stay in each nation project's Edge Function
-- secrets; the send-notification function only honours a requested provider
-- whose keys are configured server-side. This column is publishable config,
-- so it IS exposed via nations_public (the app needs it at boot).
--
-- DROP + CREATE the view (CREATE OR REPLACE can't insert a column mid-list);
-- the grant is re-applied after the drop.
-- ============================================================================
alter table public.nations add column if not exists email jsonb;

drop view if exists public.nations_public;
create view public.nations_public as
  select subdomain, display_name, short, supabase_url, supabase_anon,
         primary_color, logo, email_domain, housing_email, email,
         modules_licensed
    from public.nations where status = 'active';

grant select on public.nations_public to anon, authenticated;
