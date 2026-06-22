// ========================================================================
// ai-assistant - Housing natural-language staff assistant Edge Function
// ------------------------------------------------------------------------
// POST { messages: [{ role: "user"|"assistant", content: string }, ...] }
//
// A read-only conversational assistant for STAFF. It answers questions about
// housing data (applications, units, tenants, work orders, contractors, RFQs,
// audit log) by letting Claude call a single whitelisted, read-only
// `query_database` tool. Every query is scoped server-side to the caller's
// role so the assistant can never surface data the signed-in user could not
// already see in the app. The assistant has NO write tools - it cannot change
// data, only read it.
//
// Security model (mirrors send-notification):
//   - Requires an authenticated Supabase user (Authorization: Bearer <jwt>).
//   - Resolves the caller's role from the `staff` table (service-role read).
//   - The Anthropic API key lives ONLY in this function's secrets, never in
//     the browser. The browser talks to this function, not to Anthropic.
//   - Data reads use the service-role key but are gated by a per-table role
//     allowlist + forced row filters (e.g. field employees only see their own
//     in-house work orders).
//
// Secrets (Project Settings -> Edge Functions -> Secrets):
//   ANTHROPIC_API_KEY   required - Anthropic API key
//   ANTHROPIC_MODEL     optional - model id (default claude-sonnet-4-6)
//   -- auto-injected --
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//
// Source must stay ASCII-only (matches the send-notification constraint).
// ========================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY    = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL      = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-6";
const ANTHROPIC_URL        = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION    = "2023-06-01";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY    = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const MAX_TOOL_TURNS = 6;     // hard cap on the tool-use loop
const MAX_ROW_LIMIT  = 50;    // hard cap on rows returned per query
const MAX_MESSAGES   = 40;    // trim very long conversations

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ----- role groups -----------------------------------------------------------
// super_user inherits ed everywhere.
const MGMT    = ["ed", "super_user", "housing_manager", "housing_employee_l2", "housing_employee_l1"];
const FINANCE = ["ed", "super_user", "cfo", "finance_l1"];
const ADMIN   = ["ed", "super_user"];
const ALL     = MGMT.concat(["field_employee", "cfo", "finance_l1"]);

// ----- per-table access + column hints --------------------------------------
// Each entry: roles allowed to query it + a short column hint for the model.
// Tables not listed here (and finance_* for non-finance roles) are denied.
type TableDef = { roles: string[]; cols: string };
const TABLES: Record<string, TableDef> = {
  housing_units: {
    roles: ALL,
    cols: "id, unit_number, address, status (vacant|occupied), unit_type, bedrooms, assigned_name (current tenant), funder, dept_number, acct_number, insured_value, latitude, longitude",
  },
  applications: {
    roles: MGMT,
    cols: "id, applicant_name, status, application_type (new|file_update|house_request), score, household_size, children, dependants, created_by_email, assigned_unit, created_at",
  },
  tenants: {
    roles: ALL,
    cols: "id, full_name, email, phone, hydro_account, gas_account",
  },
  housing_sow: {
    roles: ALL,
    cols: "id, project_number, unit_id, status, approval_status ('' new|draft|signed|submitted|hm_approved|ed_approved|completed), total_cost, category, assigned_team (in_house|contractor), assigned_to (email), assigned_to_name, created_at",
  },
  contractors: {
    roles: ALL,
    cols: "id, name, email, status, trade",
  },
  housing_rfq: {
    roles: MGMT,
    cols: "id, rfq_number, status (draft|issued|awarded|cancelled), sow_id, unit_id, closes_date",
  },
  housing_audit_log: {
    roles: ["ed", "super_user", "housing_manager"],
    cols: "id, entity_type, entity_id, action, detail, actor (email), created_at",
  },
  staff: {
    roles: ["ed", "super_user", "housing_manager"],
    cols: "id, name, email, role, department, is_active",
  },
};

const SAFE_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is", "not"];

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normRole(r: string): string {
  const v = (r || "").toLowerCase().trim();
  // normalize the common legacy strings the app also normalizes client-side
  if (v === "hm" || v === "manager") return "housing_manager";
  if (v === "employee" || v === "staff") return "housing_employee_l1";
  if (v === "executive_director" || v === "executivedirector") return "ed";
  return v;
}

// Build the list of tables (with column hints) this role may read.
function allowedTablesFor(role: string): string[] {
  const out: string[] = [];
  for (const t of Object.keys(TABLES)) {
    if (TABLES[t].roles.indexOf(role) !== -1) out.push(t);
  }
  if (FINANCE.indexOf(role) !== -1) {
    out.push("finance_* (any table whose name starts with finance_)");
  }
  return out;
}

