/**
 * Cloudflare Pages Function: POST /api/lead
 *
 * Receives demo-request form submissions (including needs-check answers in
 * `message`) and emails them to you via Resend (resend.com).
 *
 * To activate:
 *   1. In the Cloudflare Pages project → Settings → Environment variables, set:
 *        RESEND_API_KEY  — API key from resend.com (free tier is fine)
 *        LEAD_TO_EMAIL   — inbox that should receive submissions
 *        LEAD_FROM_EMAIL — verified sender, e.g. leads@homelandhomes.ca
 *   2. In assets/js/main.js set SITE_CONFIG.formEndpoint = "/api/lead".
 *
 * Until configured, this returns 503 and the site's form shows its
 * "not wired up yet" notice — nothing breaks.
 */

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.RESEND_API_KEY || !env.LEAD_TO_EMAIL || !env.LEAD_FROM_EMAIL) {
    return json({ ok: false, error: "Lead endpoint not configured" }, 503);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const name = clean(data.name, 200);
  const organization = clean(data.organization, 300);
  const role = clean(data.role, 100);
  const email = clean(data.email, 200);
  const message = clean(data.message, 5000);

  if (!name || !organization || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "Missing required fields" }, 400);
  }

  const body = [
    "New demo request from the marketing site",
    "",
    "Name: " + name,
    "Nation / organization: " + organization,
    "Role: " + (role || "-"),
    "Email: " + email,
    "",
    message || "(no message)",
  ].join("\n");

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.RESEND_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Home Land Homes <" + env.LEAD_FROM_EMAIL + ">",
      to: [env.LEAD_TO_EMAIL],
      reply_to: email,
      subject: "Demo request — " + organization,
      text: body,
    }),
  });

  if (!resp.ok) {
    return json({ ok: false, error: "Email delivery failed" }, 502);
  }
  return json({ ok: true });
}

function clean(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json" },
  });
}
