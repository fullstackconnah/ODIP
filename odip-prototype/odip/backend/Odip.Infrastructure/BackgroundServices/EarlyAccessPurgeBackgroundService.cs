using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.BackgroundServices;

/// <summary>
/// Keeps the landing page's promise about alpha sign-ups: "We keep them until the alpha ends, for 12 months at most, or delete them
/// sooner if you ask" (spec 2026-10-16, L6). Deletes every EarlyAccessRequest first sent (CreatedAtUtc) <see cref="RetentionMonths"/>
/// ago or longer: once when the API starts, then every <see cref="Interval"/>. The cutoff is one interval early (see <see cref="PurgeExpiredAsync"/>), so a row is
/// gone at least an hour before its 12 months and never after. Alpha-end cleanup: docs/runbooks/early-access-alpha-cleanup.md. A repeat sign-up does NOT restart the 12 months: anyone can
/// send the form again with someone else's address, and that must not keep their details longer (lead decision, 2026-10-16). Sooner deletion is the SuperAdmin's Delete (AdminEarlyAccessController). Same shape as the bell purge in
/// NotificationDispatchBackgroundService, and like it no audit rows: the retention rule is the record, and a log line gives the count.
/// </summary>
public class EarlyAccessPurgeBackgroundService : BackgroundService
{
    public const int RetentionMonths = 12;
    public static readonly TimeSpan Interval = TimeSpan.FromHours(1);
    public static readonly TimeSpan RetryInterval = TimeSpan.FromMinutes(5);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<EarlyAccessPurgeBackgroundService> _logger;

    public EarlyAccessPurgeBackgroundService(IServiceScopeFactory scopeFactory, ILogger<EarlyAccessPurgeBackgroundService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            var wait = await RunOnceAsync(DateTime.UtcNow, stoppingToken);
            try { await Task.Delay(wait, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }

    /// <summary>Runs one purge and returns how long to wait before the next: <see cref="Interval"/>, or <see cref="RetryInterval"/> after a failure.</summary>
    public async Task<TimeSpan> RunOnceAsync(DateTime nowUtc, CancellationToken ct)
    {
        try
        {
            await PurgeExpiredAsync(nowUtc, ct);
            return Interval;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Early-access sign-up purge failed");
            // A failed run retried an hour later could leave a row past its 12 months by that hour.
            return RetryInterval;
        }
    }

    /// <summary>
    /// The latest CreatedAtUtc a run at <paramref name="nowUtc"/> deletes: the newest sign-up whose <c>AddMonths(12)</c> falls at or before
    /// now plus one <see cref="Interval"/>. AddMonths clamps (29 Feb 2024 + 12 months is 28 Feb 2025), so stepping back 12 months is not
    /// its inverse and would miss that 29 Feb row until about 1 Mar; when one more day still lands inside the bound, take it. That deletes
    /// the 28 Feb rows up to a day early ("or delete them sooner" is the promise) and no row is ever kept past its 12 months.
    /// </summary>
    public static DateTime RetentionCutoff(DateTime nowUtc)
    {
        var bound = nowUtc + Interval;
        var cutoff = bound.AddMonths(-RetentionMonths);
        return cutoff.AddDays(1).AddMonths(RetentionMonths) <= bound ? cutoff.AddDays(1) : cutoff;
    }

    /// <summary>
    /// Deletes sign-ups first sent at or before <see cref="RetentionCutoff"/>, and returns how many went.
    /// Running hourly with the cutoff an hour early means no row survives its 12 months, whichever minute the run lands on.
    /// </summary>
    public async Task<int> PurgeExpiredAsync(DateTime nowUtc, CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var dbOptions = scope.ServiceProvider.GetRequiredService<DbContextOptions<OdipDbContext>>();
        // The table has no tenant filter; the override only satisfies the constructor, as in the bell purge.
        await using var db = new OdipDbContext(dbOptions, new Notifications.ScopedTenantOverride { IsSuperAdmin = true });
        var cutoff = RetentionCutoff(nowUtc);
        // ExecuteDeleteAsync is PostgreSQL-only here (EF InMemory has none), so its tests are PostgreSQL facts.
        // shortcut: no CreatedAtUtc index, so this is an hourly scan of a table of a few hundred rows; add one if it grows large.
        var deleted = await db.EarlyAccessRequests.Where(e => e.CreatedAtUtc <= cutoff).ExecuteDeleteAsync(ct);
        // Logged here, not in the loop, so the tests that call this method see it. A count only: never an address or a name.
        if (deleted > 0)
            _logger.LogInformation("Deleted {Count} early-access sign-ups first sent more than {Months} months ago", deleted, RetentionMonths);
        return deleted;
    }
}
