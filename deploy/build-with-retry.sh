#!/usr/bin/env bash
# docker compose build, retried only on network faults (registry or TLS blips on the homelab).
# A compile or other error exits at once. RETRY_SLEEP overrides the 20s/60s waits (tests).
set -euo pipefail

fault='TLS handshake timeout|i/o timeout|failed to resolve source metadata|connection reset by peer|unexpected EOF|TOO MANYREQUESTS|toomanyrequests|503 Service Unavailable|net/http: request canceled|failed to do request'
log="$(mktemp)"; trap 'rm -f "$log"' EXIT

for attempt in 1 2 3; do
  echo "build attempt $attempt of 3"
  set +e
  docker compose build "$@" 2>&1 | tee "$log"
  code=${PIPESTATUS[0]}
  set -e
  [ "$code" -eq 0 ] && exit 0
  if [ "$attempt" -eq 3 ] || ! grep -Eq "$fault" "$log"; then exit "$code"; fi
  wait_s=${RETRY_SLEEP:-$([ "$attempt" -eq 1 ] && echo 20 || echo 60)}
  echo "network fault, retrying in ${wait_s}s"
  sleep "$wait_s"
done
