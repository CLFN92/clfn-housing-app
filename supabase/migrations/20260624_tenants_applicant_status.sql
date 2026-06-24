-- Migration: allow 'applicant' as a tenant status, so a person can have a
-- tenants record (and a TIC) before they are housed. The tenant-sync trigger
-- (sync_tenants_from_unit) only ever touches rows tied to a unit, so applicant
-- rows (current_unit_id = NULL) are untouched by it.
-- Run in the Supabase SQL editor for project fkhzrbalumzeripzolph.
-- Date: 2026-06-24  (PLAN.md Phase T2)

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_status_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_status_check
  CHECK (status = ANY (ARRAY['applicant','active','former','deceased','evicted']));
