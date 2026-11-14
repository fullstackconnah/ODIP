#!/usr/bin/env bash
# Static checks that the API runs as one non-root uid and that volume-owner re-owns its volumes to that uid.
# Run: bash deploy/compose-nonroot.test.sh (plain grep and awk, no docker).
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
compose="$here/compose.yaml"
dockerfile="$here/../odip-prototype/odip/backend/Dockerfile"
fail=0
# svc <name>: the lines of one top-level service block (CRs stripped)
svc() { tr -d '\r' < "$compose" | awk -v n="$1" '/^  [A-Za-z0-9_-]+:/ { on = ($1 == n ":") } /^[A-Za-z]/ { on = 0 } on'; }
check() { # check <name> <command...>
  local name=$1; shift
  if "$@"; then echo "PASS $name"; else echo "FAIL $name"; fail=1; fi
}
has() { grep -Eq "$2" <<<"$1"; }
api="$(svc api)"; owner="$(svc volume-owner)"

check "api runs as 1000:1000" has "$api" '^    user: "1000:1000"$'
check "volume-owner exists" test -n "$owner"
check "volume-owner runs as root" has "$owner" '^    user: "0:0"$'
check "volume-owner never restarts" has "$owner" '^    restart: "no"$'
check "volume-owner uses the api image tag" has "$owner" '^    image: odip-api:local$'
check "volume-owner has no build block" bash -c '! grep -Eq "^    build:" <<<"$1"' _ "$owner"
check "volume-owner chowns exactly the two data paths" has "$owner" 'chown -R 1000:1000 /keys /data/documents"\]$'
check "chown uid equals the api user uid" bash -c 'u=$(grep -E "^    user:" <<<"$1" | grep -Eo "[0-9]+" | head -1); grep -q "chown -R $u:$u /keys" <<<"$2"' _ "$api" "$owner"
check "volume-owner mounts exactly the two named volumes" bash -c 'm=$(awk "/^    volumes:/ {on=1; next} /^    [a-z]/ {on=0} on" <<<"$1" | sed "s/^ *- //" | sort | tr "\n" " "); [ "$m" = "documents:/data/documents odip-dp-keys:/keys " ]' _ "$owner"
check "volume-owner mounts no credentials or secrets" bash -c '! grep -Eqi "credentials|secrets" <<<"$1"' _ "$owner"
check "api waits for volume-owner to complete" bash -c 'grep -A1 -E "^      volume-owner:" <<<"$1" | grep -q "condition: service_completed_successfully"' _ "$api"
check "api still waits for a healthy db" bash -c 'grep -A1 -E "^      db:" <<<"$1" | grep -q "condition: service_healthy"' _ "$api"
check "Dockerfile sets no USER" bash -c '! grep -Eq "^USER " "$1"' _ "$dockerfile"

exit "$fail"
