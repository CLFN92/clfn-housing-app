# Platform support login ("Enter nation")

Lets a **platform super-admin** open a signed-in support session on any nation's
app — for troubleshooting — without holding a nation-domain staff account.
Implements SUPER-ADMIN-PLAN §12.3 (option **b**: a nation-side function that
trusts the control plane).

## How it works

```
Admin panel (super-admin JWT)
   -> enter-nation           [platform project, JWT-verified]
        -> support-login     [nation project, --no-verify-jwt, gated by SUPPORT_LOGIN_SECRET]
             - honors the nation's opt-out (housing_settings.support_login_enabled)
             - ensures an ACTIVE, magic-link-enabled, super_user "Platform Support" staff row
               (access_expires_at = today, so the grant lapses on its own)
             - mints a one-time Supabase magic link back to <sub>.fnhub.app
             - writes housing_audit_log: support_session_started
        <- action_link
   -> browser opens the link -> lands signed in as Platform Support
   platform_audit: entered_nation
```

The **shared secret never reaches the browser**: the admin panel calls
`enter-nation` with the operator's platform JWT; `enter-nation` (server-side)
forwards `SUPPORT_LOGIN_SECRET` to the nation's `support-login`.

Access is **full super_user** (ED tier) — guarded by: the nation's opt-out, a
same-day expiry on the staff row, a one-time short-lived magic link, and an audit
row on **both** the control plane (`entered_nation`) and the nation
(`support_session_started`, actor = the operator's email).

## One-time setup

1. **Choose a strong secret** (e.g. `openssl rand -hex 32`). Call it
   `SUPPORT_LOGIN_SECRET`. Use the **same value** on the platform project and on
   every nation project.

2. **Platform project** (fnhub-platform) -> Settings -> Edge Functions -> Secrets:
   - `SUPPORT_LOGIN_SECRET = <value>`

3. **Each nation project** -> Settings -> Edge Functions -> Secrets:
   - `SUPPORT_LOGIN_SECRET = <value>`  (same value)

4. **Deploy the functions** (CI does this on push to `main`):
   - `enter-nation` -> platform project (JWT verify ON) via
     `.github/workflows/deploy-platform-functions.yml`
   - `support-login` -> each nation project (`--no-verify-jwt`) via
     `.github/workflows/deploy-supabase-functions.yml` (use the `project_ref`
     input, or `supabase functions deploy support-login --project-ref <ref> --no-verify-jwt`)

5. **Redirect URL allowlist:** each nation project's Auth settings must allow a
   redirect to `https://<sub>.fnhub.app/` (Site URL or an added Redirect URL),
   or GoTrue will drop the redirect after the magic-link verify.

## Using it

In the admin panel's **Registered nations** table, click **Enter** next to a
provisioned nation. Confirm the dialog; a new tab opens already signed in as
**Platform Support**. The entry is logged both sides.

## Nation opt-out (OCAP consent)

A nation's ED can refuse platform support login: **Settings -> Admin -> Config ->
Platform Support Access -> Allow platform support login** (off). When off,
`support-login` returns `support_disabled` and the admin panel shows a message
telling the operator to ask the nation to re-enable it. Default is **on**.

## Security notes / future hardening

- The secret is **platform-wide** in this version. Per-nation secrets (or a
  signed short-lived token instead of a shared secret) would limit blast radius
  if the value leaked — a good next hardening step.
- Expiry is **date-granular** (end of day) because `staff.access_expires_at` is a
  date. The one-time magic link and the audited, opt-out-gated entry flow are the
  tighter bounds; revoke early by toggling the nation's opt-off or deactivating
  the "Platform Support" staff row.
- Never expose `SUPPORT_LOGIN_SECRET` to any client. It lives only in Edge
  Function secrets.
