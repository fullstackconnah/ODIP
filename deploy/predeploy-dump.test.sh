#!/usr/bin/env bash
# Tests deploy/predeploy-dump.sh against a fake docker. Run: bash deploy/predeploy-dump.test.sh
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/bin"
# Fake docker: "ps -a" prints $FAKE_ALL and "ps --status running" prints $FAKE_PS (both exit $FAKE_PS_RC);
# "config" prints the project name; "volume ls" prints $FAKE_VOL (exit $FAKE_VOL_RC); pg_dump prints $FAKE_DUMP (or fails if FAKE_DUMP_RC is set); pg_restore -l exits $FAKE_RESTORE_RC, pg_restore -f (full read) exits $FAKE_FULL_RC.
cat > "$tmp/bin/docker" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  *" config"*) [ -n "${FAKE_CFG_RC:-}" ] && exit "$FAKE_CFG_RC"; echo "name: odip"; echo "services: {}" ;;
  *"volume ls"*) [ -n "${FAKE_VOL_RC:-}" ] && exit "$FAKE_VOL_RC"; printf %s "${FAKE_VOL-}" ;;
  *" ps -a "*) [ -n "${FAKE_PS_RC:-}" ] && exit "$FAKE_PS_RC"; printf %s "${FAKE_ALL-abc123}" ;;
  *" ps "*) [ -n "${FAKE_PS_RC:-}" ] && exit "$FAKE_PS_RC"; printf '%s' "${FAKE_PS-abc123}" ;;
  *pg_dump*) [ -n "${FAKE_DUMP_RC:-}" ] && exit "$FAKE_DUMP_RC"; printf '%s' "${FAKE_DUMP-PGDMP-fake-bytes}" ;;
  *"pg_restore -f"*) cat >/dev/null; exit "${FAKE_FULL_RC:-0}" ;;
  *pg_restore*) cat >/dev/null; exit "${FAKE_RESTORE_RC:-0}" ;;
  *) exit 99 ;;
esac
STUB
chmod +x "$tmp/bin/docker"

fail=0
# run <name> <want exit> <want file count> [env assignments...]; DUMP_DIR is fresh and seeded by $SEED
run() {
  local name=$1 want=$2 count=$3; shift 3
  rm -rf "$tmp/d"; mkdir "$tmp/d"; eval "${SEED:-:}"
  env PATH="$tmp/bin:$PATH" DUMP_DIR="$tmp/d" GIT_SHA=0123456789abcdef KEEP=5 "$@" bash "${SCRIPT:-$here/predeploy-dump.sh}" >"$tmp/out" 2>&1
  local code=$? got; got=$(ls -A "$tmp/d" | wc -l)
  if [ "$code" = "$want" ] && [ "$got" = "$count" ]; then echo "PASS $name"; else echo "FAIL $name (exit $code want $want, files $got want $count)"; cat "$tmp/out"; fail=1; fi
}
old() { for n in 1 2 3 4 5 6 7; do : > "$tmp/d/odip-2020010${n}T000000Z-aaaaaaaa.dump"; done; }

run "happy path"             0 1
# File mode 600: skip with a note where the file system cannot show modes (Git Bash on Windows).
: > "$tmp/probe"; chmod 600 "$tmp/probe"
if [ "$(stat -c %a "$tmp/probe")" = 600 ]; then
  [ "$(stat -c %a "$tmp/d"/odip-*.dump)" = 600 ] && echo "PASS file mode 600" || { echo "FAIL file mode"; fail=1; }
else echo "NOTE mode assertion skipped: file system cannot show modes"; fi
grep -q 'odip-.*-01234567.dump' <(ls "$tmp/d") || { echo "FAIL name pattern"; fail=1; }
run "empty dump"             1 0 FAKE_DUMP=
run "pg_restore -l fails"    1 0 FAKE_RESTORE_RC=1
run "pg_dump fails"          1 0 FAKE_DUMP_RC=1
run "no database container"  0 0 FAKE_ALL= FAKE_PS=
grep -q "no database container: skipping" "$tmp/out" || { echo "FAIL skip line"; fail=1; }
run "no container, volume exists" 1 0 FAKE_ALL= FAKE_PS= FAKE_VOL=odip_pgdata
grep -q "::error::pre-deploy dump failed: no database container, but its data volume exists" "$tmp/out" || { echo "FAIL volume error line"; fail=1; }
run "volume listing errors" 1 0 FAKE_ALL= FAKE_PS= FAKE_VOL_RC=1
run "db exists, not running" 1 0 FAKE_PS=
run "ps exits 1"             1 0 FAKE_PS_RC=1
grep -q "::error::pre-deploy dump failed: docker compose ps failed" "$tmp/out" || { echo "FAIL ps error line"; fail=1; }
run "full read fails"        1 0 FAKE_FULL_RC=1
SEED='old; echo keep > "$tmp/d/notes.txt"' run "retention keeps 5 and notes.txt" 0 6
n=$(ls "$tmp/d" | grep -c '^odip-.*\.dump$'); [ "$n" = 5 ] && ls "$tmp/d" | grep -q 01234567 && [ -f "$tmp/d/notes.txt" ] || { echo "FAIL retention content"; fail=1; }
SEED=old run "failed dump deletes no old dump" 1 7 FAKE_DUMP=
exit $fail
