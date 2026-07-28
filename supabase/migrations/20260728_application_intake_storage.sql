-- Storage RLS for applicant-portal document uploads (Phase T-B.2).
--
-- Applicants (authenticated magic-link users) may upload/read/delete ONLY files
-- under their OWN quarantine folder:  application-intake/<their-uid>/...
-- Active staff may read all intake files (to review + carry them into the real
-- application on approval). No one else has access. These are additive policies
-- on storage.objects for the housing-files bucket; existing staff policies for
-- other paths (applications/, tenants/, units/) are untouched.
--
-- storage.foldername(name) -> text[] of path segments:
--   [1] = 'application-intake', [2] = <auth uid>, [3] = <submission id>, ...

drop policy if exists intake_owner_insert on storage.objects;
create policy intake_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'housing-files'
    and (storage.foldername(name))[1] = 'application-intake'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists intake_owner_select on storage.objects;
create policy intake_owner_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'housing-files'
    and (storage.foldername(name))[1] = 'application-intake'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists intake_owner_delete on storage.objects;
create policy intake_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'housing-files'
    and (storage.foldername(name))[1] = 'application-intake'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- Active staff may read every intake file (review + carry-forward on approval).
drop policy if exists intake_staff_select on storage.objects;
create policy intake_staff_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'housing-files'
    and (storage.foldername(name))[1] = 'application-intake'
    and exists (select 1 from public.staff s
                where lower(s.email) = lower(auth.jwt() ->> 'email') and s.is_active)
  );
