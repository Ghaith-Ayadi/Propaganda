# Notion handoff (2026-09-28)

Written by a session that could not reach `notion-personal` (not authorized). The next
session: authorize it, fetch the Tasks board, then apply this. "Rebase" the board: merge
duplicates into the tasks below, close stale ones as Cancelled with a one-line reason, and
never move anything to Done (Ghaith does that). Delete this file when applied.

## Shipped this session (create or update each, Status: In Review)

### 1. Multi-tenant rollout: close out
Label feature · Module Multi-tenant · Release 1.0
- Live since 2026-09-27 (Propaganda #3, Bedrock #1/#3). Migration ran via Bedrock CI with a
  pb_data archive; all posts on `verbatimsite000`; Vercel env partly set.
- Notion workflow was waived for this rollout; this task records it after the fact.
- Follow-ups split out below (invites UI, custom domains, per-site wordmark, public profiles).

### 2. Rotate the analytics query key
Label chore · Module Analytics
- New key generated locally (never printed/stored), set as Vercel `ANALYTICS_QUERY_KEY`
  (sensitive, prod + preview) and as the `verbatim-analytics` Worker secret. Old key (public
  in old bundles) now rejected. Removed `VITE_ANALYTICS_QUERY_KEY`, `VITE_ANALYTICS_TENANT`.
  Production redeployed from the same commit.
- Tooling: tokens live in `~/.bedrock/bedrock.env`; local Vercel CLI login is dead.
- Not verified: dashboard with real numbers (needs a signed-in check).

### 3. Google sign-in hung: service worker hijacked the OAuth callback (PR #6)
Label bug · Module Auth
- `navigateFallback` served the app shell for every navigation, including
  `/api/oauth2-redirect`, since PocketBase shares the origin. Added
  `navigateFallbackDenylist` for `/api/` and `/_/`.
- Each browser needs one reload to pick up the new worker (seen again on a second profile).

### 4. Sign-in card, Google popup hang, onboarding Sign out (PR #7)
Label bug + feature · Module Auth
- Centered wordmark, full-width buttons, Google G, "Signing in creates your account" note,
  phone width. Email-code option hidden unless the server has OTP (SMTP) on: it created
  junk accounts before.
- Blocked popup reports at once; closed popup cancels the SDK's realtime wait (2.5s grace,
  checks the SDK's abort handler so an in-flight code exchange still completes).
- Sign out on the onboarding card did nothing for accounts without an open site; fixed.

### 5. Post numbers, /collection/slug addresses, redirects, toasts (PRs #8 schema, #9 app)
Label feature · Module Editor + Blog
- `posts.number`: per-site counter, server-assigned, never reused/edited. Verbatim kept its
  Postgres ids (1 to 387, gaps from deletions). Devices backfill numbers via an id->number
  fetch (migration did not bump `updated`, on purpose).
- Address `/<collection slug>/<post slug>`: slug follows the title until first publish, then
  fixed, deduped per collection (`-2`). Editable after publish; every move leaves a
  `post_redirects` row, listed (removable) under the Slug field. Collection slugs from names,
  follow renames. Old `/p/<slug>` links forward. Mentions insert the new address.
- Collection rename now in place (posts first); auto-create paused mid-rename (it created a
  duplicate record, caught in testing).
- Toast: shadcn Base UI toast ported (`components/base/toast/toast.tsx`), publish toast,
  alerts replaced. Added `@base-ui/react` 1.8.
- Tested: 83 rehearsal checks (local + CI), full e2e against a local PocketBase. Deployed
  2026-09-28: live data verified (206 published posts numbered, 7 collection slugs).
- Rehearsal fix: `rules.mjs` now fails CI on a failed check (it only printed before).

### 6. Bedrock CI + schema-in-app-repo (done by earlier sessions, no task existed)
Label chore · Module Infra
- Bedrock CI deploys every app on merge to main, archives pb_data when `pb/` changes;
  pb-check on every app PR; Shelf deploy key; Timber app added.

## Backlog (create as Backlog unless an equivalent exists)
- Server-side 301s for old URLs (`/p/…`, redirects) via Vercel or Caddy; today they are
  client-side, slower for search engines. (feature, Blog)
- SMTP for email sign-in codes (`PB_SMTP_*` on the box); the option reappears by itself. (chore, Auth)
- Publish the Google OAuth consent screen (or add test users) so others can sign up. (chore, Auth)
- Invites and members UI (schema ready). (feature, Multi-tenant)
- Custom domains per site (superuser field + Vercel + Caddy today). (feature, Multi-tenant)
- Per-site wordmark (drawn one reads "Verbatim"). (feature, Blog)
- Public user profiles for co-members. (feature, Multi-tenant)
- Analytics keyed by slug: a renamed slug splits its history; key by post id/number. (bug, Analytics)
- Onboarding card: "Sign out" wraps when Cancel shows. (bug, Auth)
- `.claude/settings.json` permission rules (gh merge/workflow run, Vercel/Cloudflare API)
  so sessions stop getting blocked. (chore, Infra)
- Supabase project deleted after 2026-10-16; `scripts/src/*` die with it. (chore, Infra)
- `analytics-engagement` branch (June, T2 to T4) needs porting to PocketBase + site scoping
  or closing. (idea, Analytics)
- Housekeeping: local `main` checkout is far behind with uncommitted edits; worktrees
  `fix-oauth-sw`, `auth-screen`, `post-addresses`, `docs-bedrock` are merged and removable. (chore, Infra)
