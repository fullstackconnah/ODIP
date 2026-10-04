using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// One participant's plan budget, one writer at a time. A save reads the participant's other plans to refuse an overlap (and, for a replace, reads the plan to
/// check its revision) and writes after: that is only right if nothing else wrote in between. The unique index on (tenant, participant, plan start) catches two plans
/// that start on the same day, but not two plans of different start days that overlap, and a plain check-then-insert lets two requests at once both pass the check.
/// So every create and replace first takes the participant's row (<c>SELECT ... FOR NO KEY UPDATE</c>) and holds it until the save commits: the second request WAITS, then
/// reads what the first one committed, and is refused with the same 409 a slower request would have had. At most one of two overlapping plans is ever saved.
///
/// FOR NO KEY UPDATE and not FOR UPDATE: the lock only has to exclude other plan writers for this participant. It does not conflict with the FOR KEY SHARE lock that
/// an insert of any row naming the participant (a shift, a claim) takes for its foreign key, so a plan being saved never holds those up.
///
/// The same pattern as <see cref="ShiftRowLock"/>: PostgreSQL only (any other provider, including the in-memory test provider, has no concurrent transactions and
/// the lock is a no-op), a transaction is opened unless the context is already inside one (then the owner commits), and disposing rolls back whatever was not
/// committed. The API registers UseNpgsql without EnableRetryOnFailure, which is what lets a user-initiated transaction be opened here.
/// </summary>
internal sealed class FundingPlanLock : IAsyncDisposable
{
    private readonly IDbContextTransaction? _owned;

    private FundingPlanLock(IDbContextTransaction? owned, bool held)
    {
        _owned = owned;
        Held = held;
    }

    /// <summary>True when the participant's row was locked (PostgreSQL).</summary>
    public bool Held { get; }

    public static async Task<FundingPlanLock> AcquireAsync(OdipDbContext db, Guid participantId, CancellationToken ct)
    {
        if (!db.Database.IsNpgsql()) return new FundingPlanLock(null, false);

        var owned = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(ct) : null;
        try
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT \"Id\" FROM \"Participants\" WHERE \"Id\" = {participantId} FOR NO KEY UPDATE", ct);
            return new FundingPlanLock(owned, true);
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
