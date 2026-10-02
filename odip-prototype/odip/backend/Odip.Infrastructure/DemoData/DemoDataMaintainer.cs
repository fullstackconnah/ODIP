using System.Data;
using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Logging;
using Npgsql;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Notifications;

namespace Odip.Infrastructure.DemoData;

public enum DemoTickStatus
{
    /// <summary>The flag is Off: nothing was read or written.</summary>
    Disabled,

    /// <summary>There is not exactly one active tenant named Demo on demo.odip.com.au: nothing was written.</summary>
    NoDemoTenant,

    /// <summary>Another maintainer holds the lock: this tick did nothing.</summary>
    LockHeld,

    /// <summary>Between 00:00 and 05:00 local, and the day's first tick already ran.</summary>
    QuietHours,

    /// <summary>The packs ran (some may have failed: see <see cref="DemoTickResult.Failures"/>).</summary>
    Ran,

    /// <summary>The tick itself could not start (the database was unreachable): see <see cref="DemoTickResult.Detail"/>.</summary>
    Failed,
}

/// <param name="Conflict">True when the database refused the write because someone else got there first (a duplicate key, a concurrent update): expected, retried next tick.</param>
public sealed record DemoPackFailure(string Pack, string Message, bool Conflict);

/// <summary>What a tick did: the row counts the log line is built from, and the evidence the tests read.</summary>
public sealed class DemoTickResult
{
    public DemoTickStatus Status { get; init; }
    public string? Detail { get; init; }
    public DemoAnchors? Anchors { get; init; }
    public IReadOnlyDictionary<string, int> RowsAdded { get; init; } = new Dictionary<string, int>();
    public IReadOnlyDictionary<string, int> RowsChanged { get; init; } = new Dictionary<string, int>();
    public IReadOnlyList<string> SkippedStories { get; init; } = Array.Empty<string>();
    public IReadOnlyList<DemoPackFailure> Failures { get; init; } = Array.Empty<DemoPackFailure>();
    public TimeSpan Elapsed { get; init; }
}

/// <summary>
/// Runs one top-up tick (plan 4 and 5.2): finds the one Demo tenant it may write to, takes the lock, works out the provider's
/// clock, and runs each pack in its own transaction so a failing pack logs, rolls back and never stops the others. It never throws
/// (apart from honouring cancellation), never deletes, and writes only through a tenant-scoped context guarded by
/// <see cref="DemoTenantGuard"/>.
///
/// The flag is checked first and nothing else is touched when it is Off. The maintainer holds one piece of state: the provider-local
/// date of the last tick, for "between 00:00 and 05:00 only the first tick of the day runs". A restart resets it, which is the intended
/// "startup run".
/// </summary>
public sealed class DemoDataMaintainer
{
    private const int QuietHoursEndLocal = 5;

    private readonly DemoDataOptions _options;
    private readonly TimeProvider _clock;
    private readonly ILogger<DemoDataMaintainer> _logger;
    private readonly IReadOnlyList<IDemoPack> _packs;
    private readonly IDemoTickLock _tickLock;
    private DateOnly? _lastRunLocalDate;

    public DemoDataMaintainer(DemoDataOptions options, TimeProvider clock, ILogger<DemoDataMaintainer> logger,
        IEnumerable<IDemoPack>? packs = null, IDemoTickLock? tickLock = null)
    {
        _options = options;
        _clock = clock;
        _logger = logger;
        _packs = (packs ?? DemoPacks.Default()).ToList();
        _tickLock = tickLock ?? new PostgresAdvisoryTickLock();
    }

