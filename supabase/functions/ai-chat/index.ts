// CLFN Housing AI Chat — Supabase Edge Function
// Deploy: supabase functions deploy ai-chat
// Secret:  supabase secrets set ANTHROPIC_API_KEY=<your-key>

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const key = Deno.env.get('ANTHROPIC_API_KEY')
    if (!key) throw new Error('ANTHROPIC_API_KEY secret not set on this function')

    const { type, message, context, history } = await req.json()

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: buildSystem(type, context),
        messages: buildMessages(message, history),
      }),
    })

    if (!response.ok) throw new Error(await response.text())

    const data = await response.json()
    return new Response(
      JSON.stringify({ reply: data.content[0].text }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }
})

function buildSystem(type: string, ctx: any): string {
  if (type === 'draft') {
    const app = ctx?.app ?? {}
    const name = [app.fn, app.ln].filter(Boolean).join(' ') || 'the applicant'
    const action = ctx?.action ?? ''
    const actionLabel: Record<string, string> = {
      submitted: 'submission acknowledgement',
      mgr_approved: 'manager approval',
      hm_approved: 'housing manager approval',
      ed_approved: 'executive director approval',
      declined: 'application decline',
      returned: 'return to applicant for more information',
      file_update: 'request for updated documents',
      assigned: 'unit assignment',
    }
    const label = actionLabel[action] ?? action

    return `You are a professional housing administrator at Constance Lake First Nation (CLFN). Write a brief, professional note for a housing application decision.

Application details:
- Applicant: ${name} (${app.id ?? ''})
- Decision: ${label}
- Priority score: ${app.total_score ?? app.score ?? 'N/A'}
- Bedrooms requested: ${app.bed_req ?? app.bedrooms ?? 'N/A'}
- Household size: ${app.household_size ?? app.adults ?? 'N/A'}
- Unit assigned: ${ctx?.unit || 'N/A'}

Write 2–4 sentences. Be professional, clear, and compassionate. Reference specific details where relevant. Output ONLY the note text — no subject line, no greeting, no signature.`
  }

  // Chat mode
  const role = ctx?.role ?? 'staff'

  const appsJson = ctx?.apps?.length
    ? `\n\n## Housing Applications (${ctx.apps.length} total)\nEach record is one application. Fields: id, fn/ln (name), status, score, tier (priority tier), bedrooms (requested), household_size, app_type, assignedUnit/assignedAddress (if placed), submittedAt.\n` + JSON.stringify(ctx.apps.slice(0, 50))
    : '\n\n## Housing Applications\nNo application data available.'

  const unitsJson = ctx?.units?.length
    ? `\n\n## Housing Units (${ctx.units.length} total)\nComplete list of CLFN housing units — use this for unit counts and availability questions. Fields: id, address, bedrooms, bathrooms, type, status (vacant/occupied/reserved/condemned), accessible, isElders, funder, assignedTo/assignedName.\n` + JSON.stringify(ctx.units.slice(0, 60))
    : '\n\n## Housing Units\nNo unit data available.'

  const sowsJson = ctx?.sows?.length
    ? `\n\n## Scopes of Work / SOWs — ${ctx.sows.length} records\nIn this system, SOWs (Scopes of Work) ARE the maintenance and renovation work orders. When staff say "maintenance request", "work order", or "repair job", they mean a SOW. Each SOW is linked to a housing unit.\n` + JSON.stringify(ctx.sows)
    : '\n\n## Scopes of Work / SOWs\nNo SOW/maintenance data loaded yet.'

  const rfqsJson = ctx?.rfqs?.length
    ? `\n\n## RFQs / Requests for Quotes — ${ctx.rfqs.length} records\nRFQs are procurement requests sent to contractors for pricing on upcoming work.\n` + JSON.stringify(ctx.rfqs.slice(0, 30))
    : ''

  const contractorsJson = ctx?.contractors?.length
    ? `\n\n## Contractors — ${ctx.contractors.length} on file\n` + JSON.stringify(ctx.contractors.slice(0, 30))
    : ''

  const renoJson = ctx?.renoProgress?.length
    ? `\n\n## Renovation Progress — ${ctx.renoProgress.length} units with active renos\noverallPct is % complete (0–100).\n` + JSON.stringify(ctx.renoProgress)
    : ''

  // Compute quick summary stats for the prompt
  const vacantCount = (ctx?.units || []).filter((u: any) => u.status === 'vacant').length
  const pendingApps = (ctx?.apps  || []).filter((a: any) => !['assigned','declined','archived'].includes(a.status)).length

  return `You are an AI assistant for the Constance Lake First Nation (CLFN) Housing Department. You help housing staff answer questions about applications, housing units, maintenance work orders (SOWs), renovations, contractors, and housing policy.

Staff role: ${role}
Quick stats: ${ctx?.units?.length ?? 0} total units (${vacantCount} vacant), ${ctx?.apps?.length ?? 0} applications (${pendingApps} pending), ${ctx?.sows?.length ?? 0} SOWs on file.

IMPORTANT terminology for this system:
- "Maintenance request" / "work order" / "repair job" = SOW (Scope of Work) — there is no separate maintenance table
- "RFQ" = Request for Quotes (sent to contractors for pricing)
- "Tier" on an application = priority tier (e.g. Emergency, High, Medium, Low)
${appsJson}${unitsJson}${sowsJson}${rfqsJson}${contractorsJson}${renoJson}

Rules:
- For unit counts, ALWAYS use the Housing Units section — never use the SOW count.
- For maintenance/repair questions, use the SOWs section.
- Perform calculations (totals, counts, averages) directly from the data above.
- Answer concisely and confidently. Do not tell staff to check another system if the data is present here.
- If data for a specific record is not shown (e.g. only first 50 apps are included), say so clearly.`
}

function buildMessages(message: string, history: any[]): any[] {
  const prior = (history ?? []).map((h: any) => ({ role: h.role, content: h.content }))
  return [...prior, { role: 'user', content: message }]
}
