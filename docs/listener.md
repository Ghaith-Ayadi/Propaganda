# The Listener

The Listener reads a tenant's calls and Slack threads. From each one it pulls
out three things:

1. **Ideas** for the Pitcher: objections, questions, weak answers, claims with
   nothing behind them, and points people disagreed on. They go into its inbox
   (`agent_ideas`, origin `calls` or `team`) and compete for the next batch's
   slots with the plan; the Listener never starts the Pitcher.
2. **Candidate facts** for the Guardian: one `kb_proposals` row per source,
   with one `kb_changes` row per fact, each quoting the exact span it came from.
3. **Who said what**: speakers with an email or a Slack id become `kb_people`.

Only the Guardian admits facts. The Listener never writes a claim. Its
proposals are left `open`, and the Guardian's dispatcher picks them up.

Code: `worker/src/listener/` (sources, extraction, storage) and
`worker/src/workflows/listener.ts` (the run). Schema:
`supabase/migrations/20261008000040_listener_connections.sql`
(`private.listener_connections`). The KB tables are the Guardian's
(`docs/knowledge-base.md`).

## How a transcript gets in

Every source ends the same way. The transcript becomes one `kb_sources` row
(kind `call`, tier 3, or kind `slack`, tier 2), private to the tenant like
every row with a `site`. Then the `listener-<source>` run reads it.

- The run's id comes from the text, so the same transcript sent twice is read
  once.
- **Transcripts never look back.** A connector only passes on calls that
  happen after the tenant connected it.
- A tenant whose agents are off (no `kb_agent_sites` row, so every Lite
  tenant) spends nothing. The source is kept, but no model is called.

The sources:

1. **Ingest URL** (`POST /worker/v1/ingest/<token>`). Anything that can POST
   can send a call: Zapier, a script, Fireflies, Otter exports.
   - Body: text (VTT, SRT, or "Name: line" text) with `?title=&occurred=&uri=`,
     or JSON `{ title, occurred, uri, participants, transcript | segments }`.
   - The token is shown once and stored only as a hash.
2. **Granola**. The tenant pastes an API key, and the worker registers a
   webhook on Granola that points back at itself. An hourly sweep catches
   anything the webhook missed.
3. **Slack**, the #1 source. The tenant installs the app and invites
   @Propaganda to channels. Being in a channel is the opt-in.
   - A thread is read once it has been quiet for 6 hours (`SLACK_QUIET_HOURS`),
     or after 3 days.
   - Threads under 280 characters are skipped.
4. **Zoom**. Zoom sends `recording.transcript_completed`, and the worker
   downloads the VTT.
5. **Microsoft Teams**. The worker keeps a Graph subscription to all new
   transcripts in the organisation, renewed every 6 hours.
6. **Google Meet**. The worker polls each connected account's conference
   records every 15 minutes.
7. **Chat**. Paste a transcript and ask the Listener to read it
   (`POST /worker/v1/agents/listener`).

## The rules the extraction follows

- Every item quotes the source word for word. An item whose quote isn't in the
  text is dropped. The check forgives case, spacing and curly quotes, and the
  span kept is the source's own text.
- Facts come only from the tenant's own people. A speaker's side is decided by
  email domain: the domains of the tenant's members (shared providers like
  gmail.com excluded) and of the site's own domain. What a prospect says
  becomes an idea, never a fact.
- A weak answer is an idea, never a fact.
- Topics are matched to the tenant's existing `kb_topics`. The Listener never
  creates one: it suggests a topic in the change's rationale.
- Each change's rationale names the nearest existing claims (from `kb_search`)
  so the Guardian can spot a duplicate or a conflict.
- At most 40 facts per source. Long transcripts are read in parts of about
  90,000 characters.

## One-time setup (Ayadi)

All of this goes in the stack's `.env` on the box
(`/srv/propaganda-supabase/.env`; the names are in Bedrock's `.env.example`).
A provider whose keys are unset is simply not offered.

1. **`LISTENER_SECRET_KEY`**: `openssl rand -base64 32`. It seals every stored
   API key and token. Never change it once connections exist.
2. **`SERVICE_ROLE_KEY`**: already in `.env`. The worker writes through
   PostgREST with it.
3. **Slack app** (api.slack.com/apps, "From scratch"):
   - Bot scopes: `channels:history`, `groups:history`, `channels:read`,
     `groups:read`, `users:read`, `users:read.email`, `team:read`.
   - Redirect URL: `https://app.propaganda.pub/worker/v1/oauth/slack/callback`.
   - Event Subscriptions: request URL
     `https://app.propaganda.pub/worker/v1/hooks/slack`; bot events
     `message.channels`, `message.groups`, `app_uninstalled`, `tokens_revoked`.
   - Turn on public distribution, so other workspaces can install it.
   - Into `.env`: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`.
4. **Zoom app** (marketplace.zoom.us, General app, user-managed):
   - Redirect URL: `https://app.propaganda.pub/worker/v1/oauth/zoom/callback`.
   - Scopes: `user:read:user`, `cloud_recording:read:list_recording_files`,
     `cloud_recording:read:recording`.
   - Event subscription: `https://app.propaganda.pub/worker/v1/hooks/zoom`,
     event "Recording transcript files have completed", and "include a
     download token" on.
   - Into `.env`: `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_WEBHOOK_SECRET`
     (the event subscription's secret token).
   - Other accounts can only install it after Zoom reviews the app. Until then
     it works on Ayadi's own account.
5. **Microsoft (Azure) app** (Entra ID > App registrations, multitenant):
   - Redirect URL: `https://app.propaganda.pub/worker/v1/oauth/teams/callback`.
   - Application permission `OnlineMeetingTranscript.Read.All`, plus
     `OnlineMeetings.Read.All` for meeting titles.
   - A client secret.
   - Into `.env`: `MS_CLIENT_ID`, `MS_CLIENT_SECRET`.
6. **Google Cloud OAuth client** (a Web application):
   - Redirect URL: `https://app.propaganda.pub/worker/v1/oauth/meet/callback`.
   - Meet REST API enabled; scope `meetings.space.readonly`.
   - Into `.env`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
   - The scope is "sensitive": outside test users, Google asks for app
     verification before other accounts can connect.

## What a tenant needs

1. **Granola**: a Business or Enterprise plan (API keys and webhooks).
2. **Slack**: someone who can install apps in the workspace, and @Propaganda
   invited to each channel worth listening to.
3. **Zoom**: a paid plan with cloud recording and "Create audio transcript" on.
4. **Teams**: transcription on, a Microsoft 365 admin to consent once, and,
   where Microsoft asks for it, an application access policy for the app.
5. **Meet**: a Workspace edition with Meet transcripts, and transcripts turned
   on in the call.

## Known limits

1. A Slack reply that arrives after its thread was read is not read.
2. A source that arrives while the tenant's agents are off stays `pending`,
   and nothing re-reads it when they're turned on.
3. Nearby claims use keyword search: the KB has no embeddings yet.
