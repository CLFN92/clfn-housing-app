-- ============================================================================
-- 20260703_rls_lockdown.sql — Row Level Security lockdown (SECURITY_REVIEW S0)
--
-- WHY: the app is a static SPA that talks to Supabase with the PUBLIC anon key
-- and the signed-in user's JWT. Every "who can do what" rule (approvals, staff/
-- role management, settings, finance, storage) is currently enforced only in the
-- BROWSER. Without RLS, anyone with one valid staff login + the (public) anon key
-- can hit /rest/v1/* directly and, e.g., PATCH their own staff row to role='ed',
-- forge approvals, award RFQs, rewrite the approval-authority config, or delete
-- audit rows. RLS is the real server-side boundary; this migration installs it.
--
-- MODEL: role-TIER based (not the app's full fine-grained, runtime-configurable
-- APPROVAL_AUTHORITY matrix — that lives in housing_settings and is ED-editable,
-- so it can't be mirrored in static SQL). The tiers below are a coarse backstop
-- that CLOSES THE CATASTROPHIC ESCALATIONS while leaving the fine-grained
-- approve-vs-edit gating to the client (all housing-office roles are trusted
-- staff). The caller's role is read from public.staff by email (same lookup the
-- app + Edge Functions use), via SECURITY DEFINER helpers that bypass staff's
-- own RLS so role resolution can't deadlock.
--
-- HOW TO RUN: Supabase SQL Editor (or `supabase db push`) for THIS nation's
-- project. Idempotent + re-runnable. service_role (Edge Functions, SQL editor)
-- BYPASSES RLS, so server-side jobs and this script itself are unaffected.
--
-- ROLLBACK (if a legitimate flow breaks): the offending table can be reopened
-- with  `alter table public.<t> disable row level security;`  while you adjust
-- its tier — the helpers + other tables stay locked. Test the app end-to-end
-- per role after applying (esp. add-staff as HM, SOW save as field_employee,
-- finance postings as CFO).
--
-- NOTE: housing_application_notes already has its own append-only RLS migration
-- (supabase/sql/2026-05-13_housing_application_notes.sql) — intentionally NOT
-- re-defined here. finance_* / legacy `contractors` blocks are guarded with
-- to_regclass so nations without those tables skip them cleanly.
-- ============================================================================

-- ── Role helpers ────────────────────────────────────────────────────────────
-- SECURITY DEFINER + locked search_path: read the caller's canonical, active
-- role from staff regardless of staff's own RLS. Email-keyed, case-insensitive
-- (staff emails are stored lowercased by the app but we don't rely on it), with
-- the same legacy-string normalization the app uses (CLFN_PERMS.normalizeRole /
-- the Edge Function normRole).
create or replace function public.hs_role()
  returns text
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select case lower(coalesce(s.role, ''))
           when 'hm'                 then 'housing_manager'
           when 'manager'            then 'housing_manager'
           when 'employee'           then 'housing_employee_l1'
           when 'staff'              then 'housing_employee_l1'
           when 'executive_director' then 'ed'
           when 'executivedirector'  then 'ed'
           else lower(s.role)
         end
  from public.staff s
  where lower(s.email) = lower(auth.jwt() ->> 'email')
    and s.is_active = true
  limit 1
$$;

create or replace function public.hs_is_staff() returns boolean
  language sql stable set search_path = public, pg_temp
  as $$ select public.hs_role() is not null $$;

-- ED tier: super_user inherits everything granted to ED.
create or replace function public.hs_is_ed_tier() returns boolean
  language sql stable set search_path = public, pg_temp
  as $$ select public.hs_role() in ('ed','super_user') $$;

-- Management (ROLE.isManagement): ED tier + Housing Manager.
create or replace function public.hs_is_mgmt() returns boolean
  language sql stable set search_path = public, pg_temp
  as $$ select public.hs_role() in ('ed','super_user','housing_manager') $$;

-- Housing office: the roles that create/edit applications & housing records
-- (management + the two housing-employee levels). EXCLUDES field_employee and
-- finance roles.
create or replace function public.hs_is_office() returns boolean
  language sql stable set search_path = public, pg_temp
  as $$ select public.hs_role() in
        ('ed','super_user','housing_manager','housing_employee_l2','housing_employee_l1') $$;

-- Housing office + field crew: for SOW/inspection/reno-progress work the
-- maintenance crew performs.
create or replace function public.hs_is_field_or_office() returns boolean
  language sql stable set search_path = public, pg_temp
  as $$ select public.hs_role() in
        ('ed','super_user','housing_manager','housing_employee_l2','housing_employee_l1','field_employee') $$;

-- Finance tier.
create or replace function public.hs_is_finance() returns boolean
  language sql stable set search_path = public, pg_temp
  as $$ select public.hs_role() in ('ed','super_user','cfo','finance_l1') $$;

-- ── Generic policy applier ──────────────────────────────────────────────────
-- Enables RLS on p_table (if it exists) and installs 4 tier-gated policies
-- (SELECT / INSERT / UPDATE / DELETE). append_only => INSERT+SELECT only
-- (UPDATE/DELETE have no policy = denied for authenticated; a hard trigger is
-- added separately for the audit tables). Idempotent (drops its own policies).
create or replace function public._hs_tier_expr(p text) returns text
  language sql immutable as $$
  select case p
    when 'staff'        then 'public.hs_is_staff()'
    when 'office'       then 'public.hs_is_office()'
    when 'field_office' then 'public.hs_is_field_or_office()'
    when 'mgmt'         then 'public.hs_is_mgmt()'
    when 'ed'           then 'public.hs_is_ed_tier()'
    when 'finance'      then 'public.hs_is_finance()'
    else 'false'
  end
$$;

create or replace function public._hs_apply_rls(
  p_table text, p_select text, p_write text, p_append_only boolean default false
) returns void language plpgsql as $$
declare
  q       text := 'public.' || quote_ident(p_table);
  selx    text := public._hs_tier_expr(p_select);
  wrx     text := public._hs_tier_expr(p_write);
begin
  if to_regclass(q) is null then
    raise notice '[rls] skip % — table not present in this project', p_table;
    return;
  end if;
  execute format('alter table %s enable row level security', q);
  execute format('drop policy if exists %I on %s', p_table||'_hs_sel', q);
  execute format('drop policy if exists %I on %s', p_table||'_hs_ins', q);
  execute format('drop policy if exists %I on %s', p_table||'_hs_upd', q);
  execute format('drop policy if exists %I on %s', p_table||'_hs_del', q);
  execute format('create policy %I on %s for select to authenticated using (%s)',
                 p_table||'_hs_sel', q, selx);
  execute format('create policy %I on %s for insert to authenticated with check (%s)',
                 p_table||'_hs_ins', q, wrx);
  if not p_append_only then
    execute format('create policy %I on %s for update to authenticated using (%s) with check (%s)',
                   p_table||'_hs_upd', q, wrx, wrx);
    execute format('create policy %I on %s for delete to authenticated using (%s)',
                   p_table||'_hs_del', q, wrx);
  end if;
end $$;

-- ── Per-table policies ──────────────────────────────────────────────────────
-- Rationale column: which app operation the write tier backstops.
--   table                 select   write         notes
--   housing_applications  staff    office        approvals/edits; blocks field_employee & finance from forging status
--   housing_units         staff    field_office  unit edits + repair status (crew touches units)
--   housing_sow           staff    field_office  SOWs; crew edits progress/completes (whole-row jsonb, coarse)
--   housing_rfq           staff    mgmt          replaces the OLD permissive using(true); closes award forgery
--   housing_contractors   staff    office        add/recommend/approve contractors
--   tenants               staff    office        TIC edits (field_employee TIC is read-only)
--   inspections           staff    field_office  crew/office inspections
--   bcr_registry          staff    mgmt          banishment/eligibility list (sensitive)
--   housing_reno_progress staff    field_office  editRenoProgress includes field_employee
--   app_documents         staff    office        application file metadata
--   housing_unit_photos   staff    field_office  unit/SLP photos
--   tenant_movement_log   staff    office        move history
--   contractors (legacy)  staff    office        guarded; may not exist
select public._hs_apply_rls('housing_applications', 'staff', 'office');
select public._hs_apply_rls('housing_units',        'staff', 'field_office');
select public._hs_apply_rls('housing_sow',          'staff', 'field_office');
select public._hs_apply_rls('housing_contractors',  'staff', 'office');
select public._hs_apply_rls('tenants',              'staff', 'office');
select public._hs_apply_rls('inspections',          'staff', 'field_office');
select public._hs_apply_rls('bcr_registry',         'staff', 'mgmt');
select public._hs_apply_rls('housing_reno_progress','staff', 'field_office');
select public._hs_apply_rls('app_documents',        'staff', 'field_office');
select public._hs_apply_rls('housing_unit_photos',  'staff', 'field_office');
select public._hs_apply_rls('tenant_movement_log',  'staff', 'office');
select public._hs_apply_rls('contractors',          'staff', 'office');  -- legacy, guarded

-- Governance tables — ED tier only for writes (this is the escalation surface).
--   housing_settings holds approval_authority / scoring / email templates /
--   module_enablement: whoever can write it can grant themselves any authority.
select public._hs_apply_rls('housing_settings', 'staff', 'ed');

-- tenant_notes — append-only (like housing_application_notes). Any active staff
-- can add a note (workflow prompts fire from move-in/inspection/SOW-complete,
-- incl. field crew); nobody edits/deletes via the client.
select public._hs_apply_rls('tenant_notes', 'staff', 'staff', true);

-- Audit logs — append-only + hard trigger (defense in depth for accidental
-- service_role mutation). finance_audit_log is finance-scoped.
select public._hs_apply_rls('finance_audit_log', 'finance', 'finance', true);

-- housing_audit_log — special SELECT: management sees everything (the Settings
-- audit viewer); every other role sees ONLY their own rows (the landing-page
-- "Recent Activity" widget queries ?actor=eq.<self>). INSERT: any active staff.
-- Append-only (no UPDATE/DELETE policy) + the hard trigger below.
do $$
begin
  if to_regclass('public.housing_audit_log') is null then return; end if;
  execute 'alter table public.housing_audit_log enable row level security';
  execute 'drop policy if exists housing_audit_log_hs_sel on public.housing_audit_log';
  execute 'drop policy if exists housing_audit_log_hs_ins on public.housing_audit_log';
  execute $q$create policy housing_audit_log_hs_sel on public.housing_audit_log for select to authenticated
             using (public.hs_is_mgmt() or lower(coalesce(actor,'')) = lower(auth.jwt() ->> 'email'))$q$;
  execute 'create policy housing_audit_log_hs_ins on public.housing_audit_log for insert to authenticated with check (public.hs_is_staff())';
end $$;

-- Finance data tables — finance tier only (post/void ledger, loans, arrears…).
select public._hs_apply_rls('finance_rent_ledger',  'finance', 'finance');
select public._hs_apply_rls('finance_loans',        'finance', 'finance');
select public._hs_apply_rls('finance_loan_payments','finance', 'finance');
select public._hs_apply_rls('finance_arrangements', 'finance', 'finance');
select public._hs_apply_rls('finance_arr_payments', 'finance', 'finance');
select public._hs_apply_rls('finance_collections',  'finance', 'finance');
select public._hs_apply_rls('finance_journal',      'finance', 'finance');
select public._hs_apply_rls('finance_utility_hydro','finance', 'finance');
select public._hs_apply_rls('finance_utility_gas',  'finance', 'finance');

-- ── staff — special-cased (self-escalation is THE critical hole) ─────────────
-- SELECT: any active staff (role resolution + the Settings staff directory).
-- UPDATE/DELETE: ED tier only (manageStaffRecord / manageAllStaffRoles are
-- ED-only in the app — and this is what stops a field_employee from PATCHing
-- their own row to role='ed').
-- INSERT: ED can add anyone; a Housing Manager (manageStaff) can add only
-- NON-privileged staff (can't mint an ed/super_user row → no HM→ED backdoor).
do $$
begin
  if to_regclass('public.staff') is null then return; end if;
  execute 'alter table public.staff enable row level security';
  execute 'drop policy if exists staff_hs_sel on public.staff';
  execute 'drop policy if exists staff_hs_ins on public.staff';
  execute 'drop policy if exists staff_hs_upd on public.staff';
  execute 'drop policy if exists staff_hs_del on public.staff';
  execute 'create policy staff_hs_sel on public.staff for select to authenticated using (public.hs_is_staff())';
  execute $q$create policy staff_hs_ins on public.staff for insert to authenticated
             with check ( public.hs_is_ed_tier()
                          or (public.hs_is_mgmt() and lower(coalesce(role,'')) not in ('ed','super_user')) )$q$;
  execute 'create policy staff_hs_upd on public.staff for update to authenticated using (public.hs_is_ed_tier()) with check (public.hs_is_ed_tier())';
  execute 'create policy staff_hs_del on public.staff for delete to authenticated using (public.hs_is_ed_tier())';
end $$;

-- ── housing_rfq — drop the OLD permissive policies before the tiered ones ────
-- rfq-migration.sql created using(true) policies; _hs_apply_rls installs the
-- HM/ED-only tiered set but under different names, so remove the old ones or
-- they'd remain (policies OR together — one permissive policy defeats the lock).
do $$
begin
  if to_regclass('public.housing_rfq') is null then return; end if;
  execute 'drop policy if exists "Authenticated staff can read RFQs"   on public.housing_rfq';
  execute 'drop policy if exists "Authenticated staff can insert RFQs" on public.housing_rfq';
  execute 'drop policy if exists "Authenticated staff can update RFQs" on public.housing_rfq';
  execute 'drop policy if exists "Authenticated staff can delete RFQs" on public.housing_rfq';
end $$;
select public._hs_apply_rls('housing_rfq', 'staff', 'mgmt');

-- ── Append-only hard triggers for the audit tables ──────────────────────────
create or replace function public._hs_block_mutation()
  returns trigger language plpgsql as $$
begin
  raise exception '% is append-only — UPDATE/DELETE not permitted', tg_table_name;
end $$;

do $$
declare t text;
begin
  foreach t in array array['housing_audit_log','finance_audit_log','tenant_notes'] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists trg_%s_block_upd on public.%I', t, t);
      execute format('drop trigger if exists trg_%s_block_del on public.%I', t, t);
      execute format('create trigger trg_%s_block_upd before update on public.%I for each row execute function public._hs_block_mutation()', t, t);
      execute format('create trigger trg_%s_block_del before delete on public.%I for each row execute function public._hs_block_mutation()', t, t);
    end if;
  end loop;
end $$;

-- ── Storage: housing-files bucket → active staff only ───────────────────────
-- Closes the "any authenticated user (incl. a random signup) can enumerate /
-- sign URLs for anyone's ID scans / income proof" hole. This restricts access
-- to ACTIVE STAFF. NOTE: true per-entity path scoping (staff X only sees files
-- for units/apps they're related to) needs an ownership table the schema does
-- not yet have — that is a follow-up; this migration removes the far larger
-- non-staff exposure. If Supabase created a permissive default policy on this
-- bucket, DROP it (see the commented DROPs) after confirming these cover the app.
do $$
begin
  execute 'drop policy if exists hs_storage_sel on storage.objects';
  execute 'drop policy if exists hs_storage_ins on storage.objects';
  execute 'drop policy if exists hs_storage_upd on storage.objects';
  execute 'drop policy if exists hs_storage_del on storage.objects';
  execute $q$create policy hs_storage_sel on storage.objects for select to authenticated
             using (bucket_id = 'housing-files' and public.hs_is_staff())$q$;
  execute $q$create policy hs_storage_ins on storage.objects for insert to authenticated
             with check (bucket_id = 'housing-files' and public.hs_is_field_or_office())$q$;
  execute $q$create policy hs_storage_upd on storage.objects for update to authenticated
             using (bucket_id = 'housing-files' and public.hs_is_field_or_office())$q$;
  execute $q$create policy hs_storage_del on storage.objects for delete to authenticated
             using (bucket_id = 'housing-files' and public.hs_is_office())$q$;
exception when insufficient_privilege then
  raise notice '[rls] storage.objects policies need to be applied by the storage owner — apply the hs_storage_* policies via the Supabase Storage policy UI.';
end $$;

-- Common Supabase default permissive storage policy names — uncomment to drop
-- after confirming the hs_storage_* policies cover every app upload/read:
-- drop policy if exists "Give users access to own folder" on storage.objects;
-- drop policy if exists "Allow authenticated uploads"     on storage.objects;
-- drop policy if exists "Public Access"                   on storage.objects;

-- ── Verification (run these AFTER applying; expect the described results) ────
-- 1) Every browser-written table has RLS on:
--    select relname, relrowsecurity from pg_class
--    where relnamespace = 'public'::regnamespace and relkind='r'
--      and relname in ('staff','housing_applications','housing_units','housing_sow',
--        'housing_rfq','housing_contractors','tenants','tenant_notes','housing_settings',
--        'inspections','housing_audit_log','bcr_registry','housing_reno_progress',
--        'app_documents','housing_unit_photos','tenant_movement_log')
--    order by relname;   -- relrowsecurity must be true for all
-- 2) No permissive using(true) policies remain:
--    select schemaname,tablename,policyname,qual from pg_policies
--    where schemaname='public' and (qual='true' or qual is null) order by tablename;
--    -- expect ONLY the append-only INSERT policies (with_check true, qual null) here.
-- 3) Smoke test as a field_employee JWT: PATCH staff role='ed' must 401/403;
--    SELECT housing_applications must succeed; PATCH housing_settings must fail.
-- ============================================================================
