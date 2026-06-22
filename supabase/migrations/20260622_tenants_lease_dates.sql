-- Migration: add lease_start_date and lease_end_date to tenants table
-- Run this in the Supabase SQL editor for project fkhzrbalumzeripzolph
-- Date: 2026-06-22

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS lease_start_date DATE,
  ADD COLUMN IF NOT EXISTS lease_end_date   DATE;

COMMENT ON COLUMN tenants.lease_start_date IS 'Date the current lease agreement begins (may differ from move_in_date for renewals)';
COMMENT ON COLUMN tenants.lease_end_date   IS 'Date the current lease agreement expires; NULL for month-to-month tenancies';
