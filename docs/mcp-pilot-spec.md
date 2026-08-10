# Read-only MCP pilot — implementation spec

A minimal, safe first step toward an MCP server for the housing app: **4 read-only
tools, no writes**, reusing the exact security model the in-app `ai-chat` Edge
Function already runs on (JWT auth, per-table role allowlist, row caps,
append-only audit). Ship this, prove the value, then add gated writes later.

---

## 1. Architecture — where it runs and why

```
Claude Desktop ──stdio──▶ mcp-bridge (tiny local proxy) ──HTTPS+JWT──▶ Supabase Edge Function "mcp" ──service key──▶ PostgREST tables
```

Two components:

1. **`mcp` Edge Function** (new, `supabase/functions/mcp/index.ts`). Speaks MCP
   over HTTP (JSON-RPC). It holds the `SUPABASE_SERVICE_ROLE_KEY` **server-side**
   (exactly like `ai-chat` does today), requires the caller's Supabase **user
   JWT**, resolves their role from the `staff` table, and enforces the same
   per-table allowlist before every read. This is where all the logic and secrets
   live.

2. **`mcp-bridge`** (tiny local Node script). Claude Desktop launches MCP servers
   as local processes over stdio; this bridge is the local process. It does one
   job: sign the staff member in to Supabase to get their JWT, then **proxy** each
   `tools/list` / `tools/call` to the Edge Function. No housing logic, no service
   key on the laptop — only the staff member's own scoped token.

**Why this split (not a single local server):** the powerful service-role key
never leaves Supabase — the laptop only ever holds a normal staff login. It's
multi-user from day one (each staff member runs the bridge with their own
credentials and gets their own role's access), and it reuses `ai-chat`'s trust
model byte-for-byte. The alternative — one self-contained local server holding
the service key — is fewer files but puts your most powerful secret on a laptop;
avoid it.

> **OCAP note:** data stays in the nation's Supabase project; the tools return
> only the specific rows a question needs (row-capped), and every call is logged.
> The one deliberate exposure is that Claude (the cloud model) sees the rows it's
> asked about while answering. Start read-only, keep the catalog small, and treat
> expanding it as a Chief & Council decision.

---

## 2. The four tools

| Tool | Roles | What it returns |
|------|-------|-----------------|
| `list_units` | all staff | Units filtered by state (vacant / occupied / reserved / all): number, street, status, bedrooms, tenant. |
| `get_vacancy_stats` | all staff | Exact occupancy counts across **all** units (paginated server-side, not row-capped): total, vacant, occupied, reserved, other. |
| `search_applications` | management only | Applications filtered by status / type / tier, with applicant name — the waitlist search, as a tool. |
| `get_waitlist` | management only | Approved, unhoused, scored applicants (`new_housing` + `transfer_request`) ranked by score — who's next for a unit. |

Role groups and the allowlist are copied verbatim from `ai-chat`
(`housing_units` = all staff; `housing_applications` = MGMT). Nothing here can
write, and no free-form SQL is exposed — only these four shaped queries.

---

## 3. Edge Function — `supabase/functions/mcp/index.ts`

Deploy with `supabase functions deploy mcp`. Reuses the `ai-chat` secrets
(`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) — **no new
secret**. Source is ASCII-only (same dashboard-editor constraint as the other
functions).

```ts
// mcp - read-only Model Context Protocol server (JSON-RPC over HTTP).
// Deploy: supabase functions deploy mcp
//
// Security mirrors ai-chat: the caller MUST send a valid Supabase user JWT (not
// the anon key); the role is resolved from the `staff` table (active only); each
// tool is gated by a per-table role allowlist; rows are hard-capped; every call
// writes an append-only audit row. There are NO write tools.
//
// Source must stay ASCII-only.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')
const SUPABASE_ANON_KEY    = Deno.env.get('SUPABASE_ANON_KEY')
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const MAX_ROW_LIMIT = 50      // hard cap on rows returned by a list tool
const SCAN_PAGE     = 1000    // page size for full-table stat scans
const SCAN_MAX      = 8000    // safety cap on rows scanned for stats

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ----- role groups (mirror ai-chat; super_user inherits ed) -----------------
const MGMT = ['ed', 'super_user', 'housing_manager', 'housing_employee_l2', 'housing_employee_l1']
const ALL  = MGMT.concat(['field_employee', 'cfo', 'finance_l1'])

function normRole(r: string): string {
  const v = (r || '').toLowerCase().trim()
  if (v === 'hm' || v === 'manager') return 'housing_manager'
  if (v === 'employee' || v === 'staff') return 'housing_employee_l1'
  if (v === 'executive_director' || v === 'executivedirector') return 'ed'
  return v
}

// Per-tool role allowlist (the table each tool reads, gated like ai-chat).
const TOOL_ROLES: Record<string, string[]> = {
  list_units:          ALL,
  get_vacancy_stats:   ALL,
  search_applications: MGMT,
  get_waitlist:        MGMT,
}

// ----- low-level read against PostgREST with the service-role key -----------
// The caller's role is already checked at the tool layer; the service key is
// used only to read (bypassing RLS) exactly as ai-chat's query tool does.
async function pgSelect(table: string, params: string[]): Promise<{ rows?: any[]; error?: string }> {
  if (!SUPABASE_SERVICE_KEY || !SUPABASE_URL) return { error: 'Server not configured.' }
  const url = SUPABASE_URL + '/rest/v1/' + table + '?' + params.join('&')
  try {
    const r = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
        Accept: 'application/json',
      },
    })
    const text = await r.text()
    if (!r.ok) return { error: 'Query failed (' + r.status + '): ' + text.slice(0, 300) }
    try { return { rows: JSON.parse(text) } } catch { return { error: 'Could not parse result.' } }
  } catch (e) {
    return { error: 'Query error: ' + (e as Error).message }
  }
}

