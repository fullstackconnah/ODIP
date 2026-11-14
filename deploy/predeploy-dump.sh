#!/usr/bin/env bash
# Dumps the ODIP database before `docker compose up -d` (migrations apply when the new API boots,
# and a rollback only re-tags images). Run from the stack directory (the compose project).
# Inputs: DUMP_DIR, KEEP (newest dumps kept), GIT_SHA. Test: bash deploy/predeploy-dump.test.sh
set -euo pipefail

# Outside STACK_DIR on purpose: the Sync step rsyncs with --delete and would remove a folder inside it.
DUMP_DIR="${DUMP_DIR:-${STACK_DIR:-$PWD}-backups/predeploy}"
KEEP="${KEEP:-5}"
GIT_SHA="${GIT_SHA:-unknown}"

if [ -z "$(docker compose ps --status running -q db)" ]; then
  echo "no running database: skipping the pre-deploy dump"
  exit 0
fi

mkdir -p "$DUMP_DIR"
chmod 700 "$DUMP_DIR"
tmp="$DUMP_DIR/.tmp-$$"
trap 'rm -f "$tmp"' EXIT
fail() { echo "::error::pre-deploy dump failed: $1"; exit 1; }

# Name and user come from the db container's own environment, so no secret or name lives in the workflow.
docker compose exec -T db sh -c 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$tmp" || fail "pg_dump exited non-zero"
[ -s "$tmp" ] || fail "the dump file is empty"
docker compose exec -T db pg_restore -l < "$tmp" > /dev/null || fail "pg_restore -l cannot read the dump"

final="$DUMP_DIR/odip-$(date -u +%Y%m%dT%H%M%SZ)-${GIT_SHA:0:8}.dump"
mv "$tmp" "$final"

# Names sort by UTC time; delete only odip-*.dump beyond the newest KEEP, never the file just written.
files=("$DUMP_DIR"/odip-*.dump)
for ((i = 0; i < ${#files[@]} - KEEP; i++)); do
  [ "${files[i]}" = "$final" ] || rm -f "${files[i]}"
done

echo "pre-deploy dump kept: $(basename "$final") ($(wc -c < "$final") bytes)"
