-- ============================================================================
-- supabase/seed.sql — per-nation seed (run once after the schema is applied)
--
-- Intentionally LIGHT. The app falls back to in-code defaults when a
-- housing_settings row is absent (scoring model → DEFAULT_V2_SCORE_MODEL in
-- scoring.js, approval authority → DEFAULTS in approval-authority.js, modules →
-- CLFN_MODULES defaults, etc.), so a fresh nation works without seeded settings.
-- The ED can save customised values from Settings later; per-nation module
-- LICENSING comes from NATIONS_DIRECTORY (shared-config.js), not the DB.
--
-- What a new nation actually needs seeded:
--   1. The Storage bucket the app reads/writes files to.
--   2. (Optional) a nation_config_override row for display name / contact, so
--      branding shows before the ED edits it. Left commented — set per nation.
-- The first ED / super_user account is created via Supabase Auth (see
-- supabase/README.md), not here.
-- ============================================================================

-- 1) Storage bucket (id must equal STORAGE_BUCKET in shared-config.js).
--    Private bucket; access is via the authenticated REST/Storage layer.
insert into storage.buckets (id, name, public)
values ('housing-files', 'housing-files', false)
on conflict (id) do nothing;

-- 2) (Optional) seed this nation's display identity so the header/branding shows
--    before the ED customises it in Settings → Nation. Replace the values, then
--    uncomment. `key='nation_config_override'` matches applyNationOverrides().
--
-- insert into housing_settings (key, value)
-- values (
--   'nation_config_override',
--   '{"display_name":"Example First Nation","name":"Example First Nation","short":"EFN"}'::jsonb
-- )
-- on conflict (key) do update set value = excluded.value;
