using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Rostering;

/// <summary>
/// Holds one participant's roster against another generation until the transaction commits or is disposed. Shifts have no unique key (the demo pack places its own by a deterministic
/// id, and a natural key there would wedge it), so "does this pattern already have a shift on that day, then add it" is only safe when two of them cannot interleave: the Generate button,
/// the approval of an agreement revision and the daily top-up can all run for the same participant at once. They all take this lock first, so whichever comes second WAITS, and then looks
/// at the shifts the first one committed. The key is the participant's: <c>pg_advisory_xact_lock(hashtext('roster-generate:' || participantId))</c>.
///
/// PostgreSQL only: <see cref="Held"/> is false with any other provider (the in-memory test provider has no concurrent transactions). The lock opens a transaction unless the context is
/// already inside one, in which case it joins that one and the owner commits (an approval takes the lock first and holds it until its own work is saved); <see cref="CommitAsync"/> commits
/// only a transaction this lock began, and disposing rolls back whatever was not committed. If the lock statement itself fails the transaction it began is rolled back before the exception
/// leaves, so the context is never left inside an aborted transaction. The API registers <c>UseNpgsql</c> without <c>EnableRetryOnFailure</c>, so a transaction of its own is allowed.
/// </summary>
public sealed class RosterGenerationLock : IAsyncDisposable
{
    private readonly IDbContextTransaction? _owned;

    private RosterGenerationLock(IDbContextTransaction? owned, bool held)
    {
        _owned = owned;
        Held = held;
    }

    /// <summary>True when the lock was taken (PostgreSQL). Whatever was read before it was taken may have changed, and has to be read again.</summary>
    public bool Held { get; }

    public static async Task<RosterGenerationLock> AcquireAsync(OdipDbContext db, Guid participantId, CancellationToken ct)
    {
        if (!db.Database.IsNpgsql()) return new RosterGenerationLock(null, false);

        var owned = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(ct) : null;
        try
        {
            await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(hashtext('roster-generate:' || {0}::text))", new object[] { participantId }, ct);
            return new RosterGenerationLock(owned, true);
        }
        catch
        {
            if (owned is not null)
            {
                try { await owned.DisposeAsync(); } catch { /* the failure being reported is the one that matters */ }
            }
            throw;
        }
    }

    /// <summary>Commits the transaction this lock began, releasing it; nothing to do when the caller owns the transaction or there is none.</summary>
    public Task CommitAsync(CancellationToken ct) => _owned is null ? Task.CompletedTask : _owned.CommitAsync(ct);

    /// <summary>Rolls back whatever was not committed (releasing the lock).</summary>
    public ValueTask DisposeAsync() => _owned is null ? ValueTask.CompletedTask : _owned.DisposeAsync();
}
