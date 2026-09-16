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
- Applying a schema migration (a `pb_migrations` change in the Bedrock repo) or any
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
- **Sign-in is Google only** (`app/src/lib/auth.ts`). No passwords, no email codes.
- **Ids are PocketBase record ids minted on the client** (`app/src/lib/pocketbase.ts`
  `newId()`). `Post.id`, `PostVersion.postId`, `Brief.postId` are strings. There is no
  temp-id swap any more; do not reintroduce numeric ids. `posts.legacy_id` is the old
  Postgres integer, for audit only.
- **Schema is not edited here or in the dashboard.** It is `pb/propaganda/pb_migrations/*.js`
  in the Bedrock repo, deployed with its `scripts/deploy.sh`. Server logic
  (the writing-activity increment) is `pb/propaganda/pb_hooks/`.
- Sync: `app/src/lib/sync.ts` (generic push/pull per table), realtime in
  `app/src/lib/realtime.ts`. Dexie database is `verbatim-pb`.
- Images: Vercel Blob through `api/upload.ts`. Never call Blob from the browser.
- `scripts/src/*` are Supabase-era tools and stop working when the Supabase project is
  deleted after 2026-10-16. `docs/archive/` is history, not instructions.

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
