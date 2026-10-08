#!/bin/sh
# The knowledge base and its agents' SQL, on a throwaway database: every
# migration in order, then test.sql (each check raises on failure). Needs a
# Postgres 15+ with pgvector; shim.sql stands in for what the supabase/postgres
# image and GoTrue provide. Never point it at the box.
#   PGHOST=localhost PGUSER=postgres supabase/tests/kb/run.sh
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
DB=${KB_TEST_DB:-kb_test}
psql -X -q -d postgres -c "drop database if exists $DB" -c "create database $DB" 2>/dev/null
run() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }
run -f "$HERE/shim.sql" 2>/dev/null
for f in "$HERE"/../../migrations/*.sql; do
  run --single-transaction -f "$f"
done
out=$(run -f "$HERE/test.sql" 2>&1) || { echo "$out" | tail -5; exit 1; }
echo "$out" | tail -3
