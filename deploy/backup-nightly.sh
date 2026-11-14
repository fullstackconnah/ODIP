#!/usr/bin/env bash
# Nightly encrypted backup set, run by the owner's cron on the server (see docs/runbooks/backups.md).
# Writes odip-<UTC>.db.age, .files.age and .manifest (last) to $OUT/staged. Plaintext lives only in tmpfs ($WS) and
# is removed on every exit path. The server only ever holds the PUBLIC key. Exit: 0 ok, 1 failed, 75 another run holds the lock.
# Inputs (env): STACK_DIR OUT RECIPIENT KEEP_STAGED WS IMG API HOLD HOLD_POLL HOLD_MAX. Test: bash deploy/backup-nightly.test.sh
set -euo pipefail
umask 077

here="$(cd "$(dirname "$0")" && pwd)"
STACK_DIR="${STACK_DIR:-/mnt/docker/stacks/odip}"
KEEP_STAGED="${KEEP_STAGED:-7}"
IMG="${IMG:-odip-backup:1}"
API="${API:-odip-api}"
HOLD_POLL="${HOLD_POLL:-60}"
HOLD_MAX="${HOLD_MAX:-3600}"

stem="" # set once the set is named; the trap removes its .part files
say() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $1"; }
fail() {
  say "$1" >&2
  # The record is for the PC pull; it can only be written once $OUT/staged exists.
  if [ -d "${OUT:-}/staged" ]; then say "$1" > "$OUT/staged/last-failure.txt"; fi
  exit 1
}

# Checked before anything else, so a bad input never reaches a dump.
[ -n "${HOME:-}" ] || fail "HOME is not set"
[[ "$KEEP_STAGED" =~ ^[1-9][0-9]*$ ]] || fail "KEEP_STAGED must be a positive integer, got '$KEEP_STAGED'"
OUT="${OUT:-$HOME/odip-backup}"
RECIPIENT="${RECIPIENT:-$OUT/recipient.txt}"
WS="${WS:-/dev/shm/odip-backup-$(id -u)}"
# The script wipes $WS at start and exit, so it only accepts a folder named for it.
[[ "$WS" == */odip-backup-* ]] || fail "WS must be a folder named odip-backup-*, got '$WS'"
HOLD="${HOLD:-$HOME/odip-test/.deploy-hold}"
S="$OUT/staged"

mkdir -p "$S"
chmod 700 "$OUT"
exec 9> "$OUT/.lock"
flock -n 9 || exit 75

