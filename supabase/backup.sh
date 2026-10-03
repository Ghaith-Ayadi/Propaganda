#!/bin/sh
# Backups of Propaganda's database, run by the `backup` service of the box's
# stack (Bedrock compose/propaganda-supabase), in the Postgres image: pg_dump
# and curl are already there.
#
#   backup.sh nightly   every day at BACKUP_AT (UTC, default 03:40): dump and
#                       upload to R2. The service's command.
#   backup.sh upload    one dump, uploaded now (a manual backup).
#   backup.sh dump      one dump to stdout (Bedrock's pre-migration archive).
#
# What a dump holds: the DATA of the app's schemas (public, private) and of the
# auth schema (users, identities, sessions), in pg_dump's custom format. Not
# the schema itself: that is supabase/migrations, applied by the stack, and
# GoTrue's own migrations. A restore (Bedrock docs/restore.md) brings up a
# fresh stack at the same migrations and loads the data into it, triggers off,
# so every row comes back as it was, timestamps and post numbers included.
#
# Env: PGHOST PGUSER PGPASSWORD PGDATABASE (the database, as supabase_admin)
#      BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET
#      BACKUP_AT (HH:MM UTC, optional)
# Retention is the bucket's lifecycle rule (30 days), like the PocketBase
# backups. One bucket for this database alone.
set -eu

dump() {
  pg_dump --format=custom --compress=9 --data-only \
    --schema=public --schema=private --schema=auth \
    --exclude-table=auth.schema_migrations
}

upload() {
  : "${BACKUP_S3_ENDPOINT:?}" "${BACKUP_S3_BUCKET:?}" "${BACKUP_S3_ACCESS_KEY:?}" "${BACKUP_S3_SECRET:?}"
  file=$(mktemp)
  trap 'rm -f "$file"' EXIT
  dump > "$file"
  key="propaganda/$(date -u +%Y%m%dT%H%M%SZ).dump"
  curl --silent --show-error --fail-with-body --max-time 300 \
    --aws-sigv4 "aws:amz:auto:s3" --user "$BACKUP_S3_ACCESS_KEY:$BACKUP_S3_SECRET" \
    --upload-file "$file" "${BACKUP_S3_ENDPOINT%/}/$BACKUP_S3_BUCKET/$key" >/dev/null
  echo "backup: uploaded $key ($(wc -c < "$file") bytes)"
  rm -f "$file"
  trap - EXIT
}

nightly() {
  at="${BACKUP_AT:-03:40}"
  h=${at%:*}
  m=${at#*:}
  echo "backup: nightly at $at UTC to $BACKUP_S3_BUCKET"
  while :; do
    now=$(date -u +%s)
    next=$(( now - now % 86400 + ${h#0} * 3600 + ${m#0} * 60 ))
    [ "$next" -gt "$now" ] || next=$(( next + 86400 ))
    sleep $(( next - now ))
    # A failed night is logged and retried the next night; the container stays up.
    upload || echo "backup: FAILED at $(date -u +%Y-%m-%dT%H:%MZ)"
  done
}

case "${1:-}" in
  nightly) nightly ;;
  upload) upload ;;
  dump) dump ;;
  *) echo "usage: backup.sh nightly|upload|dump" >&2; exit 2 ;;
esac
