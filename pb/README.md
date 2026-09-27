# Propaganda on PocketBase

The schema (`pb_migrations/`) and server hooks (`pb_hooks/`) of Propaganda's PocketBase
instance on Bedrock. They moved here from the Bedrock repo (`pb/propaganda/`) with
multi-tenancy, so a schema change and the app change that needs it ship together.

- **Deploy**: Bedrock's `scripts/deploy.sh` keeps a checkout of this repo on the box
  (`/srv/propaganda/schema`) at the ref in Bedrock's `compose/propaganda/schema.env`, and
  restarts the instance when `pb/` changed. PocketBase applies new migrations on start,
  each in a transaction; a failing migration keeps the instance from starting and changes
  nothing.
- **Rehearse first**: `pb/rehearsal/rehearse.sh` replays the migrations on a throwaway
  instance with seeded data and runs the access-rule suite.
- **Never** edit collections in the dashboard on production (`--automigrate=false`).

| Hook | What |
|---|---|
| `auth.pb.js` | Sign-in policy from env: Google, emailed one-time codes (when SMTP is set), 90-day sessions |
| `settings.pb.js` | Instance settings from env (SMTP, backups, trusted proxy) |
| `sites.pb.js` | `POST /api/propaganda/sites`, `PATCH /api/propaganda/sites/{id}` |
| `tenancy.pb.js` | Fills `site` on creates from pre-multi-tenant clients; versions stay in their post's site |
| `writing_activity.pb.js` | `POST /api/verbose/increment`, per site |