// PostgREST "include rows where archived is false OR null".
const NOT_ARCHIVED = 'or=(archived.is.null,archived.is.false)'

// ----- tool handlers --------------------------------------------------------
async function toolListUnits(args: Record<string, unknown>): Promise<any> {
  const state = String(args.state || 'all').toLowerCase()
  const params = ['select=' + encodeURIComponent('id,num,street,status,assigned_name,data'), NOT_ARCHIVED]
  if (state === 'vacant' || state === 'occupied' || state === 'reserved') {
    params.push('status=eq.' + state)
  }
  params.push('order=num.asc', 'limit=' + MAX_ROW_LIMIT)
  const { rows, error } = await pgSelect('housing_units', params)
  if (error) return { error }
  const units = (rows || []).map((u: any) => ({
    unit: u.num, street: u.street, status: u.status,
    tenant: u.assigned_name || null,
    bedrooms: u.data?.bedrooms ?? null,
    type: u.data?.type ?? null,
  }))
  return { count: units.length, capped: units.length >= MAX_ROW_LIMIT, units }
}

async function toolVacancyStats(): Promise<any> {
  // Scan every non-archived unit server-side (well past the 50-row model cap)
  // so the occupancy numbers are exact, the way audit_activity does in ai-chat.
  const buckets: Record<string, number> = {}
  let total = 0, offset = 0, truncated = false
  while (offset < SCAN_MAX) {
    const params = ['select=status', NOT_ARCHIVED, 'order=id.asc', 'limit=' + SCAN_PAGE, 'offset=' + offset]
    const { rows, error } = await pgSelect('housing_units', params)
    if (error) return { error }
    const batch = rows || []
    for (const u of batch) {
      const s = String(u.status || 'unknown').toLowerCase()
      buckets[s] = (buckets[s] || 0) + 1
      total++
    }
    if (batch.length < SCAN_PAGE) break
    offset += SCAN_PAGE
    if (offset >= SCAN_MAX) truncated = true
  }
  return {
    total_units: total,
    vacant: buckets.vacant || 0,
    occupied: buckets.occupied || 0,
    reserved: buckets.reserved || 0,
    other: total - (buckets.vacant || 0) - (buckets.occupied || 0) - (buckets.reserved || 0),
    by_status: buckets,
    occupancy_rate: total ? Math.round(((buckets.occupied || 0) / total) * 100) : 0,
    truncated,
  }
}

