#!/usr/bin/env bash
# Tests deploy/build-with-retry.sh against a stub docker. Run: bash deploy/build-with-retry.test.sh
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/bin"
# Stub: fails with $STUB_MSG for the first $STUB_FAILS calls, then succeeds; counts calls.
cat > "$tmp/bin/docker" <<'STUB'
#!/usr/bin/env bash
n=$(( $(cat "$STUB_COUNT" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$STUB_COUNT"
if [ "$n" -le "$STUB_FAILS" ]; then echo "$STUB_MSG" >&2; exit 1; fi
exit 0
STUB
chmod +x "$tmp/bin/docker"

fail=0
run() { # name, failing calls, message, want exit zero (1|0), want attempts
  rm -f "$tmp/count"
  PATH="$tmp/bin:$PATH" STUB_COUNT="$tmp/count" STUB_FAILS="$2" STUB_MSG="$3" RETRY_SLEEP=0 \
    bash "$here/build-with-retry.sh" >/dev/null 2>&1
  code=$?; got=$(cat "$tmp/count" 2>/dev/null || echo 0)
  ok=1; { [ "$4" = 1 ] && [ $code -eq 0 ]; } || { [ "$4" = 0 ] && [ $code -ne 0 ]; } || ok=0
  [ "$got" = "$5" ] || ok=0
  if [ $ok = 1 ]; then echo "PASS $1"; else echo "FAIL $1 (exit $code, attempts $got)"; fail=1; fi
}
run "network fault then success" 1 "TLS handshake timeout" 1 2
run "three network faults"       9 "failed to resolve source metadata" 0 3
run "compile error not retried"  9 "error CS1002: ; expected" 0 1
exit $fail
