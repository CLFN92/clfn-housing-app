-- Migration: create inspections table
-- Run in Supabase SQL editor for project fkhzrbalumzeripzolph
-- Date: 2026-06-22

CREATE TABLE IF NOT EXISTS inspections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         TEXT NOT NULL,
  unit_address    TEXT,
  type            TEXT NOT NULL,         -- Move-In | Move-Out | Annual | Routine | Emergency
  inspection_date DATE NOT NULL,
  inspector_name  TEXT,
  inspector_role  TEXT,
  overall_status  TEXT DEFAULT 'pending', -- pending | pass | fail | needs_repair
  checklist       JSONB DEFAULT '[]',     -- [{room, item, rating, notes}]
  general_notes   TEXT,
  photos          JSONB DEFAULT '[]',     -- [{path, name, size, addedAt, addedBy}]
  sow_created     BOOLEAN DEFAULT FALSE,
  sow_unit_id     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  created_by      TEXT
);

CREATE INDEX IF NOT EXISTS inspections_unit_id_idx ON inspections(unit_id);
CREATE INDEX IF NOT EXISTS inspections_date_idx    ON inspections(inspection_date DESC);

COMMENT ON TABLE inspections IS 'Unit inspection records for CLFN Housing';
