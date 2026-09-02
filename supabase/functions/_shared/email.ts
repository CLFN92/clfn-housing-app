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

const EMAIL_BRAND_COLOR   = Deno.env.get("EMAIL_BRAND_COLOR");    // optional per-nation header color (hex)
const EMAIL_CONTACT_LINE  = Deno.env.get("EMAIL_CONTACT_LINE");   // optional footer contact line

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

// Only allow auth-link redirects back to our own hosts (defense in depth;
// GoTrue additionally enforces the dashboard Redirect URLs allowlist when
// minting the link). One definition shared by every link-sending function --
// a bare ^https?:// check accepts arbitrary attacker hosts.
export function isSafeRedirect(u: string): boolean {
  try {
    const url = new URL(u);
    const h = url.hostname;
    const localOk = (h === "localhost" || h === "127.0.0.1");
    if (url.protocol !== "https:" && !localOk) return false;
    return h === "fnhub.app" || h.endsWith(".fnhub.app") || localOk;
  } catch { return false; }
}

// Black or white text, whichever reads on the given background (mirrors
// send-notification's readableTextColor).
function readableTextColor(hex: string): string {
  const m = String(hex || "").trim().match(/^#?([0-9a-fA-F]{6})$/);
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 150 ? "#111827" : "#ffffff";
}

// Wrap inner content in the SAME nation-branded shell send-notification uses
// (header bar in the nation color, card body, footer with the contact line) --
// so emails sent by the public functions (applicant confirmation, tenant
// maintenance intake, password reset) look identical to every other app
// email. Branding comes from per-nation secrets: EMAIL_BRAND (name),
// EMAIL_BRAND_COLOR (header hex, optional) and EMAIL_CONTACT_LINE (optional);
// safe neutral fallbacks keep it working where those are not set.
export function renderBrandedEmail(subject: string, innerHtml: string): string {
  const name = escapeHtml(emailBrand());
  const bgRaw = String(EMAIL_BRAND_COLOR || "").trim();
  const bg = /^#[0-9a-fA-F]{6}$/.test(bgRaw) ? bgRaw : "#1f2937";
  const onBrand = readableTextColor(bg);
  const contact = EMAIL_CONTACT_LINE ? (escapeHtml(EMAIL_CONTACT_LINE) + "<br/>") : "";
  return '' +
'<!doctype html><html><head><meta charset="utf-8"/>' +
'<meta name="viewport" content="width=device-width,initial-scale=1"/></head>' +
'<body style="margin:0;padding:0;background:#f4f5f7;">' +
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;">' +
'<tr><td align="center" style="padding:24px 12px;">' +
'<table role="presentation" cellpadding="0" cellspacing="0" width="600" style="width:600px;max-width:100%;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">' +
'<tr><td style="background:' + bg + ';padding:18px 28px;">' +
'<span style="font-size:16px;font-weight:700;letter-spacing:.2px;color:' + onBrand + ';">' + name + '</span>' +
'</td></tr>' +
'<tr><td style="padding:26px 28px 8px;">' +
'<h1 style="font-size:19px;line-height:1.3;margin:0 0 16px;color:#111827;font-weight:700;">' + escapeHtml(subject) + '</h1>' +
'<div style="font-size:14px;line-height:1.65;color:#374151;">' + innerHtml + '</div>' +
'</td></tr>' +
'<tr><td style="padding:18px 28px 22px;background:#f9fafb;border-top:1px solid #e5e7eb;">' +
'<div style="font-size:12px;line-height:1.6;color:#6b7280;">' +
'<strong style="color:#374151;">' + name + '</strong><br/>' + contact +
'This is an automated notification. Reply to this email to reach the housing team.' +
'</div></td></tr>' +
'</table></td></tr></table></body></html>';
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
