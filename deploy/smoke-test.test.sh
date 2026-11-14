#!/usr/bin/env bash
# Tests deploy/smoke-test.sh against a fake docker and curl. Run: bash deploy/smoke-test.test.sh
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/bin" "$tmp/stack" "$tmp/tmpdir"
SECRET=test-secret-not-real; TOKEN=fake.token.value; BODY=FAKE-BODY-MARKER
# Fake docker: records argv to $tmp/docker.argv; prints $FAKE_TOKEN (default the fake token), fails with $FAKE_MINT_RC if set.
cat > "$tmp/bin/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$FAKE_ARGV"
printf '%s\n' "${JWT_SECRET-unset}" > "$FAKE_ARGV.env"
[ -n "${FAKE_MINT_RC:-}" ] && exit "$FAKE_MINT_RC"
printf '%s' "${FAKE_TOKEN-fake.token.value}"
STUB
# Fake curl: honours -o (writes the body marker there), prints $FAKE_CODE (default 200) for -w; $FAKE_CURL_RC makes it fail like curl does (000, exit 7).
cat > "$tmp/bin/curl" <<'STUB'
#!/usr/bin/env bash
out=; while [ $# -gt 0 ]; do [ "$1" = -o ] && out=$2; shift; done
[ -n "${FAKE_CURL_RC:-}" ] && { printf 000; exit "$FAKE_CURL_RC"; }
[ -n "$out" ] && printf '%s' FAKE-BODY-MARKER > "$out"
printf '%s' "${FAKE_CODE-200}"
STUB
chmod +x "$tmp/bin/docker" "$tmp/bin/curl"

fail=0
# run <name> <want exit> <want output line> [env assignments...]
run() {
  local name=$1 want=$2 line=$3; shift 3
  : > "$tmp/docker.argv"; rm -rf "$tmp/tmpdir"/*
  [ -n "${NOENV:-}" ] && rm -f "$tmp/stack/.env" || printf '%b' "${ENVTXT:-JWT_SECRET=$SECRET\n}" > "$tmp/stack/.env"
  env PATH="$tmp/bin:$PATH" TMPDIR="$tmp/tmpdir" FAKE_ARGV="$tmp/docker.argv" STACK_DIR="$tmp/stack" SMOKE_URL=http://fake "$@" bash "$here/smoke-test.sh" >"$tmp/out" 2>&1
  local code=$? ok=1
  [ "$code" = "$want" ] || ok=0
  [ "$(cat "$tmp/out")" = "$line" ] || ok=0
  grep -q -e "$SECRET" -e "$TOKEN" -e "$BODY" "$tmp/out" && ok=0
  grep -q "$SECRET" "$tmp/docker.argv" && ok=0
  [ -z "$(ls -A "$tmp/tmpdir")" ] || ok=0
  if [ "$ok" = 1 ]; then echo "PASS $name"; else echo "FAIL $name (exit $code want $want)"; cat "$tmp/out"; fail=1; fi
}
run "200"                0 "smoke: participants 200"
run "401"                1 "smoke: participants 401" FAKE_CODE=401
run "500"                1 "smoke: participants 500" FAKE_CODE=500
run "curl fails"         1 "smoke: participants 000" FAKE_CURL_RC=7
run "mint prints nothing" 1 "smoke: could not mint a token" FAKE_TOKEN=
run "mint fails"         1 "smoke: could not mint a token" FAKE_MINT_RC=1
run "mint times out"     1 "smoke: could not mint a token" FAKE_MINT_RC=124
NOENV=1 run "secret missing" 1 "smoke: no JWT_SECRET"
# envcase <name> <.env text, \n escapes> <value the fake docker must see in its environment>
envcase() {
  ENVTXT=$2 run "$1" 0 "smoke: participants 200"
  [ "$(cat "$tmp/docker.argv.env")" = "$3" ] && echo "PASS $1 (value)" || { echo "FAIL $1 (value)"; fail=1; }
}
envcase "env double quotes" 'JWT_SECRET="abc"\n' abc
envcase "env single quotes" "JWT_SECRET='abc'\\n" abc
envcase "env export form"   'export JWT_SECRET=abc\n' abc
envcase "env last wins"     'JWT_SECRET=first\nJWT_SECRET=second\n' second
envcase "env CRLF"          'JWT_SECRET=abc\r\n' abc
envcase "env value with ="  'JWT_SECRET=ab=c==\n' 'ab=c=='
exit $fail
