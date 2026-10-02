using Microsoft.EntityFrameworkCore;
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

    internal DemoRun(OdipDbContext db, DemoAnchors anchors, Guid tenantId, DemoDirectory directory, ILogger logger)
    {
        Db = db;
        Anchors = anchors;
        TenantId = tenantId;
        Directory = directory;
        Logger = logger;
    }

    /// <summary>A context scoped to the Demo tenant: query filters are on, so a pack can only read this tenant's rows.</summary>
    public OdipDbContext Db { get; }

    public DemoAnchors Anchors { get; }

    public Guid TenantId { get; }

    public DemoDirectory Directory { get; }

    public ILogger Logger { get; }

    public DateTime NowUtc => Anchors.NowUtc;

    /// <summary>Set by the maintainer before each pack runs, so counts are filed under the pack that produced them.</summary>
    internal string CurrentPack { get; set; } = string.Empty;

    public void Added(string kind, int count = 1) => Bump(_added, kind, count);

    public void Changed(string kind, int count = 1) => Bump(_changed, kind, count);

    /// <summary>A story that could not be built (a person it needs is missing): logged once at the end of the tick, never an error.</summary>
    public void Skipped(string story, string reason) => _skipped.Add($"{CurrentPack}: {story} ({reason})");

    internal IReadOnlyDictionary<string, int> AddedCounts => _added;

    internal IReadOnlyDictionary<string, int> ChangedCounts => _changed;

    internal IReadOnlyList<string> SkippedStories => _skipped;

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
            var present = await Db.Set<T>().IgnoreQueryFilters()
                .Where(e => chunk.Contains(EF.Property<Guid>(e, "Id")))
                .Select(e => EF.Property<Guid>(e, "Id"))
                .ToListAsync(ct);
            found.UnionWith(present);
        }
        return found;
    }

    /// <summary>
    /// Saves the pack's pending changes. The guard runs inside this (it is an interceptor on the context), so a write the plan forbids
    /// throws <see cref="DemoGuardViolationException"/> here, before anything is sent to the database.
    /// </summary>
    public Task SaveAsync(CancellationToken ct) => Db.SaveChangesAsync(ct);

    private void Bump(Dictionary<string, int> counts, string kind, int count)
    {
        if (count <= 0) return;
        var key = CurrentPack.Length == 0 ? kind : $"{CurrentPack}/{kind}";
        counts[key] = counts.GetValueOrDefault(key) + count;
    }
}
