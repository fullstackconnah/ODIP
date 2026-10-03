using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Microsoft.Extensions.Logging;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.DemoData;

/// <summary>One domain's worth of demo data (plan 4: "one pack class per domain"). A pack never throws for a missing prerequisite; it skips the story.</summary>
public interface IDemoPack
{
    /// <summary>Stable name used in the log line and in the per-pack row counts.</summary>
    string Name { get; }

    /// <summary>
    /// Builds the rows this pack is responsible for, adds the missing ones to <see cref="DemoRun.Db"/>, and saves. Existing rows are never
    /// rewritten (the owner's edits win), apart from the compare-and-set changes the plan lists (4.3).
    /// </summary>
    Task RunAsync(DemoRun run, CancellationToken ct);
}

/// <summary>Everything a pack needs for one tick: the Demo tenant's context, the provider clock, the people, and the counters.</summary>
public sealed class DemoRun
{
    private const int LookupChunk = 500;

    private readonly Dictionary<string, int> _added = new();
    private readonly Dictionary<string, int> _changed = new();
    private readonly List<string> _skipped = new();
    private readonly List<(string Unit, Exception Error)> _unitFailures = new();

    internal DemoRun(OdipDbContext db, DemoAnchors anchors, Guid tenantId, DemoDirectory directory, TimeProvider clock, ILogger logger,
        DemoAuditStamps? stamps = null)
    {
        Audit = stamps ?? new DemoAuditStamps { NowUtc = anchors.NowUtc };
        Db = db;
        Clock = clock;
        Anchors = anchors;
        TenantId = tenantId;
        Directory = directory;
        Logger = logger;
    }

    /// <summary>A context scoped to the Demo tenant: query filters are on, so a pack can only read this tenant's rows.</summary>
    public OdipDbContext Db { get; }

    public DemoAnchors Anchors { get; }

    private IReadOnlyDictionary<string, User>? _freshStaff;

    /// <summary>
    /// The staff the stories name (by story key), read from the database NOW. The directory's copies are made before the first pack runs and
    /// the tracker is cleared after every pack, so a pack that changes a user (the credential fill) leaves the directory's copy as it was: a pack
    /// that needs a credential or a competency reads the staff here instead. Read once per tick, after the packs that change them.
    /// </summary>
    public async Task<IReadOnlyDictionary<string, User>> FreshStaffAsync(CancellationToken ct)
    {
        if (_freshStaff is not null) return _freshStaff;

        var wanted = DemoPeople.StaffEmails.Keys.Select(key => (Key: key, Id: Directory.Staff(key)?.Id)).Where(x => x.Id is not null).ToList();
        var users = await DemoQueries.UsersByIds(Db, wanted.Select(x => x.Id!.Value).ToList()).ToListAsync(ct);
        return _freshStaff = wanted.ToDictionary(x => x.Key, x => users.First(u => u.Id == x.Id));
    }

    /// <summary>
    /// The audit stamps of this tick (plan 4.4). Without a stamp an audit row says the row's own CreatedAt / UpdatedAt and the system actor;
    /// <see cref="StampAudit"/> names a time and a scripted person for the next save of one entity.
    /// </summary>
    public DemoAuditStamps Audit { get; }

    public Guid TenantId { get; }

    public DemoDirectory Directory { get; }

    public ILogger Logger { get; }

    /// <summary>The tick's clock, for the app's own services (obligation tasks) that take a <see cref="TimeProvider"/>.</summary>
    public TimeProvider Clock { get; }

    public DateTime NowUtc => Anchors.NowUtc;

    /// <summary>Set by the maintainer before each pack runs, so counts are filed under the pack that produced them.</summary>
    internal string CurrentPack { get; set; } = string.Empty;

    /// <summary>
    /// The audit row the next save writes for <paramref name="entityId"/> will say <paramref name="whenUtc"/> and, when given, that the demo user
    /// <paramref name="actorUserKey"/> (a story key such as "sarah") made the change; with no key, the system actor.
    /// </summary>
    public void StampAudit(Guid entityId, DateTime whenUtc, string? actorUserKey = null)
    {
        var actor = actorUserKey is null ? null : Directory.Staff(actorUserKey);
        Audit.Set(entityId, whenUtc, actor?.Id, actor is null ? null : $"{actor.FirstName} {actor.LastName}".Trim());
    }

    /// <summary>The audit row the next save writes for <paramref name="entityId"/> says <paramref name="whenUtc"/> and that <paramref name="actor"/> did it.</summary>
    public void StampAudit(Guid entityId, DateTime whenUtc, Odip.Domain.Entities.User actor) => Audit.Set(entityId, whenUtc, actor.Id, actor.FullName);

    public void Added(string kind, int count = 1) => Bump(_added, kind, count);

    public void Changed(string kind, int count = 1) => Bump(_changed, kind, count);

    /// <summary>A story that could not be built (a person it needs is missing): logged once at the end of the tick, never an error.</summary>
    public void Skipped(string story, string reason) => _skipped.Add($"{CurrentPack}: {story} ({reason})");

    internal IReadOnlyDictionary<string, int> AddedCounts => _added;

    internal IReadOnlyDictionary<string, int> ChangedCounts => _changed;

    internal IReadOnlyList<string> SkippedStories => _skipped;

    /// <summary>
    /// A lookup over ids in chunks of 500 (the chunk <see cref="ExistingIdsAsync{T}"/> uses), so a list of ids never makes one statement grow without bound.
    /// </summary>
    public async Task<List<T>> ChunkedAsync<T>(IEnumerable<Guid> ids, Func<List<Guid>, IQueryable<T>> query, CancellationToken ct)
    {
        var found = new List<T>();
        foreach (var chunk in ids.Distinct().Chunk(LookupChunk)) found.AddRange(await query(chunk.ToList()).ToListAsync(ct));
        return found;
    }

