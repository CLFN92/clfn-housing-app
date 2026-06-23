-- Migration: add inspection date columns to housing_units
-- Run in Supabase SQL editor for project fkhzrbalumzeripzolph
-- Date: 2026-06-22

ALTER TABLE housing_units
  ADD COLUMN IF NOT EXISTS last_inspection_date DATE,
  ADD COLUMN IF NOT EXISTS next_inspection_due  DATE;

COMMENT ON COLUMN housing_units.last_inspection_date IS 'Date of most recent unit inspection';
COMMENT ON COLUMN housing_units.next_inspection_due  IS 'Date the next inspection is scheduled or due';
