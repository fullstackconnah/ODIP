using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Retention;
using Odip.Infrastructure.Services;
using Odip.Infrastructure.Tasks;

namespace Odip.Infrastructure.BackgroundServices;

/// <summary>
/// Nightly: for each organisation, counts its archived participants whose 7-year retention has run out (<see cref="RetentionClock"/>) and keeps ONE open "records due for purge" task for the Admin
/// in step with that count. It deletes nothing: only an Admin's confirmed purge does (DataRetentionController). Same shape as <see cref="EarlyAccessPurgeBackgroundService"/>, and like it
/// it never throws and logs counts only, never a name.
/// On by default; <c>Retention:ScanEnabled=false</c> switches it off. <see cref="RunOnceAsync"/> works regardless, so it can be tested and run by hand.
/// </summary>
public class RetentionScanBackgroundService : BackgroundService
{
    public const string ScanEnabledKey = "Retention:ScanEnabled";
    public static bool Enabled(IConfiguration config) => config.GetValue(ScanEnabledKey, true);
    public static readonly TimeSpan Interval = TimeSpan.FromHours(24);
    public static readonly TimeSpan RetryInterval = TimeSpan.FromMinutes(30);
    public static readonly TimeSpan FirstRunDelay = TimeSpan.FromMinutes(10);
    public const string LinkTo = "/settings?tab=retention";

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<RetentionScanBackgroundService> _logger;
    private readonly TimeProvider _clock;

    public RetentionScanBackgroundService(IServiceScopeFactory scopeFactory, IConfiguration config, ILogger<RetentionScanBackgroundService> logger, TimeProvider? clock = null)
    {
        _scopeFactory = scopeFactory;
        _config = config;
        _logger = logger;
        _clock = clock ?? TimeProvider.System;
    }

    /// <summary>The task's idempotency key: one per organisation per day. A still-open task keeps the key it was made with, so the count refreshes in place instead of a second task piling up.</summary>
    public static string SourceKey(Guid tenantId, DateOnly today) => $"{KeyPrefix(tenantId)}{today:yyyy-MM-dd}";
    private static string KeyPrefix(Guid tenantId) => $"retention-due:{tenantId}:";

    public static string Title(int n) => n == 1 ? "1 participant record is due for purge" : $"{n} participant records are due for purge";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!Enabled(_config))
        {
            _logger.LogInformation("The retention scan is off ({Key} is false)", ScanEnabledKey);
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
            // Every query below names the organisation itself; the override only satisfies the constructor, as in the early-access purge.
            await using var db = new OdipDbContext(dbOptions, new Notifications.ScopedTenantOverride { IsSuperAdmin = true });
            foreach (var tenantId in await db.Tenants.Select(t => t.Id).ToListAsync(ct))
            {
                try { await ScanTenantAsync(db, tenantId, ct); }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    db.ChangeTracker.Clear();
                    _logger.LogError("Retention scan failed for one organisation: {Error}", ex.GetType().Name); // the type only: a message can carry a name
                }
            }
            return Interval;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError("Retention scan failed: {Error}", ex.GetType().Name);
            return RetryInterval;
        }
    }

    private async Task ScanTenantAsync(OdipDbContext db, Guid tenantId, CancellationToken ct)
    {
        var zone = (await ProviderTimeZoneResolver.ResolveAsync(db, tenantId, ct)).Zone;
        var today = ProviderLocalTime.TodayIn(_clock.GetUtcNow().UtcDateTime, zone);
        var starts = await RetentionClock.EffectiveStartsAsync(db, tenantId, zone, null, ct);
        var due = starts.Values.Count(s => RetentionClock.IsDue(s, today));

        // F9: archived participants with no clock never come due; the count is logged so a gap is visible.
        var noClock = await db.Set<Participant>().IgnoreQueryFilters([TenantFilter.Name]).CountAsync(p => p.TenantId == tenantId && !p.IsActive && !p.IsDraft && p.RetentionStartsOn == null, ct);
        if (noClock > 0) _logger.LogWarning("{Count} archived participants have no retention start and will not come due", noClock);

        var prefix = KeyPrefix(tenantId);
        var openKey = await db.BookingTasks.IgnoreQueryFilters([TenantFilter.Name])
            .Where(t => t.TenantId == tenantId && t.TaskType == TaskType.RetentionPurgeDue && t.SourceKey != null && t.SourceKey.StartsWith(prefix)
                && (t.Status == TaskItemStatus.NotStarted || t.Status == TaskItemStatus.InProgress))
            .OrderBy(t => t.CreatedAt).Select(t => t.SourceKey).FirstOrDefaultAsync(ct);

        var tasks = new ObligationTaskService(db, _clock);
        if (due > 0)
            await tasks.EnsureAsync(new ObligationTaskSpec(openKey ?? SourceKey(tenantId, today), TaskType.RetentionPurgeDue, Title(due), null, LinkTo, TenantId: tenantId), ct);
        else if (openKey is not null)
            await tasks.CompleteAsync(openKey, ct);
        await db.SaveChangesAsync(ct);
        if (due > 0) _logger.LogInformation("{Count} participant records are due for purge in one organisation", due);
    }
}
