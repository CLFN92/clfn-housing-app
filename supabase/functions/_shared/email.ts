// Shared outbound-email helper for Edge Functions.
//
// Mirrors the provider logic in send-notification/index.ts so functions that
// cannot use send-notification (e.g. the PUBLIC tenant-mr intake, which has no
// user JWT to present) can still send mail with the same per-nation provider
// selection. Reads the same secrets. Source must stay ASCII-only.
//
// Providers: EMAIL_PROVIDER = "graph" (default) | "resend" | "sendgrid".

export type EmailMessage = {
  to: string;
  to_name?: string;
  subject: string;
  html: string;      // complete inner HTML body (already branded/wrapped)
  replyTo?: string;
};

const EMAIL_PROVIDER      = (Deno.env.get("EMAIL_PROVIDER") || "graph").toLowerCase();
const EMAIL_REPLY_TO      = Deno.env.get("EMAIL_REPLY_TO");
const EMAIL_BRAND         = Deno.env.get("EMAIL_BRAND");
const EMAIL_FROM          = Deno.env.get("EMAIL_FROM");
const EMAIL_FROM_NAME     = Deno.env.get("EMAIL_FROM_NAME");

const GRAPH_TENANT_ID     = Deno.env.get("GRAPH_TENANT_ID");
const GRAPH_CLIENT_ID     = Deno.env.get("GRAPH_CLIENT_ID");
const GRAPH_CLIENT_SECRET = Deno.env.get("GRAPH_CLIENT_SECRET");
const GRAPH_FROM_USER     = Deno.env.get("GRAPH_FROM_USER");

const RESEND_API_KEY      = Deno.env.get("RESEND_API_KEY");
const SENDGRID_API_KEY    = Deno.env.get("SENDGRID_API_KEY");

const DEFAULT_REPLY_TO = "housing@clfn.on.ca";
const DEFAULT_BRAND    = "Housing";

export function emailBrand(): string  { return EMAIL_BRAND || DEFAULT_BRAND; }
export function emailReplyTo(): string { return EMAIL_REPLY_TO || DEFAULT_REPLY_TO; }

// True only if the configured provider has all its secrets. Lets callers skip
// silently (never error) when a nation has not set up email yet.
export function emailConfigured(): boolean {
  if (EMAIL_PROVIDER === "graph") {
    return !!(GRAPH_TENANT_ID && GRAPH_CLIENT_ID && GRAPH_CLIENT_SECRET && GRAPH_FROM_USER);
  }
  if (EMAIL_PROVIDER === "resend")   return !!(RESEND_API_KEY && EMAIL_FROM);
  if (EMAIL_PROVIDER === "sendgrid") return !!(SENDGRID_API_KEY && EMAIL_FROM);
  return false;
}

export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function isValidEmail(s: unknown): boolean {
  return typeof s === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
}

// Wrap inner content in the same branded shell send-notification uses.
export function renderBrandedEmail(subject: string, innerHtml: string): string {
  const brand = emailBrand();
  return '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px;">'
    + '<h2 style="font-size:18px;margin:0 0 16px;color:#111;">' + escapeHtml(subject) + '</h2>'
    + innerHtml
    + '<hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0;"/>'
    + '<p style="font-size:12px;color:#888;margin:0;">' + escapeHtml(brand)
      + ' - automated notification. Reply to this email to reach the housing team.</p>'
    + '</div>';
}

let _cachedToken: { access_token: string; expires_at: number } | null = null;
async function getGraphToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (_cachedToken && _cachedToken.expires_at - 60 > now) return _cachedToken.access_token;
  const tokenUrl = "https://login.microsoftonline.com/" + GRAPH_TENANT_ID + "/oauth2/v2.0/token";
  const body = new URLSearchParams({
    client_id: GRAPH_CLIENT_ID!, client_secret: GRAPH_CLIENT_SECRET!,
    scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials",
  });
  const r = await fetch(tokenUrl, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(),
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) throw new Error("Token endpoint " + r.status + ": " + JSON.stringify(data));
  _cachedToken = { access_token: data.access_token, expires_at: now + (data.expires_in || 3600) };
  return data.access_token;
}

async function sendViaGraph(m: EmailMessage): Promise<void> {
  const token = await getGraphToken();
  const sendUrl = "https://graph.microsoft.com/v1.0/users/" + encodeURIComponent(GRAPH_FROM_USER!) + "/sendMail";
  const graphMessage: Record<string, unknown> = {
    subject: m.subject,
    body: { contentType: "HTML", content: m.html },
    toRecipients: [{ emailAddress: { address: m.to, name: m.to_name || undefined } }],
    replyTo: [{ emailAddress: { address: m.replyTo || emailReplyTo() } }],
  };
  const r = await fetch(sendUrl, {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ message: graphMessage, saveToSentItems: true }),
  });
  if (r.status !== 202) throw new Error("Graph " + r.status + ": " + (await r.text()));
}

async function sendViaResend(m: EmailMessage): Promise<void> {
  const from = EMAIL_FROM_NAME ? (EMAIL_FROM_NAME + " <" + EMAIL_FROM + ">") : EMAIL_FROM!;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [m.to], subject: m.subject, html: m.html, reply_to: m.replyTo || emailReplyTo() }),
  });
  if (!r.ok) throw new Error("Resend " + r.status + ": " + (await r.text()));
}

async function sendViaSendgrid(m: EmailMessage): Promise<void> {
  const r = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: "Bearer " + SENDGRID_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: m.to, name: m.to_name || undefined }] }],
      from: { email: EMAIL_FROM!, name: EMAIL_FROM_NAME || undefined },
      reply_to: { email: m.replyTo || emailReplyTo() },
      subject: m.subject,
      content: [{ type: "text/html", value: m.html }],
    }),
  });
  if (r.status !== 202 && !r.ok) throw new Error("SendGrid " + r.status + ": " + (await r.text()));
}

// Send one message via the configured provider. Throws on failure.
export async function sendEmail(m: EmailMessage): Promise<void> {
  if (EMAIL_PROVIDER === "graph")         return sendViaGraph(m);
  if (EMAIL_PROVIDER === "resend")        return sendViaResend(m);
  if (EMAIL_PROVIDER === "sendgrid")      return sendViaSendgrid(m);
  throw new Error("Unknown EMAIL_PROVIDER: " + EMAIL_PROVIDER);
}

// Send to many recipients SERIALLY (Graph throttles ~4 concurrent sendMail).
// Never throws: returns how many sent so callers stay best-effort.
export async function sendEmailSerially(
  recipients: Array<{ to: string; to_name?: string }>,
  build: (r: { to: string; to_name?: string }) => { subject: string; html: string; replyTo?: string },
): Promise<number> {
  let sent = 0;
  for (const r of recipients) {
    try {
      const parts = build(r);
      await sendEmail({ to: r.to, to_name: r.to_name, subject: parts.subject, html: parts.html, replyTo: parts.replyTo });
      sent++;
    } catch (e) {
      console.warn("[email] send failed to " + r.to + ": " + (e as Error).message);
    }
  }
  return sent;
}