function schemaHintFor(role: string): string {
  const lines: string[] = [];
  for (const t of Object.keys(TABLES)) {
    if (TABLES[t].roles.indexOf(role) !== -1) {
      lines.push("  " + t + ": " + TABLES[t].cols);
    }
  }
  if (FINANCE.indexOf(role) !== -1) {
    lines.push("  finance_* : finance ledger/loan/invoice tables (use select=*&limit=3 to learn columns)");
  }
  return lines.join("\n");
}

// Decide if a role may read a given table; apply forced filters for narrow roles.
function tableAccess(role: string, table: string): { ok: boolean; forced: string[]; reason?: string } {
  const def = TABLES[table];
  if (def) {
    if (def.roles.indexOf(role) === -1) {
      return { ok: false, forced: [], reason: "Your role is not permitted to read the '" + table + "' table." };
    }
    // Field employees only ever see their own in-house work orders.
    if (table === "housing_sow" && role === "field_employee") {
      return { ok: true, forced: ["assigned_team=eq.in_house"] };
    }
    return { ok: true, forced: [] };
  }
  // finance_* prefix rule
  if (table.indexOf("finance_") === 0) {
    if (FINANCE.indexOf(role) === -1) {
      return { ok: false, forced: [], reason: "Finance data is restricted to ED, CFO, and Finance roles." };
    }
    return { ok: true, forced: [] };
  }
  return { ok: false, forced: [], reason: "Unknown or non-readable table: '" + table + "'." };
}

// Run one whitelisted read query against PostgREST with the service-role key.
async function runQuery(
  role: string,
  email: string,
  input: Record<string, unknown>,
): Promise<{ rows?: unknown[]; error?: string }> {
  const table = String(input.table || "").trim();
  if (!table || !/^[a-z0-9_]+$/.test(table)) {
    return { error: "Invalid table name." };
  }
  const access = tableAccess(role, table);
  if (!access.ok) return { error: access.reason || "Access denied." };

  const params: string[] = [];

  // select
  let select = String(input.select || "*").trim();
  if (!/^[a-z0-9_,*().: ]+$/i.test(select)) select = "*";
  params.push("select=" + encodeURIComponent(select));

  // forced row filters (role scoping)
  for (const f of access.forced) params.push(f);
  // Field employee SOW: also constrain to their own assignment.
  if (table === "housing_sow" && role === "field_employee") {
    params.push("assigned_to=eq." + encodeURIComponent(email));
  }

  // caller-supplied filters: [{ column, op, value }]
  const filters = Array.isArray(input.filters) ? input.filters : [];
  for (const f of filters as Array<Record<string, unknown>>) {
    const col = String(f.column || "").trim();
    const op  = String(f.op || "eq").trim().toLowerCase();
    const val = f.value == null ? "" : String(f.value);
    if (!/^[a-z0-9_]+$/.test(col)) return { error: "Invalid filter column: " + col };
    if (SAFE_OPS.indexOf(op) === -1) return { error: "Unsupported filter op: " + op };
    params.push(encodeURIComponent(col) + "=" + op + "." + encodeURIComponent(val));
  }

  // order
  if (input.order) {
    const ord = String(input.order).trim();
    if (/^[a-z0-9_]+(\.(asc|desc))?$/i.test(ord)) params.push("order=" + ord);
  }

  // limit (hard-capped)
  let limit = parseInt(String(input.limit || "20"), 10);
  if (isNaN(limit) || limit < 1) limit = 20;
  if (limit > MAX_ROW_LIMIT) limit = MAX_ROW_LIMIT;
  params.push("limit=" + limit);

  const url = SUPABASE_URL + "/rest/v1/" + table + "?" + params.join("&");
  try {
    const r = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY!,
        Authorization: "Bearer " + SUPABASE_SERVICE_KEY,
        Accept: "application/json",
      },
    });
    const text = await r.text();
    if (!r.ok) return { error: "Query failed (" + r.status + "): " + text.slice(0, 500) };
    let rows: unknown[];
    try { rows = JSON.parse(text); } catch { return { error: "Could not parse query result." }; }
    return { rows };
  } catch (e) {
    return { error: "Query error: " + (e as Error).message };
  }
}

