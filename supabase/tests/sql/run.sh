#!/bin/sh
# Every migration on a fresh database, then the SQL checks here. Plain
# Postgres 15+, no Supabase stack: shim.sql stands in for what the
# supabase/postgres image and GoTrue provide. Never point it at the box.
#   PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres supabase/tests/sql/run.sh
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
DB=sql_checks
psql -X -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
run() { psql -X -q -v ON_ERROR_STOP=1 -d $DB "$@"; }
run -f "$HERE/shim.sql" 2>/dev/null
for f in "$HERE"/../../migrations/*.sql; do
  run --single-transaction -f "$f"
done
for t in "$HERE"/*.sql; do
  case "$t" in */shim.sql) continue ;; esac
  echo "== $(basename "$t")"
  run -t -f "$t" | grep -v '^\s*$' | grep -v -- '-[0-9a-f]\{4\}-' || true
done
