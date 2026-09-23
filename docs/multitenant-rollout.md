# Multi-tenant rollout

How to ship the multi-tenant build (schema `1758000006_multitenant.js` + the app)
without losing a word. Written for the owner; every step is yours to run.

## Why the order matters

- The **new app needs the new schema** (it reads `sites`, filters by `site`). Deployed
  first, the public blog would show "Site not found".
- The **old app keeps working on the new schema**: creates without `site` are filled
  in by `pb_hooks/tenancy.pb.js`, updates keep their site, the blog still lists
  Verbatim. Rehearsed in `pb/rehearsal/` ("old-client" checks) and in a browser: an
  edit made offline in the old app, then the server migrated, then the new app opened
  in the same browser: the edit reached the server, in Verbatim.
- So: **server first, then the app.** Merging this PR deploys the app on Vercel, so
  the server is migrated from the PR branch *before* merging.

## One-time setup on the box (Bedrock)

1. Deploy key for this repo (GitHub allows a key on one repo only):
   ```
   ssh bedrock
   ssh-keygen -t ed25519 -N "" -f ~/.ssh/propaganda_schema
   cat ~/.ssh/propaganda_schema.pub   # add as a READ-ONLY deploy key on Ghaith-Ayadi/Propaganda
   cat >> ~/.ssh/config <<'CFG'
   Host github-propaganda
     HostName github.com
     User git
     IdentityFile ~/.ssh/propaganda_schema
     IdentitiesOnly yes
   CFG
   ssh -T github-propaganda   # "successfully authenticated"
   ```
2. Email codes need SMTP in `/srv/propaganda/.env` (`PB_SMTP_HOST`, `PB_SMTP_PASSWORD`,
   …, already used by the other apps). Without it, Google sign-in still works and the
   email option returns an error.

## Rollout

1. **Sync every device.** Open the editor on each device you write on, online, and
   wait a few seconds. (Not strictly needed, since the old app keeps syncing after the
   migration, but it's the cheapest insurance there is.)
2. **Back up.** Dashboard → Settings → Backups → "Initialize new backup", and download
   it. Nightly R2 backups exist too; take a fresh one anyway.
3. **Rehearse** (optional, already done on this branch):
   `PB_BIN=~/bin/pocketbase-0.40.4 pb/rehearsal/rehearse.sh`
4. **Migrate the server from the PR branch.** Merge the Bedrock PR (it sets
   `SCHEMA_REF=claude/nice-meitner-u5cgbu` in `compose/propaganda/schema.env`), then
   `scripts/deploy.sh`. Check `docker logs pocketbase-propaganda`: the migration
   `1758000006_multitenant.js` is applied at start. If it fails, it rolls back
   entirely and the instance doesn't start: set `SCHEMA_REF=e2c7ab6` (this repo's
   schema before the migration, identical to what Bedrock had) and deploy again.
5. **Check with the old app still live:** the blog at verbatim.ayadighaith.com lists
   the same posts; the editor opens and saves. Dashboard: `sites` has Verbatim,
   `site_members` has you as owner, `posts` rows have `site = verbatimsite000`.
6. **Vercel env** (Production): add `PB_URL` (= `VITE_PB_URL`), `ANALYTICS_URL`
   (= `VITE_ANALYTICS_URL`) and `ANALYTICS_QUERY_KEY` (the worker's secret). Remove
   `VITE_ANALYTICS_QUERY_KEY` after the deploy: it's no longer read, and it was
   public in the bundle.
7. **Merge this PR.** Vercel deploys the app. Open `/admin`: you land in Verbatim with
   your drafts; your old session and local database are adopted as they are.
8. **Point the schema back at `main`**: `SCHEMA_REF=main` in Bedrock's
   `compose/propaganda/schema.env`, commit, `scripts/deploy.sh` (no restart: `pb/` is
   the same).
9. **Create the Propaganda site**: switcher (click "Verbatim" top-left) → "Add another
   account" (or "New site" to own it from the same account) → onboarding.

## If something goes wrong

- **App**: Vercel → Deployments → promote the previous deployment. The old app works on
  the migrated server (see "Why the order matters"). Once a second site exists, the
  old blog would also list that site's published posts, so don't stay there long.
- **Data**: nothing in the migration edits or deletes content. `updated` isn't bumped,
  so no device re-downloads or overwrites anything. Local databases are never deleted
  by the new app, including on sign-out.
- **Schema down-migration** (`pocketbase migrate down 1`) exists but is a last resort;
  prefer fixing forward.

## Known follow-ups

- Invites and member management (schema and rules are ready; there's no UI yet).
- Custom domains: the `domain` field is set by a superuser in the dashboard, and the
  domain also needs adding in Vercel (and Caddy, if the API should be same-origin).
- The drawn wordmark reads "Verbatim"; other sites show their name in the title face.
- `users` are only visible to themselves, so co-members will need a public profile
  (name/avatar) before a members UI can show them.
