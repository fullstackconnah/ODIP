#!/bin/bash
# Proves the "login" flood limiter (60 per 5 minutes) applies to /auth/exchange for real external
# clients, AND that touching a dev-auth endpoint first cannot disable that limit.
#
# Run from a machine that is NOT the docker host. Running it on the host exercises a
# fresh loopback IP that never touches the dev endpoints — the case that always passed.
BASE="${1:-http://192.168.4.70:8475}"

echo "=== what the limiter actually partitions on (not the controller's view) ==="
curl -s -m 10 "$BASE/api/v1/auth/dev-whoami"; echo; echo

# The regression that motivated this script: dev-login used to claim the partition as a
# no-op limiter, leaving /auth/exchange unlimited for this client. Touch it FIRST on
# purpose — if the bug is back, the loop below will never reach 429.
echo "=== touching dev-auth endpoints first (the poisoning case) ==="
for i in 1 2 3; do
  curl -s -m 10 -o /dev/null -w 'dev-users=%{http_code} ' "$BASE/api/v1/auth/dev-users"
done; echo; echo

# The only protection is the "login" flood limiter: 60 requests per 5 minutes per client address.
# So send failed exchanges until the first 429. The 4 requests above (dev-whoami, dev-users x3) share
# the same limiter, so on a healthy server the 429 arrives at exchange attempt 57 to 61. Allow up to 65.
echo "=== /auth/exchange until the first 429 (expect: 401s, then a 429 at attempt 57-61) ==="
first429=0
for i in $(seq 1 65); do
  code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X POST     -H 'Content-Type: application/json' -d '{"idToken":"probe-not-a-real-token"}'     "$BASE/api/v1/auth/exchange")
  if [ "$code" = "429" ]; then first429=$i; break; fi
done
echo "first 429 at attempt: $first429 (0 = none in 65)"
echo
if [ "$first429" -ge 57 ]; then
  echo "RESULT: PASS — the flood limiter answers 429 once the 60-per-5-minutes window is full,"
  echo "        and the dev-auth endpoints did not exempt this client from it."
else
  if [ "$first429" -eq 0 ]; then
    echo "RESULT: FAIL — 65 sign-in requests from one client, no 429."
    echo "        /auth/exchange has no flood limit for this client."
  else
    echo "RESULT: FAIL — a 429 at attempt $first429, before the 60-per-5-minutes window was full."
    echo "        The limiter is tighter than configured (or the client shares a bucket)."
  fi
  exit 1
fi
