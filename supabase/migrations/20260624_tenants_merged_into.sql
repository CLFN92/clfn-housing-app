-- Migration: person identity via a merge pointer (PLAN.md Phase T3).
-- The tenant-sync trigger inserts a new tenants row on every assignment and
-- never matches by name, so one person accumulates multiple rows over time.
-- merged_into points a duplicate row at the canonical row for that person
-- (NULL = canonical). The canonical row's id is the de-facto person id.
-- Run in the Supabase SQL editor for project fkhzrbalumzeripzolph.
-- Date: 2026-06-24

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS tenants_merged_into_idx ON tenants(merged_into);

COMMENT ON COLUMN tenants.merged_into IS 'If set, this row is a duplicate merged into the referenced canonical tenants row (the person). NULL = canonical.';
