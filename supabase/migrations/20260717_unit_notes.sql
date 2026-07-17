-- unit_notes: an append-only note log per housing unit.
-- Mirrors tenant_notes so unit notes behave exactly like tenant notes:
-- each note is its own row (author + timestamp + body), added independently.
-- housing_units.id is TEXT (see the F2 schema note), so unit_id is TEXT.

create table if not exists public.unit_notes (
  id           uuid primary key default gen_random_uuid(),
  unit_id      text not null references public.housing_units(id) on delete cascade,
  note_body    text not null,
  author_name  text,
  author_email text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_unit_notes_unit_created
  on public.unit_notes (unit_id, created_at desc);

alter table public.unit_notes enable row level security;

-- Active staff (any role with get_my_role() set) can read + add unit notes.
-- No UPDATE/DELETE policy: notes are not editable/removable from the app,
-- matching the other note tables. If your tenant_notes policies differ, mirror
-- those here instead so unit notes and tenant notes share the same access.
drop policy if exists unit_notes_select_staff on public.unit_notes;
create policy unit_notes_select_staff on public.unit_notes
  for select using (public.get_my_role() is not null);

drop policy if exists unit_notes_insert_staff on public.unit_notes;
create policy unit_notes_insert_staff on public.unit_notes
  for insert with check (public.get_my_role() is not null);

grant select, insert on public.unit_notes to authenticated;
