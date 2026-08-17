-- ============================================================================
-- FN Hub CONTROL PLANE -- record payments against invoices (partial/full).
-- Runs on the "fnhub-platform" project. Run in the platform SQL Editor.
--
-- amount_paid tracks the total received so far; the outstanding balance is
-- (total - amount_paid). An invoice settles (status 'paid') once the balance
-- reaches zero; a positive balance on a 'sent' invoice shows as partially paid
-- and feeds the Nation Information Card "Outstanding" KPI and carry-forward.
-- ============================================================================

alter table public.nation_invoices
  add column if not exists amount_paid numeric(12,2) not null default 0;