# After the lock, so a run that lost it never wipes the winner's workspace.
cleanup() {
  rm -rf "${WS:?}"
  if [ -n "$stem" ]; then rm -f "$S/$stem".*.part; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

rm -rf "${WS:?}"
mkdir -m 700 -p "$WS"

# age's -R reads every matching line; the check and the copy age sees are the same, CRs stripped.
[ -f "$RECIPIENT" ] || fail "no age recipient: $RECIPIENT is missing"
tr -d '\r' < "$RECIPIENT" | grep -E '^age1[0-9a-z]+$' > "$WS/recipient.txt" || fail "no age recipient: $RECIPIENT has no age1 line"

if ! docker image inspect "$IMG" > /dev/null 2>&1; then
  printf 'FROM postgres:16-alpine\nRUN apk add --no-cache age\n' | docker build -t "$IMG" - > /dev/null || fail "building $IMG failed"
fi

# The runner's deploy hold (set by merge-chain): a dump's locks would delay a boot-time migration.
waited=0
while [ -e "$HOLD" ] && [ -n "$(find "$HOLD" -mmin -120 2> /dev/null)" ]; do
  if [ "$waited" -ge "$HOLD_MAX" ]; then say "WARN: deploy hold still present after ${HOLD_MAX}s, going on"; break; fi
  sleep "$HOLD_POLL"
  waited=$((waited + HOLD_POLL))
done

stem="odip-$(date -u +%Y%m%dT%H%M%SZ)"
created="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Reuses predeploy-dump.sh as is (pg_dump -Fc, then pg_restore -l and a full read). KEEP=1 only touches $WS.
(cd "$STACK_DIR" && DUMP_DIR="$WS" KEEP=1 GIT_SHA=nightly bash "$here/predeploy-dump.sh") || fail "dump failed"
dumps=("$WS"/odip-*-nightly.dump)
[ -f "${dumps[0]}" ] || fail "database not running"
dump="${dumps[0]}"

# Exact rows from the dump's own snapshot: lines inside each COPY block (text COPY is one row per line).
docker run --rm -v "$WS:/w:ro" "$IMG" pg_restore -f - "/w/$(basename "$dump")" | awk '
  c && /^\\\.$/ { print "rows " t " " n; c = 0; next }
  c { n++; next }
  /^COPY .* FROM stdin;$/ { t = $0; sub(/^COPY /, "", t); sub(/ \(.*$/, "", t); c = 1; n = 0 }
' > "$WS/rows.txt" || fail "counting rows in the dump failed"
grep -q '^rows ' "$WS/rows.txt" || fail "the dump has no tables"

enc() { docker run --rm -i -v "$WS/recipient.txt:/r.txt:ro" "$IMG" age -R /r.txt; }
sha() { sha256sum "$1" | cut -d' ' -f1; }
size() { wc -c < "$1" | tr -d ' '; }
isage() { [ -s "$1" ] && [ "$(head -c 22 "$1")" = "age-encryption.org/v1" ] || fail "$2 is not an age file"; }

db_plain=$(sha "$dump")
enc < "$dump" > "$S/$stem.db.age.part" || fail "encrypting the database dump failed"
rm -f "$dump"
isage "$S/$stem.db.age.part" "the database set"

# tar, then age, as separate checked commands: no pipeline, so no pipefail needed in busybox.
# shortcut: the tar waits in tmpfs, so it must fit in RAM (about 12 KB today), when documents near GBs stream it through a fifo.
docker run --rm --volumes-from "$API:ro" -v "$WS:/w" "$IMG" tar -C / -cf /w/files.tar data/documents keys || fail "tar of the file volumes failed"
files_plain=$(sha "$WS/files.tar")
enc < "$WS/files.tar" > "$S/$stem.files.age.part" || fail "encrypting the files tar failed"
rm -f "$WS/files.tar"
isage "$S/$stem.files.age.part" "the files set"

{
  echo "stem $stem"
  echo "created $created"
  echo "db.age $(sha "$S/$stem.db.age.part") $(size "$S/$stem.db.age.part")"
  echo "files.age $(sha "$S/$stem.files.age.part") $(size "$S/$stem.files.age.part")"
  echo "db.plain $db_plain"
  echo "files.plain $files_plain"
  cat "$WS/rows.txt"
} > "$S/$stem.manifest.part"

dbbytes=$(size "$S/$stem.db.age.part"); filesbytes=$(size "$S/$stem.files.age.part")
mv "$S/$stem.db.age.part" "$S/$stem.db.age"
mv "$S/$stem.files.age.part" "$S/$stem.files.age"
mv "$S/$stem.manifest.part" "$S/$stem.manifest" # last: its presence marks the set complete
rm -rf "${WS:?}"

# Prune only after success, and only names of this exact shape; a name from a glob is re-checked, never trusted.
stems=()
for m in "$S"/odip-*.manifest; do
  b=$(basename "$m")
  if [[ "$b" =~ ^(odip-[0-9]{8}T[0-9]{6}Z)\.manifest$ ]]; then stems+=("${BASH_REMATCH[1]}"); fi
done
for ((i = 0; i < ${#stems[@]} - KEEP_STAGED; i++)); do
  old="${stems[i]}"
  [ "$old" = "$stem" ] || rm -f "$S/$old.db.age" "$S/$old.files.age" "$S/$old.manifest"
done
rm -f "$S"/*.part # under the lock no other run owns one

tables=$(grep -c '^rows ' "$OUT/staged/$stem.manifest")
rowtotal=$(awk '/^rows /{s+=$NF} END{print s+0}' "$S/$stem.manifest")
echo "nightly backup staged: $stem (db $dbbytes bytes, files $filesbytes bytes, $tables tables, $rowtotal rows)"
