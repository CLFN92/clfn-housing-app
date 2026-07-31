// provision-nation - FN Hub control plane (P4, assisted provisioning).
// Deploy on the fnhub-platform project: supabase functions deploy provision-nation
//
// SUPER-ADMIN ONLY. The panel sends the caller's platform user JWT as the
// bearer; this function verifies the caller is in super_admins before doing
// anything. It then stands up a NEW nation against a Supabase project the
// operator already created (assisted mode - P5 will create the project too).
//
// Steps (each is best-effort and reported back; a failure never throws out):
//   1. Run the bootstrap schema on the new project   (Supabase Management API)
//   2. Create the housing-files storage bucket        (new project service key)
//   3. Seed the first ED staff row                     (new project service key)
//   4. Upsert the control-plane registry row           (platform service key)
//   5. (manual) Deploy the 4 nation Edge Functions + set secrets - documented
//
// Secrets required on the platform project:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY  (auto-injected)
//   SUPABASE_MGMT_TOKEN  - a Supabase Management API token (org access token)
// Source ASCII-only.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY') || ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const MGMT_TOKEN   = Deno.env.get('SUPABASE_MGMT_TOKEN') || ''
const MGMT_BASE    = 'https://api.supabase.com'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const SUB_RE = /^[a-z0-9](?:[a-z0-9-]{0,40}[a-z0-9])?$/   // safe subdomain label
function trimSlash(s: string): string { return String(s || '').replace(/\/+$/, '') }

// Resolve + authorize the caller. Returns the lowercased super-admin email, or null.
async function authorizeSuperAdmin(admin: any, token: string): Promise<string | null> {
  if (!token) return null
  let email = ''
  try {
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token },
    })
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

  const nation   = body.nation   || {}
  const target   = body.target   || {}   // { ref, url, anon, service_role }
  const firstEd  = body.first_ed || {}   // { email, name }
  const schemaSql = String(body.schema_sql || '')

  const sub = String(nation.subdomain || '').trim().toLowerCase()
  if (!SUB_RE.test(sub))        return json({ error: 'bad_subdomain' }, 400)
  if (!nation.display_name || !nation.short) return json({ error: 'missing_nation_fields' }, 400)

  const targetUrl = trimSlash(target.url)
  const steps: Array<{ name: string; ok: boolean; detail: string }> = []
  const step = (name: string, ok: boolean, detail: string) => { steps.push({ name, ok, detail }) }

  // --- Step 1: run the bootstrap schema on the new project (Management API) ---
  if (schemaSql && target.ref && MGMT_TOKEN) {
    try {
      const r = await fetch(MGMT_BASE + '/v1/projects/' + encodeURIComponent(target.ref) + '/database/query', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + MGMT_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: schemaSql }),
      })
      const txt = await r.text()
      step('bootstrap_schema', r.ok, r.ok ? 'Schema applied.' : ('Management API ' + r.status + ': ' + txt.slice(0, 300)))
    } catch (e) { step('bootstrap_schema', false, 'Error: ' + String(e).slice(0, 200)) }
  } else {
    step('bootstrap_schema', false, 'Skipped: needs schema_sql + target.ref + SUPABASE_MGMT_TOKEN secret.')
  }

  // --- Step 2: create the housing-files storage bucket on the new project -----
  if (targetUrl && target.service_role) {
    try {
      const r = await fetch(targetUrl + '/storage/v1/bucket', {
        method: 'POST',
        headers: { apikey: target.service_role, Authorization: 'Bearer ' + target.service_role, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'housing-files', name: 'housing-files', public: false }),
      })
      const txt = await r.text()
      const already = /already exists/i.test(txt)
      step('storage_bucket', r.ok || already, r.ok ? 'Bucket created.' : (already ? 'Bucket already existed.' : (r.status + ': ' + txt.slice(0, 200))))
    } catch (e) { step('storage_bucket', false, 'Error: ' + String(e).slice(0, 200)) }
  } else {
    step('storage_bucket', false, 'Skipped: needs target.url + target.service_role.')
  }

  // --- Step 3: seed the first ED staff row on the new project -----------------
  if (targetUrl && target.service_role && firstEd.email) {
    try {
      const r = await fetch(targetUrl + '/rest/v1/staff', {
        method: 'POST',
        headers: {
          apikey: target.service_role, Authorization: 'Bearer ' + target.service_role,
          'Content-Type': 'application/json', Prefer: 'return=minimal,resolution=merge-duplicates',
        },
        body: JSON.stringify({ email: String(firstEd.email).toLowerCase(), name: firstEd.name || 'Executive Director', role: 'ed', is_active: true }),
      })
      const txt = await r.text()
      step('seed_first_ed', r.ok, r.ok ? ('Seeded ED ' + firstEd.email) : (r.status + ': ' + txt.slice(0, 200)))
    } catch (e) { step('seed_first_ed', false, 'Error: ' + String(e).slice(0, 200)) }
  } else {
    step('seed_first_ed', false, 'Skipped: needs target.url + target.service_role + first_ed.email.')
  }

  // --- Step 4: upsert the control-plane registry row (platform) ---------------
  let registryOk = false
  try {
    const row: Record<string, unknown> = {
      subdomain: sub,
      display_name: nation.display_name,
      short: nation.short,
      supabase_url: targetUrl || null,
      supabase_anon: target.anon || null,
      primary_color: nation.primary_color || null,
      email_domain: nation.email_domain || null,
      housing_email: nation.housing_email || null,
      modules_licensed: (nation.modules_licensed && typeof nation.modules_licensed === 'object') ? nation.modules_licensed : {},
      status: (targetUrl && target.anon) ? 'active' : 'provisioning',
      provisioned_by: actor,
      updated_at: new Date().toISOString(),
    }
    const { error } = await admin.from('nations').upsert(row, { onConflict: 'subdomain' })
    registryOk = !error
    step('registry_row', registryOk, registryOk ? 'Registry upserted (status ' + row.status + ').' : ('DB error: ' + (error && error.message)))
  } catch (e) { step('registry_row', false, 'Error: ' + String(e).slice(0, 200)) }

  // --- Step 5: nation Edge Functions + secrets (manual in assisted mode) ------
  step('edge_functions', false, 'Manual: deploy the 4 nation functions (send-notification, tenant-mr, applicant-intake, ai-chat) to the new project and set their secrets. Automated in P5.')

  // Audit (best-effort).
  try {
    await admin.from('platform_audit').insert({
      actor, action: 'nation_provisioned', target: sub,
      detail: JSON.stringify({ steps: steps.map((s) => ({ name: s.name, ok: s.ok })), display_name: nation.display_name }),
    })
  } catch (_e) { /* never block on audit */ }

  const allCore = registryOk
  return json({ ok: allCore, subdomain: sub, steps })
})
