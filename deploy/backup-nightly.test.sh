#!/usr/bin/env bash
# Tests deploy/backup-nightly.sh against a fake docker and flock, with the real predeploy-dump.sh as the sibling.
# Run from the repo root: bash deploy/backup-nightly.test.sh
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/bin"
# Fake docker. Every call goes to $CALLS. Env knobs: FAKE_ALL/FAKE_PS (compose ps), FAKE_IMG_RC, FAKE_BUILD_RC, FAKE_DUMP_RC,
# FAKE_ROWS_RC, FAKE_TAR_RC, FAKE_AGE_RC, FAKE_AGE_FAIL_ON=<nth age call>, FAKE_AGE_BAD (no age header).
# The fake age prints a header and the hash of its stdin, never the stdin. The tar and the dump carry the marker PGDMP-fake.
cat > "$tmp/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$CALLS"
w=$(printf '%s' "$*" | sed -n 's/.*-v \([^ ]*\):\/w.*/\1/p')
case "$*" in
  "image inspect"*) exit "${FAKE_IMG_RC:-0}" ;;
  "build "*) cat > /dev/null; exit "${FAKE_BUILD_RC:-0}" ;;
  *" ps -a "*) printf %s "${FAKE_ALL-abc123}" ;;
  *" ps "*) printf '%s' "${FAKE_PS-abc123}" ;;
  *pg_dump*) [ -n "${FAKE_DUMP_RC:-}" ] && exit "$FAKE_DUMP_RC"; printf 'PGDMP-fake-bytes' ;;
  *"pg_restore -f - "*) printf 'COPY public."A" (id) FROM stdin;\n1\n2\n\\.\n\nCOPY public."B" (id) FROM stdin;\n\\.\n'; exit "${FAKE_ROWS_RC:-0}" ;;
  *pg_restore*) cat > /dev/null ;;
  *" tar -C "*) [ -n "${FAKE_TAR_RC:-}" ] && exit "$FAKE_TAR_RC"; printf 'TAR-PGDMP-fake' > "$w/files.tar" ;;
  *" age -R "*)
    n=$(grep -c ' age -R ' "$CALLS")
    [ "${FAKE_AGE_RC:-0}" != 0 ] && exit "$FAKE_AGE_RC"
    [ "${FAKE_AGE_FAIL_ON:-0}" = "$n" ] && exit 1
    if [ -n "${FAKE_AGE_BAD:-}" ]; then echo garbage; exit 0; fi
    printf 'age-encryption.org/v1\n-> X25519 x\n'; sha256sum | cut -d' ' -f1 ;;
  *) exit 99 ;;
esac
STUB
printf '#!/usr/bin/env bash\nexit "${FAKE_FLOCK_RC:-0}"\n' > "$tmp/bin/flock"
chmod +x "$tmp/bin/docker" "$tmp/bin/flock"

fail=0
S="$tmp/o/staged"
check() { local name=$1; shift; if "$@"; then echo "PASS $name"; else echo "FAIL $name"; fail=1; fi; }
nostaged() { [ -z "$(ls -A "$S" | grep -v '^last-failure.txt$')" ]; }
# run <name> <want exit> [env assignments...]: a fresh OUT with a valid recipient, seeded by $SEED; output in $tmp/out
run() {
  local name=$1 want=$2; shift 2
  rm -rf "$tmp/o" "$tmp/odip-backup-ws" "$tmp/stack" "$tmp/home" "$tmp/nohold"; mkdir -p "$tmp/o/staged" "$tmp/stack" "$tmp/home"
  printf '# comment\nage1abc123\n' > "$tmp/o/recipient.txt"; : > "$tmp/calls.log"; eval "${SEED:-:}"
  env PATH="$tmp/bin:$PATH" CALLS="$tmp/calls.log" HOME="$tmp/home" OUT="$tmp/o" WS="$tmp/odip-backup-ws" STACK_DIR="$tmp/stack" \
    HOLD="$tmp/nohold" HOLD_POLL=0 HOLD_MAX=0 "$@" bash "${SCRIPT:-$here/backup-nightly.sh}" > "$tmp/out" 2>&1
  local code=$?
  if [ "$code" = "$want" ]; then echo "PASS $name (exit $code)"; else echo "FAIL $name (exit $code want $want)"; cat "$tmp/out"; fail=1; fi
}
sets() { ls "$S" | grep -c '\.manifest$'; }
nodump() { ! grep -q pg_dump "$tmp/calls.log"; }
noplain() { ! grep -rq --exclude-dir=bin PGDMP-fake "$tmp"; } # bin/ holds the fake docker, whose source names the marker
nows() { [ ! -e "$tmp/odip-backup-ws" ]; }

