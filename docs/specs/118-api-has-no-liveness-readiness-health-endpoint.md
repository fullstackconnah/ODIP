## Problem

The API exposes no health endpoint. `MapHealthChecks` appears nowhere in `odip-prototype/odip/backend`; `Odip.Api/Program.cs:503` maps controllers and nothing else, so every probe has to target a business route.

Consequences today:
- `.github/workflows/deploy.yml` gates the deploy on `GET /api/v1/participants` returning **401** — it asserts "auth still works", not "the app is serving". A misconfigured JWT stack that 401s everything would pass.
- `deploy/smoke-test.sh` mints a real SuperAdmin JWT just to prove the API is alive.
- `deploy/compose.yaml:18-39` gives the `api` service no `healthcheck:` at all (only `db` has one, `compose.yaml:12-16`), so Docker never knows whether the API is usable.

Wanted: a standard ASP.NET Core health check — unauthenticated liveness (process is serving) and readiness (process is serving *and* Postgres is reachable).

## Root cause hypothesis

N/A - feature.

Supporting facts that constrain the design:
- `odip-prototype/odip/nginx/default.conf` proxies only `location /api/` and `location /swagger` to `api:5000`; everything else falls through to the SPA `try_files … /index.html`. A route at `/health` would return the React index page with HTTP 200 through nginx — silently useless as a probe. Routes must live under `/api/`.
- `Program.cs:76` is a bare `AddAuthorization()` with no fallback policy, and authorization is per-controller `[Authorize]`, so a `MapHealthChecks` endpoint is anonymous by default with no extra work.
- `Program.cs:208-282` registers only *named* policies (`login`, `api`, `public`) with no `GlobalLimiter`, so health endpoints are not rate limited unless someone attaches a policy.
- `Program.cs:502` `ReadOnlyMiddleware` only blocks writes; `GET` probes pass.
- `Odip.Api.csproj` has no health-check package, and `Odip.Tests.csproj` has no `Microsoft.AspNetCore.Mvc.Testing` — so no `WebApplicationFactory` is available for end-to-end endpoint tests.

## Affected files

- `odip-prototype/odip/backend/Odip.Api/Health/DatabaseHealthCheck.cs` (new)
- `odip-prototype/odip/backend/Odip.Api/Program.cs`
- `odip-prototype/odip/backend/Dockerfile`
- `odip-prototype/odip/backend/Odip.Tests/Health/DatabaseHealthCheckTests.cs` (new)
- `deploy/compose.yaml`
- `deploy/smoke-test.sh`
- `.github/workflows/deploy.yml`

## Approach

**1. `Odip.Api/Health/DatabaseHealthCheck.cs` — custom `IHealthCheck`, no new NuGet package.**

`AddHealthChecks()`/`MapHealthChecks` and `IHealthCheck` ship in the `Microsoft.AspNetCore.App` shared framework. The convenient `AddDbContextCheck<T>()` does **not** — it needs `Microsoft.Extensions.Diagnostics.HealthChecks.EntityFrameworkCore`. Given `backend/nuget.offline.config` and the Docker `dotnet restore` layer, do not add a package for ~15 lines of code.

```csharp
public sealed class DatabaseHealthCheck : IHealthCheck
{
    private readonly OdipDbContext _db;
    public DatabaseHealthCheck(OdipDbContext db) => _db = db;

    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _db.Database.CanConnectAsync(cancellationToken)
                ? HealthCheckResult.Healthy("Database reachable.")
                : HealthCheckResult.Unhealthy("Database not reachable.");
        }
        catch (Exception ex)
        {
            // Never let a probe throw — an unhandled exception here surfaces as a 500
            // through ExceptionHandlingMiddleware instead of an Unhealthy 503, which
            // reads as "app broken" rather than "database down".
            return HealthCheckResult.Unhealthy("Database probe failed.", ex);
        }
    }
}
```

Register it tagged, next to the other service registrations (near `Program.cs:373`):

```csharp
builder.Services.AddHealthChecks()
    .AddCheck<Odip.Api.Health.DatabaseHealthCheck>("database", tags: new[] { "ready" });
```

**2. `Program.cs` — map two endpoints beside `MapControllers()` (line 503).**

```csharp
// Liveness: process is up and serving. No dependency checks — a liveness probe that
// fails on a database outage tells an orchestrator to restart a process that is fine.
app.MapHealthChecks("/api/health/live", new HealthCheckOptions
{
    Predicate = _ => false
}).AllowAnonymous();

// Readiness: liveness plus Postgres reachability.
app.MapHealthChecks("/api/health/ready", new HealthCheckOptions
{
    Predicate = check => check.Tags.Contains("ready")
}).AllowAnonymous();
```

Notes that matter:
- Path prefix `/api/` is required so nginx proxies it unchanged (`proxy_pass http://api:5000;` with no rewrite).
- `.AllowAnonymous()` is belt-and-braces given the bare `AddAuthorization()`; keep it so a future fallback policy can't silently lock probes out.
- Do **not** attach `.RequireRateLimiting(...)`. Probes fire on a fixed interval and would eat the `api` 100/min budget.
- Default response is plain text `Healthy` (200) / `Unhealthy` (503). Keep the default writer — no JSON body, no exception detail on an unauthenticated endpoint.

**3. `Dockerfile` — install `curl` in the final stage.**

