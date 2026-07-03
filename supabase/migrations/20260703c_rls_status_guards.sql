-- ============================================================================
-- 20260703c_rls_status_guards.sql
-- Tightens the ONE remaining (pre-existing) RLS gap noted in
-- SECURITY_REVIEW_2026-07.md S0 follow-up #1: the live data-table write policies
-- are coarse (`get_my_role() IS NOT NULL` = any active staff), so a role the APP
-- never lets approve -- field_employee (maintenance crew), the two finance roles,
-- and the junior housing-employee levels -- could still forge an approval / award
-- / sign-off by PATCHing the sensitive column directly via REST.
--
-- Postgres RLS is ROW-level, not column-level, and housing_sow keeps its
-- approval_status inside a `data` jsonb array (one row per unit). So this is
-- enforced with BEFORE-write TRIGGERS that inspect OLD vs NEW on the sensitive
-- fields only -- every other edit on these rows is left exactly as it was.
--
-- MODEL: a coarse, STABLE backstop, not a mirror of the runtime-configurable
-- APPROVAL_AUTHORITY matrix (that lives in housing_settings and is ED-editable).
-- We gate to the widest role set that is NEVER wrong:
--   * housing approvals/awards/sign-offs  -> housing OFFICE / MGMT (never
--     field_employee, never finance),
--   * SOW HM/ED sign-off inside the jsonb -> MGMT only (HM/ED/super_user),
--     while field_employee's legitimate create + "completed" writes still pass.
-- The fine HM-vs-ED / who-recommends split stays client-side (all office roles
-- are trusted, named, audited staff).
--
-- CONTEXT BYPASS: service_role (Edge Functions) and the SQL editor bypass RLS but
-- NOT triggers, so each guard first returns early when there is no end-user JWT
-- (auth.jwt() is null) or the caller is service_role -- trusted server paths are
-- unaffected.
--
-- Idempotent + re-runnable. Safe to run after 20260703b (the revert).
-- ============================================================================

-- ── Actor role resolver (trigger-only; creates NO policy, so it cannot loosen
--    anything the way the reverted lockdown's policies did) ────────────────────
-- Email-keyed, is_active-gated, with the same legacy-string normalization the
-- app + Edge Functions use. SECURITY DEFINER so it reads staff under the guard's
-- context regardless of staff's own RLS.
create or replace function public.app_actor_role()
  returns text language sql stable security definer
  set search_path = public, pg_temp as $$
  select case lower(coalesce(s.role,''))
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

-- True for trusted non-end-user contexts (SQL editor / service_role) -> skip the
-- guard. auth.jwt() is null in the SQL editor; the service key carries role claim
-- 'service_role'.
create or replace function public.app_guard_bypass()
  returns boolean language sql stable
  set search_path = public, pg_temp as $$
  select auth.jwt() is null
      or coalesce(auth.jwt() ->> 'role','') = 'service_role'
$$;

-- coalesce -> false so a NULL role (inactive account / valid JWT for a non-staff
-- email) is NOT authorized. Without this, `not (null in (...))` is NULL, which a
-- WHERE/IF treats as false and the guard would silently let the write through.
create or replace function public.app_actor_is_office() returns boolean
  language sql stable set search_path = public, pg_temp as $$
  select coalesce(public.app_actor_role() in
    ('ed','super_user','housing_manager','housing_employee_l2','housing_employee_l1'), false) $$;

create or replace function public.app_actor_is_mgmt() returns boolean
  language sql stable set search_path = public, pg_temp as $$
  select coalesce(public.app_actor_role() in ('ed','super_user','housing_manager'), false) $$;

-- ── housing_applications.status — only housing office may change it ───────────
create or replace function public.guard_housing_application_status()
  returns trigger language plpgsql security definer
  set search_path = public, pg_temp as $$
begin
  if public.app_guard_bypass() then return NEW; end if;
  if NEW.status is distinct from OLD.status and not public.app_actor_is_office() then
    raise exception 'not authorized to change application status (role=%)',
      coalesce(public.app_actor_role(),'<none>');
  end if;
  return NEW;
end $$;

-- ── housing_contractors.status — only housing office may change it ────────────
create or replace function public.guard_housing_contractor_status()
  returns trigger language plpgsql security definer
  set search_path = public, pg_temp as $$
begin
  if public.app_guard_bypass() then return NEW; end if;
  if NEW.status is distinct from OLD.status and not public.app_actor_is_office() then
    raise exception 'not authorized to change contractor status (role=%)',
      coalesce(public.app_actor_role(),'<none>');
  end if;
  return NEW;
end $$;

-- ── inspections.approved_by / approved_at — only office may sign off ──────────
-- field_employee can still fill the report; it just can't stamp the approval.
create or replace function public.guard_inspection_signoff()
  returns trigger language plpgsql security definer
  set search_path = public, pg_temp as $$
begin
  if public.app_guard_bypass() then return NEW; end if;
  if (NEW.approved_by is distinct from OLD.approved_by
      or NEW.approved_at is distinct from OLD.approved_at)
     and not public.app_actor_is_office() then
    raise exception 'not authorized to approve an inspection (role=%)',
      coalesce(public.app_actor_role(),'<none>');
  end if;
  return NEW;
end $$;

-- ── housing_rfq — all writes are HM/ED-only in the app (_rfqCanEdit); gate the
--    whole table to MGMT so an award/bid can't be forged via REST ─────────────
create or replace function public.guard_housing_rfq_write()
  returns trigger language plpgsql security definer
  set search_path = public, pg_temp as $$
begin
  if public.app_guard_bypass() then
    return case when tg_op = 'DELETE' then OLD else NEW end;
  end if;
  if not public.app_actor_is_mgmt() then
    raise exception 'not authorized to % an RFQ -- HM/ED only (role=%)',
      lower(tg_op), coalesce(public.app_actor_role(),'<none>');
  end if;
  return case when tg_op = 'DELETE' then OLD else NEW end;
end $$;

-- ── housing_sow — approval_status lives per-SOW in the `data` jsonb array.
--    Block a NON-mgmt caller from advancing any EXISTING sow to hm_approved /
--    ed_approved. field_employee create (+ '', draft, submitted, signed) and
--    "completed" writes still pass, so work-order completion is unaffected. ────
create or replace function public.guard_housing_sow_signoff()
  returns trigger language plpgsql security definer
  set search_path = public, pg_temp as $$
declare
  bad boolean;
begin
  if public.app_guard_bypass() then return NEW; end if;
  if public.app_actor_is_mgmt() then return NEW; end if;   -- HM/ED/super_user may sign off

  -- Flag if NEW.data introduces ANY sow in an hm_approved / ed_approved state
  -- that was not ALREADY present (same project_number + same approval_status) in
  -- OLD.data. Catches both advancing an existing sow to a sign-off state AND
  -- adding a brand-new element already stamped approved. Non-approval states
  -- (incl. '', draft, submitted, signed, completed) and unchanged approvals pass,
  -- so field_employee create + work-order "completed" writes are unaffected.
  select exists (
    select 1
    from jsonb_array_elements(coalesce(NEW.data, '[]'::jsonb)) n(elem)
    where coalesce(n.elem ->> 'approval_status','') in ('hm_approved','ed_approved')
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(OLD.data, '[]'::jsonb)) o(elem)
        where (o.elem ->> 'project_number') is not distinct from (n.elem ->> 'project_number')
          and coalesce(o.elem ->> 'approval_status','')
              = coalesce(n.elem ->> 'approval_status','')
      )
  ) into bad;

  if bad then
    raise exception 'not authorized to approve a SOW -- HM/ED only (role=%)',
      coalesce(public.app_actor_role(),'<none>');
  end if;
  return NEW;
