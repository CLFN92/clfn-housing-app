-- ============================================================================
-- FN Hub CONTROL PLANE -- per-nation invoice discounts.
-- Runs on the "fnhub-platform" project. Super-admins only. Run in the platform
-- SQL Editor. Idempotent -- safe to re-run.
--
-- Two layers:
--   nation_invoices  -- the discount actually applied to one invoice
--                       (percent-of-subtotal or fixed dollar amount, taken off
--                       before tax; printed as its own line on the PDF/email).
--   nation_billing   -- a standing discount on a nation's recurring schedule,
--                       applied to the period fee of every generated invoice
--                       (never to carried-forward balances, which are already
--                       tax-inclusive prior totals).
-- ============================================================================

alter table public.nation_invoices add column if not exists discount_type  text;                            -- 'percent' | 'fixed' | null
alter table public.nation_invoices add column if not exists discount_value numeric(12,2) not null default 0; -- the % number or the $ amount entered
alter table public.nation_invoices add column if not exists discount       numeric(12,2) not null default 0; -- computed $ amount taken off
alter table public.nation_invoices add column if not exists discount_label text;                            -- reason shown on the invoice

alter table public.nation_billing  add column if not exists discount_type  text;                            -- 'percent' | 'fixed' | null
alter table public.nation_billing  add column if not exists discount_value numeric(12,2) not null default 0;
alter table public.nation_billing  add column if not exists discount_label text;
