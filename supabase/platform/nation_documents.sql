-- ============================================================================
-- FN Hub CONTROL PLANE -- per-nation document library (contracts, BCRs, etc.).
-- Runs on the "fnhub-platform" project. Super-admins only.
--
-- Files live in a PRIVATE Storage bucket `nation-docs`, keyed by subdomain
-- (path: <subdomain>/<uuid>_<filename>). The nation_documents table holds the
-- metadata the admin panel lists. Run in the platform SQL Editor.
-- ============================================================================

-- Metadata table.
create table if not exists public.nation_documents (
  id           uuid primary key default gen_random_uuid(),
  subdomain    text not null references public.nations(subdomain) on delete cascade,
  name         text not null,           -- display filename
  path         text not null,           -- object path within the nation-docs bucket
  kind         text,                    -- e.g. 'agreement', 'bcr', 'other'
  size_bytes   bigint,
  uploaded_by  text,
  uploaded_at  timestamptz not null default now()
);
create index if not exists nation_documents_sub_idx on public.nation_documents (subdomain, uploaded_at desc);

alter table public.nation_documents enable row level security;
drop policy if exists nation_documents_all on public.nation_documents;
create policy nation_documents_all on public.nation_documents for all
  using (public.is_super_admin()) with check (public.is_super_admin());

-- Private Storage bucket.
insert into storage.buckets (id, name, public)
  values ('nation-docs', 'nation-docs', false)
  on conflict (id) do nothing;

-- Storage policies: super-admins only, scoped to the nation-docs bucket.
drop policy if exists nation_docs_read   on storage.objects;
drop policy if exists nation_docs_insert on storage.objects;
drop policy if exists nation_docs_delete on storage.objects;
create policy nation_docs_read   on storage.objects for select
  using (bucket_id = 'nation-docs' and public.is_super_admin());
create policy nation_docs_insert on storage.objects for insert
  with check (bucket_id = 'nation-docs' and public.is_super_admin());
create policy nation_docs_delete on storage.objects for delete
  using (bucket_id = 'nation-docs' and public.is_super_admin());