    /// <summary>
    /// Which of these ids already exist as <typeparamref name="T"/> rows: the "insert-if-missing" lookup (plan 4.2), a primary-key probe
    /// (<c>WHERE "Id" = ANY(@ids)</c>) in chunks of 500. Query filters are ignored on purpose: an id that exists under any tenant is taken,
    /// so a collision shows up as "already there" rather than as a failed insert.
    /// </summary>
    public async Task<HashSet<Guid>> ExistingIdsAsync<T>(IEnumerable<Guid> ids, CancellationToken ct) where T : class
    {
        var found = new HashSet<Guid>();
        foreach (var chunk in ids.Distinct().Chunk(LookupChunk))
        {
            found.UnionWith(await DemoQueries.ExistingIds<T>(Db, chunk).ToListAsync(ct));
        }
        return found;
    }

    /// <summary>
    /// Saves the pack's pending changes. The guard runs inside this (it is an interceptor on the context), so a write the plan forbids
    /// throws <see cref="DemoGuardViolationException"/> here, before anything is sent to the database.
    /// </summary>
    public Task SaveAsync(CancellationToken ct) => Db.SaveChangesAsync(ct);

    /// <summary>The pieces of a pack that failed and were skipped (see <see cref="TryUnitAsync"/>): the maintainer reports each as a failure of the pack.</summary>
    internal IReadOnlyList<(string Unit, Exception Error)> UnitFailures => _unitFailures;

    internal void ClearUnitFailures() => _unitFailures.Clear();

    private const string UnitSavepoint = "demo_unit";

    /// <summary>
    /// Runs one independent piece of a pack (one live shift) whole or not at all, so a piece that cannot be written never takes the others with it. A pack is one
    /// transaction, and on PostgreSQL a failed statement poisons it, so the piece runs inside a savepoint: on failure the database is put back to the savepoint,
    /// what the tracker holds of the piece is forgotten (rows it added are detached, rows it changed or saved are read again, so nothing in memory describes
    /// a write that was rolled back) and the failure is kept for the maintainer to report; the pack goes on with its next piece. On a store with no
    /// transactions (EF InMemory) the saves the piece had made stay, which the next tick finds as rows already there.
    /// </summary>
    /// <returns>True when the piece was written; false when it failed and was undone.</returns>
    public async Task<bool> TryUnitAsync(string unit, Func<Task> work, CancellationToken ct)
    {
        if (Db.ChangeTracker.HasChanges()) await SaveAsync(ct);                       // nothing from before the piece is inside its savepoint

        var transaction = Db.Database.CurrentTransaction;
        var savepoint = transaction is { SupportsSavepoints: true } ? UnitSavepoint : null;
        var (added, changed) = (new Dictionary<string, int>(_added), new Dictionary<string, int>(_changed));
        if (savepoint is not null) await transaction!.CreateSavepointAsync(savepoint, ct);
        try
        {
            await work();
            if (Db.ChangeTracker.HasChanges()) await SaveAsync(ct);                   // whole or not at all
            if (savepoint is not null) await transaction!.ReleaseSavepointAsync(savepoint, ct);
            return true;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            try
            {
                if (savepoint is not null)
                {
                    await transaction!.RollbackToSavepointAsync(savepoint, ct);
                    await transaction.ReleaseSavepointAsync(savepoint, ct);              // rolling back keeps the savepoint defined: pop it, so the next piece starts level
                }
                await ForgetUnsavedAndReloadAsync(ct);
            }
            catch (Exception undoing) when (undoing is not OperationCanceledException)
            {
                // The piece failed and could not be put back (a broken connection, say): the pack goes down with both reasons, the piece's own first, so the log still says
                // what went wrong in it (the first review's N3).
                throw new AggregateException($"live piece '{unit}' failed and could not be undone", ex, undoing);
            }
            _added.Clear();
            _changed.Clear();
            foreach (var (key, count) in added) _added[key] = count;                     // the counts say what is written, not what was undone
            foreach (var (key, count) in changed) _changed[key] = count;
            _unitFailures.Add((unit, ex));
            return false;
        }
    }

    /// <summary>
    /// Puts the tracker back to what the database now holds. Added rows are detached first (a failed save leaves them Added, and the rows saved inside the piece are
    /// read again and found gone). This assumes a piece saves once after its start: a row that was reloaded to "gone" while a tracked row still pointed at it on a
    /// required or SetNull foreign key would be fixed up by EF (an exception, or a null written by the next save). A piece that saves in several steps must remember
    /// what it added and changed and undo those, dependents first (independent review N4).
    /// </summary>
    private async Task ForgetUnsavedAndReloadAsync(CancellationToken ct)
    {
        foreach (var entry in Db.ChangeTracker.Entries().ToList())
            if (entry.State == EntityState.Added) entry.State = EntityState.Detached;      // the audit rows of the failed save too

        foreach (var entry in Db.ChangeTracker.Entries().ToList())
            await entry.ReloadAsync(ct);                                                  // as the database has it now, or gone (detached)
    }

    private void Bump(Dictionary<string, int> counts, string kind, int count)
    {
        if (count <= 0) return;
        var key = CurrentPack.Length == 0 ? kind : $"{CurrentPack}/{kind}";
        counts[key] = counts.GetValueOrDefault(key) + count;
    }
}
