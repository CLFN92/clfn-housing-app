// ════════════════════════════════════════════════════════════════════════
// send-notification — CLFN Housing transactional email Edge Function
// ────────────────────────────────────────────────────────────────────────
// POST { to, to_name, subject, message, html?, event?, entity_type?, entity_id? }
//
// Requires an authenticated Supabase user (Authorization: Bearer <jwt>).
// Forwards the payload to Resend's API, logs the send to housing_audit_log
// via the service-role key, and returns { ok:true, id } or an error.
//
// Secrets expected in the Supabase Edge Function environment:
//   RESEND_API_KEY              (required — your Resend API key)
//   SUPABASE_URL                (auto-injected)
//   SUPABASE_ANON_KEY           (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY   (auto-injected — needed for audit insert)
//
// FROM is hard-coded to onboarding@resend.dev for v1 because clfn.on.ca's
// DNS isn't under our control yet. Once Resend can verify the housing
// domain, change FROM_ADDRESS to "CLFN Housing <housing@clfn.on.ca>" and
// redeploy — no other changes needed.
// ════════════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY       = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY    = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const FROM_ADDRESS = "CLFN Housing <onboarding@resend.dev>";
const REPLY_TO     = "housing@clfn.on.ca";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

  // ── Env sanity ──────────────────────────────────────────────────────
  if (!RESEND_API_KEY)                       return jsonResponse({ error: "RESEND_API_KEY not configured" }, 500);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY)   return jsonResponse({ error: "Supabase env not configured" }, 500);

  // ── Auth: caller must present a valid Supabase user JWT ─────────────
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

  // ── Payload ─────────────────────────────────────────────────────────
  let payload: Record<string, unknown>;
  try { payload = await req.json(); }
  catch { return jsonResponse({ error: "Invalid JSON body" }, 400); }

  const to          = payload.to          as string | undefined;
  const to_name     = payload.to_name     as string | undefined;
  const subject     = payload.subject     as string | undefined;
  const message     = payload.message     as string | undefined;
  const html        = payload.html        as string | undefined;
  const event       = payload.event       as string | undefined;
  const entity_type = payload.entity_type as string | undefined;
  const entity_id   = payload.entity_id   as string | undefined;

  if (!to || !subject || (!message && !html)) {
    return jsonResponse({ error: "Required fields: to, subject, and one of message|html" }, 400);
  }

  // Compose the body. If the caller supplies `html`, trust it. Otherwise
  // wrap their plain-text `message` in a minimal branded template.
  const emailHtml = html ?? `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="font-size:18px;margin:0 0 16px;color:#111;">${escapeHtml(subject)}</h2>
      <div style="font-size:14px;line-height:1.6;color:#333;white-space:pre-wrap;">${escapeHtml(message)}</div>
      <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0;"/>
      <p style="font-size:12px;color:#888;margin:0;">CLFN Housing — automated notification. Reply to this email to reach the housing team.</p>
    </div>
  `;

  // ── Send via Resend ─────────────────────────────────────────────────
  const recipient = to_name ? `${to_name} <${to}>` : to;
  let resendData: Record<string, unknown>;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from:     FROM_ADDRESS,
        to:       [recipient],
        subject,
        html:     emailHtml,
        reply_to: REPLY_TO,
      }),
    });
    resendData = await r.json();
    if (!r.ok) {
      return jsonResponse({ error: "Resend rejected the request", detail: resendData }, r.status);
    }
  } catch (e) {
    return jsonResponse({ error: "Resend network error", detail: (e as Error).message }, 502);
  }

  // ── Audit log (best-effort, server-side) ────────────────────────────
  // The audit row uses the service-role key so it can't be spoofed by a
  // malicious client. A failed audit insert doesn't fail the send.
  if (SUPABASE_SERVICE_KEY) {
    try {
      const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
      await admin.from("housing_audit_log").insert({
        entity_type: entity_type || "notification",
        entity_id:   entity_id || (resendData.id as string) || "—",
        action:      event || "email_sent",
        detail:      `Email → ${to} · ${subject}`,
        actor:       user.email || user.id,
        created_at:  new Date().toISOString(),
      });
    } catch (e) {
      console.warn("[send-notification] audit log failed:", e);
    }
  }

  return jsonResponse({ ok: true, id: resendData.id });
});
