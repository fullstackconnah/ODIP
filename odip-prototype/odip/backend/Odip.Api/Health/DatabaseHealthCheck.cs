using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Odip.Infrastructure.Data;

namespace Odip.Api.Health;

/// <summary>
/// Readiness probe for Postgres reachability.
/// Hand-rolled rather than using <c>AddDbContextCheck&lt;T&gt;()</c>: that extension lives in the
/// Microsoft.Extensions.Diagnostics.HealthChecks.EntityFrameworkCore package, whereas
/// <see cref="IHealthCheck"/> itself ships in the Microsoft.AspNetCore.App shared framework —
/// so this avoids adding a NuGet dependency (and an offline-restore hazard) for ~15 lines.
/// </summary>
public sealed class DatabaseHealthCheck : IHealthCheck
{
    private readonly OdipDbContext _db;

    public DatabaseHealthCheck(OdipDbContext db) => _db = db;

    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        // A cancelled probe is not evidence of health, but it must not throw either — see below.
        if (cancellationToken.IsCancellationRequested)
        {
            return HealthCheckResult.Unhealthy("Database probe cancelled.");
        }

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
