-- Per-nation logo (data URI or URL) for admin-managed branding. Run on the
-- control-plane project. DROP + CREATE the view (CREATE OR REPLACE can't insert
-- a column mid-list); the grant is re-applied after the drop.
alter table public.nations add column if not exists logo text;

drop view if exists public.nations_public;
create view public.nations_public as
  select subdomain, display_name, short, supabase_url, supabase_anon,
         primary_color, logo, email_domain, housing_email, modules_licensed
    from public.nations where status = 'active';

grant select on public.nations_public to anon, authenticated;
