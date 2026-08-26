// ============================================================================
// send-magic-link - generate a Supabase magic link and email it through the
// app's OWN branded notification pipeline (from the nation mailbox), including
// the recipient's access-expiry date. Admin-issued (ED/HM); replaces the default
// Supabase auth email so the message is branded, from the nation, and shows when
// the person's access ends.
//
// POST { email, redirect_to, brand:{ nation_name, brand_color, contact_line },
//        mode: 'email' (default) | 'link',
//        type: 'magiclink' (default) | 'recovery' }
// type 'recovery': generate a PASSWORD RESET link instead (same branded
//   pipeline) - replaces the /auth/v1/recover flow, which depends on the
//   Supabase auth mailer this project does not use. Recovery does NOT require
//   the target to be magic-link enabled (password accounts are the audience).
// mode 'email': generate the link and email it through the branded pipeline.
// mode 'link' : generate the link and RETURN it to the (verified admin) caller
//               so they can copy/paste it into their own email or message.
// Auth: caller must be an active management staff member (JWT).
// Source must stay ASCII-only.
// ============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')
const SUPABASE_ANON_KEY    = Deno.env.get('SUPABASE_ANON_KEY')
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
function normRole(r: string): string {
  const v = (r || '').toLowerCase().trim()
  if (v === 'hm' || v === 'manager') return 'housing_manager'
  if (v === 'executive_director' || v === 'executivedirector') return 'ed'
  return v
}
function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
function fmtDate(d: unknown): string {
  const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return ''
  return MONTHS[(+m[2]) - 1] + ' ' + (+m[3]) + ', ' + m[1]
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) {
      return json({ error: 'Server not configured' }, 500)
    }
    // --- Auth: caller must be an active management staff member ---
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Missing Authorization' }, 401)
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const callerEmail = (user.email || '').toLowerCase()
    const { data: callerRows } = await admin.from('staff').select('role').eq('email', callerEmail).eq('is_active', true).limit(1)
    const callerRole = (callerRows && callerRows.length) ? normRole(callerRows[0].role || '') : ''
    if (['ed', 'super_user', 'housing_manager'].indexOf(callerRole) === -1) {
      return json({ error: 'Not permitted' }, 403)
    }

    const body = await req.json()
    const email = String(body.email || '').toLowerCase().trim()
    const redirectTo = String(body.redirect_to || '')
    const brand = (body.brand || {}) as Record<string, string>
    const linkType = String(body.type || '') === 'recovery' ? 'recovery' : 'magiclink'
    if (!email) return json({ error: 'email is required' }, 400)

    // --- Target staff must be active + magic-link enabled ---
    const { data: rows } = await admin.from('staff')
      .select('name, magic_link, is_active, access_expires_at')
      .eq('email', email).limit(1)
    if (!rows || !rows.length) return json({ error: 'No staff record for that email.' }, 404)
    const t = rows[0] as Record<string, unknown>
    if (!t.is_active) return json({ error: 'That account is inactive.' }, 400)
    if (linkType === 'magiclink' && t.magic_link !== true) return json({ error: 'That account is not enabled for magic-link sign-in.' }, 400)

    // --- Generate the magic link (does NOT send a Supabase email) ---
    const gen = await admin.auth.admin.generateLink({
      type: linkType,
      email,
      options: redirectTo ? { redirectTo } : {},
    })
    const actionLink = (gen && gen.data && (gen.data as any).properties && (gen.data as any).properties.action_link) || ''
    if (gen.error || !actionLink) {
      return json({ error: linkType === 'recovery' ? 'Could not generate a reset link.' : 'Could not generate a sign-in link.',
                    detail: gen.error ? gen.error.message : 'no action_link' }, 502)
    }

    // Server-side audit for EVERY issued link (email and copy mode alike) -
    // written with the service role so a caller hitting the function directly
    // cannot skip it.
    try {
      await admin.from('housing_audit_log').insert({
        entity_type: 'auth', entity_id: email,
        action: linkType === 'recovery' ? 'password_reset_issued' : 'magic_link_issued',
        detail: (linkType === 'recovery' ? 'Password reset link' : 'Magic sign-in link')
          + ' issued for ' + email + ' (' + (String(body.mode || '') === 'link' ? 'copy mode' : 'emailed') + ')',
        actor: callerEmail,
      })
    } catch (_e) { /* audit is best-effort, never blocks the send */ }

    // --- Copy mode: hand the link back to the verified admin instead of
    //     emailing it. Same authorization + same target-account gates as the
    //     email path; the caller pastes it into their own email/message. ---
    if (String(body.mode || '') === 'link') {
      return json({ ok: true, link: actionLink, expiry: fmtDate(t.access_expires_at) })
    }

    // --- Compose the branded inner body (send-notification wraps it in the
    //     nation-branded shell: header bar + footer contact line) ---
    const nationName = esc(brand.nation_name || 'Housing')
    const isRecovery = linkType === 'recovery'
    const btnColor = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(String(brand.brand_color || '').trim()) ? String(brand.brand_color).trim() : '#eab308'
    const expiryStr = fmtDate(t.access_expires_at)
    const inner =
      '<p style="font-size:14px;line-height:1.65;color:#374151;margin:0 0 20px;">' +
      (isRecovery
        ? 'Click below to choose a new password for the ' + nationName + ' Housing system. This link is single-use and expires shortly.'
        : 'Click below to sign in to the ' + nationName + ' Housing system. This link is single-use and expires shortly - open it on the device you want to sign in on.') +
      '</p>' +
      '<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:' + btnColor + ';">' +
      '<a href="' + esc(actionLink) + '" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:700;color:#111827;text-decoration:none;border-radius:8px;">' + (isRecovery ? 'Reset password' : 'Sign in') + '</a>' +
      '</td></tr></table>' +
      (expiryStr
        ? '<p style="font-size:13px;line-height:1.6;color:#374151;margin:22px 0 0;"><strong>Your access is valid until ' + esc(expiryStr) +
          '.</strong> After that date you will need the housing office to renew your access.</p>'
        : '') +
      '<p style="font-size:12px;line-height:1.6;color:#6b7280;margin:18px 0 0;">If you did not expect this email, you can ignore it - no one can sign in without the link above.</p>'

    // --- Send through the app's branded pipeline (forwards the caller JWT). We
    //     force provider=graph so it comes from the nation mailbox, not Supabase. ---
    const payload = {
      to: email,
      to_name: (t.name as string) || '',
      subject: (isRecovery ? 'Reset your password - ' : 'Sign in to ') + (brand.nation_name || 'your') + ' Housing',
      bodyHtml: inner,
      nation_name: brand.nation_name || '',
      brand_color: brand.brand_color || '',
      contact_line: brand.contact_line || '',
      email_provider: 'graph',
      event: isRecovery ? 'password_reset_email' : 'magic_link_signin',
      entity_type: 'auth',
      entity_id: email,
    }
    const sendRes = await fetch(SUPABASE_URL + '/functions/v1/send-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
      body: JSON.stringify(payload),
    })
    const sendData = await sendRes.json().catch(() => ({}))
    if (!sendRes.ok) {
      return json({ error: 'Link generated but the email failed to send.', detail: (sendData as any).error || '' }, 502)
    }
    return json({ ok: true })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
