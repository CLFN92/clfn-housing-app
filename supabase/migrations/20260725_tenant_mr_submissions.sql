-- ════════════════════════════════════════════════════════════════════════════
-- Tenant-submitted maintenance requests (scan-to-report QR flow).
--
-- Security boundary: external tenants NEVER touch housing_sow or any production
-- table. They submit through the public `tenant-mr` Edge Function, which validates
-- the unit's per-unit secret token, rate-limits, and inserts here with the SERVICE
-- ROLE (bypassing RLS). Staff review each row in the main app and, on approval,
-- create the real maintenance request (SOW). This table is the quarantine.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.tenant_mr_submissions (
  id                 uuid primary key default gen_random_uuid(),
  unit_id            text not null,
  unit_address       text,
  category           text,
  description        text not null,
  urgency            text default 'routine',          -- routine | urgent | emergency
  contact_name       text,
  contact_phone      text,
  photo_path         text,                             -- JSON array of Storage paths for tenant-uploaded photos
  status             text not null default 'new',      -- new | approved | rejected
  source_ip          text,
  created_at         timestamptz not null default now(),
  reviewed_by        text,
  reviewed_at        timestamptz,
  review_notes       text,
  sow_project_number text                              -- linked SOW once approved
);

create index if not exists tenant_mr_status_idx on public.tenant_mr_submissions (status, created_at desc);
create index if not exists tenant_mr_unit_idx   on public.tenant_mr_submissions (unit_id, created_at desc);
create index if not exists tenant_mr_ip_idx     on public.tenant_mr_submissions (source_ip, created_at desc);

alter table public.tenant_mr_submissions enable row level security;

-- No anon / tenant policy exists → all direct access is DENIED. Inserts happen
-- only through the Edge Function (service role bypasses RLS). Active staff may
-- read and update rows (to review / approve / reject) from the main app.
drop policy if exists tenant_mr_staff_read on public.tenant_mr_submissions;
create policy tenant_mr_staff_read on public.tenant_mr_submissions
  for select using (
    exists (select 1 from public.staff s
            where lower(s.email) = lower(auth.jwt() ->> 'email') and s.is_active)
  );

drop policy if exists tenant_mr_staff_update on public.tenant_mr_submissions;
create policy tenant_mr_staff_update on public.tenant_mr_submissions
  for update using (
    exists (select 1 from public.staff s
            where lower(s.email) = lower(auth.jwt() ->> 'email') and s.is_active)
  );

-- Intentionally NO insert or delete policy: even authenticated staff cannot
-- insert (submissions come only from the vetted Edge Function) or delete
-- (rows are resolved by status, never removed).
