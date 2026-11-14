#!/bin/bash
# ODIP deploy smoke test: mints a SuperAdmin JWT from the stack's JWT_SECRET and
# calls the API through the same nginx path the browser uses. Exit 0 only on HTTP 200.
# Prints one status line; never the response body, the token or the secret.
set -uo pipefail
STACK_DIR=${STACK_DIR:-/mnt/docker/stacks/odip}
SMOKE_URL=${SMOKE_URL:-http://localhost:8475}

JWT_SECRET=$(grep '^JWT_SECRET=' "$STACK_DIR/.env" 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '\r')
[ -n "$JWT_SECRET" ] || { echo "smoke: no JWT_SECRET"; exit 1; }
export JWT_SECRET

mint=$(mktemp); trap 'rm -f "$mint"' EXIT
cat > "$mint" <<'NODE'
const c = require('crypto');
const b = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const payload = {
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier': 'b1000000-0000-0000-0000-000000000001',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name': 'admin',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress': 'admin@odip.com.au',
  'http://schemas.microsoft.com/ws/2008/06/identity/claims/role': 'SuperAdmin',
  iss: 'Odip', aud: 'Odip', iat: now, nbf: now, exp: now + 600,
};
const h = b({ alg: 'HS256', typ: 'JWT' });
const p = b(payload);
const s = c.createHmac('sha256', process.env.JWT_SECRET).update(h + '.' + p).digest('base64url');
console.log(h + '.' + p + '.' + s);
NODE

# -e JWT_SECRET (name only) takes the value from the environment, so it stays off the command line.
TOKEN=$(docker run --rm -v "$mint":/m.js -e JWT_SECRET node:20-alpine node /m.js 2>/dev/null) || TOKEN=
[ -n "$TOKEN" ] || { echo "smoke: could not mint a token"; exit 1; }

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -H "Authorization: Bearer $TOKEN" "$SMOKE_URL/api/v1/participants") || code=000
echo "smoke: participants $code"
[ "$code" = 200 ]
