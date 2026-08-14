-- Phase FA (Access Expiry): time-box a staff member's access.
-- access_expires_at is an optional calendar date; access works through the whole
-- of that local day and is denied afterward. NULL = no expiry (the default and
-- the value for every existing row). Enforced at login in resolveHousingRole():
-- an expired user is denied regardless of auth method (password or magic link).
-- Deny is by DATE COMPARISON only -- it does not flip is_active -- so extending
-- the date restores access instantly.
--
-- Run in the Supabase SQL Editor.

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS access_expires_at date;

COMMENT ON COLUMN public.staff.access_expires_at IS
  'Optional access expiry date (inclusive). NULL = no expiry. Enforced client-side at login; access denied after this date. Does not change is_active.';
