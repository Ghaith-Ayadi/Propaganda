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
- Applying a schema migration (a `pb/pb_migrations` change deployed to the box) or any
  server-side data change that could trigger the live app's sync to overwrite local
  drafts is also off-limits without explicit go-ahead — it can silently clobber
  unsynced writing.
- If a fix seems to require touching a real article, STOP and ask first.

This rule exists because a balcony draft and other content were lost to careless edits and
a sync-unblocking migration. It overrides convenience, "just to verify", and everything else.

## Backend: PocketBase on Bedrock

Data, realtime and sign-in live on **Bedrock**
([Ghaith-Ayadi/Bedrock](https://github.com/Ghaith-Ayadi/Bedrock)), on Propaganda's own
PocketBase instance. Read
[docs/apps.md](https://github.com/Ghaith-Ayadi/Bedrock/blob/main/docs/apps.md) there
before touching anything that talks to the server.

- One origin: `verbatim.ayadighaith.com` serves the app from Vercel and PocketBase under
  `/api/*` and `/_/` (dashboard). `VITE_PB_URL` is that host. Editor at `/admin`.
  The editor and API are moving to `app.propaganda.pub`; blogs each get their own host
  (`app/src/lib/siteUrl.ts`), and the editor never runs on a blog's subdomain.
- **Multi-tenant.** Content belongs to a **site** (`sites`, `site_members` with owner/editor
  roles). Every content collection has a required `site` relation; every query, pull and
  realtime subscription must filter by it (published posts of *all* sites are public).
  The pre-multi-tenant data is the Verbatim site, id `verbatimsite000`.
- **Sign-in: Google or an emailed one-time code** (`app/src/lib/accounts.ts`). No
  passwords. One browser holds several accounts (one PocketBase client + session key per
  account); `app/src/lib/scope.ts` is the active (account, site); `components/Workspace.tsx`
  switches, signs in and onboards.
- **Ids are PocketBase record ids minted on the client** (`app/src/lib/pocketbase.ts`
  `newId()`). `Post.id`, `PostVersion.postId`, `Brief.postId` are strings. There is no
  temp-id swap any more; do not reintroduce numeric ids. `posts.legacy_id` is the old
  Postgres integer, for audit only (it seeded Verbatim's post numbers).
- **Schema lives here, in `pb/`** (`pb/pb_migrations/*.js`, `pb/pb_hooks/`), never in the
  dashboard. Bedrock's CI deploy checks it out on the box at the ref in Bedrock's
  `compose/propaganda/schema.env` (`main`) whenever Bedrock deploys (a merge to its
  `main`, or its `ci` workflow run by hand), archiving `pb_data` first if `pb/` changed. Rehearse every schema change with
  `pb/rehearsal/rehearse.sh` before deploying.
- **Post numbers and addresses** (`pb/pb_hooks/addresses.pb.js`, `app/src/lib/slug.ts`).
  `posts.number` is a per-site counter the server hands out on create: never reused, never
  edited, never sent by clients. A post's public address is `/<collection slug>/<post slug>`
  at the root of the site's host. The slug follows the title until the first publish, then
  changes only when edited; every move of a published post (new slug or collection) leaves a
  `post_redirects` row, and old `/p/<slug>` links forward. Collection slugs come from names.
- Toasts: `app/src/components/base/toast/toast.tsx` (shadcn's Base UI toast, ported). Use it
  for every toast; no `window.alert`.
- Sync: `app/src/lib/sync.ts` (generic push/pull per table), realtime in
  `app/src/lib/realtime.ts`. One Dexie database per (account, site),
  `propaganda-<user>-<site>`; the single-tenant `verbatim-pb` is adopted, never deleted.
- Images: Vercel Blob through `api/upload.ts` (site members only). Never call Blob from
  the browser. Public blogs: every site at the root of its own host, `<slug>.propaganda.pub`
  or its custom domain (Verbatim: `verbatim.ayadighaith.com`), with certificates issued on
  demand once `pb_hooks/hosts.pb.js` says the host is a site. Old `/@<slug>/` links forward.
- `scripts/src/*` are Supabase-era tools and stop working when the Supabase project is
  deleted after 2026-10-16. `docs/archive/` is history, not instructions.

## Telemetry: PostHog

Errors (browser and Vercel functions) and product analytics go to **PostHog Cloud, EU,
free plan** (hard caps, no card). The editor only: blog readers are counted by the
analytics worker, never by PostHog.

- `app/src/lib/telemetry.ts` is the only file that imports `posthog-js`. Use its `track()`
  for product events and `reportError(where, err)` wherever an error is caught and the app
  carries on (it replaces `console.error`). Uncaught errors and rejections are captured on
  their own.
- `api/_telemetry.ts` wraps each function (`withTelemetry`): throws and returned 5xx are
  reported before the response goes out.
- Free-plan budget: 100k exceptions a month. The client caps each distinct error at 3 per
  10 minutes and 100 per page load; keep that cap if you touch it.
- The writing stays private: replays mask `.bn-container`, autocapture only records clicks
  on controls. Never send post content as an event property.
- Events go through `/ingest` on our own host (`vercel.json` rewrites, Vite proxy in dev).
  `VITE_POSTHOG_KEY` unset means telemetry is off.

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