// Static how-to knowledge about the app's workflows. Used to answer
// procedural "how do I ..." questions. Grounded in the actual UI; keep ASCII.
const HOW_TO = [
  "HOW-TO KNOWLEDGE (app workflows). Use this to answer 'how do I ...' questions.",
  "Tailor steps to the user's role: if their role cannot do an action, say so and",
  "name the role that can. Do not invent buttons or menus you are unsure of -",
  "describe the general path. The app's main pages: Home (worklist + quick",
  "actions + KPIs), Inventory (housing units), Tenants, Match, Renovations,",
  "Contractors, Finance.",
  "",
  "Terminology: a 'Maintenance Request' is the same record as a 'SOW' (Statement",
  "of Work). A 'Work Order' is the crew/contractor-facing printout of that request.",
  "",
  "Create a maintenance request / work order:",
  "  - Easiest: on the Home page click the 'Renovation Questionnaire' quick action",
  "    - a guided wizard that captures the scope and opens a new request for you.",
  "  - Or open Inventory, click the hammer icon next to a unit (or open the unit",
  "    and start a New Work Order), add line items (category + description), then",
  "    Save (keeps it a draft) or Submit.",
  "  Who: management and field employees can create/edit requests.",
  "",
  "Assign a work order to crew or a contractor:",
  "  - In the request, use the 'Assigned To' control: pick in-house crew (a field",
  "    employee) or a contractor. Assigning is restricted to Housing Manager / ED.",
  "  - When assigned in-house to a field employee, that employee is notified and",
  "    the request appears in their 'Work Orders to Complete' list.",
  "",
  "Complete a maintenance request:",
  "  - Open the request (field employees: from Home > 'Work Orders to Complete',",
  "    or Inventory > the unit > its work orders).",
  "  - Click the '+ Mark Complete' button in the request header and confirm.",
  "  - This LOCKS the request, work order, and progress reports from further edits.",
  "  Who can complete: field employees, Housing Manager, and ED.",
  "  Only the ED can Reopen a completed request.",
  "",
  "Approve a renovation / SOW:",
  "  - Requests needing sign-off appear in 'Renovations Waiting Approval' on the",
  "    Home worklist and in Renovations > Reno Approvals. You can approve right",
  "    from the worklist. Housing Manager approves first; higher-cost work then",
  "    needs ED approval. (Approval authority is set in Settings > Approval Authority.)",
  "",
  "Add a progress report: open the request in Renovations and edit its progress",
  "section. Field employees and management can edit progress reports.",
  "",
  "Create / do a housing application (full walkthrough):",
  "  1. On the Home page click the 'New Application' quick action.",
  "  2. Work through the wizard steps using the Next / Back buttons:",
  "     Step 0 Applicant Info -> Step 1 Employment & Income -> Step 2 Co-Applicant",
  "     -> Step 3 Household Members -> Step 4 Emergency Contacts -> Step 5 Pets",
  "     -> Step 6 Documents -> Review & Submit. (Household members, income",
  "     records, emergency contacts and pets are add-as-many-rows sections.)",
  "  3. Housing Manager / ED see two extra steps before Documents: a Housing Need",
  "     Assessment and Tenancy History (these drive scoring and are staff-only).",
  "  4. Step 6 Documents: upload required files (ID, proof of income, etc.) in the",
  "     document library for the application.",
  "  5. Review & Submit: check the summary, then Submit. On submit you can tick a",
  "     box to email the applicant a PDF copy of their application.",
  "  6. After submit it enters the approval flow and shows in the worklist.",
  "  Who: management roles create/edit applications; field employees do not.",
  "  Tip: drafts you started appear in 'My Drafts' on the Home worklist - use",
  "  'Continue ->' to finish one.",
  "",
  "Approve an application: submitted applications appear in the Home worklist",
  "'Applications' section (and you can open any application to act on it). Open",
  "one and choose the approval action (recommend / approve / decline / return with",
  "notes). The flow is: management recommends -> Housing Manager approves -> ED",
  "approves, per the amounts/authority set in Settings > Approval Authority.",
  "Returned applications go back to the owner to fix and resubmit.",
  "",
  "Match an applicant to a unit: approved applications with no unit show in 'Ready",
  "to Match' on the worklist; use the Match page to assign a vacant unit.",
  "",
  "View or edit a tenant: go to Tenants and open a tenant's card (the Tenant",
  "Information Card / TIC). Tabs cover Overview, Utilities (hydro/gas meter +",
  "account numbers), Documents, and Unit History. Field employees see the TIC",
  "read-only.",
  "",
  "Edit a housing unit: open Inventory and click a unit to open its detail panel,",
  "then edit fields (address, status, type, funder, account numbers, insured",
  "value, etc.). A unit's renovation budget approval (HM/ED sign-off) also lives",
  "on the unit edit modal when a request exceeds the Housing Manager budget limit.",
  "",
  "Add a contractor: Contractors page > add a contractor. New contractors go",
  "pending_review -> Housing Manager verifies -> ED approves.",
  "",
  "Issue an RFQ (request for quotes): from a SOW (in Renovations or the unit",
  "panel) create an RFQ to invite contractors to bid. Tabs: Details, Scope,",
  "Recipients (pick contractors), Documents, Contracting (generate a contract).",
  "Flow: draft -> issued -> awarded. Only draft RFQs can be edited.",
  "",
  "Set a unit's location & photo: open the unit's Tenant Information Card and use",
  "'Set Location & Photo' to drop a map pin and add a photo (ED/admin).",
  "",
  "Finance (rent ledger, loans, invoices, arrangements, collections): open the",
  "Finance page (visible to ED, CFO, and Finance roles). Record rent payments and",
  "charges in the rent ledger, manage loans/invoices/payment arrangements, and run",
  "collections from their respective sections. Ledger corrections use a void",
  "(reversing) entry rather than deletion.",
  "",
  "Export data: list pages (Inventory, Match, Renovations, Contractors) and the",
  "audit log have an Export button (CSV / Excel). Use the page's Export dropdown.",
  "",
  "See your recent activity / the audit log: ED and Housing Manager can open",
  "Settings > Audit Log (exportable). 'Recent Activity' shows actions you took",
  "(matched by your email).",
  "",
  "Admin settings (ED / super user): Settings holds App Settings (incl. the",
  "ED-adjustable Scoring model), Approval Authority (who can approve what), Nation",
  "(branding, idle timeout, and the Modules on/off toggles, incl. this assistant),",
  "Notifications (edit email templates/recipients per event), and Users.",
  "",
  "Add a staff user (ED / super user): Settings > Users > add a user; set their",
  "name, email, role and department. Create their sign-in in Supabase Auth as well",
  "so they can log in. Deactivating a user (is_active off) keeps their history.",
].join("\n");

