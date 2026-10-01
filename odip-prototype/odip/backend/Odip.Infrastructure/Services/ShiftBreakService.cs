using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

public enum ShiftBreakOutcome
{
    Ok,

    /// <summary>The break does not exist on this completion.</summary>
    NotFound,

    /// <summary>Another break is already running (at most one at a time).</summary>
    AlreadyRunning,

    /// <summary>The times break a rule - see <see cref="ShiftBreakResult.Violation"/>.</summary>
    Invalid,

    /// <summary>
    /// The shift is no longer InProgress, or its completion is no longer the active, unsubmitted one: a Finish (or a Return, or a cancellation)
    /// got there between the caller resolving the shift and the break being written. Nothing was written.
    /// </summary>
    ShiftNotInProgress,
}

public sealed record ShiftBreakResult(
    ShiftBreakOutcome Outcome, ShiftBreak? Break = null, ShiftBreakViolation Violation = ShiftBreakViolation.None);

/// <summary>
/// Break start / end / edit / delete against a shift's ACTIVE <see cref="ShiftCompletion"/>. The caller (the portal
/// controller) has already established that the shift is the worker's own and InProgress; this owns the break
/// rules: at most one running, inside the actual-start-to-now window, no overlaps
/// (<see cref="ShiftBreakRules"/>). Start and End stamp the server clock - the client never supplies those instants;
/// corrections go through <see cref="EditAsync"/>.
/// </summary>
public sealed class ShiftBreakService
{
    private readonly OdipDbContext _db;
    private readonly TimeProvider _clock;

    public ShiftBreakService(OdipDbContext db, TimeProvider? clock = null)
    {
        _db = db;
        _clock = clock ?? TimeProvider.System;
    }

    private DateTime Now => _clock.GetUtcNow().UtcDateTime;

    private Task<List<ShiftBreak>> LoadAsync(Guid completionId, CancellationToken ct) =>
        _db.ShiftBreaks.Where(b => b.ShiftCompletionId == completionId).OrderBy(b => b.StartedAt).ToListAsync(ct);

    /// <summary>
    /// Starts a break now. The caller resolved the shift as InProgress a moment ago, but a Finish on another device can commit in between, and a
    /// running break on a PendingReview completion is one nobody can end (every break endpoint needs InProgress) - so the write re-checks. On
    /// PostgreSQL the check and the insert run in one transaction that holds the shift row (<c>SELECT ... FOR UPDATE</c>): a Finish that has
    /// already flipped the shift but not yet committed makes this wait, and the re-check then sees the new state; a Finish that commits later
    /// cannot slip in between the check and the insert. With the in-memory test provider only the re-check remains. If the context is already
    /// inside a transaction the lock joins it and the owner commits. Returns <see cref="ShiftBreakOutcome.ShiftNotInProgress"/>, having written
    /// nothing, when the shift or its completion is no longer open.
    /// </summary>
    public async Task<ShiftBreakResult> StartAsync(ShiftCompletion completion, Guid userId, CancellationToken ct)
    {
        var ownedTransaction = await LockShiftRowAsync(completion.ShiftId, ct);
        try
        {
            var result = await StartCoreAsync(completion, userId, ct);
            if (result.Outcome == ShiftBreakOutcome.Ok && ownedTransaction is not null) await ownedTransaction.CommitAsync(ct);
            return result;
        }
        finally
        {
            if (ownedTransaction is not null) await ownedTransaction.DisposeAsync();   // rolls back anything not committed
        }
    }

    /// <summary>
    /// PostgreSQL only: begins a transaction (unless the context is already in one) and locks the shift row until it ends. Returns the transaction
    /// this call began, or null when there is nothing to commit (another provider, or a transaction the caller owns). If the lock statement fails
    /// the transaction is rolled back before the exception leaves, so the context is never left inside an aborted transaction.
    /// </summary>
    private async Task<IDbContextTransaction?> LockShiftRowAsync(Guid shiftId, CancellationToken ct)
    {
        if (!_db.Database.IsNpgsql()) return null;

        var owned = _db.Database.CurrentTransaction is null ? await _db.Database.BeginTransactionAsync(ct) : null;
        try
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT \"Id\" FROM \"Shifts\" WHERE \"Id\" = {shiftId} FOR UPDATE", ct);
            return owned;
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

    /// <summary>Whether the shift is still InProgress and the completion is still the active, unsubmitted one - read fresh from the database.</summary>
    private async Task<bool> IsStillOpenAsync(ShiftCompletion completion, CancellationToken ct) =>
        await _db.Shifts.AsNoTracking().AnyAsync(s => s.Id == completion.ShiftId && s.Status == ShiftStatus.InProgress, ct)
        && await _db.ShiftCompletions.AsNoTracking().AnyAsync(c => c.Id == completion.Id && c.IsActive && c.SubmittedAt == null, ct);

