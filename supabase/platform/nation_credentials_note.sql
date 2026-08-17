-- ============================================================================
-- FN Hub CONTROL PLANE -- non-secret "where are the credentials" pointer.
-- Runs on the "fnhub-platform" project. Run in the platform SQL Editor.
--
-- IMPORTANT: this column is a REFERENCE ONLY (e.g. "1Password > Supabase >
-- fnhub-demo"). Never store a database password or service-role key here -- the
-- control plane is not a secret store and this value is readable by any signed-
-- in super-admin's browser.
-- ============================================================================

alter table public.nations
  add column if not exists credentials_note text;
