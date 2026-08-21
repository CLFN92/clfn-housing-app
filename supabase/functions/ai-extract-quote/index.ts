// ============================================================================
// ai-extract-quote - Scope-of-Work line items, two modes
// ----------------------------------------------------------------------------
// Extract mode: POST { file: { name, contentType, dataBase64 }, categories: [] }
// Draft mode:   POST { prompt: string, categories: [] }
// -> { items: [ { description, category, cost } ], summary }
//
// Extract mode: the client uploads a contractor quote / estimate (PDF or
// image) from the Maintenance Request (SOW) modal's Scope of Work tab and the
// document's work lines come back structured.
// Draft mode: staff describe the job in plain words ("bathroom renovation",
// "replace exterior windows in bedroom, basement, living room") and Claude
// drafts a professional scope-of-work item list for it (no prices invented).
// Either way the client pre-populates the Work Items list and the user
// reviews each line before inserting.
//
// Security mirrors ai-chat: requires a valid Supabase user JWT and active staff
// in the `staff` table; the ANTHROPIC_API_KEY lives only in function secrets.
// Every call writes one append-only ai_extract row to housing_audit_log.
//
// Source must stay ASCII-only (dashboard editor parser breaks on non-ASCII).
// ============================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_KEY        = Deno.env.get('ANTHROPIC_API_KEY')
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')
const SUPABASE_ANON_KEY    = Deno.env.get('SUPABASE_ANON_KEY')
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const MODEL       = 'claude-sonnet-4-6'
const MAX_ITEMS   = 60
const MAX_BYTES   = 12 * 1024 * 1024   // ~12 MB decoded cap (Anthropic req limit)

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
  if (v === 'employee' || v === 'staff') return 'housing_employee_l1'
  if (v === 'executive_director' || v === 'executivedirector') return 'ed'
  return v
}

// Rough decoded size of a base64 string without allocating the bytes.
function b64Bytes(b64: string): number {
  const len = b64.length
  let pad = 0
  if (len >= 1 && b64[len - 1] === '=') pad++
  if (len >= 2 && b64[len - 2] === '=') pad++
  return Math.floor((len * 3) / 4) - pad
}

const EXTRACT_TOOL = {
  name: 'extract_line_items',
  description: 'Return the work line items found in the quote as structured data.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'One entry per distinct work line item / task in the quote.',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string', description: 'Short description of the work for this line.' },
            category:    { type: 'string', description: 'The single best-fit category from the provided list, or "Other".' },
            cost:        { type: ['number', 'null'], description: 'Line total in dollars (materials + labour), or null if not stated.' },
          },
          required: ['description'],
        },
      },
      summary: { type: 'string', description: 'One short sentence describing the quote (vendor / total / scope).' },
    },
    required: ['items'],
  },
}

