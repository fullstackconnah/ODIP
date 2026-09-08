using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Odip.Infrastructure.Data;

namespace Odip.Api.Health;

/// <summary>
/// Readiness probe dependency: can the API actually reach Postgres?
/// Hand-rolled rather than using <c>AddDbContextCheck&lt;T&gt;()</c> because that extension lives in
/// the Microsoft.Extensions.Diagnostics.HealthChecks.EntityFrameworkCore package, and adding a
/// NuGet dependency for ~15 lines would also have to survive the offline restore feed
/// (backend/nuget.offline.config) and the Docker `dotnet restore` layer. <see cref="IHealthCheck"/>
/// itself ships in the Microsoft.AspNetCore.App shared framework, so this costs nothing.
/// </summary>
public sealed class DatabaseHealthCheck : IHealthCheck
{
    private readonly OdipDbContext _db;

    public DatabaseHealthCheck(OdipDbContext db) => _db = db;

    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context,
        CancellationToken cancellationToken = default)
    {
        // A probe must never throw. An unhandled exception here surfaces as a 500 through
        // ExceptionHandlingMiddleware instead of an Unhealthy 503, which reads to an operator as
        // "the app is broken" rather than "the database is down". That includes cancellation:
        // whether CanConnectAsync observes the token is provider-specific, so the cancelled case
        // is answered up front instead of relying on the catch below.
        if (cancellationToken.IsCancellationRequested)
            return HealthCheckResult.Unhealthy("Database probe cancelled.");

        try
        {
            return await _db.Database.CanConnectAsync(cancellationToken)
                ? HealthCheckResult.Healthy("Database reachable.")
                : HealthCheckResult.Unhealthy("Database not reachable.");
        }
        catch (Exception ex)
        {
            return HealthCheckResult.Unhealthy("Database probe failed.", ex);
        }
    }
}