function appName(a: any): string {
  const d = a.data || {}
  return [d.fn || d.firstName, d.ln || d.lastName].filter(Boolean).join(' ') || '(name not set)'
}

async function toolSearchApplications(args: Record<string, unknown>): Promise<any> {
  const params = ['select=' + encodeURIComponent('id,status,score,tier,app_type,assigned_unit_id,submitted_at,data'), NOT_ARCHIVED]
  const status = String(args.status || '').trim()
  const appType = String(args.app_type || '').trim()
  const tier = String(args.tier || '').trim()
  if (/^[a-z_]+$/.test(status))  params.push('status=eq.' + status)
  if (/^[a-z_]+$/.test(appType)) params.push('app_type=eq.' + appType)
  if (/^[a-z0-9_]+$/i.test(tier)) params.push('tier=eq.' + tier)
  params.push('order=score.desc', 'limit=' + MAX_ROW_LIMIT)
  const { rows, error } = await pgSelect('housing_applications', params)
  if (error) return { error }
  const apps = (rows || []).map((a: any) => ({
    id: a.id, name: appName(a), status: a.status, score: a.score,
    tier: a.tier, app_type: a.app_type, assigned_unit_id: a.assigned_unit_id,
    submitted_at: a.submitted_at,
  }))
  return { count: apps.length, capped: apps.length >= MAX_ROW_LIMIT, applications: apps }
}

async function toolWaitlist(): Promise<any> {
  const params = [
    'select=' + encodeURIComponent('id,status,score,tier,app_type,submitted_at,data'),
    NOT_ARCHIVED,
    'status=in.(mgr_approved,hm_approved,ed_approved)',
    'app_type=in.(new_housing,transfer_request)',
    'assigned_unit_id=is.null',
    'order=score.desc',
    'limit=' + MAX_ROW_LIMIT,
  ]
  const { rows, error } = await pgSelect('housing_applications', params)
  if (error) return { error }
  const list = (rows || []).map((a: any, i: number) => ({
    rank: i + 1, id: a.id, name: appName(a), score: a.score, tier: a.tier,
    app_type: a.app_type, on_rez_transfer: a.app_type === 'transfer_request',
    submitted_at: a.submitted_at,
  }))
  return {
    count: list.length, capped: list.length >= MAX_ROW_LIMIT,
    note: 'Ranked by application score. Final Match ordering also applies match-priority bonuses computed in the app.',
    waitlist: list,
  }
}

async function dispatchTool(name: string, role: string, args: Record<string, unknown>): Promise<any> {
  const allowed = TOOL_ROLES[name]
  if (!allowed) return { error: "Unknown tool '" + name + "'." }
  if (allowed.indexOf(role) === -1) return { error: 'Your role is not permitted to use ' + name + '.' }
  if (name === 'list_units')          return toolListUnits(args)
  if (name === 'get_vacancy_stats')   return toolVacancyStats()
  if (name === 'search_applications') return toolSearchApplications(args)
  if (name === 'get_waitlist')        return toolWaitlist()
  return { error: 'Not implemented.' }
}

// ----- MCP tool definitions (returned by tools/list, filtered by role) ------
const TOOL_DEFS = [
  {
    name: 'list_units',
    description: 'List housing units, optionally filtered by state. Returns unit number, street, status, bedrooms, and current tenant.',
    inputSchema: {
      type: 'object',
      properties: { state: { type: 'string', enum: ['vacant', 'occupied', 'reserved', 'all'], description: 'Which units to list. Default all.' } },
    },
  },
  {
    name: 'get_vacancy_stats',
    description: 'Exact occupancy statistics across every unit: total, vacant, occupied, reserved, other, and occupancy rate.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'search_applications',
    description: 'Search housing applications by status, app_type (new_housing|existing_tenant|transfer_request), and/or tier. Management only.',
    inputSchema: {
      type: 'object',
      properties: {
        status:   { type: 'string', description: 'e.g. submitted, mgr_approved, hm_approved, ed_approved, declined.' },
        app_type: { type: 'string', description: 'new_housing, existing_tenant, or transfer_request.' },
        tier:     { type: 'string', description: 'Priority tier.' },
      },
    },
  },
  {
    name: 'get_waitlist',
    description: 'The current waitlist: approved, unhoused, scored applicants (new_housing + transfer_request) ranked by score. Management only.',
    inputSchema: { type: 'object', properties: {} },
  },
]

