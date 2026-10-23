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
public sealed record EmploymentHeroTimesheetTick(int Organisations, int Failures);

/// <summary>
/// Sends approved timesheets to Employment Hero (<see cref="EmploymentHeroTimesheetSender"/>) every minute for every connected organisation,
/// the same way as the staff sync loop: a fresh scope per tick, one tenant-scoped context per organisation, one organisation's failure never stops the others.
/// The first tick and every 30th also check sent lines for changes. <c>EmploymentHero:Enabled</c> (default true) switches the loop off.
/// </summary>
public sealed class EmploymentHeroTimesheetBackgroundService : BackgroundService
{
    private static readonly TimeSpan FirstRunDelay = TimeSpan.FromMinutes(3);
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(1);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<EmploymentHeroTimesheetBackgroundService> _logger;

    public EmploymentHeroTimesheetBackgroundService(IServiceScopeFactory scopeFactory, IConfiguration config, ILogger<EmploymentHeroTimesheetBackgroundService> logger)
    {
        _scopeFactory = scopeFactory;
        _config = config;
        _logger = logger;
    }

    /// <summary>The change check runs on the first tick (0) and every 30 minutes after.</summary>
    internal static bool ChecksChanges(int tick) => tick % 30 == 0;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_config.GetValue("EmploymentHero:Enabled", true))
        {
            _logger.LogInformation("Employment Hero timesheets are off (EmploymentHero:Enabled is false): nothing is sent by the loop");
            return;
        }

        var delay = FirstRunDelay;
        for (var tick = 0; !stoppingToken.IsCancellationRequested; tick++)
        {
            try
            {
                await Task.Delay(delay, stoppingToken);
                await RunTickAsync(ChecksChanges(tick), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                // A BackgroundService that throws takes the host down in .NET 8: log the type only, and the next tick tries again.
                _logger.LogError("Employment Hero timesheet loop failed unexpectedly ({Error}); the next run will try again", ex.GetType().Name);
            }

            delay = Interval;
        }
    }

    public async Task<EmploymentHeroTimesheetTick> RunTickAsync(bool checkChanges, CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var dbOptions = scope.ServiceProvider.GetRequiredService<DbContextOptions<OdipDbContext>>();
        var sender = scope.ServiceProvider.GetRequiredService<EmploymentHeroTimesheetSender>();

        List<Guid> tenantIds;
        await using (var across = new OdipDbContext(dbOptions, new ScopedTenantOverride { IsSuperAdmin = true }))
            tenantIds = await across.EmploymentHeroConnections.AsNoTracking().Select(c => c.TenantId).ToListAsync(ct);

        var failures = 0;
        foreach (var tenantId in tenantIds)
        {
            try
            {
                await using var db = new OdipDbContext(dbOptions, new ScopedTenantOverride { TenantId = tenantId });
                await sender.RunAsync(db, tenantId, checkChanges, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                failures++;
                _logger.LogError("Employment Hero timesheets failed for organisation {TenantId} ({Error}); the others carry on", tenantId, ex.GetType().Name);
            }
        }

        return new EmploymentHeroTimesheetTick(tenantIds.Count, failures);
    }
}
