-- ============================================================================
-- housing_application_notes — append-only internal notes on applications
-- ============================================================================
-- Internal staff notes attached to a housing application. Visible at every
-- stage of the application (draft, submitted, approved, assigned, …). Notes
-- cannot be edited or deleted — only inserted. Author identity (name + role)
-- is denormalized into the row so historical attribution stays correct even
-- if the staff record is later changed.
--
-- Run via Supabase SQL Editor. Idempotent.
-- ============================================================================

create table if not exists public.housing_application_notes (
  id              uuid          primary key default gen_random_uuid(),
  app_id          text          not null,
  body            text          not null check (length(trim(body)) > 0),
  author_user_id  uuid,
  author_email    text,
  author_name     text,
  author_role     text,
  created_at      timestamptz   not null default now()
);

create index if not exists idx_housing_app_notes_app_id_created
  on public.housing_application_notes (app_id, created_at desc);

-- ── RLS — append-only ──────────────────────────────────────────────────────
alter table public.housing_application_notes enable row level security;

-- Drop existing policies so this script is re-runnable.
drop policy if exists "app_notes_select_authenticated"
  on public.housing_application_notes;
drop policy if exists "app_notes_insert_authenticated"
  on public.housing_application_notes;
drop policy if exists "app_notes_block_update"
  on public.housing_application_notes;
drop policy if exists "app_notes_block_delete"
  on public.housing_application_notes;

create policy "app_notes_select_authenticated"
  on public.housing_application_notes
  for select
  to authenticated
  using (true);

create policy "app_notes_insert_authenticated"
  on public.housing_application_notes
  for insert
  to authenticated
  with check (true);

-- No UPDATE / DELETE policies = the operations are denied for everyone
-- (anon + authenticated). Service_role bypasses RLS but should not be used
-- from the client.

-- Belt-and-suspenders: trigger that hard-blocks UPDATE/DELETE even for
-- accidental service_role calls.
create or replace function public._block_app_notes_mutation()
  returns trigger
  language plpgsql
as $$
begin
  raise exception 'housing_application_notes is append-only — UPDATE/DELETE not permitted';
end;
$$;

drop trigger if exists trg_block_app_notes_update on public.housing_application_notes;
drop trigger if exists trg_block_app_notes_delete on public.housing_application_notes;

create trigger trg_block_app_notes_update
  before update on public.housing_application_notes
  for each row execute function public._block_app_notes_mutation();

create trigger trg_block_app_notes_delete
  before delete on public.housing_application_notes
  for each row execute function public._block_app_notes_mutation();
