#!/bin/bash
# Rehearse the schema on a throwaway PocketBase: build a pre-multi-tenant
# instance from the migrations before 1758000006, seed it (seed.mjs), snapshot
# every row, apply the current pb/ (migrations + hooks), snapshot again and
# compare, then run the access-rule suite (rules.mjs) and the post-address
# suite (addresses.mjs: numbers, collection slugs, redirects).
#
#   PB_BIN=/path/to/pocketbase-0.40.4 pb/rehearsal/rehearse.sh
#
# Never point this at a real instance: it creates its own data dir under
# $WORK (default /tmp/pb-rehearsal) and serves on 127.0.0.1:8091.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PB_DIR="$HERE/.."
WORK="${WORK:-/tmp/pb-rehearsal}"
PB_BIN="${PB_BIN:-pocketbase}"
APP_MODULES="$HERE/../../app/node_modules"   # the pocketbase JS SDK

rm -rf "$WORK" && mkdir -p "$WORK/old-mig" "$WORK/old-hooks"
ln -s "$APP_MODULES" "$WORK/node_modules"
cp "$HERE"/*.mjs "$WORK/"
# The schema before multi-tenancy: every migration older than 1758000006,
# and the hooks as they were at the commit that introduced it.
for f in "$PB_DIR"/pb_migrations/*.js; do
  [[ "$(basename "$f")" < "1758000006" ]] && cp "$f" "$WORK/old-mig/"
done
ROOT="$(git -C "$PB_DIR" rev-parse --show-toplevel)"
git -C "$ROOT" archive "$(git -C "$ROOT" log --format=%H -1 -- pb/pb_migrations/1758000006_multitenant.js)^" pb/pb_hooks | tar -x -C "$WORK" && cp -r "$WORK/pb/pb_hooks/." "$WORK/old-hooks/"

serve() { # $1 migrations dir, $2 hooks dir
  "$PB_BIN" serve --dir "$WORK/data" --migrationsDir "$1" --hooksDir "$2" --automigrate=false --http 127.0.0.1:8091 > "$WORK/pb.log" 2>&1 &
  echo $! > "$WORK/pb.pid"; sleep 3
}
stop() { kill "$(cat "$WORK/pb.pid")" 2>/dev/null || true; sleep 1; }
trap stop EXIT

serve "$WORK/old-mig" "$WORK/old-hooks"
"$PB_BIN" superuser upsert admin@test.local 'Passw0rd123!' --dir "$WORK/data" >/dev/null
(cd "$WORK" && node seed.mjs && node snapshot.mjs > before.json)
stop

serve "$PB_DIR/pb_migrations" "$PB_DIR/pb_hooks"
grep -E "^(ERROR|Error)|failed to apply" "$WORK/pb.log" && { echo "PocketBase reported errors"; exit 1; } || true
(cd "$WORK" && node snapshot.mjs > after.json && python3 -c "
import json,sys
a=json.load(open('before.json')); b=json.load(open('after.json'))
ok=all(a[k]==b[k] for k in a)
print('content + updated timestamps unchanged:', ok)
sys.exit(0 if ok else 1)" && node rules.mjs && node addresses.mjs)
