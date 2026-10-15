# ODIP Backend — Auth / Seed Data Notes

Derived from reading (paths relative to `backend\`):
- `Odip.Api\Program.cs`
- `Odip.Api\Controllers\AuthController.cs`
- `Odip.Infrastructure\Services\CurrentTenant.cs`
- `Odip.Api\Middleware\ReadOnlyMiddleware.cs`
- `Odip.Infrastructure\Data\DbSeeder.cs`
- `Odip.Domain\Enums\Enums.cs` (`UserRole`)
- `Odip.Api\appsettings.json` / `appsettings.Development.json`

## 1. JWT claims the backend reads

`AuthController.GenerateJwtToken` / `GenerateSuperAdminJwtToken` build claims with
`System.Security.Claims.ClaimTypes.*` constants. Those constants **are already the
long Microsoft/XML-SOAP claim URIs**, and `JwtSecurityTokenHandler.WriteToken` uses
the `Claim.Type` string verbatim as the JSON key — so the URIs, not short names like
`sub`/`role`/`email`, are what actually appear in the token payload and what the
receiving `JwtBearer` handler looks up (there is no `MapInboundClaims = false`
anywhere in `Program.cs`, but no mapping is needed here since the token already uses
the long forms).

| Purpose | Exact JSON claim key in the JWT | .NET constant |
|---|---|---|
| User id | `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier` | `ClaimTypes.NameIdentifier` |
| Username | `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name` | `ClaimTypes.Name` |
| Email | `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` | `ClaimTypes.Email` |
| Role | `http://schemas.microsoft.com/ws/2008/06/identity/claims/role` | `ClaimTypes.Role` |
| Full display name | `fullName` (short, custom claim, not mapped) | — |
| Tenant id | `tenant_id` (short, custom claim, not mapped) | — |

Plus standard registered claims: `iss` = `"Odip"`, `aud` = `"Odip"`, `exp`, `iat`/`nbf` (not
required by validation, but harmless to include).

**Important asymmetry:** `GenerateSuperAdminJwtToken` (used for the `odip.com.au`
super-admin domain path in `AuthController.Exchange`) **never sets a `tenant_id`
claim at all** — SuperAdmin tokens are tenant-less. `GenerateJwtToken` (the normal
tenant-user path) always sets `tenant_id` to the resolved tenant's `Id`.

Consumers of these claims:
- `CurrentTenant.cs` (`Odip.Infrastructure\Services\CurrentTenant.cs`): reads
  `user.FindFirst("tenant_id")?.Value` → `TenantId` (null if absent/unparseable), and
  `user.IsInRole("SuperAdmin")` → `IsSuperAdmin`. If `IsSuperAdmin` and the request
  carries an `X-View-As-Tenant: <guid>` header, `TenantId` is overridden to that guid
  and `IsSuperAdmin` is flipped to `false` for the rest of the request (tenant-scoped
  impersonation). If a SuperAdmin has scoped to a tenant this way, an additional
  `X-View-As-User: <guid>` header sets `ViewAsUserId` (currently unused by any backend
  consumer per the code comment — no validation that the user belongs to the tenant).
- `ReadOnlyMiddleware.cs`: blocks POST/PUT/PATCH/DELETE with 403 if
  `User.IsInRole("ReadOnly")` — relies on the same `ClaimTypes.Role` claim / ASP.NET
  role claim type (default `RoleClaimType = ClaimTypes.Role`, unchanged in `Program.cs`).
- Controller `[Authorize(Roles = "...")]` attributes — same role-claim mechanism.

`Program.cs` JWT validation parameters: `ValidateIssuer=true` (`"Odip"`),
`ValidateAudience=true` (`"Odip"`), `ValidateIssuerSigningKey=true` (HMAC-SHA256,
key = UTF8 bytes of `JWT_SECRET`), `ValidateLifetime=true`, `ClockSkew=2 min`. The
bearer token can also arrive via an `odip_jwt` HttpOnly cookie (see
`OnMessageReceived` in `Program.cs`) as a fallback when the `Authorization` header is
absent — not needed for our header-based testing.

## 2. Seed data (`DbSeeder.SeedAsync`, runs unconditionally on every startup via `Program.cs`)

All IDs below are **fixed/hardcoded GUIDs**, not generated at runtime — no DB query
needed to discover them; they are safe to hardcode into test scripts.

### Tenants (always ensured to exist)
| Tenant | Id | EmailDomain |
|---|---|---|
| Odip | `a0000000-0000-0000-0000-000000000001` | `odip.com.au` |
| Demo | `b0000000-0000-0000-0000-000000000001` | `demo.odip.com.au` |

(A third tenant id, `00000000-0000-0000-0000-000000000001` ("Connah"), is referenced
by a seeded user — see caveat below — but `DbSeeder` never inserts a `Tenant` row for
it, so it likely only exists in real/production databases, not a fresh local one.)

### Users (fixed IDs, guarded individually so re-seeding is idempotent)
| Username | Email | Role | Tenant |
|---|---|---|---|
| `admin` | `admin@odip.com.au` | **SuperAdmin** | Odip (`a0000000-...-0001`) |
| `sarah.mitchell` | `sarah.mitchell@demo.odip.com.au` | Coordinator | Demo |
| `james.obrien` | `james.obrien@demo.odip.com.au` | SupportWorker | Demo |
| `rachel.thompson` | `rachel.thompson@demo.odip.com.au` | Coordinator | Demo |
| `emily.nguyen` | `emily.nguyen@demo.odip.com.au` | SupportWorker | Demo |
| `daniel.williams` | `daniel.williams@demo.odip.com.au` | SupportWorker | Demo |
| `coordinator.read` | `readonly@demo.odip.com.au` | **ReadOnly** | Demo |

Fixed user IDs (for `mint-jwt.js` "userId" argument):
- `admin` → `b1000000-0000-0000-0000-000000000001`
- `sarah.mitchell` → `b1000000-0000-0000-0000-000000000002`
- `james.obrien` → `b1000000-0000-0000-0000-000000000003`
- `rachel.thompson` → `b2000000-0000-0000-0000-000000000001`
- `emily.nguyen` → `b2000000-0000-0000-0000-000000000002`
- `daniel.williams` → `b2000000-0000-0000-0000-000000000003`
- `coordinator.read` → `b2000000-0000-0000-0000-000000000004`

`DbSeeder` no longer repairs existing rows on start-up (it used to move demo rows to the Demo tenant,
force `admin@odip.com.au` to `SuperAdmin` and fix empty `TenantId`s); it only seeds what is missing.

**Caveat / surprise:** a second SuperAdmin user, `info@connah.com.au`
(username `superadmin`), is created with `TenantId = 00000000-0000-0000-0000-000000000001`
if not already present — but as noted above, no `Tenant` row with that id (or with
domain `connah.com.au`) is ever inserted by `DbSeeder`. This looks like a
production/customer fixup left in the seeder; on a brand-new local DB it creates an
orphaned user row with a Guid `TenantId` (if the FK is enforced this could even throw —
worth watching for a startup error). It's irrelevant for local JWT-based testing since
we mint tokens directly and never exercise the Firebase `exchange` endpoint's tenant
lookup for this row.

The seeder also creates 10 Staff, 4 EventTemplates, 20 Participants, 8 SupportProfiles,
10 Contacts, and further NDIS/trip/vehicle/accommodation data (see
`DbSeeder.SeedAsync`/`SeedNdisDataAsync`, lines ~260-860) — all under the **Demo**
tenant. Not reproduced here since it's not needed for auth testing; re-read
`DbSeeder.cs` directly if specific entity IDs are needed for endpoint testing.

## 3. Roles and widest access

`UserRole` enum (`Odip.Domain\Enums\Enums.cs`): `Admin`, `Coordinator`, `SupportWorker`,
`ReadOnly`, `SuperAdmin`.

**`SuperAdmin` has the widest access** — it is:
- Included in essentially every `[Authorize(Roles = "...")]` list across all
  controllers (see `endpoints.md`), including the `SuperAdmin`-only
  `AdminUsersController` and `TenantsController` (tenant management — no other role
  can reach these).
- Documented in the enum itself: `SuperAdmin // Platform operator — TenantId is null,
  bypasses all query filters`.
- Exempt from `ReadOnlyMiddleware`'s write-blocking (that only checks for the
  `ReadOnly` role).
