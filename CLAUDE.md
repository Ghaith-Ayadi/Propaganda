# Propaganda — project root

This is a **Propaganda** working tree (personal IP, owned by Ghaith). Worktrees under
`.claude/worktrees/**` are also Propaganda — every rule here applies there too.

## 🚫 NEVER touch the user's real articles (highest-priority rule)

**NEVER edit, overwrite, empty, delete, re-title, change the status of, or run any
mutating operation on an existing article/post unless Ghaith EXPRESSLY instructs it for
that specific article.** This includes "harmless" testing, undo/redo experiments, sync
pushes, migrations, and browser-driven edits. Bedrock now takes nightly backups and
every post has a version history, but a restore is a manual, whole-database operation:
treat content as irreplaceable anyway.

- **All experimentation, test edits, and demos happen in the `Test` collection only.**
  You may freely add, modify, and delete posts whose `type = 'Test'`. Nothing else.
- Adding brand-new posts (in `Test`) is fine. Touching any post outside `Test` is not.
- Never test destructive editor behaviour (paste, undo, delete, image ops) on a real post.
  Create a throwaway post in `Test` and use that.
- Applying a schema migration (a `supabase/migrations` change deployed to the box) or any
  server-side data change that could trigger the live app's sync to overwrite local
  drafts is also off-limits without explicit go-ahead — it can silently clobber
  unsynced writing.
- If a fix seems to require touching a real article, STOP and ask first.

This rule exists because a balcony draft and other content were lost to careless edits and
a sync-unblocking migration. It overrides convenience, "just to verify", and everything else.

## Backend: self-hosted Supabase on Bedrock

