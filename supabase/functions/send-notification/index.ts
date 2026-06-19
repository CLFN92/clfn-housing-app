// ========================================================================
// send-notification - Housing transactional email Edge Function
// ------------------------------------------------------------------------
// POST { to, to_name, subject, message, html?, bodyHtml?, reply_to?, brand?,
//        event?, entity_type?, entity_id?, attachments? }
//
// Multi-nation: the email PROVIDER is selectable per nation via the
// EMAIL_PROVIDER secret, so nations without Microsoft 365 can still send.
//   EMAIL_PROVIDER = "graph"    (default) - Microsoft Graph / M365 mailbox
//                  | "resend"             - Resend HTTP API
//                  | "sendgrid"           - SendGrid HTTP API
//
// Requires an authenticated Supabase user (Authorization: Bearer <jwt>) so the
// function can't be abused by anonymous callers. Logs each send to
// housing_audit_log via the service-role key (best-effort, never fails a send).
//
// Secrets (set per nation in Project Settings -> Edge Functions -> Secrets):
//   EMAIL_PROVIDER    optional, default "graph"
//   EMAIL_REPLY_TO    optional reply-to override (default housing@clfn.on.ca)
//   EMAIL_BRAND       optional footer brand     (default "CLFN Housing")
//   -- Graph (when EMAIL_PROVIDER=graph) --
//   GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_FROM_USER
//   -- Resend (when EMAIL_PROVIDER=resend) --
//   RESEND_API_KEY, EMAIL_FROM (sender email), EMAIL_FROM_NAME (optional)
//   -- SendGrid (when EMAIL_PROVIDER=sendgrid) --
//   SENDGRID_API_KEY, EMAIL_FROM (sender email), EMAIL_FROM_NAME (optional)
//   -- auto-injected --
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// ========================================================================

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EMAIL_PROVIDER       = (Deno.env.get("EMAIL_PROVIDER") || "graph").toLowerCase();
const EMAIL_REPLY_TO       = Deno.env.get("EMAIL_REPLY_TO");
const EMAIL_BRAND          = Deno.env.get("EMAIL_BRAND");
const EMAIL_FROM           = Deno.env.get("EMAIL_FROM");
const EMAIL_FROM_NAME      = Deno.env.get("EMAIL_FROM_NAME");

const GRAPH_TENANT_ID      = Deno.env.get("GRAPH_TENANT_ID");
const GRAPH_CLIENT_ID      = Deno.env.get("GRAPH_CLIENT_ID");
const GRAPH_CLIENT_SECRET  = Deno.env.get("GRAPH_CLIENT_SECRET");
const GRAPH_FROM_USER      = Deno.env.get("GRAPH_FROM_USER");

const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY");
const SENDGRID_API_KEY     = Deno.env.get("SENDGRID_API_KEY");

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY    = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const DEFAULT_REPLY_TO = "housing@clfn.on.ca";
const DEFAULT_BRAND    = "CLFN Housing";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Attachment = { name: string; contentType: string; contentBytes: string };
type OutMessage = {
  to: string;
  to_name?: string;
  subject: string;
  emailHtml: string;
  replyTo: string;
  attachments?: Attachment[];
};

// ----- Microsoft Graph (M365) ------------------------------------------------
let _cachedToken: { access_token: string; expires_at: number } | null = null;

async function getGraphToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (_cachedToken && _cachedToken.expires_at - 60 > now) {
    return _cachedToken.access_token;
  }
  const tokenUrl = "https://login.microsoftonline.com/" + GRAPH_TENANT_ID + "/oauth2/v2.0/token";
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
  _cachedToken = { access_token: data.access_token, expires_at: now + (data.expires_in || 3600) };
  return data.access_token;
}

async function sendViaGraph(m: OutMessage): Promise<void> {
  const token = await getGraphToken();
  const sendUrl = "https://graph.microsoft.com/v1.0/users/" + encodeURIComponent(GRAPH_FROM_USER!) + "/sendMail";
  const graphAttachments = (m.attachments && m.attachments.length)
    ? m.attachments.map((a) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name:          a.name,
        contentType:   a.contentType,
        contentBytes:  a.contentBytes,
      }))
    : undefined;
  const graphMessage: Record<string, unknown> = {
    subject:      m.subject,
    body:         { contentType: "HTML", content: m.emailHtml },
    toRecipients: [{ emailAddress: { address: m.to, name: m.to_name || undefined } }],
    replyTo:      [{ emailAddress: { address: m.replyTo } }],
  };
  if (graphAttachments) graphMessage.attachments = graphAttachments;
  const r = await fetch(sendUrl, {
    method:  "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body:    JSON.stringify({ message: graphMessage, saveToSentItems: true }),
  });
  if (r.status !== 202) {
    throw new Error("Graph " + r.status + ": " + (await r.text()));
  }
}

