# AI Assistant — per-nation setup

The AI chat (and draft-note) assistant is backed by the **`ai-chat` Edge
Function**, which runs on each nation's own Supabase project and reads that
project's **`ANTHROPIC_API_KEY`** secret. So every nation needs two things:

1. the `ai-chat` (and `send-notification`) functions **deployed** to its project, and
2. its **Anthropic API key** set as the `ANTHROPIC_API_KEY` secret on that project.

Fresh provisioning runs the database schema but does **not** deploy Edge
Functions, which is why a brand-new nation (e.g. the demo) shows
"failed to fetch" in AI chat — there is no function to call yet.

## 1. Deploy the nation functions to a nation's project

Use the **"Deploy Supabase Edge Functions"** GitHub workflow with a target ref:

- GitHub → Actions → **Deploy Supabase Edge Functions** → **Run workflow** →
  set **project_ref** to the nation's project ref (the `<ref>` in
  `https://<ref>.supabase.co`, shown in the admin NIC → Supabase tab) → Run.

This deploys `ai-chat`, `send-notification`, and the other nation functions to
that project. (Leaving `project_ref` blank targets the default
`SUPABASE_PROJECT_ID` secret — the lead nation.) Control-plane functions
(`provision-nation`, `report-nation-usage`, `recurring-invoices`,
`set-nation-secret`) are skipped by this workflow by design.

CLI equivalent, if you prefer:
`supabase functions deploy ai-chat --project-ref <nation-ref>`

## 2. Set the nation's Anthropic key from the admin portal

In the admin portal → open the nation → **Supabase** tab → **AI Assistant key**:
paste the nation's `sk-ant-...` key and **Save & apply to project**.

This calls the control-plane **`set-nation-secret`** function, which writes the
key straight into that nation project's `ANTHROPIC_API_KEY` secret via the
Supabase Management API. The key is **never** stored in the control plane or
sent back to the browser — only a masked marker (`...1234` + timestamp) is kept
on the nation row so the panel can show "key set".

### One-time platform setup for the key feature
- Run `supabase/platform/nation_ai_key.sql` on the platform project (adds the
  masked-marker columns).
- The `set-nation-secret` function needs the **`SB_MGMT_TOKEN`** secret on the
  platform project — the same Management API token `provision-nation` already
  uses. `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` are
  auto-injected.

## Result

Once the functions are deployed and the key is set, AI chat works for that
nation, billed to that nation's own Anthropic key. Each nation is independent —
disabling the `ai_assistant` module (Settings → Nation → Modules) hides the
assistant regardless.
