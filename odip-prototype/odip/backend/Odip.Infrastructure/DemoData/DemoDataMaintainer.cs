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

/// <param name="Conflict">True when the database refused the write because someone else got there first (a serialization failure or a deadlock): expected, retried next tick. A duplicate key is NOT one: it is reported as a failure that names its constraint.</param>
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
/// The flag is checked first and nothing else is touched when it is Off. The maintainer holds two pieces of state: the provider-local
/// date of the last tick, for "between 00:00 and 05:00 only the first tick of the day runs" (a restart resets it, which is the intended
/// "startup run"), and per pack how many ticks in a row it has conflicted, so a conflict that never goes away becomes an Error.
/// </summary>
public sealed class DemoDataMaintainer
{
    private const int QuietHoursEndLocal = 5;

    /// <summary>A pack that conflicts on this many ticks in a row stops being "a race, try again" and is logged at Error.</summary>
    private const int ConflictEscalationTicks = 3;

    private readonly DemoDataOptions _options;
    private readonly TimeProvider _clock;
    private readonly ILogger<DemoDataMaintainer> _logger;
    private readonly IReadOnlyList<IDemoPack> _packs;
    private readonly IDemoTickLock _tickLock;
    private DateOnly? _lastRunLocalDate;
    private readonly Dictionary<string, int> _conflictStreak = new();
    private readonly object _streakLock = new();