// ----- Resend ----------------------------------------------------------------
async function sendViaResend(m: OutMessage): Promise<void> {
  const from = EMAIL_FROM_NAME ? (EMAIL_FROM_NAME + " <" + EMAIL_FROM + ">") : EMAIL_FROM!;
  const body: Record<string, unknown> = {
    from,
    to:       [m.to],
    subject:  m.subject,
    html:     m.emailHtml,
    reply_to: m.replyTo,
  };
  if (m.attachments && m.attachments.length) {
    body.attachments = m.attachments.map((a) => ({ filename: a.name, content: a.contentBytes }));
  }
  const r = await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: { Authorization: "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error("Resend " + r.status + ": " + (await r.text()));
  }
}

// ----- SendGrid --------------------------------------------------------------
async function sendViaSendgrid(m: OutMessage): Promise<void> {
  const body: Record<string, unknown> = {
    personalizations: [{ to: [{ email: m.to, name: m.to_name || undefined }] }],
    from:    { email: EMAIL_FROM!, name: EMAIL_FROM_NAME || undefined },
    reply_to:{ email: m.replyTo },
    subject: m.subject,
    content: [{ type: "text/html", value: m.emailHtml }],
  };
  if (m.attachments && m.attachments.length) {
    body.attachments = m.attachments.map((a) => ({
      content:     a.contentBytes,
      filename:    a.name,
      type:        a.contentType,
      disposition: "attachment",
    }));
  }
  const r = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method:  "POST",
    headers: { Authorization: "Bearer " + SENDGRID_API_KEY, "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  if (r.status !== 202 && !r.ok) {
    throw new Error("SendGrid " + r.status + ": " + (await r.text()));
  }
}

// ----- helpers ---------------------------------------------------------------
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

function providerEnvMissing(): string[] {
  const missing: string[] = [];
  if (EMAIL_PROVIDER === "graph") {
    if (!GRAPH_TENANT_ID)     missing.push("GRAPH_TENANT_ID");
    if (!GRAPH_CLIENT_ID)     missing.push("GRAPH_CLIENT_ID");
    if (!GRAPH_CLIENT_SECRET) missing.push("GRAPH_CLIENT_SECRET");
    if (!GRAPH_FROM_USER)     missing.push("GRAPH_FROM_USER");
  } else if (EMAIL_PROVIDER === "resend") {
    if (!RESEND_API_KEY) missing.push("RESEND_API_KEY");
    if (!EMAIL_FROM)     missing.push("EMAIL_FROM");
  } else if (EMAIL_PROVIDER === "sendgrid") {
    if (!SENDGRID_API_KEY) missing.push("SENDGRID_API_KEY");
    if (!EMAIL_FROM)       missing.push("EMAIL_FROM");
  }
  return missing;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")    return jsonResponse({ error: "Method not allowed" }, 405);

  // Provider env sanity
  if (["graph", "resend", "sendgrid"].indexOf(EMAIL_PROVIDER) === -1) {
    return jsonResponse({ error: "Unknown EMAIL_PROVIDER: " + EMAIL_PROVIDER }, 500);
  }
  const missing = providerEnvMissing();
  if (missing.length) {
    return jsonResponse({ error: "Email provider env not configured (" + EMAIL_PROVIDER + ")", missing }, 500);
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
  const attachments = payload.attachments as Attachment[] | undefined;

  // Nation-driven branding/reply-to: payload override -> secret -> default.
  const replyTo = (payload.reply_to as string) || EMAIL_REPLY_TO || DEFAULT_REPLY_TO;
  const brand   = (payload.brand    as string) || EMAIL_BRAND    || DEFAULT_BRAND;

  if (!to || !subject || (!message && !html && !bodyHtml)) {
    return jsonResponse({
      error: "Required fields: to, subject, and one of message|html|bodyHtml",
    }, 400);
  }

  // Compose body - three modes, in priority order:
  //   1. `html`     - caller supplies a complete document, used as-is
  //   2. `bodyHtml` - caller supplies inner content (rich text), wrapped in the
  //                   branded shell. NOT escaped (sanitized client-side).
  //   3. `message`  - plain text, escaped + wrapped in the branded shell
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
    + '<p style="font-size:12px;color:#888;margin:0;">' + escapeHtml(brand) + ' - automated notification. Reply to this email to reach the housing team.</p>'
    + '</div>'
  );

  const outMessage: OutMessage = { to, to_name, subject, emailHtml, replyTo, attachments };

  // Send via the configured provider
  try {
    if (EMAIL_PROVIDER === "graph")         await sendViaGraph(outMessage);
    else if (EMAIL_PROVIDER === "resend")   await sendViaResend(outMessage);
    else                                    await sendViaSendgrid(outMessage);
  } catch (e) {
    return jsonResponse({ error: "Send failed (" + EMAIL_PROVIDER + ")", detail: (e as Error).message }, 502);
  }

  // Audit log (best-effort, server-side, service-role).
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
