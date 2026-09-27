# Handoff: Bedrock CI + multi-tenant rollout (2026-09-27)

From a cloud Claude session (no SSH, can't create repos) to a **local** session
on Ghaith's laptop (has `ssh bedrock` via the 1Password agent, and `gh`).

**Rules that still apply:** Propaganda `CLAUDE.md`. Never touch real posts, and do
test edits only in `Test` posts. Never print a secret. Ask before anything that
changes production data.

## The one blocking step (needs the laptop)

Bedrock#4 moves Someday and Shelf to "schema lives in the app's own repo". It
needs the server to have read access to the **private** Shelf repo. Someday is
public and goes over HTTPS, so it needs no key.

```sh
cd ~/code/.../Bedrock          # the local Bedrock checkout
git checkout main && git pull
git fetch origin claude/funny-clarke-kit01d-app-schemas
git show origin/claude/funny-clarke-kit01d-app-schemas:scripts/app-repo-key.sh > /tmp/app-repo-key.sh
bash /tmp/app-repo-key.sh shelf Ghaith-Ayadi/Shelf
```

- The script runs `ssh bedrock` about 3 times. Keep 1Password unlocked and approve
  the Touch ID prompts.
- It is idempotent. It creates `~/.ssh/shelf_schema` and a `github-shelf` alias on
  the box, and a read-only deploy key `bedrock-schema` on Ghaith-Ayadi/Shelf.
- It ends with "successfully authenticated".
- Make sure `gh auth status` shows **Ghaith-Ayadi** as the active account. There
  are two accounts; `gh auth switch -u Ghaith-Ayadi` if not.

Then merge https://github.com/Ghaith-Ayadi/Bedrock/pull/4 (CI is green) and
watch the `ci` workflow run on `main`. Expected:
- someday and shelf say "migrations/hooks changed … stop, archive, start". The
  first schema checkout counts as a change.
- An archive is written to `/srv/<app>/predeploy/…tar.gz`.
- Both apps report `healthy`.
- The smoke test gives 200 on all four hosts.

The migrations are byte-identical and already applied, so they are no-ops.

**If shelf is skipped** ("schema checkout failed"): the key step didn't work. Fix
it and re-run the workflow (`gh workflow run ci.yml -R Ghaith-Ayadi/Bedrock`). Do
not leave it: shelf's running container still mounts the removed `pb/shelf`.

## What is done (all merged unless noted)

**Bedrock CI/CD** (`docs/ci.md` in Bedrock):
- `.github/workflows/ci.yml`:
  - check job on every PR: shellcheck, the one-method rule, compose config,
    caddy validate, PocketBase version match, drift check of pb-check copies;
  - deploy job on push to `main`: SSH with a forced-command key
    (`scripts/ci-entry.sh` → `scripts/remote-deploy.sh`), then `scripts/smoke.sh`.
- Set up with `scripts/ci-setup.sh`; Actions secrets `BEDROCK_*` exist.
- `remote-deploy.sh`:
  - flock;
  - schema checkout per app from `compose/<app>/schema.env`;
  - if `pb/` changed: stop, archive `pb_data` (last 5 kept), start;
  - wait healthy;
  - exits non-zero on any failure.

**Schema checks in app repos:** shared `.github/workflows/pb-check.yml` in Bedrock.
- Levels:
  - L1 `node --check`;
  - L2 boot on an empty DB with PocketBase 0.40.4;
  - L3 seed the base branch's schema, upgrade, fail on lost records;
  - `pb/ci.sh` hook (Propaganda runs its rehearsal).
- Shelf (private) calls Bedrock's workflow. Someday and Propaganda (public) carry
  an exact copy, because a public repo can't call a private repo's workflow;
  Bedrock CI fails on drift.
- Tested: it fails correctly on a bad migration, a bad hook, and a
  data-deleting migration.

**Multi-tenant Propaganda (live):**
- The migration ran through CI with an archive first.
- All 206 posts are assigned to `verbatimsite000`, and anonymous visitors see
  published posts only.
- Propaganda#3 is merged. Vercel production is `52d1579`, and the previous
  production deployment `15e3743` is the rollback.
- Bedrock `schema.env` for propaganda follows `main`.

**Vercel env (project `verbatim`):**
- Added: `PB_URL` for preview, `ANALYTICS_URL` for prod and preview,
  `VITE_DEFAULT_SITE_SLUG=verbatim` for preview.

**Schema moved** to Someday and Shelf `pb/`: Someday#2 and Shelf#2 merged. The
Bedrock side is #4, pending.

## Still open after that

1. **Analytics:**
   - Set `ANALYTICS_QUERY_KEY` on Vercel (prod and preview), equal to the analytics
     Worker's secret (`verbatim-analytics`). Rotate the secret, because the old
     `VITE_ANALYTICS_QUERY_KEY` was public in the bundle.
   - Then remove `VITE_ANALYTICS_QUERY_KEY` and `VITE_ANALYTICS_TENANT` from Vercel.
   - Needs Cloudflare access. The cloud session couldn't see a Cloudflare token.
2. **Test the live app signed in:** Google sign-in at verbatim.ayadighaith.com/admin
   should land in Verbatim with the drafts. Edit a `Test` post only.
3. **Permission rules:** add `.claude/settings.json` in Propaganda and Bedrock to
   stop the auto-mode classifier blocking routine calls (curl to
   api.vercel.com / api.cloudflare.com, wrangler, gh merges and workflow runs).
   The human commits this; a session can't grant itself access.
4. **Notion:** CLAUDE.md requires a task. The multi-tenant work was waived, but
   the Bedrock CI work has no task yet.
5. **Optional:**
   - The `auth` and `settings` hooks are duplicated per app; decide whether they
     become a shared platform hooks dir.
   - Propaganda could switch its schema to HTTPS (it's public) and drop its
     deploy key.
   - The unmerged "Shame" app branch in Bedrock (`claude/jolly-turing-l7os72`)
     should start on the one method.

## Gotchas seen today

- **1Password SSH agent silently refused** after one approval ("Permission denied
  (publickey)" while `ssh -v` showed "Server accepts key"). Fix: lock and unlock
  1Password.
- **fail2ban** on the box bans an IP for 1h after 5 failed logins in 10 minutes.
- **The laptop terminal was on the wrong GitHub account:** "Repository not
  found". Fix with `gh auth switch` and `gh auth setup-git`.
