-- Passwordless (magic-link) sign-in — per user.
-- When TRUE, this user may sign in with an emailed magic link. FALSE (the default
-- and the value for every existing row) means password sign-in only: a magic-link
-- attempt for them is rejected at completion. Intended for consultants / external
-- users so regular staff keep using passwords.
--
-- Run in the Supabase SQL Editor.

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS magic_link boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.staff.magic_link IS
  'When true, this user may sign in via emailed magic link. false = password sign-in only. Set from Settings -> Users; enforced at magic-link completion.';
