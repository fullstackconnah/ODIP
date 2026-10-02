using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// One catalogue, one writer at a time. A confirm reads the rows already in the table, plans against them and saves, and the plan is only right if nothing
/// else changed the table in between: two admins confirming the same file together each read an empty table and each insert the whole catalogue (every code
/// then has two active rows with the same start date, and the lookup answers Ambiguous). The confirm therefore takes a transaction-scoped PostgreSQL
/// advisory lock before it reads and releases it when it commits, so the second confirm waits, then reads what the first one wrote and finds nothing to add.
///
/// The same pattern as <see cref="ShiftRowLock"/> and the medication slot lock: PostgreSQL only (any other provider, including the in-memory test provider,
/// has no concurrent transactions and the lock is a no-op), a transaction is opened unless the context is already inside one (then the owner commits), and the
/// wait is bounded (20 s, below the driver's command timeout), so an import that cannot get the lock says so instead of hanging. The API registers UseNpgsql without EnableRetryOnFailure, which is what
/// lets a user-initiated transaction be opened here.
/// </summary>
internal sealed class CatalogueImportLock : IAsyncDisposable
{
    /// <summary>The advisory-lock key every catalogue confirm takes: the ASCII of "ODIPCATL".</summary>
    internal const long Key = 0x4F4449504341544C;

    /// <summary>
    /// How long a confirm waits for another to finish. The lock is taken by one SQL command, and Npgsql cancels a command after 30 s by default (nothing here
    /// sets another), so a longer wait would be cut off by the driver and reach the admin as a raw 500 instead of the refusal below. (The medication slot
    /// lock also stays well under that 30 s, at 5 s.) An import normally takes seconds.
    /// </summary>
    private static readonly TimeSpan Wait = TimeSpan.FromSeconds(20);

    private readonly IDbContextTransaction? _owned;

    private CatalogueImportLock(IDbContextTransaction? owned) => _owned = owned;

    public static async Task<CatalogueImportLock> AcquireAsync(OdipDbContext db, CancellationToken ct)
    {
        if (!db.Database.IsNpgsql()) return new CatalogueImportLock(null);

        var owned = db.Database.CurrentTransaction is null ? await db.Database.BeginTransactionAsync(ct) : null;
        try
        {
            // One round trip: bound the wait, take the lock, then hand the setting back to the server's own value for the rest of the transaction.
            var sql = string.Create(System.Globalization.CultureInfo.InvariantCulture,
                $"SET LOCAL lock_timeout = {(int)Wait.TotalMilliseconds}; SELECT pg_advisory_xact_lock({{0}}); SET LOCAL lock_timeout TO DEFAULT");
            await db.Database.ExecuteSqlRawAsync(sql, new object[] { Key }, ct);
            return new CatalogueImportLock(owned);
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.LockNotAvailable)
        {
            await ReleaseAfterFailureAsync(owned);
            throw new InvalidOperationException("Another catalogue import is still running. Wait for it to finish, then preview the file again.");
        }
        catch
        {
            await ReleaseAfterFailureAsync(owned);
            throw;
        }
    }

    /// <summary>Commits the transaction this lock began, releasing the lock; nothing to do when the caller owns the transaction or there is none.</summary>
    public Task CommitAsync(CancellationToken ct) => _owned?.CommitAsync(ct) ?? Task.CompletedTask;

    /// <summary>Rolls back whatever was not committed (releasing the lock).</summary>
    public ValueTask DisposeAsync() => _owned?.DisposeAsync() ?? ValueTask.CompletedTask;

    /// <summary>Rolls back the transaction this class began (never one it joined); a failure to do so must not hide the original error.</summary>
    private static async Task ReleaseAfterFailureAsync(IDbContextTransaction? owned)
    {
        if (owned is null) return;
        try { await owned.DisposeAsync(); }
        catch { /* the failure being reported is the one that matters */ }
    }
}
