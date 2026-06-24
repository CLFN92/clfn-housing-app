-- Migration: BCR registry - people banished from the community by Band Council
-- Resolution (BCR), and therefore ineligible for housing.
-- Run in the Supabase SQL editor for project fkhzrbalumzeripzolph.
-- Date: 2026-06-24
--
-- Name-keyed for now (Phase T1). A stable person-id link to applications/tenants
-- comes in a later phase (T3); see PLAN.md "Phase T".

CREATE TABLE IF NOT EXISTS bcr_registry (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name   TEXT NOT NULL,              -- person's name (matched case-insensitively)
  bcrd_date   DATE,                        -- date the BCR took effect
  reason      TEXT,
  active      BOOLEAN DEFAULT TRUE,        -- false = BCR lifted (kept for history)
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  created_by  TEXT,
  lifted_at   TIMESTAMPTZ,
  lifted_by   TEXT
);

-- Case-insensitive name lookup (the eligibility check matches on lower(full_name)).
CREATE INDEX IF NOT EXISTS bcr_registry_name_idx ON bcr_registry (lower(full_name));
CREATE INDEX IF NOT EXISTS bcr_registry_active_idx ON bcr_registry (active);

COMMENT ON TABLE bcr_registry IS 'People banished from the community by Band Council Resolution (BCR) - ineligible for housing. Name-keyed (Phase T1); person-id link is a later phase.';
