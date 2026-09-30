using Microsoft.EntityFrameworkCore;
using Npgsql;
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

    public async Task<ShiftBreakResult> StartAsync(ShiftCompletion completion, Guid userId, CancellationToken ct)
    {
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