Data, realtime and sign-in live on **Bedrock**
([Ghaith-Ayadi/Bedrock](https://github.com/Ghaith-Ayadi/Bedrock)), on Propaganda's own
self-hosted Supabase (`compose/propaganda-supabase`: Postgres, GoTrue, PostgREST,
Realtime). Read [supabase/README.md](supabase/README.md) and Bedrock's
[docs/apps.md](https://github.com/Ghaith-Ayadi/Bedrock/blob/main/docs/apps.md) before
touching anything that talks to the server. PocketBase ran it until 2026-10-05 (Notion
PPG-82); its schema and hooks (`pb/`) are in git history.

- One origin: `app.propaganda.pub` serves the app from Vercel and the API under
  `/auth/v1`, `/rest/v1`, `/realtime/v1` (Caddy). `VITE_SUPABASE_URL` is that host,
  `VITE_SUPABASE_ANON_KEY` the public key. Editor at `/admin`. Blogs each get their own
  host (`app/src/lib/siteUrl.ts`) and read the API cross-origin; the editor never runs on
  a blog's subdomain.
- **Multi-tenant.** Content belongs to a **site** (`sites`, `site_members` with owner/editor
  roles). Every content table has a required `site`; row-level security is keyed on it,
  and every query, pull and realtime subscription must filter by it (published posts of
  *all* sites are public). The pre-multi-tenant data is the Verbatim site, id `verbatimsite000`.
- **Sign-in: Google or an emailed one-time code** (`app/src/lib/accounts.ts`). No
  passwords. One browser holds several accounts (one Supabase client + session key per
  account); `app/src/lib/scope.ts` is the active (account, site); `components/Workspace.tsx`
  switches, signs in and onboards. Google runs in a popup that lands on `/auth/callback`
  (`app/src/lib/oauthCallback.ts`). An account's `userId` is its PocketBase id when it has
  one (`app_metadata.pb_id`), so devices keep their local databases; `authId` is the server's.
- **Ids are minted on the client** (`app/src/lib/supabase.ts` `newId()`, 15 chars of
  [a-z0-9], the shape since PocketBase). `Post.id`, `PostVersion.postId`, `Brief.postId`
  are strings. Do not reintroduce numeric ids. `posts.legacy_id` is the old Postgres
  integer, for audit only (it seeded Verbatim's post numbers).
- **Schema lives here, in `supabase/migrations`**, never in Studio. Bedrock's deploy
  checks it out on the box at the ref in Bedrock's `compose/propaganda-supabase/schema.env`
  (`main`) whenever Bedrock deploys, dumps the data first if `supabase/` changed, then
  runs `migrate`. Run `supabase/tests/run.sh` on the laptop stack before deploying any
  schema change.
- **Post numbers and addresses** (`supabase/migrations/*_addresses.sql`, `app/src/lib/slug.ts`).
  `posts.number` is a per-site counter the server hands out on insert: never reused, never
  edited, never sent by clients. A post's public address is `/<collection slug>/<post slug>`
  at the root of the site's host. The slug follows the title until the first publish, then
  changes only when edited; every move of a published post (new slug or collection) leaves a
  `post_redirects` row, and old `/p/<slug>` links forward. Collection slugs come from names.
- Toasts: `app/src/components/base/toast/toast.tsx` (shadcn's Base UI toast, ported). Use it
  for every toast; no `window.alert`.
- Sync: `app/src/lib/sync.ts` (generic push/pull per table), realtime in
  `app/src/lib/realtime.ts` (an event triggers a re-read of the row: update events leave
  out large unchanged values). One Dexie database per (account, site),
  `propaganda-<user>-<site>`; the single-tenant `verbatim-pb` is adopted, never deleted.
  A push never overwrites a row edited while it was in flight, and a new
  `public.data_epoch()` (a re-import) makes devices reconcile.
- Images: Vercel Blob through `api/upload.ts` (site members only). Never call Blob from
  the browser. Public blogs: every site at the root of its own host, `<slug>.propaganda.pub`
  or its custom domain (Verbatim: `verbatim.ayadighaith.com`), with certificates issued on
  demand once `tls_check()` says the host is a site. Old `/@<slug>/` links forward.
- Blog themes: [docs/blog-themes.md](docs/blog-themes.md). A site's `blog.design` setting
  switches its public blog from the original renderer to the themed templates; writing it
  (or `blog.themes`) on a real site is the owner's call, like any other live data.
- `scripts/src/*` are tools from the Supabase Cloud days and stop working when that
  project is deleted after 2026-10-16. `docs/archive/` is history, not instructions.

## Model calls: one logged path

Every call to a language model goes through `callModel()` in `api/_ai/gateway.ts` (Vercel AI
SDK). It checks the budget rules, runs the call, and writes a row to `public.model_calls`
(tenant, job, model, tokens, cost at API prices, DBOS workflow and step). Prices
(`model_prices`) and limits (`cost_limits`) are data. Paid APIs that aren't models (DataForSEO)
go through `callPaidApi()` in the same file: same budget rules, one row per request at the
provider's reported cost. Never call a provider directly:
`npm run check:model-paths` (in `api/`) fails on it. Limits default to off; the global daily
cap engages `cost_kill`, which only a superadmin lifts. Tenants see their month on Home
(`CostMeter`), the superadmin sees all of it in Admin > Consumption.

**Own keys (BYOK).** A tenant may save its own Anthropic key (Settings, "Your Anthropic
key", through `api/model-key.ts`; owners set or remove it). It is stored only as AES-GCM ciphertext under
`MODEL_KEY_SECRET` in `model_keys` (service role only; `api/_ai/modelKeys.ts`) and never goes
back to a browser, a log or a message. With a key saved, every `anthropic/` call for that
tenant runs on it, logged `paid_by = 'tenant'` and outside our budgets; there is never a
fallback to our account. A failed key stalls the tenant's runs (`tenantKeyOf` in
`worker/src/limits.ts`) until it works again. Which account a tenant runs on is hardcoded,
by site id, in `api/_ai/modelKeys.ts` (`accountOf`): only the tenants on Ayadi's own accounts are listed
(`private` on `ANTHROPIC_KEY_PRIVATE`, else the AI Gateway; `axoniq` on `ANTHROPIC_KEY_AXONIQ`).
Every other tenant runs on the key its owner saves, and with none its Claude calls wait.
`routeModel()` is the one place this is decided. Claude subscription
(Pro/Max) logins are never used for agents: Anthropic's terms allow API keys only for products.

## Agents: the DBOS worker

Agents run as DBOS workflows in `worker/` (one Node process on the box, `propaganda-worker`
in Bedrock's `compose/propaganda-supabase`, built from the same checkout as the schema).
DBOS keeps its tables in its own database, `propaganda_dbos`; in the app's the worker only
reads, except the Scout's own tables. Start a run with `startForTenant(site, ...)`; a model call is a `modelStep()`, which
waits out the Claude subscription's usage limit instead of failing. Admin > Runs reads the
worker's Runs API (`/worker/v1/`, superadmins only). Read `worker/README.md` before adding
a workflow: changing one that has runs in flight needs `DBOS.patch()`.
The Scout (`workflows/scout.ts`) runs weekly per tenant and writes only its own tables
(`supabase/migrations/20261008000020_scout.sql`, as role `propaganda_scout`).
DBOS keeps its tables in its own database, `propaganda_dbos`; the worker reads the app's
through a read-only pool and writes only through its functions. Start a run with `startForTenant(site, ...)`; a model call is a `modelStep()`, which
waits out the Claude subscription's usage limit instead of failing. Admin > Runs reads the
worker's Runs API (`/worker/v1/`, superadmins only). Read `worker/README.md` before adding
a workflow: changing one that has runs in flight needs `DBOS.patch()`. The knowledge base
agents (Checker, Guardian) live in `worker/src/agents/`; the KB itself is described in
`docs/knowledge-base.md`. Only the Guardian changes claims, through `kb_guardian_decide`.
The Listener (`worker/src/listener/`, `docs/listener.md`) turns call transcripts and Slack
threads into ideas and Guardian proposals; transcripts are `kb_sources` rows, private to
their tenant, and connectors never read calls from before they were connected.

## Telemetry: PostHog

Errors (browser and Vercel functions) and product analytics go to **PostHog Cloud, EU,
free plan** (hard caps, no card). The editor only: blog readers are counted by the
analytics worker, never by PostHog.

- `app/src/lib/telemetry.ts` is the only file that imports `posthog-js`. Use its `track()`
  for product events and `reportError(where, err)` wherever an error is caught and the app
  carries on (it replaces `console.error`). Uncaught errors and rejections are captured on
  their own.
- **Error codes** (`app/src/lib/errors.ts`): a failure people can see carries a stable code
  (`AUTH-EXCHANGE`, `SITE-CREATE`, ...; the list is at the top of that file, never reuse one).
  Throw `new AppError(code, sentence, cause)` or wrap with `coded()` / `withCode()`; show
  `userMessage(err)` (the sentence plus the code), and `reportError()` logs the code with the
  cause's HTTP status, PostgREST/Postgres code and message, and sends the same to PostHog.
- `api/_telemetry.ts` wraps each function (`withTelemetry`): throws and returned 5xx are
  reported before the response goes out.
- Free-plan budget: 100k exceptions a month. The client caps each distinct error at 3 per
  10 minutes and 100 per page load; keep that cap if you touch it.
- Pre-GA, nothing is masked (Ayadi, 2026-10-08): replays record the writing and every input,
  and autocapture records every click. Revisit before GA. Still don't send post content as
  an event property: it bloats events and replays already show it.
- Events go through `/ingest` on our own host (`vercel.json` rewrites, Vite proxy in dev).
  `VITE_POSTHOG_KEY` unset means telemetry is off.
- Every event and replay carries `tenant_id`, `tenant_slug` and `account_id`; filter recordings by those.

## Notion is mandatory and is part of "done"

Propaganda is tracked in **Notion**, not Plane. **Every** work session touches Notion.
A change is not complete until Notion reflects it — no matter how the work was asked for
("go", "start working on X", "just fix this", or a bare task description all count).

**Scope guard:** use the `notion-personal` MCP only, and only ever read/write within the
Propaganda page subtree (page `36c73ad5-6c72-8037-89c3-c0911798bfc2`). If a Notion call
returns anything outside that subtree, stop and flag it — don't act on it.

**Gate — before writing any code:**
1. Find the Notion task for this work.
2. **If none exists, CREATE one first** (Status `In Progress`; set Label / Module / Release),
   then start. Never run an epic with no task on the board. This is the step that keeps
   getting skipped.

**Gate — before you tell the user the work is done:**
- Smoke test the happy path.
- Write up the work in the task **page body**: what shipped, key decisions, difficulties,
  follow-ups / known edge cases / tech debt. (Light notes → a comment prefixed `🟧From Claude🟧`.)
- Move the task to `In Review`. **Never** move it to `Done` yourself — the human does that.
- **Self-check: if Notion wasn't touched this session, you are not done. Do it now.**

Full Notion structure, field definitions, and IDs live in `~/code/CLAUDE.md` →
"Notion (Propaganda only)". This file is the loud reminder; that one is the reference.