    public DemoDataMaintainer(DemoDataOptions options, TimeProvider clock, ILogger<DemoDataMaintainer> logger,
        IEnumerable<IDemoPack>? packs = null, IDemoTickLock? tickLock = null)
    {
        _options = options;
        _clock = clock;
        _logger = logger;
        _packs = (packs ?? DemoPacks.Default()).Where(pack => options.Allows(pack.Name)).ToList();           // DemoData:Packs: a pack left off never runs
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
        var stamps = new DemoAuditStamps();
        var guarded = new DbContextOptionsBuilder<OdipDbContext>(dbOptions)
            .AddInterceptors(new DemoAuditStampInterceptor(stamps), new DemoGuardInterceptor(new DemoTenantGuard(tenantId, owned)))
            .Options;
        await using var db = new OdipDbContext(guarded, new ScopedTenantOverride { TenantId = tenantId, IsSuperAdmin = false });

        // 3. The provider clock (the same lookup the app's own date rules use) and the day-roll cadence.
        var state = await DemoQueries.ProviderState(db).FirstOrDefaultAsync(ct);
        var anchors = DemoAnchors.Create(_clock.GetUtcNow().UtcDateTime, state);
        stamps.NowUtc = anchors.NowUtc;
        // Between 00:00 and 05:00 local only the day's first tick runs, so whatever falls due in those hours is written at the first tick after 05:00 (an event
        // scripted for 00:30 appears at 05:xx; it carries its scripted time, so the row is not wrong, only late to appear).
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
        var run = new DemoRun(db, anchors, tenantId, directory, _clock, _logger, stamps);

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
            EndStreak(pack.Name);
            ReportPieceFailures(pack.Name, run, failures);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            run.ClearUnitFailures();                                          // the pack is rolled back whole: its pieces' failures are part of that
            ReportFailure(pack.Name, ex, failures);
        }
        finally
        {
            if (transaction is not null) await transaction.DisposeAsync();   // rolls back anything not committed
            run.Db.ChangeTracker.Clear();
        }
    }

    private enum ConflictKind
    {
        /// <summary>An ordinary failure: a bug or an outage, always an Error.</summary>
        None,

        /// <summary>A serialization failure or a deadlock: somebody else wrote first. Expected, and retried next tick.</summary>
        Race,

        /// <summary>A unique violation. Not expected: demo ids are deterministic and every pack looks its rows up first, so this is a row
        /// (or an index added later) that collides with ours, and it will collide again.</summary>
        Duplicate,
    }

    private static (ConflictKind Kind, string? Constraint) Classify(Exception ex)
    {
        for (Exception? e = ex; e is not null; e = e.InnerException)
        {
            if (e is not PostgresException pg) continue;
            switch (pg.SqlState)
            {
                case PostgresErrorCodes.SerializationFailure:
                case PostgresErrorCodes.DeadlockDetected:
                    return (ConflictKind.Race, null);
                case PostgresErrorCodes.UniqueViolation:
                    return (ConflictKind.Duplicate, pg.ConstraintName);
            }
        }
        return (ConflictKind.None, null);
    }

    /// <summary>
    /// Records a failed pack and logs it at the level it deserves: Information for a race, Warning (with the constraint) for a duplicate
    /// key, Error for anything else, and Error for any conflict once the same pack has conflicted on <see cref="ConflictEscalationTicks"/>
    /// ticks in a row, because a conflict that does not go away is not a race.
    /// </summary>
    private void ReportFailure(string pack, Exception ex, List<DemoPackFailure> failures, bool piece = false)
    {
        var (kind, constraint) = Classify(ex);
        var constraintName = constraint ?? "(unknown)";
        var message = ex is DemoGuardViolationException ? ex.Message
            : kind == ConflictKind.Duplicate ? $"UniqueViolation on constraint {constraintName}: {DatabaseText(ex)}"
            : $"{ex.GetType().Name}: {ex.Message}";
        failures.Add(new DemoPackFailure(pack, message, kind == ConflictKind.Race));

        if (kind == ConflictKind.None)
        {
            EndStreak(pack);
            if (piece) _logger.LogError(ex, "Demo data: {Piece} failed and was undone; the rest of its pack carried on", pack);
            else _logger.LogError(ex, "Demo data: pack {Pack} failed and was rolled back; the other packs continue", pack);
            return;
        }

        var ticks = ExtendStreak(pack);
        if (ticks >= ConflictEscalationTicks)
        {
            var what = kind == ConflictKind.Duplicate ? $"duplicate key on constraint {constraintName}" : "serialization failure or deadlock";
            if (piece)
                _logger.LogError(ex, "Demo data: {Piece} has conflicted on {Ticks} consecutive ticks and is not recovering by itself ({What}); it was undone and the rest of its pack carried on", pack, ticks, what);
            else
                _logger.LogError(ex, "Demo data: pack {Pack} has conflicted on {Ticks} consecutive ticks and is not recovering by itself ({What}); it was rolled back and the other packs continue",
                    pack, ticks, what);
        }
        else if (kind == ConflictKind.Duplicate)
        {
            if (piece)
                _logger.LogWarning("Demo data: {Piece} hit a duplicate key on constraint {Constraint} and was undone; it will retry next tick (conflict {Ticks} in a row)", pack, constraintName, ticks);
            else
                _logger.LogWarning("Demo data: pack {Pack} hit a duplicate key on constraint {Constraint} and was rolled back; it will retry next tick (conflict {Ticks} in a row)",
                    pack, constraintName, ticks);
        }
        else
        {
            if (piece) _logger.LogInformation("Demo data: {Piece} lost a race with another writer and was undone; it will retry next tick", pack);
            else _logger.LogInformation("Demo data: pack {Pack} lost a race with another writer and was rolled back; it will retry next tick", pack);
        }
    }

    /// <summary>
    /// A pack's pieces that failed and were undone (a live shift) are failures of the pack for the tick's result and the log, named by pack and piece, but the
    /// pack itself committed what the other pieces wrote. A piece that did not fail this tick has no conflict streak to keep.
    /// </summary>
    private void ReportPieceFailures(string pack, DemoRun run, List<DemoPackFailure> failures)
    {
        var pieces = run.UnitFailures.ToList();
        run.ClearUnitFailures();
        foreach (var (unit, error) in pieces) ReportFailure($"{pack}: {unit}", error, failures, piece: true);

        var failedNow = pieces.Select(p => $"{pack}: {p.Unit}").ToHashSet(StringComparer.Ordinal);
        lock (_streakLock)
        {
            foreach (var key in _conflictStreak.Keys.Where(k => k.StartsWith(pack + ": ", StringComparison.Ordinal) && !failedNow.Contains(k)).ToList())
                _conflictStreak.Remove(key);
        }
    }

    /// <summary>
    /// What the database said about a conflict, which the exception around it does not repeat: its message (which names the constraint) and, only when the connection
    /// string says Include Error Detail, the key that was taken (Npgsql leaves the detail out otherwise, as the production connection string does).
    /// </summary>
    private static string DatabaseText(Exception ex)
    {
        for (Exception? e = ex; e is not null; e = e.InnerException)
        {
            if (e is PostgresException pg) return string.IsNullOrWhiteSpace(pg.Detail) ? pg.MessageText : $"{pg.MessageText}. {pg.Detail}";
        }
        return ex.Message;
    }

    private int ExtendStreak(string pack)
    {
        lock (_streakLock) return _conflictStreak[pack] = _conflictStreak.GetValueOrDefault(pack) + 1;
    }

    private void EndStreak(string pack)
    {
        lock (_streakLock) _conflictStreak.Remove(pack);
    }

    private void LogSummary(DemoTickResult result)
    {
        var anchors = result.Anchors!;
        _logger.LogInformation(
            "Demo data tick for {Today} in {Zone} (tz database: {TzData}): {Added} rows added, {Changed} changed, {Skipped} stories skipped, {Failed} packs failed, {Ms} ms",
            anchors.D0, anchors.Provider.Id, ProviderLocalTime.TzDataAvailable ? "present" : "MISSING, fixed +10:00",
            result.RowsAdded.Values.Sum(), result.RowsChanged.Values.Sum(), result.SkippedStories.Count, result.Failures.Count,
            (long)result.Elapsed.TotalMilliseconds);

        // A piece of a pack that committed (a live shift undone and tried again next tick) counts among the "packs failed" above; say how many of them are.
        var pieces = result.Failures.Count(f => f.Pack.Contains(": ", StringComparison.Ordinal));
        if (pieces > 0)
            _logger.LogInformation("Demo data: {Pieces} of those failures are pieces of a pack that committed (undone, and tried again at the next tick): {Names}",
                pieces, string.Join("; ", result.Failures.Where(f => f.Pack.Contains(": ", StringComparison.Ordinal)).Select(f => f.Pack)));

        if (result.SkippedStories.Count > 0)
            _logger.LogInformation("Demo data: skipped stories: {Stories}", string.Join("; ", result.SkippedStories));
    }
}