end $$;

-- ── Attach the triggers (idempotent) ─────────────────────────────────────────
do $$
begin
  if to_regclass('public.housing_applications') is not null then
    execute 'drop trigger if exists trg_guard_app_status on public.housing_applications';
    execute 'create trigger trg_guard_app_status before update on public.housing_applications
             for each row execute function public.guard_housing_application_status()';
  end if;

  if to_regclass('public.housing_contractors') is not null then
    execute 'drop trigger if exists trg_guard_contractor_status on public.housing_contractors';
    execute 'create trigger trg_guard_contractor_status before update on public.housing_contractors
             for each row execute function public.guard_housing_contractor_status()';
  end if;

  if to_regclass('public.inspections') is not null then
    execute 'drop trigger if exists trg_guard_inspection_signoff on public.inspections';
    execute 'create trigger trg_guard_inspection_signoff before update on public.inspections
             for each row execute function public.guard_inspection_signoff()';
  end if;

  if to_regclass('public.housing_rfq') is not null then
    execute 'drop trigger if exists trg_guard_rfq_write on public.housing_rfq';
    execute 'create trigger trg_guard_rfq_write before insert or update or delete on public.housing_rfq
             for each row execute function public.guard_housing_rfq_write()';
  end if;

  if to_regclass('public.housing_sow') is not null then
    execute 'drop trigger if exists trg_guard_sow_signoff on public.housing_sow';
    execute 'create trigger trg_guard_sow_signoff before update on public.housing_sow
             for each row execute function public.guard_housing_sow_signoff()';
  end if;
end $$;

-- ── Verification (run AFTER applying) ────────────────────────────────────────
-- 1) Triggers present:
--    select tgrelid::regclass, tgname from pg_trigger
--    where tgname like 'trg_guard_%' order by 1;
-- 2) As a field_employee JWT:
--    PATCH housing_applications?id=eq.X {status:'ed_approved'}  -> 403/exception
--    PATCH housing_rfq?id=eq.X         {status:'awarded'}       -> 403/exception
--    marking their assigned SOW 'completed'                     -> still succeeds
-- 3) As HM/ED: all of the above succeed.
-- NOTE: finance status forgery (approve loans / post journal) is a parallel gap
-- on finance_* -- deferred until the live finance_* policies are confirmed (the
-- policy dump used to author this covered housing tables only).
-- ============================================================================
