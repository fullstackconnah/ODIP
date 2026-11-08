using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// The <see cref="ShiftRowLock"/> for a group activity staff row (GA PR3): Start, Finish, Approve and Record times each take it first, then re-read the row and
/// re-check its state, so a Finish can never land after an Approve. Same shape: PostgreSQL only, joins an existing transaction, the owner commits.
/// </summary>
public sealed class GroupStaffRowLock : IAsyncDisposable
{
    private readonly IDbContextTransaction? _owned;

    private GroupStaffRowLock(IDbContextTransaction? owned, bool held)
    {
        _owned = owned;
        Held = held;
    }

    /// <summary>True when the row lock was taken (PostgreSQL). The caller should re-read the shift before trusting what it loaded earlier.</summary>
    public bool Held { get; }

    public static async Task<GroupStaffRowLock> AcquireAsync(OdipDbContext db, Guid rowId, CancellationToken ct)
    {
        if (!db.Database.IsNpgsql()) return new GroupStaffRowLock(null, false);

        var owned = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(ct) : null;
        try
        {
            await db.Database.ExecuteSqlInterpolatedAsync($"SELECT \"Id\" FROM \"GroupActivityStaff\" WHERE \"Id\" = {rowId} FOR UPDATE", ct);
            return new GroupStaffRowLock(owned, true);
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
