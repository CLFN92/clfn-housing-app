// enter-nation - control-plane support impersonation (SUPER-ADMIN-PLAN 12.3).
//
// Deploy on the fnhub-platform project WITH JWT verification (the admin panel
// sends the caller's platform user JWT as the bearer):
//   supabase functions deploy enter-nation --project-ref <platform-ref>
//
// SUPER-ADMIN ONLY. Trust model is ASYMMETRIC + per-nation: this function reads
// the target nation's PRIVATE key (nation_support_keys, control-plane only) and
// signs a short-lived ES256 entry token; the nation's `support-login` verifies it
// with its PUBLIC key. No shared secret is sent or stored on the nation, so a
// leak of a nation's material cannot forge access.
//
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (auto).
// Source ASCII-only.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { signEs256 } from '../_shared/jose.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') || ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

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

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const actor = await authorizeSuperAdmin(admin, token)
  if (!actor) return json({ error: 'forbidden' }, 403)

  let body: any = {}
  try { body = await req.json() } catch (_e) { return json({ error: 'bad_json' }, 400) }
  const sub = String(body.subdomain || '').trim().toLowerCase()
  if (!SUB_RE.test(sub)) return json({ error: 'bad_subdomain' }, 400)

  // Nation + its signing key.
  const { data: nrows, error: nErr } = await admin.from('nations')
    .select('subdomain, display_name, supabase_url, status').eq('subdomain', sub).limit(1)
  if (nErr) return json({ error: 'lookup_failed', detail: nErr.message }, 500)
  const nation = (nrows && nrows[0]) || null
  if (!nation) return json({ error: 'unknown_nation' }, 404)
  const ref = refFromUrl(nation.supabase_url || '')
  if (!ref) return json({ error: 'nation_not_provisioned',
    message: 'This nation has no Supabase project on record yet, so there is nothing to enter.' }, 400)

  const { data: krows } = await admin.from('nation_support_keys').select('private_jwk').eq('subdomain', sub).limit(1)
  const privateJwk = krows && krows[0] && krows[0].private_jwk
  if (!privateJwk) return json({ error: 'no_support_key',
    message: 'No support key for this nation yet. Generate one in the admin panel (Configure -> Supabase -> Support login key), then set SUPPORT_LOGIN_PUBKEY on the nation project.' }, 400)

  const redirectTo = 'https://' + sub + '.fnhub.app/'
  const now = Math.floor(Date.now() / 1000)

  // Sign a short-lived (2 min) entry token. Everything support-login trusts is in
  // the SIGNED claims -- operator + redirect target -- so nothing can be tampered.
  let entryToken = ''
  try {
    entryToken = await signEs256({
      iss: 'fnhub-control-plane', sub: sub, op: actor, rt: redirectTo,
      iat: now, nbf: now - 30, exp: now + 120, jti: crypto.randomUUID(),
    }, privateJwk)
  } catch (e) { return json({ error: 'sign_failed', detail: String(e && (e as Error).message || e) }, 500) }

  const fnUrl = 'https://' + ref + '.functions.supabase.co/support-login'
  let out: any = {}
  try {
    const r = await fetch(fnUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-support-token': entryToken },
      body: '{}',
    })
    out = await r.json().catch(() => ({}))
    if (!r.ok) {
      return json({ error: out.error || 'nation_error', message: out.message || ('HTTP ' + r.status) },
        r.status === 403 ? 403 : 502)
    }
  } catch (e) {
    return json({ error: 'nation_unreachable',
      message: 'Could not reach this nation\'s support-login function. Is it deployed with SUPPORT_LOGIN_PUBKEY set?',
      detail: String(e && (e as Error).message || e) }, 502)
  }

  const link = out && out.action_link
  if (!link) return json({ error: 'no_link', message: 'The nation returned no sign-in link.' }, 502)

  try {
    await admin.from('platform_audit').insert({
      action: 'entered_nation', subdomain: sub,
      detail: actor + ' opened a support session on ' + (nation.display_name || sub)
        + ' (expires ' + (out.access_expires_at || 'today') + ')',
    })
  } catch (_e) { /* audit best-effort */ }

  return json({ ok: true, action_link: link, subdomain: sub, operator: actor,
    access_expires_at: out.access_expires_at || null, ed_notified: out.ed_notified || 0 })
})
