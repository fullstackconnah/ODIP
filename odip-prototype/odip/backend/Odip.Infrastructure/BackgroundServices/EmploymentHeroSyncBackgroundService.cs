using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;
using Odip.Infrastructure.Notifications;

namespace Odip.Infrastructure.BackgroundServices;

/// <summary>What one tick did, for its one summary line.</summary>
public sealed record EmploymentHeroSyncTick(int Organisations, int Failures);

/// <summary>
/// Runs the Employment Hero staff sync (<see cref="EmploymentHeroStaffSync"/>) every 30 minutes for every connected organisation. It has the same
/// shape as <see cref="RosterTopUpBackgroundService"/>:
/// - a fresh DI scope per tick and a Task.Delay loop;
/// - a SuperAdmin-scoped context to read which organisations are connected, then one tenant-scoped context per organisation;
/// - one organisation's failure is logged and counted, and the others carry on.
/// <c>EmploymentHero:Enabled</c> (default true) switches the loop off; Sync now on the card still works.
/// </summary>
public sealed class EmploymentHeroSyncBackgroundService : BackgroundService
{
    private static readonly TimeSpan FirstRunDelay = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(30);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<EmploymentHeroSyncBackgroundService> _logger;

    public EmploymentHeroSyncBackgroundService(IServiceScopeFactory scopeFactory, IConfiguration config, ILogger<EmploymentHeroSyncBackgroundService> logger)
    {
        _scopeFactory = scopeFactory;
        _config = config;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_config.GetValue("EmploymentHero:Enabled", true))
        {
            _logger.LogInformation("Employment Hero sync is off (EmploymentHero:Enabled is false): staff are synced only by Sync now");
            return;
        }

        var delay = FirstRunDelay;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(delay, stoppingToken);
                await RunTickAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                // A BackgroundService that throws takes the host down in .NET 8: log it, and the next tick tries again.
                _logger.LogError(ex, "Employment Hero sync failed unexpectedly; the next run will try again");
            }

            delay = Interval;
        }
    }

    public async Task<EmploymentHeroSyncTick> RunTickAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var dbOptions = scope.ServiceProvider.GetRequiredService<DbContextOptions<OdipDbContext>>();
        var sync = scope.ServiceProvider.GetRequiredService<EmploymentHeroStaffSync>();

        List<Guid> tenantIds;
        await using (var across = new OdipDbContext(dbOptions, new ScopedTenantOverride { IsSuperAdmin = true }))
            tenantIds = await across.EmploymentHeroConnections.AsNoTracking().Select(c => c.TenantId).ToListAsync(ct);

        var failures = 0;
        foreach (var tenantId in tenantIds)
        {
            try
            {
                await using var db = new OdipDbContext(dbOptions, new ScopedTenantOverride { TenantId = tenantId });
                var result = await sync.RunAsync(db, tenantId, ct);
                if (result.Outcome == EmploymentHeroSyncOutcome.Failed) failures++;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                failures++;
                // The type only: an exception's own text can carry a person's details (a PostgresException's Detail names the duplicate email).
                _logger.LogError("Employment Hero sync failed for organisation {TenantId} ({Error}); the others carry on and it is tried again in 30 minutes", tenantId, ex.GetType().Name);
            }
        }

        if (tenantIds.Count > 0)
            _logger.LogInformation("Employment Hero sync: {Organisations} organisations, {Failures} failed", tenantIds.Count, failures);
        return new EmploymentHeroSyncTick(tenantIds.Count, failures);
    }
}
