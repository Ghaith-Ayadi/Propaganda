# Propaganda on Supabase (self-hosted)

The backend: Postgres, Auth (GoTrue), PostgREST and Realtime, self-hosted on
Bedrock (`Ghaith-Ayadi/Bedrock`, `compose/propaganda-supabase`). It replaced
Propaganda's PocketBase on 2026-10-05 (Notion PPG-82); the PocketBase schema and
hooks (`pb/`) are in git history, its final data in R2
`bedrock-dumps/propaganda-pocketbase-final-*.tar.gz`.

| Path | What |
|---|---|
| `migrations/*.sql` | The schema. Applied in name order by `migrate.sh`, each in a transaction, recorded in `supabase_migrations.schema_migrations` (the Supabase CLI's table, so Supabase Cloud can take over at GA) |
| `docker-compose.yml` | The stack on the laptop: same images and routing as the box, throwaway data |
| `Caddyfile.local` | The laptop gateway: what Caddy does on the box (path routing, CORS) |
| `templates/` | The sign-in code email, served to GoTrue inside the stack |
| `tests/` | The PocketBase rehearsal suites, ported: access, addresses, hosts, sites, realtime |
| `import/pb_to_pg.py` | PocketBase to Postgres: export, load, verify |
| `backup.sh` | Nightly `pg_dump` to R2; also Bedrock's pre-migration archive |
| `keys.mjs` | Fresh secrets (JWT secret, anon and service keys, passwords) |

## How PocketBase maps

- **Ids** are the same 15-char strings, minted on the client (`app/src/lib/supabase.ts`
  `newId`). Rows keep their ids through the import; only users get new ones
  (GoTrue's uuids), with the PocketBase id kept as `app_metadata.pb_id`, which
  the app uses to name its local databases, so every device opens the same
  Dexie database (drafts included) after the move.
- **Empty values** stay `""` and `0`; empty dates are `NULL`.
- **Rules** are row-level security keyed on `site` (`20261002000003_access.sql`).
- **Hooks** are triggers (numbers, slugs, redirects, a version's site) and
  functions called through `rpc()`: `create_site`, `update_site`,
  `delete_site`, `increment_writing_activity`, `tls_check` (Caddy's on-demand
  TLS check, asked straight from PostgREST).
- **Realtime** events only say which row changed; the app reads the row again
  (an update event leaves out a large unchanged value, e.g. a post's body).
  Deletes arrive unfiltered, by id.
- **Sign-in**: Google (popup, PKCE; the popup lands on `/auth/callback`) and
  emailed six-digit codes once SMTP is set. Sessions renew themselves.
- **Files** stay on Vercel Blob (`api/upload.ts`): no Storage service.

## On the laptop

```
node supabase/keys.mjs > supabase/.env
docker compose -f supabase/docker-compose.yml up -d
supabase/tests/run.sh                     # wipes the laptop stack's data first
```

API at `http://localhost:54321`, email codes in Mailpit at
`http://localhost:54324`, Studio with `--profile studio` at
`http://localhost:54323`. The app against it: `.env.local` at the repo root
with `VITE_SUPABASE_URL=http://localhost:54321` and `VITE_SUPABASE_ANON_KEY`
from `supabase/.env`.

A new migration: add `migrations/<yyyymmddhhmmss>_<name>.sql`, then
`docker compose -f supabase/docker-compose.yml run --rm migrate` and
`supabase/tests/run.sh`. On the box it applies on the next Bedrock deploy, after
an archive of the data.

## The import

```
python3 import/pb_to_pg.py export > snapshot.json     # PocketBase, read only
python3 import/pb_to_pg.py load snapshot.json         # replaces Postgres content, one transaction
python3 import/pb_to_pg.py verify snapshot.json       # every row, every field
```

Repeatable until `private.import_lock` has a row (the cutover). Each load bumps
`public.data_epoch()`, and the app re-reads its site from scratch when the epoch
it last synced against changed (unsynced edits are pushed first and never
dropped). Run loads with the editor closed. On the box, see the cutover below.

## Cutover (done 2026-10-05, kept as the record)

Before: the stack is up on the box with a verified rehearsal load; the Google
OAuth client has the redirect URI `https://app.propaganda.pub/auth/v1/callback`;
Vercel has `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (all environments);
the app PR's preview deployment passed the smoke test against the box; a
manual backup reached R2.

1. Every device: let the editor sync, then close it.
2. Freeze PocketBase: Bedrock PR that makes Caddy refuse writes to
   `/api/collections/*` on `app.propaganda.pub` (reads still work, so the old
   build shows everything). No PocketBase data changes.
3. On the box, with the Supabase stack's env: `export`, `load`, `verify` must
   print `VERIFY: ALL IDENTICAL`. Keep the snapshot. Then
   `insert into private.import_lock (note) values ('cutover <date>');`.
4. Bedrock PR: Caddy's `on_demand_tls ask` to
   `http://propaganda-rest:3000/rpc/tls_check`.
5. Merge the app PR: Vercel builds production against Supabase.
6. Smoke test: Google sign-in; open and edit a `Test` post (save, version
   history, restore); collections, addresses, redirects; briefs; settings;
   switch sites; blogs on `verbatim.ayadighaith.com` and a
   `<slug>.propaganda.pub`; image upload; analytics; offline open.
7. Each device: sign in again with Google. The account finds its local
   database through `pb_id`; anything unsynced is pushed.

**Rollback**, until Ghaith confirms: promote the previous production
deployment in Vercel, lift the freeze, point the TLS check back. PocketBase is
exactly as it was at the freeze. Edits made meanwhile: those still unsynced on
a device go to PocketBase by themselves (same local database, still dirty); the
rest are listed by
`select id, title, updated from posts where updated > '<cutover time>'` and
copied by hand. A second cutover later: delete the lock row and run the
import again; the epoch bump makes every device reconcile.

Ghaith confirmed on 2026-10-05; `compose/propaganda` (PocketBase) and `pb/`
were retired the same day, so the rollback above no longer applies.

## Backups

`backup.sh nightly` in the stack's `backup` service: at 03:40 UTC a data dump
(public, private and auth schemas, custom format) to the R2 bucket
`bedrock-backups-propaganda-db`, 30-day lifecycle. Restore recipe in Bedrock
`docs/restore.md`: a fresh stack at the same migrations, then
`pg_restore --data-only --disable-triggers --single-transaction`. Rehearsed:
a restored copy verified identical, row for row, to the PocketBase export.
