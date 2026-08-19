// gen-support-key - control-plane support-login keypair generator (SA-PLAN 12.3).
//
// Deploy on the fnhub-platform project WITH JWT verification:
//   supabase functions deploy gen-support-key --project-ref <platform-ref>
//
// SUPER-ADMIN ONLY. Generates a per-nation ES256 keypair server-side (the private
// key NEVER touches a browser), stores it in nation_support_keys, and returns the
// PUBLIC JWK for the operator to paste into that nation's SUPPORT_LOGIN_PUBKEY
// Edge Function secret.
//
// LOCKED once set: if a key already exists this returns the existing PUBLIC key
// and refuses to overwrite unless { rotate: true } is passed (rotating
// invalidates the nation's current public key until it is re-copied).
//
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (auto).
// Source ASCII-only.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { generateEs256 } from '../_shared/jose.ts'

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
  const rotate = !!body.rotate
  if (!SUB_RE.test(sub)) return json({ error: 'bad_subdomain' }, 400)

  // Nation must exist.
  const { data: nrows } = await admin.from('nations').select('subdomain').eq('subdomain', sub).limit(1)
  if (!nrows || !nrows.length) return json({ error: 'unknown_nation' }, 404)

  // Locked: an existing key is not overwritten unless rotate:true.
  const { data: existing } = await admin.from('nation_support_keys').select('public_jwk, created_at').eq('subdomain', sub).limit(1)
  if (existing && existing.length && !rotate) {
    return json({ ok: true, locked: true, already: true, public_jwk: existing[0].public_jwk,
      created_at: existing[0].created_at,
      message: 'A support key already exists for this nation (locked). Pass rotate to replace it.' })
  }

  // Generate + store (private stays here; only the public JWK is returned).
  let keys
  try { keys = await generateEs256() }
  catch (e) { return json({ error: 'keygen_failed', detail: String(e && (e as Error).message || e) }, 500) }

  const row = {
    subdomain: sub, algorithm: 'ES256',
    private_jwk: keys.privateJwk, public_jwk: keys.publicJwk,
    created_by: actor, updated_at: new Date().toISOString(),
  }
  try {
    if (existing && existing.length) await admin.from('nation_support_keys').update(row).eq('subdomain', sub)
    else                            await admin.from('nation_support_keys').insert(row)
  } catch (e) { return json({ error: 'store_failed', detail: String(e && (e as Error).message || e) }, 500) }

  try {
    await admin.from('platform_audit').insert({
      action: rotate ? 'support_key_rotated' : 'support_key_generated', subdomain: sub,
      detail: actor + (rotate ? ' rotated' : ' generated') + ' the support-login key for ' + sub,
    })
  } catch (_e) { /* audit best-effort */ }

  return json({ ok: true, rotated: !!(existing && existing.length), public_jwk: keys.publicJwk })
})
