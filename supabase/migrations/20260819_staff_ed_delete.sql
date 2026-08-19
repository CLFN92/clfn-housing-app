-- Allow ED / super_user to HARD-DELETE a DEACTIVATED staff row, so an orphaned
-- record (e.g. its Supabase Auth user was deleted out-of-band) can be removed and
-- the person re-added cleanly. ACTIVE staff still cannot be deleted -- deactivate
-- first -- so normal departures keep their audit history. Replaces staff_no_delete.
-- Run in each nation project's SQL Editor (or via the control-plane fleet runner).
drop policy if exists staff_no_delete on public.staff;
drop policy if exists staff_delete_ed_inactive on public.staff;
create policy staff_delete_ed_inactive on public.staff as permissive for delete to authenticated
  using (get_my_role() in ('ed','super_user') and is_active = false);
