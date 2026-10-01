using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// Holds the shift row (<c>SELECT ... FOR UPDATE</c>) until the operation commits or is disposed. Two operations must not interleave on a shift:
/// Finish (reads the end-of-shift blockers, then flips the shift to PendingReview) and Start Break (re-checks the shift is open, then adds a running
/// break to its active completion). Both take this lock first, so whichever arrives second WAITS and then reads the state the first one committed: a
/// Start Break that wins makes Finish see the running break (422 FINISH_BLOCKED), a Finish that wins makes the Start Break see a shift that is no
/// longer open (409). Without it a break could be inserted in the gap between Finish's check and its write, leaving a running break on a submitted
/// completion that nobody can end (every break endpoint needs an InProgress shift).
///
/// PostgreSQL only: <see cref="Held"/> is false with any other provider (the in-memory test provider has no concurrent transactions). The lock opens a
/// transaction unless the context is already inside one, in which case it joins that one and the owner commits; <see cref="CommitAsync"/> commits only
/// a transaction this lock began, and disposing rolls back whatever was not committed. If the lock statement itself fails the transaction it began is
/// rolled back before the exception leaves, so the context is never left inside an aborted transaction.
/// </summary>
public sealed class ShiftRowLock : IAsyncDisposable
{
    private readonly IDbContextTransaction? _owned;

    private ShiftRowLock(IDbContextTransaction? owned, bool held)
    {
        _owned = owned;
        Held = held;
    }

    /// <summary>True when the row lock was taken (PostgreSQL). The caller should re-read the shift before trusting what it loaded earlier.</summary>
    public bool Held { get; }

    public static async Task<ShiftRowLock> AcquireAsync(OdipDbContext db, Guid shiftId, CancellationToken ct)
    {
        if (!db.Database.IsNpgsql()) return new ShiftRowLock(null, false);

        var owned = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(ct) : null;
        try
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT \"Id\" FROM \"Shifts\" WHERE \"Id\" = {shiftId} FOR UPDATE", ct);
            return new ShiftRowLock(owned, true);
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

    /// <summary>Commits the transaction this lock began, releasing the row; nothing to do when the caller owns the transaction or there is none.</summary>
    public Task CommitAsync(CancellationToken ct) => _owned is null ? Task.CompletedTask : _owned.CommitAsync(ct);

    /// <summary>Rolls back whatever was not committed (releasing the row).</summary>
    public ValueTask DisposeAsync() => _owned is null ? ValueTask.CompletedTask : _owned.DisposeAsync();
}
