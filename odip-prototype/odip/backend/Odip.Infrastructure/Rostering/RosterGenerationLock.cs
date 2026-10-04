using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Rostering;

/// <summary>Another change to the same participant's roster held the lock for longer than it is worth waiting. Nothing was changed: say so and try again.</summary>
public sealed class RosterBusyException : InvalidOperationException
{
    public const string Words = "Another change to this participant's roster is still running. Wait a moment, then try again.";
    public RosterBusyException() : base(Words) { }
}

/// <summary>
/// Holds one participant's roster against another generation until the transaction commits or is disposed. Shifts have no unique key (the demo pack places its own by a deterministic
/// id, and a natural key there would wedge it), so "does this pattern already have a shift on that day, then add it" is only safe when two of them cannot interleave: the Generate button,
/// the approval of an agreement revision and the daily top-up can all run for the same participant at once. They all take this lock first, so whichever comes second WAITS, and then looks
/// at the shifts the first one committed. The key is the participant's: <c>pg_advisory_xact_lock(hashtext('roster-generate:' || participantId))</c>.
///
/// PostgreSQL only: <see cref="Held"/> is false with any other provider (the in-memory test provider has no concurrent transactions). The lock opens a transaction unless the context is
/// already inside one, in which case it joins that one and the owner commits (an approval takes the lock first and holds it until its own work is saved); <see cref="CommitAsync"/> commits
/// only a transaction this lock began, and disposing rolls back whatever was not committed. The wait is bounded (<see cref="DefaultWait"/>, under the driver's 30 s command timeout, as the catalogue
/// import lock does it): a holder that has stalled turns a click into a <see cref="RosterBusyException"/> the controllers answer with a 409, not a hung request and a raw 500. If the lock statement itself fails the transaction it began is rolled back before the exception
/// leaves, so the context is never left inside an aborted transaction. The API registers <c>UseNpgsql</c> without <c>EnableRetryOnFailure</c>, so a transaction of its own is allowed.
/// </summary>
public sealed class RosterGenerationLock : IAsyncDisposable
{
    /// <summary>How long a generation waits for another one of the same participant to finish: an approval or a top-up is a second or two of work.</summary>
    public static readonly TimeSpan DefaultWait = TimeSpan.FromSeconds(10);

    private readonly IDbContextTransaction? _owned;

    private RosterGenerationLock(IDbContextTransaction? owned, bool held)
    {
        _owned = owned;
        Held = held;
    }

    /// <summary>True when the lock was taken (PostgreSQL). Whatever was read before it was taken may have changed, and has to be read again.</summary>
    public bool Held { get; }

    public static async Task<RosterGenerationLock> AcquireAsync(OdipDbContext db, Guid participantId, CancellationToken ct, TimeSpan? wait = null)
    {
        if (!db.Database.IsNpgsql()) return new RosterGenerationLock(null, false);

        var owned = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(ct) : null;
        try
        {
            // One round trip: bound the wait, take the lock, then hand the setting back to the server's own value for the rest of the transaction.
            var sql = string.Create(System.Globalization.CultureInfo.InvariantCulture,
                $"SET LOCAL lock_timeout = {(int)(wait ?? DefaultWait).TotalMilliseconds}; SELECT pg_advisory_xact_lock(hashtext('roster-generate:' || {{0}}::text)); SET LOCAL lock_timeout TO DEFAULT");
            await db.Database.ExecuteSqlRawAsync(sql, new object[] { participantId }, ct);
            return new RosterGenerationLock(owned, true);
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.LockNotAvailable)
        {
            await ReleaseAfterFailureAsync(owned);
            throw new RosterBusyException();
        }
        catch
        {
            await ReleaseAfterFailureAsync(owned);
            throw;
        }
    }

    /// <summary>Rolls back the transaction this class began (never one it joined); a failure to do so must not hide the original error.</summary>
    private static async Task ReleaseAfterFailureAsync(IDbContextTransaction? owned)
    {
        if (owned is null) return;
        try { await owned.DisposeAsync(); }
        catch { /* the failure being reported is the one that matters */ }
    }

    /// <summary>Commits the transaction this lock began, releasing it; nothing to do when the caller owns the transaction or there is none.</summary>
    public Task CommitAsync(CancellationToken ct) => _owned is null ? Task.CompletedTask : _owned.CommitAsync(ct);

    /// <summary>Rolls back whatever was not committed (releasing the lock).</summary>
    public ValueTask DisposeAsync() => _owned is null ? ValueTask.CompletedTask : _owned.DisposeAsync();
}
