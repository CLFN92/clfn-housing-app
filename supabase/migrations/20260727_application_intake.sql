-- ============================================================================
-- Tenant/applicant application intake - Phase T-A (schema + RLS + id sequence).
--
-- Security model (mirrors tenant_mr_submissions, extended for LOGGED-IN
-- applicants):
--   * Applicants get real Supabase Auth accounts (magic-link). They are a
--     SEPARATE population from staff - staff are gated everywhere by a row in
--     public.staff, and applicants are never in it, so existing staff-only RLS
--     already excludes them.
--   * Applicants NEVER touch housing_applications. They only ever see their OWN
--     rows in the quarantine table application_submissions (RLS on auth.uid()).
--   * ALL applicant WRITES go through the authenticated `applicant-intake` Edge
--     Function (service role) so every write rule lives server-side - there is
--     no direct applicant insert/update/delete policy.
--   * Staff review each submission and, on approval, create/update the real
--     housing_applications record via the existing app path (Phase T-C/T-D).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Quarantine table for applicant-submitted applications / updates / transfers.
-- ---------------------------------------------------------------------------
create table if not exists public.application_submissions (
  id               uuid primary key default gen_random_uuid(),
  applicant_uid    uuid not null,                        -- auth.users.id of the applicant
  submission_type  text not null default 'new',          -- new | update | transfer
  linked_app_id    text,                                  -- APP-xxxxxx this updates/transfers (staff-set)
  payload          jsonb not null default '{}'::jsonb,    -- full application field set (mirrors housing_applications.data)
  status           text not null default 'draft',         -- draft | submitted | in_review | changes_requested | approved | rejected | withdrawn
  review_notes     text,
  reviewed_by      text,
  reviewed_at      timestamptz,
  created_app_id   text,                                  -- APP-xxxxxx created/updated on approval
  submitted_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists app_sub_owner_idx  on public.application_submissions (applicant_uid, updated_at desc);
create index if not exists app_sub_status_idx on public.application_submissions (status, updated_at desc);
create index if not exists app_sub_linked_idx on public.application_submissions (linked_app_id);

alter table public.application_submissions enable row level security;

-- SELECT: the owning applicant sees their own rows; active staff see all.
drop policy if exists app_sub_select on public.application_submissions;
create policy app_sub_select on public.application_submissions
  for select using (
    applicant_uid = auth.uid()
    or exists (select 1 from public.staff s
               where lower(s.email) = lower(auth.jwt() ->> 'email') and s.is_active)
  );

-- UPDATE: active staff only (review / approve / reject / link). Applicant writes
-- happen ONLY through the Edge Function (service role, bypasses RLS).
drop policy if exists app_sub_staff_update on public.application_submissions;
create policy app_sub_staff_update on public.application_submissions
  for update using (
    exists (select 1 from public.staff s
            where lower(s.email) = lower(auth.jwt() ->> 'email') and s.is_active)
  );

-- Intentionally NO insert or delete policy: applicants cannot insert/delete
-- directly (the vetted Edge Function does it), and staff resolve rows by status
-- rather than deleting them.

-- ---------------------------------------------------------------------------
-- Per-applicant profile. `linked_app_ids` is the set of production apps staff
-- have tied to this account; it drives the portal's "new vs update/transfer"
-- choice WITHOUT any cross-record lookup. Staff/service-role write only.
-- ---------------------------------------------------------------------------
create table if not exists public.applicant_profiles (
  uid             uuid primary key,                       -- auth.users.id
  email           text,
  full_name       text,
  phone           text,
  linked_app_ids  text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.applicant_profiles enable row level security;

-- SELECT: owner sees their own profile; active staff see all.
drop policy if exists applicant_profiles_select on public.applicant_profiles;
create policy applicant_profiles_select on public.applicant_profiles
  for select using (
    uid = auth.uid()
    or exists (select 1 from public.staff s
               where lower(s.email) = lower(auth.jwt() ->> 'email') and s.is_active)
  );

-- UPDATE: active staff only (e.g. to set linked_app_ids). Profile creation +
-- benign self-updates happen through the Edge Function (service role).
drop policy if exists applicant_profiles_staff_update on public.applicant_profiles;
create policy applicant_profiles_staff_update on public.applicant_profiles
  for update using (
    exists (select 1 from public.staff s
            where lower(s.email) = lower(auth.jwt() ->> 'email') and s.is_active)
  );

-- ---------------------------------------------------------------------------
-- Server-side APP-xxxxxx sequence. Promotion (Phase T-C) will mint ids from
-- here instead of the client-side max()+1 scheme (a known collision risk in
-- PLAN.md). Starts well above the current highest client-minted id (~185) so
-- the two schemes never overlap in the near term; unifying the staff wizard
-- onto this sequence is a later cleanup.
-- ---------------------------------------------------------------------------
create sequence if not exists public.housing_app_id_seq start with 5000 increment by 1;

-- Returns the next id as 'APP-######' (zero-padded to 6 digits).
create or replace function public.next_housing_app_id() returns text
language sql volatile as $$
  select 'APP-' || lpad(nextval('public.housing_app_id_seq')::text, 6, '0');
$$;