function buildSystemPrompt(name: string, role: string, today: string): string {
  return [
    "You are the Housing Assistant, a helpful, concise assistant built into a",
    "First Nations housing management application used by housing staff.",
    "",
    "The signed-in user is " + (name || "a staff member") + " (role: " + role + ").",
    "Today's date is " + today + ".",
    "",
    "You do two things:",
    "  1. Answer questions about housing DATA by calling the read-only",
    "     `query_database` tool.",
    "  2. Answer 'how do I ...' procedural questions using the HOW-TO knowledge",
    "     below (no tool call needed for those).",
    "You have NO ability to change, create, or delete anything - you can only",
    "read data. If asked to modify data, explain that you are read-only and point",
    "them to where in the app to make the change (use the HOW-TO knowledge).",
    "",
    "Tables you may query for this user (with column hints):",
    schemaHintFor(role),
    "",
    "Query guidance:",
    "- Use ilike with *term* for fuzzy name/text matches (e.g. applicant_name=ilike.*smith*).",
    "- Vacant units: housing_units where status=eq.vacant.",
    "- If you are unsure of a table's columns, run select=* with limit=3 to inspect it.",
    "- Keep limits small; you can request up to " + MAX_ROW_LIMIT + " rows.",
    "- If a query returns an error about a column, adjust and retry once.",
    "- Only state facts you retrieved from the database. Never invent records,",
    "  names, numbers, or statuses. If the data is not there, say so.",
    "",
    HOW_TO,
    "",
    "Style: brief and direct. Prefer short numbered steps for how-to answers and",
    "short summaries / small tables over raw JSON for data answers. When you cite",
    "counts or figures, they must come from a query you ran. This is sensitive",
    "community data governed by OCAP principles - do not speculate about",
    "individuals and keep answers grounded in the records.",
  ].join("\n");
}

const TOOLS = [
  {
    name: "query_database",
    description:
      "Read rows from an allowed housing table. Read-only. Returns up to " +
      MAX_ROW_LIMIT + " rows as JSON. Use filters to narrow results.",
    input_schema: {
      type: "object",
      properties: {
        table:  { type: "string", description: "Table name to read from." },
        select: { type: "string", description: "Comma-separated columns, or * for all. Default *." },
        filters: {
          type: "array",
          description: "Row filters, ANDed together.",
          items: {
            type: "object",
            properties: {
              column: { type: "string" },
              op:     { type: "string", description: "One of eq, neq, gt, gte, lt, lte, like, ilike, in, is, not. Default eq." },
              value:  { type: "string" },
            },
            required: ["column", "value"],
          },
        },
        order: { type: "string", description: "e.g. created_at.desc" },
        limit: { type: "integer", description: "Max rows (1-" + MAX_ROW_LIMIT + ")." },
      },
      required: ["table"],
    },
  },
];

