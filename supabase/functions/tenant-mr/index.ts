// Tenant maintenance request intake - scan-to-report QR flow.
// Deploy: supabase functions deploy tenant-mr
//
// PUBLIC function. The tenant report form sends the project ANON key as the
// bearer, so the gateway accepts the call; this function then does its OWN
// validation (per-unit secret token + rate limit) and writes to
// tenant_mr_submissions with the SERVICE ROLE. Tenants have NO direct table
// access - this function is the only write path, and it never touches
// housing_sow. Source must stay ASCII-only.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const MAX_DESC       = 2000
const RL_WINDOW_MIN  = 10      // rate-limit window
const RL_UNIT_MAX    = 5       // max submissions per unit per window
const RL_IP_MAX      = 12      // max submissions per source IP per window
const URGENCY        = ['routine', 'urgent', 'emergency']

const STORAGE_BUCKET = Deno.env.get('STORAGE_BUCKET') || 'housing-files'
const MAX_PHOTOS     = 3               // max photos per submission
const MAX_PHOTO_BYTES = 6 * 1024 * 1024 // per-photo decoded size cap (~6MB)
const PHOTO_MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

// Decode a data: URL into { bytes, ext, contentType }, or null if unusable.
function decodePhoto(dataUrl: string): { bytes: Uint8Array; ext: string; contentType: string } | null {
  if (typeof dataUrl !== 'string') return null
  const m = dataUrl.match(/^data:([^;,]+);base64,([\s\S]+)$/)
  if (!m) return null
  const contentType = m[1].toLowerCase()
  const ext = PHOTO_MIME[contentType]
  if (!ext) return null
  let bin: string
  try { bin = atob(m[2]) } catch { return null }
  if (bin.length > MAX_PHOTO_BYTES) return null
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { bytes, ext, contentType }
}

// Upload validated photos with the service role. Returns the storage paths that
// uploaded cleanly; a failed photo is skipped so it can never sink the request.
async function uploadPhotos(admin: any, unitId: string, submissionId: string, raw: unknown): Promise<string[]> {
  let list: unknown[] = []
  if (Array.isArray(raw)) list = raw
  else if (typeof raw === 'string' && raw) list = [raw]
  if (!list.length) return []
  const paths: string[] = []
  for (let i = 0; i < list.length && paths.length < MAX_PHOTOS; i++) {
    const dec = decodePhoto(String(list[i] || ''))
    if (!dec) continue
    const path = 'tenants/' + unitId + '/tenant-mr/' + submissionId + '/photo-' + (paths.length + 1) + '.' + dec.ext
    try {
      const { error } = await admin.storage.from(STORAGE_BUCKET)
        .upload(path, dec.bytes, { contentType: dec.contentType, upsert: true })
      if (!error) paths.push(path)
    } catch (_e) { /* skip this photo, keep the request */ }
  }
  return paths
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Server not configured.' }, 500)
    const admin = createClient(SUPABASE_URL, SERVICE_KEY)

    const body   = await req.json().catch(() => ({}))
    const action = String(body.action || '')
    const unitId = String(body.unit_id || '').trim()
    const token  = String(body.token || '').trim()
    if (!unitId || !token) return json({ error: 'Missing unit or code.' }, 400)

    // Validate the per-unit secret token (stored in housing_units.data.qr_token).
    const { data: unitRows, error: uErr } = await admin
      .from('housing_units').select('id, num, street, data').eq('id', unitId).limit(1)
    if (uErr) return json({ error: 'Lookup failed.' }, 500)
    const unit = unitRows && unitRows[0]
    if (!unit) return json({ error: 'This code is not linked to a unit.' }, 404)
    const realToken = unit.data && (unit.data.qr_token || unit.data.qrToken)
    if (!realToken || realToken !== token) return json({ error: 'This code is invalid or has been replaced.' }, 403)
    const address = ((unit.num || '') + ' ' + (unit.street || '')).trim()

    // --- validate: confirm the code + return the unit address for the form ---
    if (action === 'validate') {
      return json({ ok: true, unit_id: unitId, address })
    }

    // --- submit: record the request in the staging table ---
    if (action === 'submit') {
      const description = String(body.description || '').trim().slice(0, MAX_DESC)
      if (!description) return json({ error: 'Please describe the problem.' }, 400)
      const category     = String(body.category || '').trim().slice(0, 80)
      const urgency      = URGENCY.indexOf(String(body.urgency || '')) !== -1 ? String(body.urgency) : 'routine'
      const contactName  = String(body.contact_name || '').trim().slice(0, 120)
      const contactPhone = String(body.contact_phone || '').trim().slice(0, 40)
      const ip = (req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || '').split(',')[0].trim()
      const sinceIso = new Date(Date.now() - RL_WINDOW_MIN * 60000).toISOString()

      // Rate limit: per unit and per source IP.
      const { count: unitCount } = await admin.from('tenant_mr_submissions')
        .select('id', { count: 'exact', head: true }).eq('unit_id', unitId).gte('created_at', sinceIso)
      if ((unitCount || 0) >= RL_UNIT_MAX) {
        return json({ error: 'A few requests were just submitted for this unit. Please try again in a little while.' }, 429)
      }
      if (ip) {
        const { count: ipCount } = await admin.from('tenant_mr_submissions')
          .select('id', { count: 'exact', head: true }).eq('source_ip', ip).gte('created_at', sinceIso)
        if ((ipCount || 0) >= RL_IP_MAX) return json({ error: 'Too many requests. Please try again later.' }, 429)
      }

      const { data: ins, error: iErr } = await admin.from('tenant_mr_submissions').insert({
        unit_id: unitId, unit_address: address, category, description, urgency,
        contact_name: contactName, contact_phone: contactPhone, status: 'new', source_ip: ip,
      }).select('id').limit(1)
      if (iErr) return json({ error: 'Could not save your request. Please try again.' }, 500)
      const subId = (ins && ins[0] && ins[0].id) || ''

      // Optional photos: upload with the service role, store the paths on the row.
      // A photo failure is non-fatal - the text request is already saved.
      if (subId && body.photos) {
        const paths = await uploadPhotos(admin, unitId, subId, body.photos)
        if (paths.length) {
          await admin.from('tenant_mr_submissions')
            .update({ photo_path: JSON.stringify(paths) }).eq('id', subId)
        }
      }
      return json({ ok: true, reference: subId, address })
    }

    return json({ error: 'Unknown action.' }, 400)
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
