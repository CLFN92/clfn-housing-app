// Applicant application intake - Phase T-A.
// Deploy: supabase functions deploy applicant-intake
//
// AUTHENTICATED function for logged-in APPLICANTS (magic-link accounts), who
// are a separate population from staff. The applicant sends their own user JWT
// as the bearer; this function verifies it, requires a CONFIRMED email, and is
// the ONLY write path into application_submissions (writes with the SERVICE
// ROLE, bypassing RLS). Applicants never touch housing_applications.
//
// Actions: ping | save_draft | submit | withdraw. Reading own rows is done
// directly by the portal via RLS (owner SELECT) - not here. Source ASCII-only.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  emailConfigured, isValidEmail, escapeHtml, renderBrandedEmail, emailBrand,
  sendEmail, sendEmailSerially,
} from '../_shared/email.ts'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')
const ANON_KEY          = Deno.env.get('SUPABASE_ANON_KEY')
const SERVICE_KEY       = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const APP_URL           = (Deno.env.get('APP_URL') || '').replace(/\/$/, '')

const NOTIFY_ROLES = (Deno.env.get('HOUSING_APP_NOTIFY_ROLES') || 'housing_manager,ed,hm,manager')
  .split(',').map((r) => r.trim().toLowerCase()).filter(Boolean)
const NOTIFY_TO    = (Deno.env.get('HOUSING_APP_NOTIFY_TO') || '')
  .split(',').map((s) => s.trim()).filter((s) => isValidEmail(s))

const TYPES     = ['new', 'update', 'transfer']
const MAX_BYTES = 512 * 1024   // payload cap (defense in depth; docs go to Storage, not here)

// Magic-link rate limits (we replace Supabase's built-in /otp throttle).
const ML_WINDOW_MIN = 10
const ML_EMAIL_MAX  = 3        // per email per window
const ML_IP_MAX     = 15       // per source IP per window

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

// Resolve the housing recipients for the "new application submitted" email.
async function resolveHousingRecipients(admin: any): Promise<Array<{ to: string; to_name?: string }>> {
  const seen = new Set<string>()
  const out: Array<{ to: string; to_name?: string }> = []
  for (const e of NOTIFY_TO) { const k = e.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push({ to: e }) } }
  try {
    const { data } = await admin.from('staff').select('email, name, role, is_active').eq('is_active', true)
    for (const s of (data || [])) {
      if (NOTIFY_ROLES.indexOf(String(s.role || '').toLowerCase()) === -1) continue
      if (!isValidEmail(s.email)) continue
      const k = String(s.email).toLowerCase()
      if (seen.has(k)) continue
      seen.add(k); out.push({ to: s.email, to_name: s.name || undefined })
    }
  } catch (_e) { /* explicit list only */ }
  return out
}

const TYPE_LABEL: Record<string, string> = { new: 'application', update: 'application update', transfer: 'transfer request' }

async function notifySubmission(admin: any, row: any, applicantEmail: string, applicantName: string): Promise<void> {
  if (!emailConfigured()) return
  const brand = emailBrand()
  const kind  = TYPE_LABEL[row.submission_type] || 'application'

  // 1) Housing team.
  const recipients = await resolveHousingRecipients(admin)
  if (recipients.length) {
    const subject = 'New ' + kind + ' submitted for review'
    const who = applicantName || applicantEmail || 'An applicant'
    const link = APP_URL
      ? '<p style="font-size:13px;margin:14px 0 0;"><a href="' + APP_URL + '/housing.html" style="color:#0b6bcb;">Open the Housing app</a> and review it under <b>Application Submissions</b>.</p>'
      : '<p style="font-size:13px;margin:14px 0 0;color:#666;">Review it in the Housing app under <b>Application Submissions</b>.</p>'
    const inner = '<p style="font-size:14px;color:#333;margin:0 0 6px;">' + escapeHtml(who)
      + ' submitted a ' + escapeHtml(kind) + ' through the applicant portal.</p>'
      + '<p style="font-size:13px;color:#666;margin:0;">Reference: ' + escapeHtml(row.id) + '</p>'
      + link
    const html = renderBrandedEmail(subject, inner)
    await sendEmailSerially(recipients, () => ({ subject, html }))
  }

  // 2) Applicant confirmation.
  if (isValidEmail(applicantEmail)) {
    const subject = 'We received your ' + kind
    const inner = '<p style="font-size:14px;color:#333;margin:0 0 6px;">Thank you'
      + (applicantName ? ', ' + escapeHtml(applicantName) : '')
      + '. The ' + escapeHtml(brand) + ' office has received your ' + escapeHtml(kind) + ' and will review it.</p>'
      + '<p style="font-size:12px;color:#888;margin:14px 0 0;">Reference: ' + escapeHtml(row.id) + '</p>'
      + '<p style="font-size:13px;color:#666;margin:10px 0 0;">You can sign in to the applicant portal any time to check the status.</p>'
    const html = renderBrandedEmail(subject, inner)
    try { await sendEmail({ to: applicantEmail, to_name: applicantName || undefined, subject, html }) }
    catch (e) { console.warn('[applicant-intake] confirm email failed: ' + (e as Error).message) }
  }
}