- Able to impersonate/scope into any tenant via `X-View-As-Tenant` (see `CurrentTenant.cs`
  above), which no other role can do.

Note: the `Admin` enum value exists and appears in many `[Authorize(Roles=...)]` lists
(e.g. `AuditController`, `SupportCatalogueController` import endpoints,
`PlanPricingController` PUT settings; the `PublicHolidaysController` write endpoints were SuperAdmin-only from plan builder phase B), but **`DbSeeder` never
seeds any user with `Role = Admin`** — only `SuperAdmin`, `Coordinator`,
`SupportWorker`, `ReadOnly` exist in seed data. To test `Admin`-gated endpoints,
mint a JWT with `role=Admin` directly (mint-jwt.js supports any role string; the
backend only checks the role claim value against the `[Authorize(Roles=...)]` list,
it does not require the user to exist in the DB for role checks — only some
controllers additionally look the user up by id/email from the DB, which would then
fail for a fabricated `Admin` user unless you use one of the real seeded users'
underlying entity or add one).

For all practical "give me the widest access" testing, mint a token with
`role=SuperAdmin`, `userId=b1000000-0000-0000-0000-000000000001` (the real seeded
`admin@odip.com.au` user) — the default `mint-jwt.js` produces exactly this.

## 4. Other startup requirements worth knowing (from `Program.cs`)

