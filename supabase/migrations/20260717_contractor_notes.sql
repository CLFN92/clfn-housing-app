-- contractor_notes: an append-only note log per contractor.
-- Mirrors tenant_notes / unit_notes so contractor notes behave exactly the
-- same: each note is its own row (author + timestamp + body), added
-- independently. housing_contractors.id is TEXT (e.g. 'CT-1750000000000'),
-- so contractor_id is TEXT.

create table if not exists public.contractor_notes (
  id            uuid primary key default gen_random_uuid(),
  contractor_id text not null references public.housing_contractors(id) on delete cascade,
  note_body     text not null,
  author_name   text,
  author_email  text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_contractor_notes_ct_created
  on public.contractor_notes (contractor_id, created_at desc);

alter table public.contractor_notes enable row level security;

-- Active staff (any role with get_my_role() set) can read + add notes.
-- No UPDATE/DELETE policy: notes are not editable/removable from the app,
-- matching tenant_notes / unit_notes. If your tenant_notes policies differ,
-- mirror those here so all note tables share the same access.
drop policy if exists contractor_notes_select_staff on public.contractor_notes;
create policy contractor_notes_select_staff on public.contractor_notes
  for select using (public.get_my_role() is not null);

drop policy if exists contractor_notes_insert_staff on public.contractor_notes;
create policy contractor_notes_insert_staff on public.contractor_notes
  for insert with check (public.get_my_role() is not null);

grant select, insert on public.contractor_notes to authenticated;
