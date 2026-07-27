-- Add an optional tenant email to tenant maintenance-request submissions.
-- When a tenant enters an email on the scan-to-report form, the tenant-mr Edge
-- Function stores it here and emails them a confirmation. Idempotent.

alter table public.tenant_mr_submissions
  add column if not exists contact_email text;
