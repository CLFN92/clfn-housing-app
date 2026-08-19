# Platform support login ("Enter nation")

Lets a **platform super-admin** open a signed-in support session on any nation's
app — for troubleshooting — without holding a nation-domain staff account.
Implements SUPER-ADMIN-PLAN §12.3 with **per-nation asymmetric signing** (no
shared secret) plus an **ED notification** on every entry.

## How it works

```
Admin panel (super-admin JWT)
   -> enter-nation           [platform project, JWT-verified]
        - reads the nation's PRIVATE key from nation_support_keys (control plane only)
        - signs a 2-minute ES256 token: { sub, op(erator), rt(redirect), iat, exp, jti }
        -> support-login      [nation project, --no-verify-jwt]
             - verifies the token with SUPPORT_LOGIN_PUBKEY (the nation's PUBLIC key)
             - honors the nation's opt-out (housing_settings.support_login_enabled)
             - ensures an ACTIVE, magic-link, super_user "Platform Support" staff row
               (access_expires_at = today)
             - mints a one-time Supabase magic link back to <sub>.fnhub.app
             - writes housing_audit_log: support_session_started
             - best-effort: emails the nation's ED(s) via the nation's own provider
        <- action_link
   -> browser opens the link -> lands signed in as Platform Support
   platform_audit: entered_nation
```

**Trust model — asymmetric, per nation.** Each nation has its own ES256 keypair.
The **private** key lives ONLY in the control-plane DB (`nation_support_keys`);
the nation holds ONLY its **public** key (`SUPPORT_LOGIN_PUBKEY`). Because the
nation can only *verify*, a stolen public key can't forge a login, and there is
**no shared secret** whose leak would expose every nation. The operator email and
redirect target ride inside the **signed** claims, so they can't be tampered.

Access is **full super_user** (ED tier), guarded by: the nation's opt-out, a
same-day expiry, a one-time short-lived magic link, a 2-minute signed token, an
audit row on **both** sides, and an **email to the nation's ED** on every entry.

## One-time platform setup

1. Run **`supabase/platform/nation_support_keys.sql`** in the platform project's
   SQL Editor (creates the key table + a public-only view).
2. Deploy the functions (CI, on push to `main`):
   - `enter-nation` + `gen-support-key` -> platform project (JWT verify ON)
   - `support-login` -> each nation project (`--no-verify-jwt`)

## Per-nation setup (once each)

1. In the admin panel: **Configure -> Supabase -> Support login key -> Generate
   keypair**. The private key is stored on the control plane; the public key is
   shown (locked) with a **Copy** button.
2. Paste that public key into the nation project -> Settings -> Edge Functions ->
   Secrets as **`SUPPORT_LOGIN_PUBKEY`**.
3. Deploy `support-login` to that nation project (nation-functions workflow with
   the `project_ref` input, or
   `supabase functions deploy support-login --project-ref <ref> --no-verify-jwt`).
4. Allow a redirect to `https://<sub>.fnhub.app/` in the nation project's Auth
   settings (Site URL or an added Redirect URL).

**No shared secret** to distribute or rotate globally. Rotate a single nation's
key anytime from the Supabase tab (**Rotate key**) — it locks the old key until
you re-copy the new public key and redeploy `support-login` for that nation.

## Using it

In **Registered nations**, click **Enter** next to a provisioned nation, confirm
the dialog, and a new tab opens signed in as **Platform Support**. The entry is
logged both sides and the nation's ED is emailed.

## Nation opt-out (OCAP consent)

A nation's ED can refuse platform support login: **Settings -> Admin -> Config ->
Platform Support Access -> Allow platform support login** (off). When off,
`support-login` returns `support_disabled`. Default is on.

## Email notification

The ED email is sent by `support-login` **on the nation project**, using that
nation's own email provider (the same `EMAIL_PROVIDER`/`GRAPH_*`/`RESEND_*`
secrets `send-notification` uses). The **control plane needs no email setup**. If
a nation hasn't configured email, the notification is silently skipped — the
entry is still audited on both sides.

## Remaining hardening ideas

- **Sub-day expiry.** `staff.access_expires_at` is a DATE, so the staff grant
  lasts to end-of-day; the 2-minute token + one-time magic link are the tight
  bounds. A timestamp-based expiry (or auto-deactivating the row after N minutes)
  would tighten it.
- **Replay tracking.** The token carries a `jti`; a used-jti store would harden
  against replay within the 2-minute window (short exp already limits it).
- **MFA on the platform super-admin** account — the whole feature is gated by
  that login.
