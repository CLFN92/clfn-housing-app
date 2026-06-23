// CLFN Housing AI Chat - Supabase Edge Function
// Deploy: supabase functions deploy ai-chat
// Secret:  supabase secrets set ANTHROPIC_API_KEY=<your-key>
//
// Security: requires a valid Supabase user JWT (the browser must send the
// signed-in user's access token, NOT the public anon key) and the user must be
// active staff in the `staff` table. This stops anonymous abuse of the function
// (it calls the paid Anthropic API) and makes the assistant role-aware from the
// verified role rather than trusting a client-supplied one. The function does
// not query housing tables itself - the client supplies the data context.
//
// Source must stay ASCII-only (dashboard editor parser breaks on non-ASCII).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ANTHROPIC_KEY        = Deno.env.get('ANTHROPIC_API_KEY')
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')
const SUPABASE_ANON_KEY    = Deno.env.get('SUPABASE_ANON_KEY')
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    if (!ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_API_KEY secret not set on this function' }, 500)
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json({ error: 'Supabase env not configured' }, 500)

    // --- Auth: require a valid Supabase user JWT (not the anon key) ---
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Missing or malformed Authorization header' }, 401)
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: authErr } = await userClient.auth.getUser()
    if (authErr || !user) return json({ error: 'Unauthorized', detail: authErr?.message }, 401)

    // --- Resolve the verified, authoritative staff role (active staff only) ---
    let role = ''
    if (SUPABASE_SERVICE_KEY) {
      const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
      const { data: rows } = await admin
        .from('staff')
        .select('role')
        .eq('email', (user.email || '').toLowerCase())
        .eq('is_active', true)
        .limit(1)
      if (rows && rows.length) role = rows[0].role || ''
    }
    if (!role) return json({ error: 'AI assistant is available to active housing staff only.' }, 403)

    const body = await req.json()
    const type    = body.type
    const message = body.message
    const history = body.history
    const context = body.context || {}
    context.role = role  // trust the verified role, never the client-supplied one

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: buildSystem(type, context),
        messages: buildMessages(message, history),
      }),
    })

    if (!response.ok) return json({ error: await response.text() }, 502)

    const data = await response.json()
    return json({ reply: data.content?.[0]?.text || '(no response)' })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})

