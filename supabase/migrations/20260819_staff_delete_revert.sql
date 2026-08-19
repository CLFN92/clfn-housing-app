-- Revert the staff hard-delete policy back to the safe default: NO deletes on the
-- staff table (deactivate instead, so audit history is preserved). Run this on any
-- project where 20260819_staff_ed_delete.sql was applied. The app no longer offers
-- a Delete button; an inactive user is brought back with Reactivate, which also
-- recreates their login if it was removed.
drop policy if exists staff_delete_ed_inactive on public.staff;
drop policy if exists staff_no_delete on public.staff;
create policy staff_no_delete on public.staff as permissive for delete to authenticated using (false);
