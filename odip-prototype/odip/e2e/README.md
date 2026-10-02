# ODIP end-to-end tests

Playwright tests that drive the real frontend against the real API and PostgreSQL.
This is its own npm project, kept out of `frontend/` so Vitest, ESLint and the production image build never see it.

## What runs where

```
Chromium (Playwright, Australia/Sydney, 1440x900)
  -> E2E_BASE_URL  (default http://127.0.0.1:8475)   web tier: nginx in CI, scripts/serve.mjs locally
       -> /api  ->  Odip.Api (Release publish, DEV_AUTH_ENABLED=true)  ->  PostgreSQL 16
Playwright fixtures (Node, no browser)
  -> E2E_API_URL   (default http://127.0.0.1:5000)   dev-login and all test-data set-up through the public API
```

CI: the `e2e` job in `.github/workflows/pr-validation.yml` builds and starts exactly this stack on every PR
(informational, not a required check yet). `DEV_AUTH_ENABLED=true` and `VITE_DEV_AUTH=true` are set only in that job;
production keeps them off.

## Layout

- `playwright.config.ts`, `global-setup.ts` - config; setup polls API health, checks the dev-users seed and that
  readiness is in Warn mode (otherwise every write would be refused).
- `support/` - `env`, `api` (dev-login + authenticated calls), `dates` (Sydney-zone date maths), `data`
  (unique-token builders for participants, staff, trips, vehicles, shifts), `fixtures` (signed-in page).
  Test staff get an address at the Demo tenant's own email domain (`DEMO_EMAIL_DOMAIN` in `env`): the API refuses any
  other address that is not at a common email provider until the request says `addressConfirmed` (400 AddressNeedsConfirmation).
- `tests/_canary/` - stack canary: health, seed, dev-login per role, Warn mode, the activate / book / roster write
  paths, and one browser sign-in through the served frontend. Tag `@smoke` marks the quick subset.
- `scripts/serve.mjs` - stand-in for nginx (static + SPA fallback + `/api` proxy, security headers read from
  `nginx/default.conf`).

## Run locally on a machine without a container runtime

You need .NET 8 SDK, Node 20+, and a PostgreSQL 16 server (a portable zip is enough). All paths below are from
`odip-prototype/odip`. Pick free ports first (netstat) - the examples use 55436 (PostgreSQL), 5000 (API), 8475 (web).

1. PostgreSQL: `initdb -D <dir> -U postgres -A trust -E UTF8`, then
   `postgres -D <dir> -p 55436 -c listen_addresses=127.0.0.1` (leave running). Create database `odip_e2e`
   with any client, or use database `postgres`.
2. API:
   ```
   dotnet publish backend/Odip.Api/Odip.Api.csproj -c Release -o /tmp/odip-api
   ```
   then run it from the publish directory with these environment variables:
   ```
   ConnectionStrings__DefaultConnection=Host=127.0.0.1;Port=55436;Database=odip_e2e;Username=postgres;Password=postgres
   JWT_SECRET=e2e-only-signing-key-0123456789-abcdefghij
   DEV_AUTH_ENABLED=true
   ASPNETCORE_ENVIRONMENT=Production
   ASPNETCORE_URLS=http://127.0.0.1:5000
   HolidaySync__FromYear=2100
   ```
   `dotnet Odip.Api.dll`. It migrates and seeds on boot; wait for `GET /api/health/ready` to return 200.
3. Frontend, built with dev sign-in:
   ```
   npm --prefix frontend ci
   VITE_DEV_AUTH=true npm --prefix frontend run build
   ```
4. Web tier: `node e2e/scripts/serve.mjs` (env `PORT` default 8475, `API_URL` default http://127.0.0.1:5000,
   `DIST` default `frontend/dist`).
5. Tests:
   ```
   npm --prefix e2e ci
   npm --prefix e2e exec -- playwright install chromium
   npm --prefix e2e test            # everything
   npm --prefix e2e run test:smoke  # @smoke subset
   ```
   Point at other ports with `E2E_API_URL` and `E2E_BASE_URL`. `npm --prefix e2e run typecheck` runs `tsc --noEmit`.

The database is never cleaned: tests create rows with unique tokens and never assert global counts, so repeated
runs against the same database are fine. Throw the data directory away for a pristine run.

## Conventions

- Locate by role, label or visible name; never `waitForTimeout` or `networkidle`.
- Dates come from `support/dates.ts` (Sydney zone), never from the runner's clock directly.
- Failure artifacts only (`trace` on first retry, screenshot on failure); no video.