// --- Portal maintenance-request photos (mirrors tenant-mr) ----------------
const MRQ_MAX_PHOTOS = 3
const MRQ_MAX_PHOTO_BYTES = 6 * 1024 * 1024
const MRQ_PHOTO_MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const MRQ_BUCKET = Deno.env.get('STORAGE_BUCKET') || 'housing-files'
function mrqDecodePhoto(dataUrl: string): { bytes: Uint8Array; ext: string; contentType: string } | null {
  if (typeof dataUrl !== 'string') return null
  const m = dataUrl.match(/^data:([^;,]+);base64,([\s\S]+)$/)
  if (!m) return null
  const contentType = m[1].toLowerCase()
  const ext = MRQ_PHOTO_MIME[contentType]
  if (!ext) return null
  let bin: string
  try { bin = atob(m[2]) } catch { return null }
  if (bin.length > MRQ_MAX_PHOTO_BYTES) return null
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { bytes, ext, contentType }
}
// Same storage path convention as the QR flow, so staff review shows portal
// photos identically. A failed photo is skipped, never sinks the request.
async function mrqUploadPhotos(admin: any, unitId: string, submissionId: string, raw: unknown): Promise<string[]> {
  let list: unknown[] = []
  if (Array.isArray(raw)) list = raw
  else if (typeof raw === 'string' && raw) list = [raw]
  if (!list.length) return []
  const paths: string[] = []
  for (let i = 0; i < list.length && paths.length < MRQ_MAX_PHOTOS; i++) {
    const dec = mrqDecodePhoto(String(list[i] || ''))
    if (!dec) continue
    const path = 'tenants/' + unitId + '/tenant-mr/' + submissionId + '/photo-' + (paths.length + 1) + '.' + dec.ext
    try {
      const { error } = await admin.storage.from(MRQ_BUCKET)
        .upload(path, dec.bytes, { contentType: dec.contentType, upsert: true })
      if (!error) paths.push(path)
    } catch (_e) { /* skip this photo, keep the request */ }
  }
  return paths
}

// --- Member portal: resolve the signed-in member's UNIT -------------------
// Email-matched tenants row first (the tenant file), then a linked
// application's assigned unit. Server-side only: the portal never supplies a
// unit id, so a member can only ever file against their own home.
async function resolveMemberUnit(admin: any, email: string, linkedAppIds: string[]): Promise<{ id: string; address: string } | null> {
  try {
    let unitId: string | null = null
    const { data: ts } = await admin.from('tenants')
      .select('current_unit_id').ilike('email', email).is('merged_into', null)
      .not('current_unit_id', 'is', null).limit(1)
    if (ts && ts[0] && ts[0].current_unit_id) unitId = ts[0].current_unit_id
    if (!unitId && linkedAppIds && linkedAppIds.length) {
      const { data: apps } = await admin.from('housing_applications')
        .select('assigned_unit_id').in('id', linkedAppIds).not('assigned_unit_id', 'is', null).limit(1)
      if (apps && apps[0] && apps[0].assigned_unit_id) unitId = apps[0].assigned_unit_id
    }
    if (!unitId) return null
    const { data: us } = await admin.from('housing_units').select('id, num, street').eq('id', unitId).limit(1)
    if (!us || !us[0]) return null
    return { id: us[0].id, address: (String(us[0].num || '') + ' ' + String(us[0].street || '')).trim() }
  } catch (_e) { return null }
}