- **Postgres migrations run automatically at startup** (`db.Database.MigrateAsync()`),
  with retry (5 attempts, exponential backoff 2s/4s/8s/16s) if Postgres isn't reachable
  yet. It also pre-creates `__EFMigrationsHistory` and back-fills specific historical
  migration ids if `AccommodationProperties` already exists — irrelevant for a fresh
  DB, but means a fresh DB just needs to be reachable and have `CREATE TABLE`
  privileges; no manual migration step is required before `dotnet run`.
- `DbSeeder.SeedAsync` and `DbSeeder.SeedNdisDataAsync` both run on **every** startup
  (idempotent, guarded per-row), not just first run.
- JWT secret rejects the specific string `"Odip-Dev-Only-Secret-Min32Characters!!"`
  even though it's 32+ chars — must differ from that exact literal, and be ≥32 chars.
  `run-api.ps1` uses `"OdipLocalTestSecret-0123456789abcdef0123456789"`, which is fine.
- Firebase Admin SDK initialization is **mandatory** at startup (`FirebaseApp.Create`
  is called unconditionally, not lazily) — if `FIREBASE_SERVICE_ACCOUNT_JSON` is
  missing/invalid/unparsable, the app throws before it ever starts listening. It's
  loaded via `GoogleCredential.FromJson`, which needs syntactically valid JSON with a
  parseable RSA private key, but (per this task's own framing) is otherwise never used
  to make real Google calls in our tests since we bypass Firebase token verification
  entirely by minting our own backend JWTs.
- CORS is locked to `ALLOWED_ORIGINS` env var (comma-split), defaulting to
  `http://localhost:5173,http://localhost:3000` if unset; `run-api.ps1` sets it
  explicitly to `http://localhost:5173`.
- A strict CSP / security-headers middleware is applied to every response
  (`X-Frame-Options: DENY`, `Cache-Control: no-store`, etc.) — shouldn't affect
  API-only testing via curl/Postman but worth knowing if testing via a browser.
- Login (`/api/v1/auth/exchange`) is limited two ways: a flood guard of 60 requests / 5
  minutes per IP (`"login"` policy), and a lockout after 10 FAILED exchanges from one IP
  in 15 minutes (a 429 with code `LockedOut` and a `Retry-After` header; a success clears
  the count). General API calls are limited to 100/minute per IP (`"api"` policy). All
  irrelevant for our flow since we skip `/exchange` entirely and mint JWTs directly, but
  could bite if any test script does call `/exchange`. A refused exchange is a 401 whose
  body's `code` says why (see the repo-root `docs/runbooks/sign-in-trouble.md`, not
  `odip-prototype/odip/docs/`).
