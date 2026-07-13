-- Migration: add date of birth to the BCR / Ineligibility registry.
-- Run in the Supabase SQL editor for project fkhzrbalumzeripzolph.
-- Date: 2026-07-12
--
-- bcr_registry is name-keyed (Phase T1 — see 20260624_bcr_registry.sql), so
-- two people with the same or similar name can't otherwise be told apart on
-- this list. Date of birth is an optional second identifier, same rationale
-- as the "same name + DOB" duplicate check already used for applications
-- (_findDuplicateApplications() in housing-app.js).

ALTER TABLE bcr_registry
  ADD COLUMN IF NOT EXISTS date_of_birth DATE;

COMMENT ON COLUMN bcr_registry.date_of_birth IS 'Optional — helps disambiguate BCR entries from other people with the same or a similar name.';