// Staff notification for a portal-submitted maintenance request -- mirrors
// the QR flow's (tenant-mr) email so both arrive the same way.
async function notifyPortalMr(admin: any, info: { address: string; category: string; description: string; urgency: string; contactName: string; email: string }): Promise<void> {
  if (!emailConfigured()) return
  const recipients = await resolveHousingRecipients(admin)
  if (!recipients.length) return
  const urg = (info.urgency || 'routine').toLowerCase()
  const subject = (urg === 'emergency' ? 'EMERGENCY ' : urg === 'urgent' ? 'Urgent ' : '')
    + 'maintenance request - ' + (info.address || 'a unit')
  const inner = '<p style="font-size:14px;color:#333;margin:0 0 6px;">A maintenance request was submitted through the member portal for <b>' + escapeHtml(info.address) + '</b>.</p>'
    + (info.category ? '<p style="font-size:13px;color:#333;margin:0 0 4px;"><b>Category:</b> ' + escapeHtml(info.category) + '</p>' : '')
    + '<p style="font-size:13px;color:#333;margin:0 0 4px;"><b>Urgency:</b> ' + escapeHtml(info.urgency) + '</p>'
    + '<p style="font-size:13px;color:#333;margin:6px 0 4px;white-space:pre-wrap;">' + escapeHtml(String(info.description || '').slice(0, 2000)) + '</p>'
    + '<p style="font-size:12px;color:#666;margin:10px 0 0;">Submitted by ' + escapeHtml(info.contactName || info.email) + ' (' + escapeHtml(info.email) + '). Review it in the Housing app under <b>Tenant Requests</b>.</p>'
  const html = renderBrandedEmail(subject, inner)
  await sendEmailSerially(recipients, () => ({ subject, html }))
}

// Nation band-number verification (opt-in via Settings -> Config in the staff
// app). housing_settings key 'nation_band_number' holds the nation's 3-digit
// band membership number. When set, a self-serve applicant's band (registry)
// number must be exactly 10 digits and START with those 3 digits -- the first
// three digits of a registry number are always the band membership number.
// When the setting is absent/blank the check is skipped entirely, so nations
// that have not configured it are unaffected.
async function readNationSetting(admin: any, key: string): Promise<unknown> {
  try {
    const { data } = await admin.from('housing_settings').select('value').eq('key', key).limit(1)
    let v = data && data[0] ? data[0].value : null
    if (v && typeof v === 'object' && 'value' in v) v = (v as any).value
    return v
  } catch (_e) { return null }
}
async function nationBandPrefix(admin: any): Promise<string> {
  const s = String((await readNationSetting(admin, 'nation_band_number')) ?? '').trim()
  return /^\d{3}$/.test(s) ? s : ''
}
// External (self-serve) applications master switch. Settings -> Config in the
// staff app. Absent = ON (backwards compatible); only an explicit false turns
// the portal off.
async function portalEnabled(admin: any): Promise<boolean> {
  const v = await readNationSetting(admin, 'external_applications_enabled')
  return !(v === false || v === 'false')
}
const PORTAL_CLOSED_MSG = 'Online applications are currently closed. Please contact the Housing office.'
// Generic on purpose -- never disclose the expected length or prefix.
const BAND_FAIL_MSG = 'That band / membership number could not be verified. Please check the number on your status card, or contact the Housing office.'

// Only allow magic-link redirects back to our own hosts (defense in depth;
// Supabase also validates against its Redirect URL allow-list).
function isSafeRedirect(u: string): boolean {
  try {
    const url = new URL(u)
    const h = url.hostname
    const localOk = (h === 'localhost' || h === '127.0.0.1')
    if (url.protocol !== 'https:' && !localOk) return false
    // Our own hosts ONLY. The old wildcard *.pages.dev / *.workers.dev
    // acceptance meant ANY attacker-registered Cloudflare Pages/Workers
    // subdomain was an accepted post-auth redirect target (open-redirect
    // token leak; Supabase's own uri_allow_list was the only real gate).
    // Mirrors support-login's safeRedirect.
    return h === 'fnhub.app' || h.endsWith('.fnhub.app') || localOk
  } catch { return false }
}

