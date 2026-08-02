#!/usr/bin/env node
/**
 * mint-jwt.js — zero-dependency HS256 JWT minter for local ODIP backend testing.
 *
 * Mirrors exactly what Odip.Api\Controllers\AuthController.cs produces in
 * GenerateJwtToken()/GenerateSuperAdminJwtToken(), including .NET's default
 * inbound/outbound claim-type mapping (JwtSecurityTokenHandler writes the
 * long http://schemas.*.../claims/... URIs as the actual JSON claim keys —
 * NOT the short "sub"/"role"/"email" names — because AuthController builds
 * its claims with System.Security.Claims.ClaimTypes.* constants, which are
 * already the long URIs).
 *
 * Claims written (see Odip.Api/Controllers/AuthController.cs):
 *   http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier = userId (Guid)
 *   http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name           = username
 *   http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress  = email
 *   http://schemas.microsoft.com/ws/2008/06/identity/claims/role         = role (e.g. "SuperAdmin")
 *   fullName                                                             = full display name
 *   tenant_id                                                            = tenant Guid (OMITTED for SuperAdmin,
 *                                                                          matching GenerateSuperAdminJwtToken which
 *                                                                          never sets it — CurrentTenant.cs then reads
 *                                                                          TenantId as null and IsSuperAdmin as true)
 *
 * Program.cs validates: iss == "Odip", aud == "Odip", HS256 signature with
 * the JWT_SECRET env var (>=32 chars), and expiry (ClockSkew 2 min).
 *
 * Usage:
 *   node mint-jwt.js <secret> [role] [tenantId] [userId] [email]
 *
 * Defaults (matching Odip.Infrastructure/Data/DbSeeder.cs seed data):
 *   role     = SuperAdmin
 *   tenantId = a0000000-0000-0000-0000-000000000001   (Odip tenant; ignored/omitted when role=SuperAdmin)
 *   userId   = b1000000-0000-0000-0000-000000000001   (seeded SuperAdmin user "admin")
 *   email    = admin@odip.com.au
 *
 * Examples:
 *   node mint-jwt.js "OdipLocalTestSecret-0123456789abcdef0123456789"
 *   node mint-jwt.js "OdipLocalTestSecret-0123456789abcdef0123456789" Coordinator b0000000-0000-0000-0000-000000000001 b1000000-0000-0000-0000-000000000002 sarah.mitchell@demo.odip.com.au
 */

'use strict';
const crypto = require('crypto');

const CLAIM_NAMEID = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier';
const CLAIM_NAME = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name';
const CLAIM_EMAIL = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress';
const CLAIM_ROLE = 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role';

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlBuffer(buf) {
  return buf.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const args = process.argv.slice(2);
const secret = args[0];

if (!secret) {
  console.error('Usage: node mint-jwt.js <secret> [role] [tenantId] [userId] [email] [username] [fullName]');
  console.error('  role defaults to SuperAdmin; tenantId/userId/email have DbSeeder-matching defaults.');
  process.exit(1);
}

if (secret.length < 32) {
  console.error(`Warning: secret is only ${secret.length} chars — Odip.Api\\Program.cs requires JWT_SECRET >= 32 chars and will refuse to start with a shorter one. (This only matters for the value used to run the API, not for minting.)`);
}

const role = args[1] || 'SuperAdmin';
const tenantId = args[2] || 'a0000000-0000-0000-0000-000000000001';
const userId = args[3] || 'b1000000-0000-0000-0000-000000000001';
const email = args[4] || 'admin@odip.com.au';
const username = args[5] || (role === 'SuperAdmin' ? 'admin' : email.split('@')[0]);
const fullName = args[6] || (role === 'SuperAdmin' ? 'System Admin' : username);

const header = { alg: 'HS256', typ: 'JWT' };

const nowSec = Math.floor(Date.now() / 1000);
const expSec = nowSec + 8 * 60 * 60; // now + 8h

const payload = {
  [CLAIM_NAMEID]: userId,
  [CLAIM_NAME]: username,
  [CLAIM_EMAIL]: email,
  [CLAIM_ROLE]: role,
  fullName: fullName,
  iss: 'Odip',
  aud: 'Odip',
  exp: expSec,
  iat: nowSec,
  nbf: nowSec,
};

// SuperAdmin tokens minted by AuthController.GenerateSuperAdminJwtToken() never
// carry a tenant_id claim at all (SuperAdmin is tenant-less / bypasses filters).
// Mirror that exactly: only attach tenant_id for non-SuperAdmin roles.
if (role !== 'SuperAdmin') {
  payload.tenant_id = tenantId;
}

const encodedHeader = base64url(JSON.stringify(header));
const encodedPayload = base64url(JSON.stringify(payload));
const signingInput = `${encodedHeader}.${encodedPayload}`;

const signature = crypto
  .createHmac('sha256', secret)
  .update(signingInput)
  .digest();
const encodedSignature = base64urlBuffer(signature);

const jwt = `${signingInput}.${encodedSignature}`;

console.log(jwt);
