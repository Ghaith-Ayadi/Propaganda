#!/bin/bash
# Run every suite against the laptop stack (supabase/docker-compose.yml):
# wipe its data, seed it, then access, addresses, hosts, sites and realtime.
#
#   supabase/tests/run.sh
#
# Only ever touches the laptop stack: it talks to localhost:54321 and runs SQL
# in that compose project's db container. Never point it at the box.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
COMPOSE=(docker compose -f "$HERE/../docker-compose.yml")

"${COMPOSE[@]}" ps --status running --services | grep -qx db || { echo "Start the laptop stack first."; exit 1; }
"${COMPOSE[@]}" run --rm -T migrate >/dev/null
# The suites import supabase-js from the app.
ln -sfn ../../app/node_modules "$HERE/node_modules"

"${COMPOSE[@]}" exec -T db psql -U postgres -q -v ON_ERROR_STOP=1 -c "
  truncate public.sites, public.site_members, public.posts, public.post_versions, public.collections,
    public.briefs, public.brief_templates, public.app_settings, public.writing_activity,
    public.post_redirects, private.site_internals cascade;
  delete from auth.users;"

cd "$HERE"
node seed.mjs
failed=0
for suite in access addresses hosts sites realtime; do
  echo "== $suite"
  node "$suite.mjs" || failed=1
done
# The knowledge base agents need the worker built (cd worker && npm ci && npm run build).
echo "== kb_agents"
if [ -f ../../worker/dist/main.js ]; then node kb_agents.mjs || failed=1; else echo "skipped: worker/dist missing"; fi
exit "$failed"
