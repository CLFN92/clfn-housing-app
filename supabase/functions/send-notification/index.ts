// ========================================================================
// send-notification - CLFN Housing transactional email Edge Function
// ------------------------------------------------------------------------
// POST { to, to_name, subject, message, html?, event?, entity_type?, entity_id? }
//
// Sends via Microsoft Graph (graph.microsoft.com/v1.0/users/{from}/sendMail)
// using OAuth2 client_credentials flow against the Entra app
// "CLFN Housing App - Notifications". The Mail.Send Application permission
// is admin-consented at the tenant level and scoped to ONLY the
// housing@clfn.on.ca shared mailbox via Exchange's Application Access
// Policy. Sent items appear in the housing@clfn.on.ca Sent folder.
//
// Requires an authenticated Supabase user (Authorization: Bearer <jwt>) -
// keeps the function from being abused by anonymous callers. Logs each
// send to housing_audit_log via the service-role key (best-effort, never
// fails the send).
//
// Secrets expected in the Supabase Edge Function environment:
//   GRAPH_TENANT_ID            (required - Entra tenant GUID)
//   GRAPH_CLIENT_ID            (required - Entra app client ID)
//   GRAPH_CLIENT_SECRET        (required - client secret VALUE, not the ID)
//   GRAPH_FROM_USER            (required - UPN of the shared mailbox to
//                              send as, e.g. housing@clfn.on.ca)
//   SUPABASE_URL               (auto-injected)
//   SUPABASE_ANON_KEY          (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY  (auto-injected - needed for audit insert)
// ========================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GRAPH_TENANT_ID      = Deno.env.get("GRAPH_TENANT_ID");
const GRAPH_CLIENT_ID      = Deno.env.get("GRAPH_CLIENT_ID");
const GRAPH_CLIENT_SECRET  = Deno.env.get("GRAPH_CLIENT_SECRET");
const GRAPH_FROM_USER      = Deno.env.get("GRAPH_FROM_USER");
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY    = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const REPLY_TO = "housing@clfn.on.ca";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// In-memory Graph token cache. Edge Function instances reuse a token
// across invocations until it expires. 60s safety buffer.
let _cachedToken: { access_token: string; expires_at: number } | null = null;

async function getGraphToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (_cachedToken && _cachedToken.expires_at - 60 > now) {
    return _cachedToken.access_token;
  }
  const tokenUrl = "https://login.microsoftonline.com/"
                 + GRAPH_TENANT_ID
                 + "/oauth2/v2.0/token";
  const body = new URLSearchParams({
    client_id:     GRAPH_CLIENT_ID!,
    client_secret: GRAPH_CLIENT_SECRET!,
    scope:         "https://graph.microsoft.com/.default",
    grant_type:    "client_credentials",
  });
  const r = await fetch(tokenUrl, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    body.toString(),
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) {
    throw new Error("Token endpoint " + r.status + ": " + JSON.stringify(data));
  }
  _cachedToken = {
    access_token: data.access_token,
    expires_at:   now + (data.expires_in || 3600),
  };
  return data.access_token;
}

function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")    return jsonResponse({ error: "Method not allowed" }, 405);

  // Env sanity
  const missing: string[] = [];
  if (!GRAPH_TENANT_ID)     missing.push("GRAPH_TENANT_ID");
  if (!GRAPH_CLIENT_ID)     missing.push("GRAPH_CLIENT_ID");
  if (!GRAPH_CLIENT_SECRET) missing.push("GRAPH_CLIENT_SECRET");
  if (!GRAPH_FROM_USER)     missing.push("GRAPH_FROM_USER");
  if (missing.length) {
    return jsonResponse({ error: "Graph env not configured", missing }, 500);
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return jsonResponse({ error: "Supabase env not configured" }, 500);
  }

  // Auth: caller must present a valid Supabase user JWT
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

  // Payload
  let payload: Record<string, unknown>;
  try { payload = await req.json(); }
  catch { return jsonResponse({ error: "Invalid JSON body" }, 400); }

  const to          = payload.to          as string | undefined;
  const to_name     = payload.to_name     as string | undefined;
  const subject     = payload.subject     as string | undefined;
  const message     = payload.message     as string | undefined;
  const html        = payload.html        as string | undefined;
  const bodyHtml    = payload.bodyHtml    as string | undefined;
  const event       = payload.event       as string | undefined;
  const entity_type = payload.entity_type as string | undefined;
  const entity_id   = payload.entity_id   as string | undefined;

  if (!to || !subject || (!message && !html && !bodyHtml)) {
    return jsonResponse({
      error: "Required fields: to, subject, and one of message|html|bodyHtml",
    }, 400);
  }

  // Compose body - three modes, in priority order:
  //   1. `html`     - caller supplies a complete document, used as-is
  //   2. `bodyHtml` - caller supplies inner content (rich text), wrapped
  //                   in the branded shell. NOT escaped (caller's HTML
  //                   should already be sanitized client-side before send).
  //   3. `message`  - plain text, escaped + wrapped in the branded shell
  //
  // The branded shell is the same for `bodyHtml` and `message` so the
  // recipient experience is consistent regardless of authoring path.
  const innerHtml = bodyHtml
    ? bodyHtml
    : '<div style="font-size:14px;line-height:1.6;color:#333;white-space:pre-wrap;">'
        + escapeHtml(message)
      + '</div>';

  const emailHtml = html ?? (
    '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px;">'
    + '<h2 style="font-size:18px;margin:0 0 16px;color:#111;">' + escapeHtml(subject) + '</h2>'
    + innerHtml
    + '<hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0;"/>'
    + '<p style="font-size:12px;color:#888;margin:0;">CLFN Housing - automated notification. Reply to this email to reach the housing team.</p>'
    + '</div>'
  );

  // Acquire Graph token
  let token: string;
  try { token = await getGraphToken(); }
  catch (e) {
    return jsonResponse({
      error:  "Failed to acquire Graph token",
      detail: (e as Error).message,
    }, 502);
  }

  // Send via Graph sendMail. Returns 202 Accepted with empty body on success.
  const sendUrl = "https://graph.microsoft.com/v1.0/users/"
                + encodeURIComponent(GRAPH_FROM_USER!)
                + "/sendMail";
  const graphBody = {
    message: {
      subject,
      body:         { contentType: "HTML", content: emailHtml },
      toRecipients: [{ emailAddress: { address: to, name: to_name || undefined } }],
      replyTo:      [{ emailAddress: { address: REPLY_TO } }],
    },
    saveToSentItems: true,
  };

  try {
    const r = await fetch(sendUrl, {
      method:  "POST",
      headers: {
        Authorization:  "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(graphBody),
    });
    if (r.status !== 202) {
      const detail = await r.text();
      return jsonResponse({
        error:  "Graph rejected the request",
        status: r.status,
        detail,
      }, r.status);
    }
  } catch (e) {
    return jsonResponse({
      error:  "Graph network error",
      detail: (e as Error).message,
    }, 502);
  }

  // Audit log (best-effort, server-side). Service-role insert can't be
  // spoofed by a malicious client. A failed audit insert never fails the send.
  if (SUPABASE_SERVICE_KEY) {
    try {
      const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      await admin.from("housing_audit_log").insert({
        entity_type: entity_type || "notification",
        entity_id:   entity_id || "-",
        action:      event || "email_sent",
        detail:      "Email -> " + to + " | " + subject,
        actor:       user.email || user.id,
        created_at:  new Date().toISOString(),
      });
    } catch (e) {
      console.warn("[send-notification] audit log failed:", e);
    }
  }

  return jsonResponse({ ok: true });
});
