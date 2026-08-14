-- Phase FA: per-user Feature Access
-- Adds an optional feature_access list to each staff row. A non-empty JSON array
-- (of feature keys, e.g. ["contractors","rfq","maintenance_requests"]) confines
-- that user to those functions; NULL = no restriction (full access, the default
-- and the value for every existing row). Enforced client-side (nav hiding + page
-- guard) and read at login via resolveHousingRole().
--
-- Run in the Supabase SQL Editor.

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS feature_access jsonb;

COMMENT ON COLUMN public.staff.feature_access IS
  'Optional per-user feature allowlist (JSON array of feature keys). NULL = full access. Used by the app''s Feature Access gate; does not grant approval rights.';