// How-to knowledge: lets the assistant answer procedural "how do I ..."
// questions. Grounded in the real UI; tailor steps to the user's role.
const HOW_TO = `

## How-to knowledge (app workflows)
Use this to answer "how do I ..." questions. Tailor steps to the staff role; if
their role cannot do an action, say so and name the role that can. Main pages:
Home (worklist + quick actions + KPIs), Inventory (units), Tenants, Match,
Renovations, Contractors, Inspections, Finance. A "Maintenance Request" is the
same record as a "SOW"; a "Work Order" is its crew/contractor printout.

Create a maintenance request / work order: easiest is the Home page
"Renovation Questionnaire" quick action (a guided wizard) - or open Inventory,
click the hammer icon next to a unit, add line items (category + description),
then Save (draft) or Submit. Management and field employees can create/edit.

Assign a work order: in the request use "Assigned To" - in-house crew (a field
employee) or a contractor. Assigning is restricted to Housing Manager / ED.
An in-house assignee is notified and sees it under "Work Orders to Complete".

Complete a maintenance request: open the request, click "Mark Complete" in the
header and confirm. This locks the request, work order, and progress reports.
Field employees, Housing Manager, and ED can complete; only ED can reopen.

Approve a renovation / SOW: items needing sign-off appear in "Renovations
Waiting Approval" on the Home worklist and in Renovations > Reno Approvals.
Housing Manager approves first; higher-cost work then needs ED approval.

Do a housing application (full walkthrough):
  1. Home > "New Application" quick action.
  2. Work through the wizard with Next/Back: Applicant Info -> Employment &
     Income -> Co-Applicant -> Household Members -> Emergency Contacts -> Pets
     -> Documents -> Review & Submit. (HM/ED see two extra staff-only steps -
     Housing Need Assessment and Tenancy History - before Documents.)
  3. Step 6 Documents: upload required files (ID, proof of income, etc.).
  4. Review & Submit; you can tick a box to email the applicant a PDF copy.
  Drafts appear in "My Drafts" on the worklist - use "Continue ->" to finish.
  Management creates/edits applications; field employees do not.

Approve an application: submitted applications show in the worklist
"Applications" section. Open one and choose recommend / approve / decline /
return-with-notes. Flow: management recommends -> Housing Manager approves ->
ED approves, per Settings > Approval Authority. Tip: the approval note box has a
"Draft with AI" button that writes a professional decision note for you.

Match an applicant to a unit: approved applications with no unit show in "Ready
to Match"; use the Match page to assign a vacant unit.

Inspections: open the Inspections page (under the Operations nav) > "New
Inspection". Pick the unit and type (Move-In, Move-Out, Annual, Routine,
Emergency), complete the room-by-room checklist (pass / fail / needs repair),
add notes/photos, and save. A failed/needs-repair inspection can spawn a SOW
(maintenance request) for the unit. Unit records show last and next inspection
dates.

View or edit a tenant: Tenants > open a tenant card (TIC). Tabs: Overview,
Utilities (hydro/gas meters + accounts), Documents, Unit History. Lease start
and end dates are recorded on the tenant. Field employees see the TIC read-only.

Edit a housing unit: Inventory > click a unit to open its detail panel, then
edit fields (address, status, type, funder, account numbers, insured value,
inspection dates, etc.).

Add a contractor: Contractors page > add a contractor. New contractors go
pending_review -> Housing Manager verifies -> ED approves.

Issue an RFQ: from a SOW (Renovations or the unit panel) create an RFQ to invite
contractors to bid. Flow: draft -> issued -> awarded; only drafts can be edited.

Set a unit's location & photo: open the unit's Tenant Information Card and use
"Set Location & Photo" to drop a map pin and add a photo (ED/admin).

Finance (ED, CFO, and Finance roles only): open the Finance page. Sections:
Tenants, Rent Ledger, Loans, Invoices/Charges, Payment Arrangements,
Collections, Journal Entries, Transactions, Reports. Common tasks:
  - Record a rent payment: Rent Ledger > "+ Record Payment" (cash supports a
    denomination breakdown).
  - Set an opening balance: Rent Ledger > "Set Opening Balance".
  - Post a charge/invoice: Invoices > "+ Invoice"; "Batch Print" for many; Void
    from the invoice's Void action.
  - Create a loan: Loans > "+ New Loan"; record repayments with "Record Loan
    Payment"; print the Loan Agreement.
  - Set up a payment arrangement: Payment Arrangements > "New Arrangement";
    record installments with "Record Payment".
  - Flag for collections: Collections > "Flag Account".
  - Post a journal entry: Journal Entries > "+ New Entry" (debits/credits must
    balance).
  - Fix a mistake: do NOT delete - use Reverse Payment / Reverse Entry / Adjust
    Entry (or Void on an invoice). Finance ledgers are append-only and audited.
  - Statements/reports: Finance Reports > "Run Statements"; export buttons on
    each list.

Admin settings (ED / super user): Settings has App Settings (incl. the scoring
model), Approval Authority, Nation (branding, idle timeout, and Module toggles -
including this AI Assistant and Inspections), Notifications (email templates per
event), and Users (add/deactivate staff).
`

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