    public async Task<DemoTickResult> RunAsync(DbContextOptions<OdipDbContext> dbOptions, CancellationToken ct)
    {
        if (!_options.Enabled) return new DemoTickResult { Status = DemoTickStatus.Disabled };

        var started = Stopwatch.GetTimestamp();
        try
        {
            return await RunTickAsync(dbOptions, started, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Demo data: the tick could not run");
            return new DemoTickResult { Status = DemoTickStatus.Failed, Detail = ex.Message, Elapsed = Stopwatch.GetElapsedTime(started) };
        }
    }

    private async Task<DemoTickResult> RunTickAsync(DbContextOptions<OdipDbContext> dbOptions, long started, CancellationToken ct)
    {
        // 1. The one tenant we may write to. The lookup context has no tenant of its own, so it can only see the (unfiltered) Tenants table.
        await using var lookup = new OdipDbContext(dbOptions, new ScopedTenantOverride());
        var candidates = await DemoQueries.DemoTenantCandidates(lookup).ToListAsync(ct);
        var demo = candidates
            .Where(t => t.IsActive && string.Equals(t.EmailDomain, DemoPeople.TenantEmailDomain, StringComparison.OrdinalIgnoreCase))
            .ToList();
        if (demo.Count != 1)
        {
            _logger.LogInformation(
                "Demo data: needs exactly one active Demo tenant (named {Name} on {Domain}) and found {Count}: nothing written",
                DemoPeople.TenantName, DemoPeople.TenantEmailDomain, demo.Count);
            return new DemoTickResult { Status = DemoTickStatus.NoDemoTenant, Elapsed = Stopwatch.GetElapsedTime(started) };
        }

        // 2. The working context: tenant-scoped (query filters on, TenantId stamped), with the guard attached after the audit interceptor.
        var tenantId = demo[0].Id;
        var owned = new DemoOwnedIds();
        var guarded = new DbContextOptionsBuilder<OdipDbContext>(dbOptions)
            .AddInterceptors(new DemoGuardInterceptor(new DemoTenantGuard(tenantId, owned)))
            .Options;
        await using var db = new OdipDbContext(guarded, new ScopedTenantOverride { TenantId = tenantId, IsSuperAdmin = false });

        // 3. The provider clock (the same lookup the app's own date rules use) and the day-roll cadence.
        var state = await DemoQueries.ProviderState(db).FirstOrDefaultAsync(ct);
        var anchors = DemoAnchors.Create(_clock.GetUtcNow().UtcDateTime, state);
        if (anchors.NowLocal.Hour < QuietHoursEndLocal && _lastRunLocalDate == anchors.D0)
        {
            return new DemoTickResult { Status = DemoTickStatus.QuietHours, Anchors = anchors, Elapsed = Stopwatch.GetElapsedTime(started) };
        }

        // 4. One maintainer per database.
        await using var held = await _tickLock.TryAcquireAsync(lookup, ct);
        if (held is null)
        {
            _logger.LogInformation("Demo data: another maintainer holds the lock, skipping this tick");
            return new DemoTickResult { Status = DemoTickStatus.LockHeld, Anchors = anchors, Elapsed = Stopwatch.GetElapsedTime(started) };
        }

        var directory = await DemoDirectory.LoadAsync(db, ct);
        directory.FillOwned(owned);
        var run = new DemoRun(db, anchors, tenantId, directory, _clock, _logger);

        var failures = new List<DemoPackFailure>();
        foreach (var pack in _packs)
        {
            await RunPackAsync(pack, run, failures, ct);
        }
        _lastRunLocalDate = anchors.D0;

        var result = new DemoTickResult
        {
            Status = DemoTickStatus.Ran,
            Anchors = anchors,
            RowsAdded = run.AddedCounts.ToDictionary(kv => kv.Key, kv => kv.Value),
            RowsChanged = run.ChangedCounts.ToDictionary(kv => kv.Key, kv => kv.Value),
            SkippedStories = run.SkippedStories.ToList(),
            Failures = failures,
            Elapsed = Stopwatch.GetElapsedTime(started),
        };
        LogSummary(result);
        return result;
    }

    /// <summary>
    /// One pack, one transaction. On Postgres the transaction is REPEATABLE READ, which is the compare-and-set: if anyone changes a row
    /// this pack read before the pack writes it, the write fails with a serialization error instead of overwriting their change, the pack
    /// rolls back, and the next tick tries again. (EF InMemory has no transactions, and no second writer either.)
    /// </summary>
    private async Task RunPackAsync(IDemoPack pack, DemoRun run, List<DemoPackFailure> failures, CancellationToken ct)
    {
        run.CurrentPack = pack.Name;
        IDbContextTransaction? transaction = null;
        try
        {
            if (run.Db.Database.IsRelational())
                transaction = await run.Db.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);

            await pack.RunAsync(run, ct);

            if (transaction is not null) await transaction.CommitAsync(ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            var conflict = IsConflict(ex);
            failures.Add(new DemoPackFailure(pack.Name, ex is DemoGuardViolationException ? ex.Message : $"{ex.GetType().Name}: {ex.Message}", conflict));
            if (conflict)
                _logger.LogInformation("Demo data: pack {Pack} lost a race with another writer and was rolled back; it will retry next tick", pack.Name);
            else
                _logger.LogError(ex, "Demo data: pack {Pack} failed and was rolled back; the other packs continue", pack.Name);
        }
        finally
        {
            if (transaction is not null) await transaction.DisposeAsync();   // rolls back anything not committed
            run.Db.ChangeTracker.Clear();
        }
    }

    /// <summary>A duplicate key, a serialization failure or a deadlock: somebody else wrote first. Expected, not a bug.</summary>
    private static bool IsConflict(Exception ex)
    {
        for (Exception? e = ex; e is not null; e = e.InnerException)
        {
            if (e is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation or PostgresErrorCodes.SerializationFailure or PostgresErrorCodes.DeadlockDetected })
                return true;
        }
        return false;
    }

    private void LogSummary(DemoTickResult result)
    {
        var anchors = result.Anchors!;
        _logger.LogInformation(
            "Demo data tick for {Today} in {Zone} (tz database: {TzData}): {Added} rows added, {Changed} changed, {Skipped} stories skipped, {Failed} packs failed, {Ms} ms",
            anchors.D0, anchors.Provider.Id, ProviderLocalTime.TzDataAvailable ? "present" : "MISSING, fixed +10:00",
            result.RowsAdded.Values.Sum(), result.RowsChanged.Values.Sum(), result.SkippedStories.Count, result.Failures.Count,
            (long)result.Elapsed.TotalMilliseconds);

        if (result.SkippedStories.Count > 0)
            _logger.LogInformation("Demo data: skipped stories: {Stories}", string.Join("; ", result.SkippedStories));
    }
}
