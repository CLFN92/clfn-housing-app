/* admin-config.js — FN Hub super-admin panel connection to the CONTROL PLANE
 * (the dedicated "fnhub-platform" Supabase project).
 *
 * Fill these in AFTER you create the fnhub-platform project:
 *   Supabase → Project Settings → API → Project URL + anon/publishable key.
 * The anon key is publishable (safe here). NEVER put a service-role or
 * Management API key in this file — those live only in Edge Function secrets.
 */
window.PLATFORM_SUPABASE_URL  = 'https://REPLACE_WITH_PLATFORM_REF.supabase.co';
window.PLATFORM_SUPABASE_ANON = 'REPLACE_WITH_PLATFORM_ANON_KEY';