Write 2-4 sentences. Be professional, clear, and compassionate. Reference specific details where relevant. Output ONLY the note text - no subject line, no greeting, no signature.`
  }

  // Chat mode
  const role = ctx?.role ?? 'staff'

  const appsJson = ctx?.apps?.length
    ? `\n\n## Housing Applications (${ctx.apps.length} total)\nEach record is one application. Fields: id, fn/ln (name), status, score, tier (priority tier), bedrooms (requested), household_size, app_type, assignedUnit/assignedAddress (if placed), submittedAt.\n` + JSON.stringify(ctx.apps.slice(0, 50))
    : '\n\n## Housing Applications\nNo application data available.'

  const unitsJson = ctx?.units?.length
    ? `\n\n## Housing Units (${ctx.units.length} total)\nComplete list of CLFN housing units - use this for unit counts and availability questions. Fields: id, address, bedrooms, bathrooms, type, status (vacant/occupied/reserved/condemned), accessible, isElders, funder, assignedTo/assignedName.\n` + JSON.stringify(ctx.units.slice(0, 60))
    : '\n\n## Housing Units\nNo unit data available.'

  const sowsJson = ctx?.sows?.length
    ? `\n\n## Scopes of Work / SOWs - ${ctx.sows.length} records\nIn this system, SOWs (Scopes of Work) ARE the maintenance and renovation work orders. When staff say "maintenance request", "work order", or "repair job", they mean a SOW. Each SOW is linked to a housing unit.\n` + JSON.stringify(ctx.sows)
    : '\n\n## Scopes of Work / SOWs\nNo SOW/maintenance data loaded yet.'

  const rfqsJson = ctx?.rfqs?.length
    ? `\n\n## RFQs / Requests for Quotes - ${ctx.rfqs.length} records\nRFQs are procurement requests sent to contractors for pricing on upcoming work.\n` + JSON.stringify(ctx.rfqs.slice(0, 30))
    : ''

  const contractorsJson = ctx?.contractors?.length
    ? `\n\n## Contractors - ${ctx.contractors.length} on file\n` + JSON.stringify(ctx.contractors.slice(0, 30))
    : ''

  const renoJson = ctx?.renoProgress?.length
    ? `\n\n## Renovation Progress - ${ctx.renoProgress.length} units with active renos\noverallPct is % complete (0-100).\n` + JSON.stringify(ctx.renoProgress)
    : ''

  // Compute quick summary stats for the prompt
  const vacantCount = (ctx?.units || []).filter((u: any) => u.status === 'vacant').length
  const pendingApps = (ctx?.apps  || []).filter((a: any) => !['assigned','declined','archived'].includes(a.status)).length

  return `You are an AI assistant for the Constance Lake First Nation (CLFN) Housing Department. You help housing staff answer questions about applications, housing units, maintenance work orders (SOWs), renovations, contractors, inspections, and housing policy, and explain how to do things in the app.

Staff role: ${role}
Quick stats: ${ctx?.units?.length ?? 0} total units (${vacantCount} vacant), ${ctx?.apps?.length ?? 0} applications (${pendingApps} pending), ${ctx?.sows?.length ?? 0} SOWs on file.

IMPORTANT terminology for this system:
- "Maintenance request" / "work order" / "repair job" = SOW (Scope of Work) - there is no separate maintenance table
- "RFQ" = Request for Quotes (sent to contractors for pricing)
- "Tier" on an application = priority tier (e.g. Emergency, High, Medium, Low)
${appsJson}${unitsJson}${sowsJson}${rfqsJson}${contractorsJson}${renoJson}
${HOW_TO}
Rules:
- For unit counts, ALWAYS use the Housing Units section - never use the SOW count.
- For maintenance/repair questions, use the SOWs section.
- For "how do I ..." questions, use the How-to knowledge above and tailor to the staff role.
- Perform calculations (totals, counts, averages) directly from the data above.
- Answer concisely and confidently. Do not tell staff to check another system if the data is present here.
- If data for a specific record is not shown (e.g. only first 50 apps are included), say so clearly.
- This is sensitive community data governed by OCAP principles - keep answers grounded in the records and do not speculate about individuals.`
}

function buildMessages(message: string, history: any[]): any[] {
  const prior = (history ?? []).map((h: any) => ({ role: h.role, content: h.content }))
  return [...prior, { role: 'user', content: message }]
}