function toolsForRole(role: string) {
  return TOOL_DEFS.filter((t) => (TOOL_ROLES[t.name] || []).indexOf(role) !== -1)
}

// ----- audit: one append-only row per tool call -----------------------------
async function writeMcpAudit(email: string, name: string, role: string, tool: string, args: unknown, rowCount: number | null): Promise<void> {
  if (!SUPABASE_SERVICE_KEY || !SUPABASE_URL) return
  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const detail = {
      detail: 'MCP tool: ' + tool + (rowCount != null ? ' (' + rowCount + ' rows)' : ''),
      name: name || email, role, tool, args, source: 'mcp',
    }
    await admin.from('housing_audit_log').insert({
      entity_type: 'mcp', entity_id: 'MCP', action: 'mcp_' + tool,
      detail: JSON.stringify(detail), actor: email, created_at: new Date().toISOString(),
    })
  } catch (e) {
    console.warn('[mcp-audit] insert failed:', (e as Error).message)
  }
}

// ----- JSON-RPC helpers -----------------------------------------------------
function rpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}
function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json({ error: 'Supabase env not configured' }, 500)

  // --- Auth: valid Supabase user JWT, resolved to active staff (like ai-chat) ---
  const authHeader = req.headers.get('Authorization') || ''
  if (!authHeader.startsWith('Bearer ')) return json(rpcError(null, -32001, 'Missing Authorization'), 401)
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: { user }, error: authErr } = await userClient.auth.getUser()
  if (authErr || !user) return json(rpcError(null, -32001, 'Unauthorized'), 401)

  const email = (user.email || '').toLowerCase()
  let role = '', actorName = ''
  if (SUPABASE_SERVICE_KEY) {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const { data: rows } = await admin.from('staff').select('role, name').eq('email', email).eq('is_active', true).limit(1)
    if (rows && rows.length) { role = normRole(rows[0].role || ''); actorName = rows[0].name || '' }
  }
  if (!role) return json(rpcError(null, -32002, 'Active housing staff only'), 403)

  let msg: any
  try { msg = await req.json() } catch { return json(rpcError(null, -32700, 'Parse error'), 400) }

  const { id, method, params } = msg || {}

  // Notifications (no id) -> ack with 202, no body.
  if (id === undefined || id === null) {
    return new Response(null, { status: 202, headers: CORS })
  }

  if (method === 'initialize') {
    return json(rpcResult(id, {
      protocolVersion: (params && params.protocolVersion) || '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'housing-mcp', version: '0.1.0' },
    }))
  }

  if (method === 'tools/list') {
    return json(rpcResult(id, { tools: toolsForRole(role) }))
  }

  if (method === 'tools/call') {
    const name = params?.name
    const args = (params?.arguments as Record<string, unknown>) || {}
    const out = await dispatchTool(String(name || ''), role, args)
    const rowCount = out && typeof out.count === 'number' ? out.count : null
    await writeMcpAudit(email, actorName, role, String(name || ''), args, rowCount)
    if (out && out.error) {
      return json(rpcResult(id, { content: [{ type: 'text', text: 'ERROR: ' + out.error }], isError: true }))
    }
    return json(rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(out) }] }))
  }

  return json(rpcError(id, -32601, "Method not found: " + method))
})
```

---

## 4. Local bridge — `mcp-bridge.mjs`

The only thing that runs on the staff member's machine. It signs in to Supabase
with their staff credentials, keeps a fresh access token, and proxies MCP
requests to the Edge Function. Requires the official SDK:

```bash
npm init -y && npm install @modelcontextprotocol/sdk
```

```js
// mcp-bridge.mjs - stdio MCP server that proxies to the Supabase "mcp" function.
// Holds only the staff member's own login; never the service key.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const ENDPOINT   = process.env.MCP_ENDPOINT      // https://<proj>.functions.supabase.co/mcp
const SB_URL     = process.env.SUPABASE_URL
const SB_ANON    = process.env.SUPABASE_ANON_KEY
const EMAIL      = process.env.HOUSING_EMAIL
const PASSWORD   = process.env.HOUSING_PASSWORD

