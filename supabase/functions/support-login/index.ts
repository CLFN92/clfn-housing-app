// support-login - NATION-side support impersonation (SUPER-ADMIN-PLAN 12.3).
//
// Deploy on EACH nation's own Supabase project, WITHOUT JWT verification (it is
// called server-to-server by the control-plane `enter-nation` function, not by a
// signed-in user):
//   supabase functions deploy support-login --project-ref <nation-ref> --no-verify-jwt
//
// Trust model: the ONLY gate is the shared secret in the `x-support-secret`
// header, which must equal this project's SUPPORT_LOGIN_SECRET. That secret is
// set server-side on both the platform project (so enter-nation can send it) and
// on this nation project (so this function can verify it); it NEVER reaches the
// browser -- the admin panel calls enter-nation with the operator's platform JWT,
// and enter-nation (server-side) forwards the secret here.
//
// What it does, on a valid call:
//   1. Refuses if the nation has opted OUT (housing_settings.support_login_enabled
//      set to false) -- the nation's own consent switch (OCAP).
//   2. Ensures a "Platform Support" auth user + ACTIVE, magic-link-enabled,
//      super_user staff row exists for the operator's email (access_expires_at =
//      today, so the grant lapses on its own).
//   3. Mints a short-lived Supabase magic link back to the nation app.
//   4. Writes an append-only housing_audit_log row (actor = operator email).
//   5. Returns { action_link } for the operator's browser to open.
//
// Secrets required on the nation project:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (auto-injected)
//   SUPPORT_LOGIN_SECRET                       (shared secret; required)
// Source ASCII-only.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const SUPPORT_SECRET = Deno.env.get('SUPPORT_LOGIN_SECRET') || ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-support-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
function todayIso(): string { return new Date().toISOString().slice(0, 10) }
// Constant-time-ish string compare so a valid secret can't be timing-probed.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
// Only allow a redirect back to a nation app host (never an open redirect).
function safeRedirect(u: string): string {
  try {
    const url = new URL(String(u || ''))
    if (url.protocol !== 'https:') return ''
    if (url.hostname !== 'fnhub.app' && !url.hostname.endsWith('.fnhub.app')) return ''
    return url.toString()
  } catch (_e) { return '' }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'not_configured' }, 500)
  if (!SUPPORT_SECRET)              return json({ error: 'support_secret_not_set' }, 500)

  const sent = req.headers.get('x-support-secret') || ''
  if (!sent || !safeEqual(sent, SUPPORT_SECRET)) return json({ error: 'forbidden' }, 403)

  let body: any = {}
  try { body = await req.json() } catch (_e) { return json({ error: 'bad_json' }, 400) }
  const operator = String(body.operator_email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(operator)) return json({ error: 'bad_operator_email' }, 400)
  const redirectTo = safeRedirect(body.redirect_to)
  if (!redirectTo) return json({ error: 'bad_redirect' }, 400)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  // 1. Nation opt-out (OCAP consent). Default ENABLED unless explicitly false.
  try {
    const { data: st } = await admin.from('housing_settings').select('value').eq('key', 'support_login_enabled').limit(1)
    if (st && st.length) {
      const v: any = st[0].value
      const enabled = (v && typeof v === 'object') ? v.enabled !== false : v !== false
      if (!enabled) return json({ error: 'support_disabled',
        message: 'This nation has turned off platform support login. Ask the nation to re-enable it in Settings.' }, 403)
    }
  } catch (_e) { /* settings unreadable -> fail safe by NOT blocking is wrong; but a
                    missing table would be a broken project. Treat read failure as
                    enabled so support can still reach a misconfigured nation. */ }

  // 2. Ensure the auth user exists (idempotent; ignore "already registered").
  try {
    const { error: cuErr } = await admin.auth.admin.createUser({ email: operator, email_confirm: true })
    if (cuErr && !/registered|exists|duplicate/i.test(cuErr.message || '')) {
      return json({ error: 'create_user_failed', detail: cuErr.message }, 500)
    }
  } catch (e) { return json({ error: 'create_user_failed', detail: String(e && (e as Error).message || e) }, 500) }

  // 2b. Ensure an ACTIVE, magic-link-enabled, super_user staff row (access lapses
  //     today on its own -- see auth-login.js completeMagicLinkSignIn hard gate).
  const staffRow = {
    name: 'Platform Support', email: operator, role: 'super_user',
    department: 'Platform Support', is_active: true, magic_link: true,
    access_expires_at: todayIso(),
  }
  try {
    const { data: ex } = await admin.from('staff').select('id').eq('email', operator).limit(1)
    if (ex && ex.length) await admin.from('staff').update(staffRow).eq('email', operator)
    else                 await admin.from('staff').insert(staffRow)
  } catch (e) { return json({ error: 'staff_upsert_failed', detail: String(e && (e as Error).message || e) }, 500) }

  // 3. Mint the magic link back to the nation app.
  let actionLink = ''
  try {
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'magiclink', email: operator, options: { redirectTo },
    })
    actionLink = (data && (data as any).properties && (data as any).properties.action_link) || ''
    if (error || !actionLink) return json({ error: 'link_failed', detail: (error && error.message) || 'no action_link' }, 500)
  } catch (e) { return json({ error: 'link_failed', detail: String(e && (e as Error).message || e) }, 500) }

  // 4. Audit (append-only; best-effort but awaited so it lands before we return).
  try {
    await admin.from('housing_audit_log').insert({
      action: 'support_session_started', actor: operator, entity_type: 'support', entity_id: 'SUPPORT',
      detail: JSON.stringify({ summary: 'Platform support login minted for ' + operator,
        role: 'super_user', access_expires_at: staffRow.access_expires_at, redirect_to: redirectTo }),
    })
  } catch (_e) { /* never block the login on an audit hiccup */ }

  return json({ ok: true, action_link: actionLink, operator: operator, access_expires_at: staffRow.access_expires_at })
})
