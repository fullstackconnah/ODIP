#!/bin/bash
# Proves /auth/exchange is rate limited for real external clients, AND that touching a
# dev-auth endpoint first cannot disable that limit.
#
# Run from a machine that is NOT the docker host. Running it on the host exercises a
# fresh loopback IP that never touches the dev endpoints — the case that always passed.
BASE="${1:-http://192.168.4.70:8475}"

burst() {  # burst <n> -> prints status codes
  local c=""
  for i in $(seq 1 "$1"); do
    c="$c $(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST \
      -H 'Content-Type: application/json' -d '{"idToken":"probe-not-a-real-token"}' \
      "$BASE/api/v1/auth/exchange")"
  done
  echo "$c"
}

echo "=== what the limiter actually partitions on (not the controller's view) ==="
curl -s -m 10 "$BASE/api/v1/auth/dev-whoami"; echo; echo

# The regression that motivated this script: dev-login used to claim the partition as a
# no-op limiter, leaving /auth/exchange unlimited for this client. Touch it FIRST on
# purpose — if the bug is back, the burst below will never reach 429.
echo "=== touching dev-auth endpoints first (the poisoning case) ==="
for i in 1 2 3; do
  curl -s -m 10 -o /dev/null -w 'dev-users=%{http_code} ' "$BASE/api/v1/auth/dev-users"
done; echo; echo

# 14 > the 10-failure lockout threshold, and well under the 60-per-5-min flood window,
# so a 429 here can only have come from the failure tracker.
echo "=== /auth/exchange x14 (expect: 401 x10 then 429) ==="
codes=$(burst 14)
echo "codes:$codes"
echo
case "$codes" in
  *429*) echo "RESULT: PASS — repeated FAILED sign-ins lock out, and the dev-auth"
         echo "        exemption no longer leaks into the limited partition." ;;
  *)     echo "RESULT: FAIL — 14 failed logins from one client, no 429."
         echo "        /auth/exchange has no brute-force protection for real users."
         exit 1 ;;
esac