`mcr.microsoft.com/dotnet/aspnet:8.0` ships neither `curl` nor `wget`, so a Compose `healthcheck` referencing either is permanently unhealthy. Add to the runtime stage (after line 28):

```dockerfile
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*
```

**4. `deploy/compose.yaml` — healthcheck on the `api` service.**

```yaml
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:5000/api/health/ready || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 120s
```

`start_period` must be generous: `Program.cs:378-462` runs migrate + ~20 seeders *before* `app.Run()`, so the listener does not exist at all during startup and probes get connection-refused, not a 503.

**5. `.github/workflows/deploy.yml` — add readiness to the gate, keep the 401 assertion.**

In the `Health check` step, add a third probe and require all three:

```bash
READY=$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL/api/health/ready" || echo 000)
...
if [ "$FE" = "200" ] && [ "$READY" = "200" ] && [ "$API" = "401" ]; then
```

Keeping `API=401` preserves the existing "auth is still enforced" signal; readiness adds the "app + database actually work" signal that was missing.

**6. `deploy/smoke-test.sh` — probe health before minting the JWT.**

```bash
echo "=== GET /api/health/ready (through nginx, unauthenticated) ==="
curl -s -w "\nHTTP %{http_code}\n" http://localhost:8475/api/health/ready
```

Place it above the JWT-minting block so an unhealthy stack fails fast without the `docker run node:20-alpine` round trip. `set -e` is already in force at line 4; `curl -s` without `-f` will not abort on a 503, which is what we want — the status code is printed either way.

## Test plan

Project: **`Odip.Tests`** (xUnit + Moq + EF InMemory, as per existing convention). New file `Odip.Tests/Health/DatabaseHealthCheckTests.cs`, following the inline-fixture style of `Odip.Tests/HealthConditions/ParticipantHealthConditionsControllerTests.cs`.

1. `CheckHealthAsync_ReturnsHealthy_WhenDatabaseIsReachable` — build an `OdipDbContext` on `UseInMemoryDatabase(Guid.NewGuid().ToString())`, assert `HealthStatus.Healthy`.
2. `CheckHealthAsync_ReturnsUnhealthy_WhenContextIsDisposed` — dispose the context, then invoke the check; assert `HealthStatus.Unhealthy` and that no exception escapes (this is the catch branch — it must degrade, not throw).
3. `CheckHealthAsync_DoesNotThrow_OnCancellation` — pass an already-cancelled `CancellationToken`; assert the call returns an `Unhealthy` result rather than propagating `OperationCanceledException` out of the probe.
4. `DatabaseHealthCheck_IsRegisteredWithReadyTag` — resolve `IOptions<HealthCheckServiceOptions>` from a minimal `ServiceCollection` that has run the same `AddHealthChecks().AddCheck<DatabaseHealthCheck>("database", tags: ["ready"])` registration; assert the registration exists and its tags contain `"ready"`. This is what stops someone deleting the tag and quietly turning liveness into readiness.

Not unit-testable here: the actual HTTP routing/anonymous access of `/api/health/live` and `/api/health/ready`. `Odip.Tests` has no `Microsoft.AspNetCore.Mvc.Testing` reference and this spec deliberately adds no packages — that behaviour is covered by the `deploy/smoke-test.sh` probe and the workflow health gate.

Verification commands (run by a separate validation agent, per CLAUDE.md): `dotnet build` and `dotnet test` from `odip-prototype/odip/backend`.

## Risks

1. **`curl` in the runtime image.** Adds an `apt-get` layer and a binary to a production image. If the build host has no network during `docker compose build`, this step fails the deploy at the image-build gate — before any container is replaced, so it fails safe, but it does fail. Alternative if that is unacceptable: drop the Compose `healthcheck` and rely on the workflow/smoke-test probes only.
2. **`UseHttpsRedirection()` at `Program.cs:480`.** Currently a no-op because the Dockerfile sets only `ASPNETCORE_URLS=http://+:5000`, so the middleware cannot resolve an HTTPS port. If anyone later sets `ASPNETCORE_HTTPS_PORT`, plain-HTTP probes start getting 307 and the container flips to unhealthy for a reason that has nothing to do with health.
3. **Readiness leaks DB state unauthenticated.** `/api/health/ready` returning 503 tells any LAN caller Postgres is down. Mitigated by using the default plain-text writer (`Healthy`/`Unhealthy`, no detail, no exception text). Accepted per the issue's "should not require authentication".
4. **Probe cost.** `CanConnectAsync` opens a real connection per call. At `interval: 30s` this is negligible; do not lower it to a few seconds without checking the Npgsql pool.
5. **Blind spot during startup.** Because migrate+seed happens before `app.Run()`, readiness cannot distinguish "starting" from "dead" — probes see connection-refused for both. `start_period: 120s` and the workflow's 30×5s retry loop absorb this; a slow first-boot migration on a cold volume could still exceed it.

## Open questions

Should `frontend`'s `depends_on: - api` (`deploy/compose.yaml:60-61`) be upgraded to `condition: service_healthy` now that `api` has a healthcheck? It would stop nginx serving a SPA that cannot reach its API, but it also means an unhealthy API blocks the frontend from starting at all — currently the frontend comes up regardless. This spec leaves it as the plain `depends_on` it is today.

## Size

**M** — roughly 150 lines across 7 files: ~35 new backend lines (health check class), ~20 in `Program.cs`, ~70 of tests, and ~25 across `Dockerfile`, `compose.yaml`, `deploy.yml`, and `smoke-test.sh`.
