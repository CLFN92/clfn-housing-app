-- ============================================================================
-- 20260703b_rls_revert_redundant_lockdown.sql
-- Reverts 20260703_rls_lockdown.sql.
--
-- WHY: after the lockdown was applied, a dump of the LIVE public.* policies
-- showed the database ALREADY had a complete, coherent RLS scheme
-- (get_my_role() / is_housing_role() / is_finance_role() with staff_* and
-- *_ed_only policies) that already:
--   * has RLS enabled on every browser-written table with a staff-gated policy,
--   * locks staff INSERT/UPDATE/DELETE and housing_settings writes to ED tier
--     (staff_*_ed_only / settings_write_ed_only) -> NO self-escalation and NO
--     approval-authority rewrite (the two catastrophic holes S0 warned about),
--   * keeps housing_audit_log append-only (INSERT-only; no UPDATE/DELETE policy),
--   * gates housing_applications writes to is_housing_role() (housing office),
--     and the remaining data tables to get_my_role() IS NOT NULL (active staff).
--
-- The lockdown's parallel hs_* layer was therefore REDUNDANT, and because RLS
-- policies OR together it also LOOSENED access:
--   * hs_is_staff() SELECT let field_employee + finance read
--     housing_applications / tenants / etc. that the pre-existing
--     is_housing_role() SELECT deliberately excluded, and
--   * staff INSERT was broadened from ED-only to "HM may add non-privileged staff".
--
-- This script removes everything the lockdown added and restores the
-- pre-existing scheme. Safe + idempotent. service_role (Edge Functions, SQL
-- editor) BYPASSES RLS, so this script is unaffected by the policies it removes.
--
-- Remaining (pre-existing) gaps are tracked in SECURITY_REVIEW_2026-07.md (S0)
-- as deliberate follow-ups; they are NOT patched here so we don't diverge from
-- the live scheme piecemeal:
--   * data-table writes are coarse: get_my_role() IS NOT NULL lets ANY active
--     staff (incl. field_employee) PATCH e.g. housing_sow.approval_status or a
--     housing_rfq award via direct REST. The browser gates this by role; RLS
--     does not. Tightening it means either per-table role predicates or a
--     status-transition trigger -- a separate, tested migration.
--   * the canonical live scheme (get_my_role/is_housing_role/is_finance_role +
--     the staff_* / *_ed_only policies) is NOT yet captured in this repo. Run
--     `supabase db dump` into 0001_init_schema.sql so a new nation is
--     reproducible (see SECURITY_REVIEW S0).
-- ============================================================================

-- 1) Drop every policy the lockdown created. Its policies are the only ones
--    whose names contain '_hs_' (per-table <t>_hs_sel/ins/upd/del, staff_hs_*,
--    housing_audit_log_hs_*) or begin 'hs_storage_' (storage.objects). The
--    pre-existing policies (staff_*, *_ed_only, audit_log_read_housing_roles,
--    "Allow authenticated inserts", "Authenticated staff can ...") do NOT match
--    either pattern and are left intact.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname in ('public','storage')
      and ( policyname like '%\_hs\_%' escape '\'
         or policyname like 'hs\_storage\_%' escape '\' )
  loop
    execute format('drop policy if exists %I on %I.%I',
                   r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- 2) Remove the lockdown's append-only trigger from tenant_notes ONLY -- it was
--    editable in the pre-existing scheme (staff_update / staff_delete present).
--    KEEP the hard append-only triggers on the two AUDIT tables: CLAUDE.md
--    requires audit tables to be append-only at the DB level, and a BEFORE
--    UPDATE/DELETE trigger is defense-in-depth on top of the RLS absence of
--    UPDATE/DELETE policies (guards against accidental service_role mutation).
do $$
begin
  if to_regclass('public.tenant_notes') is not null then
    execute 'drop trigger if exists trg_tenant_notes_block_upd on public.tenant_notes';
    execute 'drop trigger if exists trg_tenant_notes_block_del on public.tenant_notes';
  end if;
end $$;

-- 3) Drop the lockdown helper functions. _hs_block_mutation() is KEPT because
--    the audit-table triggers retained in step 2 still reference it.
drop function if exists public._hs_apply_rls(text, text, text, boolean);
drop function if exists public._hs_tier_expr(text);
drop function if exists public.hs_is_finance();
drop function if exists public.hs_is_field_or_office();
drop function if exists public.hs_is_office();
drop function if exists public.hs_is_mgmt();
drop function if exists public.hs_is_ed_tier();
drop function if exists public.hs_is_staff();
drop function if exists public.hs_role();

-- 4) Verify (expect the described results):
--    a) No '_hs_'/'hs_storage_' policies remain:
--       select schemaname, tablename, policyname from pg_policies
--       where policyname like '%\_hs\_%' escape '\'
--          or policyname like 'hs\_storage\_%' escape '\';   -- 0 rows
--    b) Pre-existing policies still present on every table:
--       select tablename, cmd, policyname from pg_policies
--       where schemaname='public' order by tablename, cmd;   -- staff_* / *_ed_only
--    c) Audit tables still append-only (trigger present):
--       select tgrelid::regclass, tgname from pg_trigger
--       where tgname like 'trg_%_block_%';   -- housing_audit_log + finance_audit_log
-- ============================================================================
