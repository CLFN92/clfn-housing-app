// enter-nation - control-plane support impersonation (SUPER-ADMIN-PLAN 12.3).
//
// Deploy on the fnhub-platform project WITH JWT verification (the admin panel
// sends the caller's platform user JWT as the bearer):
//   supabase functions deploy enter-nation --project-ref <platform-ref>
//
// SUPER-ADMIN ONLY. Verifies the caller is in super_admins, looks up the target
// nation's project, then calls that nation's `support-login` function
// SERVER-TO-SERVER with the shared SUPPORT_LOGIN_SECRET (which therefore never
// reaches the browser). The nation function mints a magic link back to its app;
// this function returns that link for the operator's browser to open.
//
// Secrets required on the platform project:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY  (auto-injected)
//   SUPPORT_LOGIN_SECRET  - shared with every nation's support-login function.
// Source ASCII-only.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL') || ''
const ANON_KEY       = Deno.env.get('SUPABASE_ANON_KEY') || ''
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const SUPPORT_SECRET = Deno.env.get('SUPPORT_LOGIN_SECRET') || ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
const SUB_RE = /^[a-z0-9](?:[a-z0-9-]{0,40}[a-z0-9])?$/
function refFromUrl(url: string): string {
  const m = /^https?:\/\/([a-z0-9-]+)\.supabase\.co/i.exec(String(url || '').trim())
  return m ? m[1] : ''
}
async function authorizeSuperAdmin(admin: any, token: string): Promise<string | null> {
  if (!token) return null
  let email = ''
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token } })
    if (!r.ok) return null
    const u = await r.json()
    email = String((u && u.email) || '').toLowerCase()
  } catch (_e) { return null }
  if (!email) return null
  const { data } = await admin.from('super_admins').select('email').ilike('email', email).limit(1)
  return (data && data.length) ? email : null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'method_not_allowed' }, 405)
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'not_configured' }, 500)
  if (!SUPPORT_SECRET) return json({ error: 'support_secret_not_set',
    message: 'Set SUPPORT_LOGIN_SECRET on the platform project (and on each nation project) to enable support login.' }, 500)

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const actor = await authorizeSuperAdmin(admin, token)
  if (!actor) return json({ error: 'forbidden' }, 403)

  let body: any = {}
  try { body = await req.json() } catch (_e) { return json({ error: 'bad_json' }, 400) }
  const sub = String(body.subdomain || '').trim().toLowerCase()
  if (!SUB_RE.test(sub)) return json({ error: 'bad_subdomain' }, 400)

  // Look up the nation's project.
  const { data: nrows, error: nErr } = await admin.from('nations')
    .select('subdomain, display_name, supabase_url, status').eq('subdomain', sub).limit(1)
  if (nErr) return json({ error: 'lookup_failed', detail: nErr.message }, 500)
  const nation = (nrows && nrows[0]) || null
  if (!nation) return json({ error: 'unknown_nation' }, 404)
  const ref = refFromUrl(nation.supabase_url || '')
  if (!ref) return json({ error: 'nation_not_provisioned',
    message: 'This nation has no Supabase project on record yet, so there is nothing to enter.' }, 400)

  const fnUrl = 'https://' + ref + '.functions.supabase.co/support-login'
  const redirectTo = 'https://' + sub + '.fnhub.app/'

  // Call the nation-side function server-to-server with the shared secret.
  let out: any = {}
  try {
    const r = await fetch(fnUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-support-secret': SUPPORT_SECRET },
      body: JSON.stringify({ operator_email: actor, redirect_to: redirectTo }),
    })
    out = await r.json().catch(() => ({}))
    if (!r.ok) {
      // Surface the nation function's own error (e.g. support_disabled) verbatim.
      return json({ error: out.error || 'nation_error', message: out.message || ('HTTP ' + r.status),
        nation_status: r.status }, r.status === 403 ? 403 : 502)
    }
  } catch (e) {
    return json({ error: 'nation_unreachable',
      message: 'Could not reach this nation\'s support-login function. Is it deployed with SUPPORT_LOGIN_SECRET set?',
      detail: String(e && (e as Error).message || e) }, 502)
  }

  const link = out && out.action_link
  if (!link) return json({ error: 'no_link', message: 'The nation returned no sign-in link.' }, 502)

  // Audit on the control plane: WHO entered WHICH nation, and when.
  try {
    await admin.from('platform_audit').insert({
      action: 'entered_nation', subdomain: sub,
      detail: actor + ' opened a support session on ' + (nation.display_name || sub)
        + ' (expires ' + (out.access_expires_at || 'today') + ')',
    })
  } catch (_e) { /* audit best-effort */ }

  return json({ ok: true, action_link: link, subdomain: sub, operator: actor, access_expires_at: out.access_expires_at || null })
})
