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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'Method not allowed' }, 405)
  try {
    if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) return json({ error: 'Server not configured.' }, 500)

    // --- Auth: require a valid, email-CONFIRMED Supabase user (the applicant) ---
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Sign in to continue.' }, 401)
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) return json({ error: 'Your session has expired. Please sign in again.' }, 401)
    if (!user.email_confirmed_at) return json({ error: 'Please confirm your email first.' }, 403)

    const uid   = user.id
    const email = user.email || ''
    const admin = createClient(SUPABASE_URL, SERVICE_KEY)

    const body   = await req.json().catch(() => ({}))
    const action = String(body.action || '')

    // Ensure a profile row exists (email only; never touches linked_app_ids).
    await admin.from('applicant_profiles').upsert({ uid, email, updated_at: new Date().toISOString() }, { onConflict: 'uid' })

    // --- ping: bootstrap the dashboard ---
    if (action === 'ping') {
      const { data: prof } = await admin.from('applicant_profiles').select('*').eq('uid', uid).limit(1)
      const { data: subs } = await admin.from('application_submissions')
        .select('id, submission_type, status, linked_app_id, created_app_id, submitted_at, updated_at')
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
