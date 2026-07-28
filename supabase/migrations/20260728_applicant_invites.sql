-- Staff-initiated portal invites: pre-link an existing application to an
-- applicant's email so that when they accept the invite and sign in, their
-- portal shows their real application (update / transfer) instead of "start new".
--
-- Written only by the applicant-intake Edge Function (service role) on invite;
-- consumed on the applicant's first sign-in (ping) to populate
-- applicant_profiles.linked_app_ids. Idempotent.

create table if not exists public.applicant_invites (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,               -- lower-cased applicant email
  app_id      text,                         -- APP-xxxxxx to link on accept (optional)
  invited_by  text,                          -- staff email who sent it
  invited_at  timestamptz not null default now(),
  consumed_at timestamptz                    -- set when the applicant signs in
);

create index if not exists applicant_invites_email_idx on public.applicant_invites (email, consumed_at);

alter table public.applicant_invites enable row level security;

-- Active staff may read (to see invite status); all writes go through the Edge
-- Function (service role). No client insert/update/delete policy.
drop policy if exists applicant_invites_staff_read on public.applicant_invites;
create policy applicant_invites_staff_read on public.applicant_invites
  for select using (
    exists (select 1 from public.staff s
            where lower(s.email) = lower(auth.jwt() ->> 'email') and s.is_active)
  );
