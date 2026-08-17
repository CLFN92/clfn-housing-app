-- Per-nation logo (data URI or URL) for the admin-managed branding. Run on the
-- control-plane project. Recreates nations_public to expose it.
alter table public.nations add column if not exists logo text;

create or replace view public.nations_public as
  select subdomain, display_name, short, supabase_url, supabase_anon,
         primary_color, logo, email_domain, housing_email, modules_licensed
    from public.nations where status = 'active';
grant select on public.nations_public to anon, authenticated;