run "happy path" 0
m=$(ls "$S"/*.manifest); stem=$(basename "$m" .manifest)
check "staged holds exactly the three files" test "$(ls "$S" | sort | tr '\n' ' ')" = "$stem.db.age $stem.files.age $stem.manifest "
check "manifest db.age sha matches the file" grep -qx "db.age $(sha256sum "$S/$stem.db.age" | cut -d' ' -f1) $(wc -c < "$S/$stem.db.age" | tr -d ' ')" "$m"
check "manifest files.age sha matches the file" grep -q "^files.age $(sha256sum "$S/$stem.files.age" | cut -d' ' -f1) " "$m"
check "manifest rows A 2" grep -qx 'rows public."A" 2' "$m"
check "manifest rows B 0" grep -qx 'rows public."B" 0' "$m"
check "manifest has plain hashes and stem" bash -c "grep -q '^db.plain [0-9a-f]\{64\}$' '$m' && grep -q '^files.plain [0-9a-f]\{64\}$' '$m' && grep -qx 'stem $stem' '$m'"
check "workspace gone" nows
check "no plaintext anywhere" noplain
check "summary line" grep -q "nightly backup staged: $stem (.*2 tables, 2 rows)" "$tmp/out"

run "missing recipient" 1 RECIPIENT="$tmp/o/none.txt"
check "missing recipient: no pg_dump, nothing staged, record names the recipient" bash -c "$(declare -f nostaged nodump); S='$S'; tmp='$tmp'; nodump && nostaged && grep -q recipient '$S/last-failure.txt'"
SEED='printf "# only a comment\nnot-a-key\n" > "$tmp/o/recipient.txt"' run "recipient without an age1 line" 1
check "no age1 line: no pg_dump, nothing staged, record written" bash -c "$(declare -f nostaged nodump); S='$S'; tmp='$tmp'; nodump && nostaged && grep -q 'no age1 line' '$S/last-failure.txt'"
SEED='printf "# k\r\nage1abc123\r\n" > "$tmp/o/recipient.txt"' run "CRLF recipient file" 0
check "CRLF: a set is staged" test "$(sets)" = 1
run "KEEP_STAGED not a number" 1 KEEP_STAGED=0
check "bad KEEP_STAGED: no pg_dump, nothing staged" bash -c "$(declare -f nostaged nodump); S='$S'; tmp='$tmp'; nodump && nostaged"
run "KEEP_STAGED not a number (text)" 1 KEEP_STAGED=seven
run "HOME empty" 1 HOME=
check "HOME empty: no pg_dump" nodump
run "WS not named odip-backup-*" 1 WS="$tmp/o"
check "bad WS: no pg_dump, the folder is not wiped" bash -c "$(declare -f nodump); tmp='$tmp'; nodump && [ -f '$tmp/o/recipient.txt' ]"

run "db not running" 1 FAKE_ALL= FAKE_PS=
check "db not running: named, nothing staged, workspace gone" bash -c "$(declare -f nostaged nows); S='$S'; tmp='$tmp'; nostaged && nows && grep -q 'database not running' '$S/last-failure.txt'"

SEED='printf old > "$S/odip-20200101T000000Z.manifest"' run "pg_dump fails" 1 FAKE_DUMP_RC=1
check "pg_dump fails: no .part, the old set is untouched" bash -c "[ -z \"\$(ls '$S' | grep '\.part$')\" ] && [ \"\$(cat '$S/odip-20200101T000000Z.manifest')\" = old ]"

run "age fails" 1 FAKE_AGE_RC=1
check "age fails: nothing staged, workspace gone" bash -c "$(declare -f nostaged nows); S='$S'; tmp='$tmp'; nostaged && nows"
run "age header missing" 1 FAKE_AGE_BAD=1
check "bad header: nothing staged, workspace gone" bash -c "$(declare -f nostaged nows); S='$S'; tmp='$tmp'; nostaged && nows"
run "age fails on the files step" 1 FAKE_AGE_FAIL_ON=2
check "files-step failure: workspace gone, no plaintext anywhere, nothing staged" bash -c "$(declare -f nostaged nows noplain); S='$S'; tmp='$tmp'; nostaged && nows && noplain"
run "tar fails" 1 FAKE_TAR_RC=1
check "tar fails: nothing staged, no plaintext anywhere" bash -c "$(declare -f nostaged noplain); S='$S'; tmp='$tmp'; nostaged && noplain"
run "row count fails" 1 FAKE_ROWS_RC=1
check "row count fails: nothing staged" bash -c "$(declare -f nostaged); S='$S'; nostaged"

run "image build fails" 1 FAKE_IMG_RC=1 FAKE_BUILD_RC=1
check "build fails: no pg_dump" nodump
run "image missing is built" 0 FAKE_IMG_RC=1
check "image built before the dump" bash -c "b=\$(grep -n '^build ' '$tmp/calls.log' | head -1 | cut -d: -f1); d=\$(grep -n pg_dump '$tmp/calls.log' | head -1 | cut -d: -f1); [ -n \"\$b\" ] && [ \"\$b\" -lt \"\$d\" ]"

run "lock held" 75 FAKE_FLOCK_RC=1
check "lock held: nothing staged, no failure record, no dump" bash -c "$(declare -f nostaged nodump); S='$S'; tmp='$tmp'; nostaged && nodump && [ ! -e '$S/last-failure.txt' ]"

SEED=': > "$tmp/nohold"' run "deploy hold" 0
check "deploy hold: WARN and a set staged" bash -c "grep -q WARN '$tmp/out' && [ \"\$(ls '$S' | grep -c '\.manifest$')\" = 1 ]"

SEED='for d in 1 2 3 4 5 6 7 8 9; do for e in db.age files.age manifest; do : > "$S/odip-2020010${d}T000000Z.$e"; done; done
echo n > "$S/notes.txt"; : > "$S/odip-x.age"; : > "$S/odip-20200101T000000Z.db.age.part"; : > "$S/odip-20190101T000000Z.db.age"' run "prune" 0
check "prune keeps 7 complete sets including the new one" test "$(sets)" = 7
check "prune keeps notes.txt, odip-x.age and the incomplete stem" bash -c "[ -f '$S/notes.txt' ] && [ -f '$S/odip-x.age' ] && [ -f '$S/odip-20190101T000000Z.db.age' ]"
check "prune removes the stray .part and the oldest sets only" bash -c "[ -z \"\$(ls '$S' | grep '\.part$')\" ] && [ ! -e '$S/odip-20200101T000000Z.manifest' ] && [ ! -e '$S/odip-20200103T000000Z.files.age' ] && [ -e '$S/odip-20200104T000000Z.manifest' ]"

mkdir -p "$tmp/other"
run "relative invocation" 0 # SCRIPT stays absolute; the next line starts it by a relative path from another folder
rm -rf "$tmp/o/staged"/*
( cd "$tmp/other" && rel="$(realpath --relative-to="$tmp/other" "$here" 2> /dev/null || echo "$here")" \
  && env PATH="$tmp/bin:$PATH" CALLS="$tmp/calls.log" HOME="$tmp/home" OUT="$tmp/o" WS="$tmp/odip-backup-ws" STACK_DIR="$tmp/stack" HOLD="$tmp/nohold" \
     bash "$rel/backup-nightly.sh" > "$tmp/out" 2>&1 )
check "relative invocation stages a set" test "$(sets)" = 1
exit $fail
