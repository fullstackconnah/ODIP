#!/bin/bash
# ODIP deploy smoke test: mints a SuperAdmin JWT from the stack's JWT_SECRET and
# calls the API through the same nginx path the browser uses.
set -e
cd /mnt/docker/stacks/odip

JWT_SECRET=$(grep '^JWT_SECRET' .env | cut -d= -f2)

cat > /tmp/odip-mint.js <<'NODE'
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

TOKEN=$(docker run --rm -v /tmp/odip-mint.js:/m.js -e JWT_SECRET="$JWT_SECRET" node:20-alpine node /m.js)
rm -f /tmp/odip-mint.js

echo "=== GET /api/v1/participants (through nginx, authenticated) ==="
curl -s -w "\nHTTP %{http_code}\n" -H "Authorization: Bearer $TOKEN" \
  http://localhost:8475/api/v1/participants | head -c 600