let token = null, tokenExp = 0

async function getToken() {
  if (token && Date.now() < tokenExp - 60000) return token
  const r = await fetch(SB_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: SB_ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  const d = await r.json()
  if (!r.ok) throw new Error('Login failed: ' + JSON.stringify(d))
  token = d.access_token
  tokenExp = Date.now() + (d.expires_in || 3600) * 1000
  return token
}

async function rpc(method, params) {
  const jwt = await getToken()
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const d = await r.json()
  if (d.error) throw new Error(d.error.message || 'RPC error')
  return d.result
}

const server = new Server({ name: 'housing-bridge', version: '0.1.0' }, { capabilities: { tools: {} } })
server.setRequestHandler(ListToolsRequestSchema, async () => rpc('tools/list', {}))
server.setRequestHandler(CallToolRequestSchema, async (req) =>
  rpc('tools/call', { name: req.params.name, arguments: req.params.arguments || {} }))

await server.connect(new StdioServerTransport())
```

---

## 5. Connecting Claude Desktop

Edit `claude_desktop_config.json` (Claude Desktop → Settings → Developer → Edit
Config). Add one `mcpServers` entry pointing at the bridge:

```json
{
  "mcpServers": {
    "housing": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-bridge.mjs"],
      "env": {
        "MCP_ENDPOINT": "https://<project-ref>.functions.supabase.co/mcp",
        "SUPABASE_URL": "https://<project-ref>.supabase.co",
        "SUPABASE_ANON_KEY": "<publishable anon key from shared-config.js>",
        "HOUSING_EMAIL": "kevin.proctor@clfn.on.ca",
        "HOUSING_PASSWORD": "<the staff member's own login password>"
      }
    }
  }
}
```

Restart Claude Desktop. The four tools appear under the tools (plug) icon. Then
you can ask, in plain language:

- "How many vacant units do we have?" -> `get_vacancy_stats`
- "List the occupied units." -> `list_units`
- "Who's next on the housing waitlist?" -> `get_waitlist`
- "Show me the ed_approved transfer applications." -> `search_applications`

Each answer is grounded in live data, role-checked, and logged. A field employee
running the same bridge with their own credentials would see only `list_units`
and `get_vacancy_stats` — the two management tools wouldn't even appear.

> **Password in the config** is acceptable for a single-admin pilot on a trusted
> machine, but it is plaintext. Two better options when you go past the pilot:
> keep the token in the OS keychain, or move to a proper OAuth connector (Claude
> Desktop supports remote MCP servers over HTTPS with OAuth) so no password sits
> in a file at all.

---

## 6. Test checklist before handing it to staff

1. **Auth rejected without a token** — `curl -X POST <endpoint>` returns 401.
2. **Auth rejected for non-staff** — a valid JWT for a non-staff user returns 403.
3. **Role filtering** — `tools/list` as a `field_employee` returns only the two
   all-staff tools; as `ed`, all four.
4. **Stats are exact** — `get_vacancy_stats.total_units` matches the Inventory
   count (it scans every unit, not just 50).
5. **Row cap holds** — `list_units` never returns more than 50; `capped:true`
   flags when there are more.
6. **Audit rows land** — after each call, a `mcp_<tool>` row appears in
   `housing_audit_log` with the caller's email (visible in Settings -> Audit Log).

---

## 7. What comes after the pilot (not in scope now)

- Add read tools: `search_tenants`, `list_maintenance_requests`, `list_rfqs`,
  `list_contractors`, `list_overdue_inspections`, `reconcile_units_applications`.
- Then **gated writes**, one at a time, each returning a preview + requiring
  confirmation and a stricter role: `create_maintenance_request`,
  `reclassify_application`, `merge_applications`, `assign_unit`,
  `send_notification`.
- Replace the password-in-config bridge with an OAuth remote connector.
- For zero external exposure, point the same catalog at a self-hosted model.
