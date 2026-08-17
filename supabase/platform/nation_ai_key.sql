-- ============================================================================
-- FN Hub CONTROL PLANE -- masked marker for a nation's AI (Anthropic) API key.
-- Runs on the "fnhub-platform" project. Super-admins only. Run in the platform
-- SQL Editor.
--
-- The actual key is written into the nation project's ANTHROPIC_API_KEY Edge
-- Function secret by the set-nation-secret function and is NEVER stored here in
-- full. These columns only let the admin UI show "key set (...1234), updated X".
-- ============================================================================

alter table public.nations
  add column if not exists ai_key_last4      text,
  add column if not exists ai_key_updated_at timestamptz;
