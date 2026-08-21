#!/bin/bash
# Answers: does an external client through nginx get a STABLE rate-limit partition key?
#
# Run this from a machine that is NOT the docker host — the whole point is to see what
# the server resolves for traffic that crosses Docker's published-port NAT. Running it
# on the host itself reproduces the scenario that already passes and proves nothing.
BASE="${1:-http://192.168.4.70:8475}"

echo "=== partition key, 4 consecutive requests from this machine ==="
for i in 1 2 3 4; do
  curl -s "$BASE/api/v1/auth/dev-whoami" \
    | sed -E 's/.*"remoteIpAddress":"([^"]*)".*"xForwardedFor":"([^"]*)".*"partitionKeyWouldBe":"([^"]*)".*/remote=\1  xff=\2  key=\3/'
done

echo
echo "=== does /auth/exchange actually 429 from here? (6 calls) ==="
# 401 401 401 401 401 429  => limiter works for external clients
# 401 x6                   => external clients are NOT protected
for i in $(seq 1 6); do
  printf '%s ' "$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    -H 'Content-Type: application/json' -d '{"idToken":"probe-not-a-real-token"}' \
    "$BASE/api/v1/auth/exchange")"
done
echo
