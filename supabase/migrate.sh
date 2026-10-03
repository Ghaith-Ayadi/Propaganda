#!/bin/sh
# Apply supabase/migrations/*.sql that the database hasn't seen, in name order,
# each in its own transaction together with its row in
# supabase_migrations.schema_migrations (the table the Supabase CLI keeps, so
# `supabase db push` agrees with this database later). A failing migration
# changes nothing and stops the run.
#
# Runs as the `migrate` service of the compose stacks (the laptop's and the
# box's), with PGHOST / PGUSER / PGPASSWORD / PGDATABASE set, after the auth
# service has created its own schema.
set -eu
DIR="${MIGRATIONS_DIR:-/migrations}"
run() { psql -v ON_ERROR_STOP=1 -X -q "$@"; }

run -c "create schema if not exists supabase_migrations;
        create table if not exists supabase_migrations.schema_migrations (
          version text primary key, statements text[], name text);"

applied=0
for f in "$DIR"/*.sql; do
  [ -e "$f" ] || continue
  base=$(basename "$f" .sql)
  version=${base%%_*}
  name=${base#*_}
  if [ -n "$(run -tAc "select 1 from supabase_migrations.schema_migrations where version = '$version'")" ]; then
    continue
  fi
  echo "migrate: applying $base"
  run --single-transaction -f "$f" \
    -c "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name')"
  applied=$((applied + 1))
done
# PostgREST caches the schema: have it read the new one.
[ "$applied" -gt 0 ] && run -c "notify pgrst, 'reload schema';"
echo "migrate: $applied applied, schema at $(run -tAc 'select max(version) from supabase_migrations.schema_migrations')"