// Throttle magic-link requests per email + per IP. Generic (never reveals
// whether an address exists). Degrades to "no limit" if the table is absent.
async function magicLinkRateLimited(admin: any, email: string, ip: string): Promise<boolean> {
  try {
    const since = new Date(Date.now() - ML_WINDOW_MIN * 60000).toISOString()
    const { count: ec } = await admin.from('magic_link_requests')
      .select('id', { count: 'exact', head: true }).eq('email', email).gte('created_at', since)
    if ((ec || 0) >= ML_EMAIL_MAX) return true
    if (ip) {
      const { count: ic } = await admin.from('magic_link_requests')
        .select('id', { count: 'exact', head: true }).eq('ip', ip).gte('created_at', since)
      if ((ic || 0) >= ML_IP_MAX) return true
    }
    await admin.from('magic_link_requests').insert({ email, ip })
  } catch (_e) { /* table not created yet - skip limiting rather than break */ }
  return false
}

// Generate a magic link (creating the auth user on first sign-in) and email it
// through the nation's OWN provider - not Supabase's default sender.
async function sendMagicLink(admin: any, email: string, redirectTo?: string, opts?: { subject?: string; intro?: string }): Promise<{ ok: boolean; error?: string }> {
  const linkOpts = redirectTo ? { redirectTo } : undefined
  let gen = await admin.auth.admin.generateLink({ type: 'magiclink', email, options: linkOpts })
  if (gen.error && /not found|no user|does not exist|unable/i.test(gen.error.message || '')) {
    // First-time applicant: create the account, then generate the link. Their
    // possession of the emailed link is the email confirmation.
    await admin.auth.admin.createUser({ email, email_confirm: true })
    gen = await admin.auth.admin.generateLink({ type: 'magiclink', email, options: linkOpts })
  }
  if (gen.error) return { ok: false, error: gen.error.message }
  const link = gen.data && gen.data.properties && gen.data.properties.action_link
  if (!link) return { ok: false, error: 'No sign-in link was generated.' }

  const brand   = emailBrand()
  const subject = (opts && opts.subject) || ('Sign in to ' + brand)
  const intro   = (opts && opts.intro) || ('Click the button below to sign in to the ' + brand + ' application portal. This link is valid for a short time and can be used once.')
  const safeLink = escapeHtml(link)
  const inner =
      '<p style="font-size:14px;color:#333;margin:0 0 16px;">' + escapeHtml(intro) + '</p>'
    + '<p style="margin:0 0 20px;"><a href="' + safeLink + '" '
    +   'style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:700;'
    +   'padding:12px 24px;border-radius:8px;font-size:15px;">Sign in</a></p>'
    + '<p style="font-size:12px;color:#666;margin:0 0 4px;">Or paste this link into your browser:</p>'
    + '<p style="font-size:12px;color:#0b6bcb;word-break:break-all;margin:0 0 16px;">' + safeLink + '</p>'
    + '<p style="font-size:12px;color:#888;margin:0;">If you did not request this, you can safely ignore this email.</p>'
  const html = renderBrandedEmail(subject, inner)
  try {
    await sendEmail({ to: email, subject, html })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)
  try {
    if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) return json({ error: 'Server not configured.' }, 500)

    const body   = await req.json().catch(() => ({}))
    const action = String(body.action || '')

    // --- portal_info: PRE-LOGIN. Tells the sign-in screen whether the portal
    // is open and whether a band number is required. Never discloses the
    // nation's 3-digit prefix itself. ---
    if (action === 'portal_info') {
      const adminI = createClient(SUPABASE_URL, SERVICE_KEY)
      const enabled = await portalEnabled(adminI)
      const prefix = enabled ? await nationBandPrefix(adminI) : ''
      return json({ ok: true, enabled, band_required: !!prefix, closed_message: enabled ? undefined : PORTAL_CLOSED_MSG })
    }

    // --- request_link: PRE-LOGIN. Generate a magic link and email it through
    // the nation's OWN pipeline (not Supabase's default sender). No user JWT;
    // the client calls this with the anon key like any public endpoint. ---
    if (action === 'request_link') {
      const linkEmail = String(body.email || '').trim().toLowerCase()
      if (!isValidEmail(linkEmail)) return json({ error: 'Please enter a valid email address.' }, 400)
      const rawRedirect = String(body.redirect_to || '').trim()
      const redirectTo  = isSafeRedirect(rawRedirect) ? rawRedirect : undefined
      const ip = (req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || '').split(',')[0].trim()
      const admin0 = createClient(SUPABASE_URL, SERVICE_KEY)
      if (!(await portalEnabled(admin0))) return json({ error: PORTAL_CLOSED_MSG, portal_disabled: true }, 503)
      // Rate-limit BEFORE the band-number gate so prefix guessing burns the
      // same per-email/per-IP budget as link requests -- the gate can't be
      // used as a free verification oracle. Generic success either way so we
      // never reveal whether an address exists or that a throttle fired.
      if (await magicLinkRateLimited(admin0, linkEmail, ip)) return json({ ok: true })
      // Front-door band-number gate (when the nation number is configured):
      // no sign-in link is sent unless the 10-digit registry number starts
      // with the nation's 3-digit band number. Errors never disclose the
      // expected prefix. The submit action re-verifies regardless.
      const gatePrefix = await nationBandPrefix(admin0)
      if (gatePrefix) {
        const gateBand = String(body.band || '').replace(/[\s-]/g, '')
        if (!/^\d{10}$/.test(gateBand)) return json({ error: BAND_FAIL_MSG }, 400)
        if (gateBand.slice(0, 3) !== gatePrefix) return json({ error: BAND_FAIL_MSG }, 400)
      }
      // If this nation has no email provider configured, tell the client so it
      // can fall back to Supabase's built-in sender rather than fail.
      if (!emailConfigured()) return json({ error: 'email_not_configured' }, 503)
      const sent = await sendMagicLink(admin0, linkEmail, redirectTo)
      if (!sent.ok) {
        console.warn('[applicant-intake] magic link failed: ' + sent.error)
        return json({ error: 'Could not send the sign-in link. Please try again shortly.' }, 502)
      }
      return json({ ok: true })
    }

    // --- Auth: remaining actions require a signed-in user ---
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Sign in to continue.' }, 401)
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) return json({ error: 'Your session has expired. Please sign in again.' }, 401)
    const uid   = user.id
    const email = (user.email || '').toLowerCase()
    const admin = createClient(SUPABASE_URL, SERVICE_KEY)

    // External-applications master switch: when OFF, every portal action is
    // refused -- including staff invites, so a disabled portal cannot be
    // half-used. Staff get a message pointing at the setting.
    if (!(await portalEnabled(admin))) {
      if (action === 'invite') return json({ error: 'External applications are turned OFF in Settings -> Config. Turn them on to invite applicants.' }, 503)
      return json({ error: PORTAL_CLOSED_MSG, portal_disabled: true }, 503)
    }

    // --- invite: STAFF-only. Email an applicant a branded portal sign-in link,
    // and (optionally) pre-link their existing application to their email so
    // they land on it. Runs before the applicant email-confirmed gate. ---
    if (action === 'invite') {
      const { data: staffRows } = await admin.from('staff').select('id').ilike('email', email).eq('is_active', true).limit(1)
      if (!staffRows || !staffRows.length) return json({ error: 'Staff access required.' }, 403)
      const targetEmail = String(body.email || '').trim().toLowerCase()
      if (!isValidEmail(targetEmail)) return json({ error: 'Enter a valid applicant email.' }, 400)
      if (!emailConfigured()) return json({ error: 'Email is not set up for this nation yet.' }, 503)
      const appId = String(body.app_id || '').trim()
      const rawRedirect = String(body.redirect_to || '').trim()
      const redirectTo = isSafeRedirect(rawRedirect) ? rawRedirect : undefined
      if (appId) { try { await admin.from('applicant_invites').insert({ email: targetEmail, app_id: appId, invited_by: email }) } catch (_e) {} }
      const brand = emailBrand()
      const sent = await sendMagicLink(admin, targetEmail, redirectTo, {
        subject: 'You are invited to the ' + brand + ' portal',
        intro: 'You have been invited to the ' + brand + ' housing application portal. Sign in with the button below to submit or update your application.'
      })
      if (!sent.ok) { console.warn('[applicant-intake] invite failed: ' + sent.error); return json({ error: 'Could not send the invite. Please try again.' }, 502) }
      return json({ ok: true })
    }

    // Applicant self-service actions require a confirmed email.
    if (!user.email_confirmed_at) return json({ error: 'Please confirm your email first.' }, 403)

    // Ensure a profile row exists (email only; never touches linked_app_ids).
    await admin.from('applicant_profiles').upsert({ uid, email, updated_at: new Date().toISOString() }, { onConflict: 'uid' })

    // --- ping: bootstrap the dashboard ---
    if (action === 'ping') {
      // Consume any staff invites that pre-linked an application to this email,
      // then seed a pre-filled draft from EVERY linked application. The seed is
      // driven off the profile's persistent linked_app_ids (NOT the one-time
      // invite row), so it is idempotent: it still populates the portal even if
      // the invite was already consumed on an earlier sign-in.
      try {
        // 1) Merge any fresh invite app_ids into the profile's linked list.
        const { data: pr } = await admin.from('applicant_profiles').select('linked_app_ids').eq('uid', uid).limit(1)
        const linked: string[] = (pr && pr[0] && pr[0].linked_app_ids) || []
        let changed = false
        try {
          const { data: invs } = await admin.from('applicant_invites').select('id, app_id').eq('email', email).is('consumed_at', null)
          if (invs && invs.length) {
            for (const iv of invs) { if (iv.app_id && linked.indexOf(iv.app_id) === -1) { linked.push(iv.app_id); changed = true } }
            await admin.from('applicant_invites').update({ consumed_at: new Date().toISOString() }).in('id', invs.map((i: any) => i.id))
          }
        } catch (_e) { /* invites table may not exist yet */ }
        if (changed) await admin.from('applicant_profiles').update({ linked_app_ids: linked, updated_at: new Date().toISOString() }).eq('uid', uid)

        // 2) For each linked application with no submission yet, seed a pre-filled
        //    DRAFT so the portal opens POPULATED instead of blank.
        for (const appId of linked) {
          if (!appId) continue
          try {
            const { data: existSub } = await admin.from('application_submissions')
              .select('id').eq('applicant_uid', uid).eq('linked_app_id', appId).limit(1)
            if (existSub && existSub.length) continue
            const { data: appRows } = await admin.from('housing_applications')
              .select('id, data, app_type').eq('id', appId).limit(1)
            const src = appRows && appRows[0]
            if (!src) continue
            const d = (src.data && typeof src.data === 'object') ? src.data : {}
            const payload: Record<string, unknown> = {}
            const scalarKeys = ['fn','ln','dob','band','marital','reserve','livingSituation','phone','email','street','city','province','postal','occDate','homeless','haveHouse','homeCondition','hasCoApp']
            for (const k of scalarKeys) { if (d[k] !== undefined && d[k] !== null && d[k] !== '') payload[k] = d[k] }
            if (d.coApp) payload.coApp = d.coApp
            for (const k of ['habitants','incomes','references','pets']) { if (Array.isArray(d[k]) && d[k].length) payload[k] = d[k] }
            const subType = src.app_type === 'transfer_request' ? 'transfer' : (src.app_type === 'existing_tenant' ? 'update' : 'new')
            await admin.from('application_submissions').insert({
              applicant_uid: uid, submission_type: subType, payload, status: 'draft', linked_app_id: appId,
            })
          } catch (_e) { /* best-effort seed; the portal still works without it */ }
        }
      } catch (_e) { /* profile table may not exist yet */ }
      const { data: prof } = await admin.from('applicant_profiles').select('*').eq('uid', uid).limit(1)
      const { data: subs } = await admin.from('application_submissions')
        .select('id, submission_type, status, linked_app_id, created_app_id, review_notes, submitted_at, updated_at')
        .eq('applicant_uid', uid).order('updated_at', { ascending: false })
      // band_required tells the portal to demand a 10-digit registry number.
      // The 3-digit prefix itself is NEVER sent to the client -- disclosing it
      // would hand a spoofer the exact format to fabricate; the prefix match
      // is enforced only server-side at submit, with a generic error.
      const bandPrefix = await nationBandPrefix(admin)
      // Member portal: the signed-in member's unit (if any) powers the
      // "My Home" card + maintenance-request form on the dashboard.
      const memberUnit = await resolveMemberUnit(admin, email, ((prof && prof[0] && prof[0].linked_app_ids) || []))
      // Recent maintenance requests for the member's unit -- powers the
      // status list on the "My home" card.
      let memberMrs: unknown[] = []
      if (memberUnit) {
        try {
          const { data: mrs } = await admin.from('tenant_mr_submissions')
            .select('id, created_at, category, urgency, status, review_notes, sow_project_number')
            .eq('unit_id', memberUnit.id).order('created_at', { ascending: false }).limit(5)
          memberMrs = mrs || []
        } catch (_e) { /* list is optional */ }
      }
      return json({ ok: true, uid, email, profile: (prof && prof[0]) || null, submissions: subs || [], band_required: !!bandPrefix, unit: memberUnit, maintenance: memberMrs })
    }

    // --- save_draft: create or update the applicant's OWN draft ---
    if (action === 'save_draft') {
      const submissionType = TYPES.indexOf(String(body.submission_type || '')) !== -1 ? String(body.submission_type) : 'new'
      const payload = (body.payload && typeof body.payload === 'object') ? body.payload : {}
      if (JSON.stringify(payload).length > MAX_BYTES) return json({ error: 'This application is too large to save.' }, 413)
      const fullName = [payload.fn, payload.ln].filter(Boolean).join(' ').trim().slice(0, 160)
      const phone    = String(payload.phone || '').trim().slice(0, 40)

      let subId = String(body.submission_id || '').trim()
      if (subId) {
        // Update an existing row the caller owns and that is still editable.
        const { data: rows } = await admin.from('application_submissions')
          .select('id, applicant_uid, status').eq('id', subId).limit(1)
        const row = rows && rows[0]
        if (!row || row.applicant_uid !== uid) return json({ error: 'Not found.' }, 404)
        if (['draft', 'changes_requested'].indexOf(row.status) === -1) {
          return json({ error: 'This application can no longer be edited.' }, 409)
        }
        await admin.from('application_submissions').update({
          submission_type: submissionType, payload, status: 'draft', updated_at: new Date().toISOString(),
        }).eq('id', subId)
      } else {
        const { data: ins, error: iErr } = await admin.from('application_submissions').insert({
          applicant_uid: uid, submission_type: submissionType, payload, status: 'draft',
        }).select('id').limit(1)
        if (iErr) return json({ error: 'Could not save. Please try again.' }, 500)
        subId = (ins && ins[0] && ins[0].id) || ''
      }
      if (fullName || phone) {
        await admin.from('applicant_profiles').update({
          full_name: fullName || undefined, phone: phone || undefined, updated_at: new Date().toISOString(),
        }).eq('uid', uid)
      }
      return json({ ok: true, id: subId })
    }

    // --- submit: lock the draft for staff review + notify ---
    if (action === 'submit') {
      const subId = String(body.submission_id || '').trim()
      if (!subId) return json({ error: 'Missing application.' }, 400)
      const { data: rows } = await admin.from('application_submissions')
        .select('*').eq('id', subId).limit(1)
      const row = rows && rows[0]
      if (!row || row.applicant_uid !== uid) return json({ error: 'Not found.' }, 404)
      if (['draft', 'changes_requested'].indexOf(row.status) === -1) {
        return json({ error: 'This application has already been submitted.' }, 409)
      }
      const p = row.payload || {}
      if (!String(p.fn || '').trim() || !String(p.ln || '').trim()) {
        return json({ error: 'Please enter the applicant first and last name before submitting.' }, 400)
      }
      // Band-number verification (server-side gate; the portal mirrors this
      // client-side for early feedback but this is the enforcement point).
      // Anti-spoofing: neither error message reveals the expected prefix.
      const reqPrefix = await nationBandPrefix(admin)
      if (reqPrefix) {
        const band = String(p.band || '').replace(/[\s-]/g, '')
        if (!/^\d{10}$/.test(band)) {
          return json({ error: BAND_FAIL_MSG }, 400)
        }
        if (band.slice(0, 3) !== reqPrefix) {
          return json({ error: BAND_FAIL_MSG }, 400)
        }
        p.band = band   // persist the normalized (digits-only) form
      }
      const now = new Date().toISOString()
      const { data: upd } = await admin.from('application_submissions')
        .update({ status: 'submitted', submitted_at: now, updated_at: now, payload: p })
        .eq('id', subId).select('*').limit(1)
      const saved = (upd && upd[0]) || row
      const applicantName = [p.fn, p.ln].filter(Boolean).join(' ').trim()
      const kindLbl = row.submission_type === 'update' ? 'Application update'
        : row.submission_type === 'transfer' ? 'Transfer request' : 'New application'
      // Audit the external submission (append-only, service role). Never throws.
      try {
        await admin.from('housing_audit_log').insert({
          entity_type: 'application', entity_id: subId, action: 'application_portal_submitted',
          detail: kindLbl + ' submitted via applicant portal - ' + (applicantName || email),
          actor: (p.email && isValidEmail(p.email)) ? p.email : email, created_at: now,
        })
      } catch (_e) { /* audit is best-effort */ }
      try { await notifySubmission(admin, saved, (p.email && isValidEmail(p.email)) ? p.email : email, applicantName) }
      catch (e) { console.warn('[applicant-intake] notify failed: ' + (e as Error).message) }
      return json({ ok: true, id: subId, reference: subId })
    }

    // --- withdraw: applicant pulls back a submission not yet resolved ---
    if (action === 'withdraw') {
      const subId = String(body.submission_id || '').trim()
      if (!subId) return json({ error: 'Missing application.' }, 400)
      const { data: rows } = await admin.from('application_submissions')
        .select('id, applicant_uid, status').eq('id', subId).limit(1)
      const row = rows && rows[0]
      if (!row || row.applicant_uid !== uid) return json({ error: 'Not found.' }, 404)
      if (['submitted', 'in_review', 'changes_requested'].indexOf(row.status) === -1) {
        return json({ error: 'This application cannot be withdrawn.' }, 409)
      }
      await admin.from('application_submissions')
        .update({ status: 'withdrawn', updated_at: new Date().toISOString() }).eq('id', subId)
      return json({ ok: true })
    }

    // --- report_mr: authenticated member files a maintenance request against
    // THEIR OWN unit (resolved server-side; the client sends no unit id).
    // Writes the same staging queue as the QR flow (tenant_mr_submissions),
    // same rate limit + staff notification, tagged with the member's email. ---
    if (action === 'report_mr') {
      const { data: pr2 } = await admin.from('applicant_profiles').select('linked_app_ids').eq('uid', uid).limit(1)
      const linked2: string[] = (pr2 && pr2[0] && pr2[0].linked_app_ids) || []
      const unit = await resolveMemberUnit(admin, email, linked2)
      if (!unit) return json({ error: 'No unit is linked to your account yet. Contact the Housing office to have your home added to your file.' }, 400)
      const description = String(body.description || '').trim().slice(0, 4000)
      if (!description) return json({ error: 'Please describe the problem.' }, 400)
      const category = String(body.category || '').trim().slice(0, 80)
      const URG2 = ['routine', 'urgent', 'emergency']
      const urgency = URG2.indexOf(String(body.urgency || '')) !== -1 ? String(body.urgency) : 'routine'
      const contactName = String(body.contact_name || '').trim().slice(0, 120)
      const contactPhone = String(body.contact_phone || '').trim().slice(0, 40)
      const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
      const sinceIso = new Date(Date.now() - 10 * 60000).toISOString()
      const { count: mrCount } = await admin.from('tenant_mr_submissions')
        .select('id', { count: 'exact', head: true }).eq('unit_id', unit.id).gte('created_at', sinceIso)
      if ((mrCount || 0) >= 3) {
        return json({ error: 'A few requests were just submitted for this unit. Please try again in a little while.' }, 429)
      }
      const { data: mrIns, error: mrErr } = await admin.from('tenant_mr_submissions').insert({
        unit_id: unit.id, unit_address: unit.address, category, description, urgency,
        contact_name: contactName, contact_phone: contactPhone, status: 'new', source_ip: ip,
      }).select('id').limit(1)
      if (mrErr) return json({ error: 'Could not save your request. Please try again.' }, 500)
      // Contact email = the verified sign-in address (best-effort column, may
      // not exist pre-migration -- mirrors the QR flow's own handling).
      try { if (mrIns && mrIns[0]) await admin.from('tenant_mr_submissions').update({ contact_email: email }).eq('id', mrIns[0].id) } catch (_e) { /* optional column */ }
      // Photos (optional, max 3 compressed data URLs) -- stored exactly like
      // the QR flow's so the staff review modal renders them unchanged.
      try {
        if (mrIns && mrIns[0] && body.photos) {
          const pPaths = await mrqUploadPhotos(admin, unit.id, mrIns[0].id, body.photos)
          if (pPaths.length) await admin.from('tenant_mr_submissions').update({ photo_path: JSON.stringify(pPaths) }).eq('id', mrIns[0].id)
        }
      } catch (_e) { /* photos are best-effort */ }
      try { await notifyPortalMr(admin, { address: unit.address, category, description, urgency, contactName, email }) } catch (_e) { /* best-effort */ }
      try {
        await admin.from('housing_audit_log').insert({
          entity_type: 'unit', entity_id: unit.id, action: 'tenant_mr_submitted',
          detail: 'Maintenance request submitted via member portal - ' + unit.address + (category ? ' (' + category + ')' : ''),
          actor: email,
        })
      } catch (_e) { /* audit best-effort */ }
      return json({ ok: true })
    }

    return json({ error: 'Unknown action.' }, 400)
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
