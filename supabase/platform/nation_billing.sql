-- ============================================================================
-- FN Hub CONTROL PLANE -- recurring billing schedules (automated invoicing).
-- Runs on the "fnhub-platform" project. Super-admins only. Run in the platform
-- SQL Editor.
--
-- A nation_billing row is a subscription schedule: on each due date the
-- `recurring-invoices` Edge Function generates a nation_invoices row from it,
-- advances next_run_date by the cadence, and (when auto_send) emails the nation.
-- ============================================================================

create table if not exists public.nation_billing (
  id             uuid primary key default gen_random_uuid(),
  subdomain      text not null references public.nations(subdomain) on delete cascade,
  active         boolean not null default true,
  cadence        text not null default 'monthly',      -- 'monthly' | 'annual'
  description    text not null,                          -- invoice line description (e.g. "Subscription - Mid-size (monthly)")
  unit_amount    numeric(12,2) not null default 0,       -- amount per period (pre-tax)
  tax_rate       numeric(5,2)  not null default 0,        -- percent
  next_run_date  date not null,                           -- next date an invoice is generated
  anchor_day     int,                                     -- day-of-month to bill on (1-28); null = next_run_date's day
  due_days       int not null default 30,                 -- invoice due N days after issue
  auto_send      boolean not null default false,          -- email the invoice to the nation on generation
  recipient_email text,                                   -- billing contact (required when auto_send)
  cc_emails      text,                                     -- comma-separated CCs (optional)
  last_run_date  date,                                     -- last date an invoice was generated
  last_invoice   text,                                     -- last generated invoice number
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists nation_billing_sub_idx on public.nation_billing (subdomain);
create index if not exists nation_billing_due_idx on public.nation_billing (active, next_run_date);

alter table public.nation_billing enable row level security;
drop policy if exists nation_billing_all on public.nation_billing;
create policy nation_billing_all on public.nation_billing for all
  using (public.is_super_admin()) with check (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- SCHEDULING (run ONCE, after deploying the recurring-invoices function and
-- setting its secrets). Requires the pg_cron and pg_net extensions.
--
-- 1) Enable the extensions (Dashboard -> Database -> Extensions, or):
--      create extension if not exists pg_cron;
--      create extension if not exists pg_net;
--
-- 2) Schedule a daily call to the Edge Function. Replace <PLATFORM_REF> with the
--    platform project ref and <CRON_SECRET> with the same value you set as the
--    CRON_SECRET Edge Function secret. Runs daily at 13:00 UTC (~8-9am Eastern).
--
--      select cron.schedule(
--        'recurring-invoices-daily',
--        '0 13 * * *',
--        $$
--        select net.http_post(
--          url     := 'https://<PLATFORM_REF>.functions.supabase.co/recurring-invoices',
--          headers := jsonb_build_object(
--                       'Content-Type', 'application/json',
--                       'x-cron-secret', '<CRON_SECRET>'),
--          body    := '{}'::jsonb
--        );
--        $$
--      );
--
-- 3) To change or remove the schedule later:
--      select cron.unschedule('recurring-invoices-daily');
-- ---------------------------------------------------------------------------
