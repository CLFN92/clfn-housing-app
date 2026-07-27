-- Rate-limit log for applicant-portal magic-link requests.
--
-- We generate + send the magic-link email ourselves (through the nation's own
-- email pipeline) instead of Supabase's built-in sender, so we must re-add the
-- abuse throttle that the built-in /otp endpoint provided. The applicant-intake
-- Edge Function writes/reads this with the service role; it degrades gracefully
-- (skips limiting) if this table has not been created yet.

create table if not exists public.magic_link_requests (
  id         uuid primary key default gen_random_uuid(),
  email      text,
  ip         text,
  created_at timestamptz not null default now()
);

create index if not exists mlr_email_idx on public.magic_link_requests (email, created_at desc);
create index if not exists mlr_ip_idx    on public.magic_link_requests (ip, created_at desc);

alter table public.magic_link_requests enable row level security;
-- No policies: service-role only (the Edge Function). No client access at all.