    private async Task<ShiftBreakResult> StartCoreAsync(ShiftCompletion completion, Guid userId, CancellationToken ct)
    {
        if (!await IsStillOpenAsync(completion, ct)) return new ShiftBreakResult(ShiftBreakOutcome.ShiftNotInProgress);

        var breaks = await LoadAsync(completion.Id, ct);
        if (breaks.Any(b => b.IsRunning)) return new ShiftBreakResult(ShiftBreakOutcome.AlreadyRunning);

        var now = Now;
        var violation = ShiftBreakRules.Validate(now, null, completion.ActualStart, now, breaks);
        if (violation != ShiftBreakViolation.None) return new ShiftBreakResult(ShiftBreakOutcome.Invalid, null, violation);

        var created = new ShiftBreak
        {
            Id = Guid.NewGuid(), ShiftCompletionId = completion.Id, StartedAt = now, CreatedByUserId = userId,
            CreatedAt = now, UpdatedAt = now,
        };
        _db.ShiftBreaks.Add(created);
        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException pg && pg.ConstraintName == ShiftBreak.OneRunningIndexName)
        {
            // A racing second Start hit the partial unique index (one running break per completion).
            _db.Entry(created).State = EntityState.Detached;
            return new ShiftBreakResult(ShiftBreakOutcome.AlreadyRunning);
        }
        return new ShiftBreakResult(ShiftBreakOutcome.Ok, created);
    }

    public async Task<ShiftBreakResult> EndAsync(ShiftCompletion completion, Guid breakId, CancellationToken ct)
    {
        var breaks = await LoadAsync(completion.Id, ct);
        var target = breaks.FirstOrDefault(b => b.Id == breakId);
        if (target is null) return new ShiftBreakResult(ShiftBreakOutcome.NotFound);

        // Idempotent: a retry after a dropped response (or a double tap) must read as success, not as a failure.
        if (!target.IsRunning) return new ShiftBreakResult(ShiftBreakOutcome.Ok, target);

        var now = Now;
        var violation = ShiftBreakRules.Validate(target.StartedAt, now, completion.ActualStart, now, breaks.Where(b => b.Id != breakId));
        if (violation != ShiftBreakViolation.None) return new ShiftBreakResult(ShiftBreakOutcome.Invalid, target, violation);

        target.EndedAt = now;
        target.UpdatedAt = now;
        await _db.SaveChangesAsync(ct);
        return new ShiftBreakResult(ShiftBreakOutcome.Ok, target);
    }

    public async Task<ShiftBreakResult> EditAsync(
        ShiftCompletion completion, Guid breakId, DateTime startedAt, DateTime? endedAt, CancellationToken ct)
    {
        var breaks = await LoadAsync(completion.Id, ct);
        var target = breaks.FirstOrDefault(b => b.Id == breakId);
        if (target is null) return new ShiftBreakResult(ShiftBreakOutcome.NotFound);

        var start = ShiftBreakRules.ToUtc(startedAt);
        DateTime? end = endedAt is { } e ? ShiftBreakRules.ToUtc(e) : null;

        // Only a RUNNING break may have no end; an ended break cannot be re-opened by an edit.
        if (!target.IsRunning && end is null)
            return new ShiftBreakResult(ShiftBreakOutcome.Invalid, target, ShiftBreakViolation.EndRequired);

        var now = Now;
        var violation = ShiftBreakRules.Validate(start, end, completion.ActualStart, now, breaks.Where(b => b.Id != breakId));
        if (violation != ShiftBreakViolation.None) return new ShiftBreakResult(ShiftBreakOutcome.Invalid, target, violation);

        target.StartedAt = start;
        target.EndedAt = end;
        target.EditedAt = now;
        target.UpdatedAt = now;
        await _db.SaveChangesAsync(ct);
        return new ShiftBreakResult(ShiftBreakOutcome.Ok, target);
    }

    public async Task<ShiftBreakResult> DeleteAsync(ShiftCompletion completion, Guid breakId, CancellationToken ct)
    {
        var target = await _db.ShiftBreaks.FirstOrDefaultAsync(b => b.Id == breakId && b.ShiftCompletionId == completion.Id, ct);
        if (target is null) return new ShiftBreakResult(ShiftBreakOutcome.NotFound);

        _db.ShiftBreaks.Remove(target);
        await _db.SaveChangesAsync(ct);
        return new ShiftBreakResult(ShiftBreakOutcome.Ok, target);
    }
}
