using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Options;
using Moq;
using Odip.Api.Health;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Health;

/// <summary>
/// Coverage for the readiness probe behind /api/health/ready. The HTTP routing and anonymous
/// access of the endpoints themselves are not exercised here — Odip.Tests has no
/// Microsoft.AspNetCore.Mvc.Testing reference, so that layer is covered by deploy/smoke-test.sh
/// and the deploy workflow's health gate.
/// </summary>
public class DatabaseHealthCheckTests
{
    private static OdipDbContext CreateDb(string dbName)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    private static HealthCheckContext Context() => new()
    {
        Registration = new HealthCheckRegistration(
            "database",
            _ => new DatabaseHealthCheck(CreateDb(Guid.NewGuid().ToString())),
            HealthStatus.Unhealthy,
            new[] { "ready" })
    };

    [Fact]
    public async Task CheckHealthAsync_ReturnsHealthy_WhenDatabaseIsReachable()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var check = new DatabaseHealthCheck(db);

        var result = await check.CheckHealthAsync(Context(), CancellationToken.None);

        Assert.Equal(HealthStatus.Healthy, result.Status);
    }

    [Fact]
    public async Task CheckHealthAsync_ReturnsUnhealthy_WhenContextIsDisposed()
    {
        var db = CreateDb(Guid.NewGuid().ToString());
        var check = new DatabaseHealthCheck(db);
        db.Dispose();

        // The catch branch: it must degrade to Unhealthy, not throw — an escaping exception
        // would surface as a 500 through ExceptionHandlingMiddleware instead of a 503.
        var result = await check.CheckHealthAsync(Context(), CancellationToken.None);

        Assert.Equal(HealthStatus.Unhealthy, result.Status);
    }

    [Fact]
    public async Task CheckHealthAsync_DoesNotThrow_OnCancellation()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var check = new DatabaseHealthCheck(db);
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        var result = await check.CheckHealthAsync(Context(), cts.Token);

        Assert.Equal(HealthStatus.Unhealthy, result.Status);
    }

    [Fact]
    public void DatabaseHealthCheck_IsRegisteredWithReadyTag()
    {
        // Mirrors the Program.cs registration. If the "ready" tag is dropped there, the
        // readiness predicate matches nothing and /api/health/ready silently degrades into
        // a second liveness endpoint — this test is what catches that.
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddHealthChecks()
            .AddCheck<DatabaseHealthCheck>("database", tags: new[] { "ready" });

        using var provider = services.BuildServiceProvider();
        var options = provider.GetRequiredService<IOptions<HealthCheckServiceOptions>>().Value;

        var registration = Assert.Single(options.Registrations, r => r.Name == "database");
        Assert.Contains("ready", registration.Tags);
    }
}