async function writeAudit(email: string, name: string, role: string, source: string, count: number, isDraft: boolean): Promise<void> {
  if (!SUPABASE_SERVICE_KEY || !SUPABASE_URL) return
  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const detail = {
      detail: (isDraft ? 'AI scope draft: "' : 'AI quote extract: ') + (source || 'file') + (isDraft ? '"' : '') + ' -> ' + count + ' line item(s)',
      name: name || email, role, source, items: count,
    }
    await admin.from('housing_audit_log').insert({
      entity_type: 'ai', entity_id: 'AI', action: isDraft ? 'ai_scope_draft' : 'ai_extract',
      detail: JSON.stringify(detail), actor: email, created_at: new Date().toISOString(),
    })
  } catch (e) {
    console.warn('[ai-extract-quote] audit insert failed:', (e as Error).message)
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    if (!ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_API_KEY secret not set on this function' }, 500)
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json({ error: 'Supabase env not configured' }, 500)

    // Auth: valid Supabase user JWT + active staff (same as ai-chat)
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Missing Authorization header' }, 401)
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) return json({ error: 'Unauthorized', detail: authErr?.message }, 401)

    const email = (user.email || '').toLowerCase()
    let role = '', actorName = ''
    if (SUPABASE_SERVICE_KEY) {
      const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
      const { data: rows } = await admin.from('staff').select('role, name').eq('email', email).eq('is_active', true).limit(1)
      if (rows && rows.length) { role = normRole(rows[0].role || ''); actorName = rows[0].name || '' }
    }
    if (!role) return json({ error: 'This feature is available to active housing staff only.' }, 403)

    const body = await req.json()
    const file = body.file || {}
    const contentType = String(file.contentType || '').toLowerCase()
    const dataB64 = String(file.dataBase64 || '')
    const fileName = String(file.name || 'quote')
    const draftPrompt = String(body.prompt || '').trim().slice(0, 600)
    const isDraftMode = !dataB64 && !!draftPrompt
    const categories: string[] = Array.isArray(body.categories) ? body.categories.map((c: unknown) => String(c)) : []
    const catList = categories.length ? categories.join(', ') : 'Other'

    let userContent: Array<Record<string, unknown>>
    if (isDraftMode) {
      // Draft mode: no document - generate a scope of work from the job
      // description. No prices: staff or the tendering process set those.
      const prompt =
        'You are helping First Nation housing staff prepare a Maintenance Request (scope of work) ' +
        'for a housing unit. The staff member describes the job as: "' + draftPrompt + '". ' +
        'Draft a practical, complete scope of work for that job as separate line items, the way a ' +
        'housing manager or general contractor would break it down (include preparation, removal/' +
        'disposal, rough-in, installation, finishing, and cleanup steps where they apply, and any ' +
        'code-required items such as GFCI outlets, venting, or flashing). For each item: a short ' +
        'plain description of the work; and the single best-fit category chosen EXACTLY from this ' +
        'list (or "Other" if none fits): [' + catList + ']. Set cost to null on every item - do NOT ' +
        'invent prices. If the description names several rooms or locations, cover each one. ' +
        'Keep it to the described job only. Return at most ' + MAX_ITEMS + ' items via the ' +
        'extract_line_items tool, plus a one-sentence summary of the scope.'
      userContent = [{ type: 'text', text: prompt }]
    } else {
      if (!dataB64) return json({ error: 'Provide a file to read, or a prompt describing the job.' }, 400)
      if (b64Bytes(dataB64) > MAX_BYTES) return json({ error: 'File is too large (max ~12 MB).' }, 400)

      const isPdf = contentType.indexOf('pdf') >= 0
      const isImg = contentType.indexOf('image/') === 0
      if (!isPdf && !isImg) return json({ error: 'Unsupported file type. Upload a PDF or an image (JPG/PNG).' }, 400)

      const sourceBlock = isPdf
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: dataB64 } }
        : { type: 'image',    source: { type: 'base64', media_type: contentType || 'image/jpeg', data: dataB64 } }

      const prompt =
        'This document is a contractor quote or repair estimate for a housing unit. ' +
        'Extract every distinct work line item / task as a separate entry. For each: a short ' +
        'plain description of the work; the single best-fit category chosen EXACTLY from this list ' +
        '(or "Other" if none fits): [' + catList + ']; and the line total in dollars (materials + ' +
        'labour combined) as a number, or null if the line has no stated price. Do NOT invent items or ' +
        'prices that are not in the document. Ignore tax, subtotal, and grand-total summary rows - only ' +
        'return actual work lines. Return at most ' + MAX_ITEMS + ' items via the extract_line_items tool.'
      userContent = [sourceBlock as Record<string, unknown>, { type: 'text', text: prompt }]
    }

    const payload = {
      model: MODEL,
      max_tokens: 3000,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: 'tool', name: 'extract_line_items' },
      messages: [{ role: 'user', content: userContent }],
    }

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    })
    const data = await r.json()
    if (!r.ok) return json({ error: 'AI request failed', detail: JSON.stringify(data).slice(0, 600) }, 502)

    const content = (data.content as Array<Record<string, unknown>>) || []
    const toolUse = content.find((b) => b.type === 'tool_use')
    const out = (toolUse && (toolUse.input as Record<string, unknown>)) || {}
    const rawItems = Array.isArray(out.items) ? out.items : []
    const catSet = new Set(categories)

    const items = rawItems.slice(0, MAX_ITEMS).map((it: Record<string, unknown>) => {
      const desc = String(it.description || '').trim()
      let cat = String(it.category || '').trim()
      if (cat && !catSet.has(cat)) cat = 'Other'
      let cost: number | null = null
      const c = it.cost
      if (typeof c === 'number' && isFinite(c)) cost = c
      else if (typeof c === 'string' && c.trim()) {
        const n = parseFloat(c.replace(/[^0-9.]/g, ''))
        if (isFinite(n)) cost = n
      }
      return { description: desc, category: cat || '', cost: cost }
    }).filter((it) => it.description)

    await writeAudit(email, actorName, role, isDraftMode ? draftPrompt : fileName, items.length, isDraftMode)

    return json({ items, summary: String(out.summary || '') })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
