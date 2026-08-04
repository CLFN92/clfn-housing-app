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

// Only allow magic-link redirects back to our own hosts (defense in depth;
// Supabase also validates against its Redirect URL allow-list).
function isSafeRedirect(u: string): boolean {
  try {
    const url = new URL(u)
    const h = url.hostname
    const localOk = (h === 'localhost' || h === '127.0.0.1')
    if (url.protocol !== 'https:' && !localOk) return false
    return h === 'fnhub.app' || h.endsWith('.fnhub.app')
        || h.endsWith('.pages.dev') || h.endsWith('.workers.dev') || localOk
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

    // --- request_link: PRE-LOGIN. Generate a magic link and email it through
    // the nation's OWN pipeline (not Supabase's default sender). No user JWT;
    // the client calls this with the anon key like any public endpoint. ---
    if (action === 'request_link') {
      const linkEmail = String(body.email || '').trim().toLowerCase()
      if (!isValidEmail(linkEmail)) return json({ error: 'Please enter a valid email address.' }, 400)
      // If this nation has no email provider configured, tell the client so it
      // can fall back to Supabase's built-in sender rather than fail.
      if (!emailConfigured()) return json({ error: 'email_not_configured' }, 503)
      const rawRedirect = String(body.redirect_to || '').trim()
      const redirectTo  = isSafeRedirect(rawRedirect) ? rawRedirect : undefined
      const ip = (req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || '').split(',')[0].trim()
      const admin0 = createClient(SUPABASE_URL, SERVICE_KEY)
      // Rate-limit; respond with generic success either way so we never reveal
      // whether an address exists or signal that a bomb attempt was throttled.
      if (await magicLinkRateLimited(admin0, linkEmail, ip)) return json({ ok: true })
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
            const scalarKeys = ['fn','ln','dob','band','marital','reserve','phone','email','street','city','province','postal','occDate','homeless','haveHouse','homeCondition','hasCoApp']
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
      return json({ ok: true, uid, email, profile: (prof && prof[0]) || null, submissions: subs || [] })
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
      const now = new Date().toISOString()
      const { data: upd } = await admin.from('application_submissions')
        .update({ status: 'submitted', submitted_at: now, updated_at: now })
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

    return json({ error: 'Unknown action.' }, 400)
  } catch (e) {
    return json({ error: (e as Error).message }, 500)
  }
})
