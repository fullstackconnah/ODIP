using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.BackgroundServices;

/// <summary>
/// Keeps the landing page's promise about alpha sign-ups: "We keep them until the alpha ends, for 12 months at most, or delete them
/// sooner if you ask" (spec 2026-10-16, L6). Deletes every EarlyAccessRequest last sent more than <see cref="RetentionMonths"/> ago:
/// once when the API starts, then every <see cref="Interval"/>. A repeat sign-up moves LastRequestedAtUtc, so it restarts that
/// person's 12 months. Sooner deletion is the SuperAdmin's Delete (AdminEarlyAccessController). Same shape as the bell purge in
/// NotificationDispatchBackgroundService, and like it no audit rows: the retention rule is the record, and a log line gives the count.
/// </summary>
public class EarlyAccessPurgeBackgroundService : BackgroundService
{
    public const int RetentionMonths = 12;
    public static readonly TimeSpan Interval = TimeSpan.FromHours(24);

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
            try
            {
                await PurgeExpiredAsync(DateTime.UtcNow, stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "Early-access sign-up purge failed");
            }

            try { await Task.Delay(Interval, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }

    /// <summary>Deletes sign-ups last sent before <paramref name="nowUtc"/> minus 12 months and returns how many went.</summary>
    public async Task<int> PurgeExpiredAsync(DateTime nowUtc, CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var dbOptions = scope.ServiceProvider.GetRequiredService<DbContextOptions<OdipDbContext>>();
        // The table has no tenant filter; the override only satisfies the constructor, as in the bell purge.
        await using var db = new OdipDbContext(dbOptions, new Notifications.ScopedTenantOverride { IsSuperAdmin = true });
        var cutoff = nowUtc.AddMonths(-RetentionMonths);
        // ExecuteDeleteAsync is PostgreSQL-only here (EF InMemory has none), so its tests are PostgreSQL facts.
        // shortcut: no LastRequestedAtUtc index, so this is a daily scan of a table of a few hundred rows; add one if it grows large.
        var deleted = await db.EarlyAccessRequests.Where(e => e.LastRequestedAtUtc < cutoff).ExecuteDeleteAsync(ct);
        // Logged here, not in the loop, so the tests that call this method see it. A count only: never an address or a name.
        if (deleted > 0)
            _logger.LogInformation("Deleted {Count} early-access sign-ups last sent more than {Months} months ago", deleted, RetentionMonths);
        return deleted;
    }
}
