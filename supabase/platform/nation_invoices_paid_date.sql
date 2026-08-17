-- ============================================================================
-- FN Hub CONTROL PLANE -- add payment date to invoices (for overdue interest).
-- Runs on the "fnhub-platform" project. Run in the platform SQL Editor.
-- ============================================================================

alter table public.nation_invoices
  add column if not exists paid_date date;