async function callAnthropic(system: string, messages: unknown[]): Promise<Record<string, unknown>> {
  const r = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY!,
      "anthropic-version": ANTHROPIC_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,
      system,
      tools: TOOLS,
      messages,
    }),
  });
  const data = await r.json();
  if (!r.ok) {
    throw new Error("Anthropic " + r.status + ": " + JSON.stringify(data).slice(0, 600));
  }
  return data;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")    return jsonResponse({ error: "Method not allowed" }, 405);

  if (!ANTHROPIC_API_KEY)                    return jsonResponse({ error: "ANTHROPIC_API_KEY not configured" }, 500);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY)   return jsonResponse({ error: "Supabase env not configured" }, 500);
  if (!SUPABASE_SERVICE_KEY)                 return jsonResponse({ error: "Service role key not configured" }, 500);

  // Auth: caller must present a valid Supabase user JWT.
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonResponse({ error: "Missing or malformed Authorization header" }, 401);
  }
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) {
    return jsonResponse({ error: "Unauthorized", detail: authErr?.message }, 401);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Resolve the caller's role from the staff table (must be active staff).
  const email = (user.email || "").toLowerCase();
  let role = "";
  let name = "";
  try {
    const { data: staffRows } = await admin
      .from("staff")
      .select("role,name")
      .eq("email", email)
      .eq("is_active", true)
      .limit(1);
    if (staffRows && staffRows.length) {
      role = normRole(staffRows[0].role || "");
      name = staffRows[0].name || "";
    }
  } catch (_) { /* fall through */ }

  if (!role || ALL.indexOf(role) === -1) {
    return jsonResponse({ error: "Assistant is available to active housing staff only." }, 403);
  }

  // Payload
  let payload: Record<string, unknown>;
  try { payload = await req.json(); }
  catch { return jsonResponse({ error: "Invalid JSON body" }, 400); }

  const inMessages = Array.isArray(payload.messages) ? payload.messages : [];
  if (!inMessages.length) return jsonResponse({ error: "messages[] required" }, 400);

  // Sanitize incoming history to {role, content:string} and trim length.
  const messages: unknown[] = [];
  for (const m of (inMessages as Array<Record<string, unknown>>).slice(-MAX_MESSAGES)) {
    const r = m.role === "assistant" ? "assistant" : "user";
    const c = typeof m.content === "string" ? m.content : String(m.content ?? "");
    if (c.trim()) messages.push({ role: r, content: c.slice(0, 8000) });
  }
  if (!messages.length) return jsonResponse({ error: "No usable message content" }, 400);

  const system = buildSystemPrompt(name, role, new Date().toISOString().slice(0, 10));

  // Tool-use loop.
  try {
    let turns = 0;
    while (turns < MAX_TOOL_TURNS) {
      turns++;
      const resp = await callAnthropic(system, messages);
      const content = (resp.content as Array<Record<string, unknown>>) || [];
      const stopReason = resp.stop_reason as string;

      // Append the assistant turn verbatim (preserves tool_use blocks).
      messages.push({ role: "assistant", content });

      if (stopReason !== "tool_use") {
        // Final answer: concatenate text blocks.
        const text = content
          .filter((b) => b.type === "text")
          .map((b) => b.text as string)
          .join("\n")
          .trim();
        return jsonResponse({ ok: true, reply: text || "(no response)", role });
      }

      // Execute every tool_use block, collect tool_result blocks.
      const toolResults: unknown[] = [];
      for (const block of content) {
        if (block.type !== "tool_use") continue;
        let resultText: string;
        if (block.name === "query_database") {
          const qr = await runQuery(role, email, (block.input as Record<string, unknown>) || {});
          if (qr.error) {
            resultText = "ERROR: " + qr.error;
          } else {
            const rows = qr.rows || [];
            resultText = "Returned " + rows.length + " row(s):\n" + JSON.stringify(rows).slice(0, 12000);
          }
        } else {
          resultText = "ERROR: unknown tool '" + block.name + "'.";
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: resultText,
        });
      }
      messages.push({ role: "user", content: toolResults });
    }
    // Ran out of turns.
    return jsonResponse({
      ok: true,
      reply: "I wasn't able to finish that lookup. Try narrowing the question.",
      role,
    });
  } catch (e) {
    return jsonResponse({ error: "Assistant failed", detail: (e as Error).message }, 502);
  }
});
