using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Infrastructure.Tasks;

namespace Odip.Infrastructure.BackgroundServices;

/// <summary>
/// Nightly: for each organisation, keeps ONE open Admin task per compliance date within 90 days of it (<see cref="ComplianceDueTasks"/>), retitled as the date nears and passes, and closes the open task of any
/// date that was moved or deleted. Same shape as <see cref="RetentionScanBackgroundService"/>: it never throws and logs counts only, never a label (a key personnel label is a person's name).
/// On by default: <c>Compliance:ScanEnabled</c>. <see cref="RunOnceAsync"/> works regardless, so it can be tested and run by hand.
/// </summary>
public class ComplianceScanBackgroundService : BackgroundService
{
    public const string ScanEnabledKey = "Compliance:ScanEnabled";
    public static readonly TimeSpan Interval = TimeSpan.FromHours(24);
    public static readonly TimeSpan RetryInterval = TimeSpan.FromMinutes(30);
    public static readonly TimeSpan FirstRunDelay = TimeSpan.FromMinutes(10);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<ComplianceScanBackgroundService> _logger;
    private readonly TimeProvider _clock;

    public ComplianceScanBackgroundService(IServiceScopeFactory scopeFactory, IConfiguration config, ILogger<ComplianceScanBackgroundService> logger, TimeProvider? clock = null)
    {
        _scopeFactory = scopeFactory;
        _config = config;
        _logger = logger;
        _clock = clock ?? TimeProvider.System;
    }

    public static bool Enabled(IConfiguration config) => config.GetValue(ScanEnabledKey, true);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!Enabled(_config))
        {
            _logger.LogInformation("The compliance scan is off ({Key} is false)", ScanEnabledKey);
            return;
        }
        var wait = FirstRunDelay;
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await Task.Delay(wait, stoppingToken); }
            catch (OperationCanceledException) { break; }
            wait = await RunOnceAsync(stoppingToken);
        }
    }

    /// <summary>One scan of every organisation. Returns how long to wait before the next: <see cref="Interval"/>, or <see cref="RetryInterval"/> after a failure.</summary>
    public async Task<TimeSpan> RunOnceAsync(CancellationToken ct)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var dbOptions = scope.ServiceProvider.GetRequiredService<DbContextOptions<OdipDbContext>>();
            // Every query below names the organisation itself; the override only satisfies the constructor, as in the retention scan.
            await using var db = new OdipDbContext(dbOptions, new Notifications.ScopedTenantOverride { IsSuperAdmin = true });
            foreach (var tenantId in await db.Tenants.Select(t => t.Id).ToListAsync(ct))
            {
                try { await ScanTenantAsync(db, tenantId, ct); }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    db.ChangeTracker.Clear();
                    _logger.LogError("Compliance scan failed for one organisation: {Error}", ex.GetType().Name); // the type only: a message can carry a name
                }
            }
            return Interval;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError("Compliance scan failed: {Error}", ex.GetType().Name);
            return RetryInterval;
        }
    }

    private async Task ScanTenantAsync(OdipDbContext db, Guid tenantId, CancellationToken ct)
    {
        var zone = (await ProviderTimeZoneResolver.ResolveAsync(db, tenantId, ct)).Zone;
        var today = ProviderLocalTime.TodayIn(_clock.GetUtcNow().UtcDateTime, zone);
        // The context has no tenant filter, so both queries name the organisation: otherwise one organisation's scan would close every other's reminders.
        var items = await db.ComplianceItems.IgnoreQueryFilters([TenantFilter.Name]).Where(i => i.TenantId == tenantId).ToListAsync(ct);

        var tasks = new ObligationTaskService(db, _clock);
        var wanted = new HashSet<string>();
        foreach (var spec in items.Select(i => ComplianceDueTasks.Spec(i, today, tenantId)).Where(spec => spec is not null).Select(spec => spec!))
        {
            wanted.Add(spec.SourceKey);
            await tasks.EnsureAsync(spec, ct);
        }

        var open = await db.BookingTasks.IgnoreQueryFilters([TenantFilter.Name])
            .Where(t => t.TenantId == tenantId && t.TaskType == TaskType.ComplianceDue && t.SourceKey != null && t.SourceKey.StartsWith(ComplianceDueTasks.KeyPrefix)
                && (t.Status == TaskItemStatus.NotStarted || t.Status == TaskItemStatus.InProgress))
            .Select(t => t.SourceKey!).ToListAsync(ct);
        var closed = 0;
        foreach (var key in open.Where(k => !wanted.Contains(k)))
        {
            await tasks.CompleteAsync(key, ct);
            closed++;
        }
        await db.SaveChangesAsync(ct);
        if (wanted.Count + closed > 0) _logger.LogInformation("Compliance scan: {Open} dates within 90 days, {Closed} reminders closed in one organisation", wanted.Count, closed);
    }
}
