# Arena

The Arena puts the same real agent task to two to four models, shows the answers blind, and records which one won and what each cost. It is its own app in `arena/`, deployed on its own, so it never waits for a numbered product release.

## What it shares with the product

1. The sign-in accounts. It uses the same Supabase auth: Google (a redirect that comes back to the Arena) and, when the server can send mail, an emailed one-time code. Only superadmins can run a round or read votes.
2. The worker. A round runs in the product's worker (`worker/src/arena.ts`, `POST /worker/v1/arena`), so the prompts are production's own. A prompt change in a release is what the next round tests.
3. The tables. Votes go to `public.arena_votes`; every call is in `model_calls` as `arena:<agent>`.
4. The theme tokens, imported from `app/src/styles`.

Nothing else is shared. The Arena has no product code in it and the product Admin has no Arena page.

## What ships when

1. Changes under `arena/` deploy on merge to `main` (`.github/workflows/deploy-arena.yml`), to the Arena's own Vercel project.
2. Worker changes to `arena.ts` still reach the box with the product (the box follows the release tag). A new Arena feature that needs a worker change waits for a release; page-only changes do not.
3. Models and defaults live in the page (`arena/src/ArenaPage.tsx`), so trying a new model needs no release.

## One-time setup

1. Create a Vercel project for `arena/` with Root Directory left empty and Git integration off, and add the `VERCEL_ARENA_PROJECT_ID` repo secret (the token and org id are the product's).
2. Point `arena.propaganda.pub` at it.
3. Add `https://arena.propaganda.pub/**` to the auth server's redirect allow list (`GOTRUE_URI_ALLOW_LIST` in Bedrock's `compose/propaganda-supabase/docker-compose.yml`), or Google sign-in lands on the product instead.
4. Build env on that project: `VITE_SUPABASE_URL=https://arena.propaganda.pub` (same origin, so no CORS) and `VITE_SUPABASE_ANON_KEY` (the product's public key). `vercel.json` rewrites `/auth/v1`, `/rest/v1` and `/worker/v1` to `app.propaganda.pub`.

## Local

`cd arena && npm install && npm run dev` serves on 5174 and proxies the same three paths to `ARENA_BACKEND` (default `https://app.dev.propaganda.pub`). Set `VITE_SUPABASE_ANON_KEY` for that host.

## Writing rounds

A writing round (Ayadi, 2026-10-14) is five pieces. Each piece is one of the tenant's approved briefs, written in full by every rival (default GPT-6.1 Sol, Qwen3.8 Max, DeepSeek V4 Pro, Opus 5.5) with the Writer's own system prompt and draft prompt, minus the web research and reviewer edits so the input is identical. The page shows the four drafts as A to D in a shuffled order with no model names; the names and costs appear after the vote, then the next piece starts. Nothing is saved as a post. Each piece's call is capped by `ARENA_WRITER_ROUND_CAP_USD` (default 2).

## Which tenants

A round reads only Ayadi's own tenants, found by site slug (`ARENA_TENANT_SLUGS`, default `verbatim,ppgd`), so a tenant that signs up again keeps working. `ARENA_TENANTS` adds ids.
