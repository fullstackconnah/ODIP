using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>One ticked routine, as the package DTOs need it.</summary>
/// <param name="RoutineId">The routine.</param>
/// <param name="ScheduledAt">The provider-local occurrence time the tick is for, or null for an untimed routine.</param>
/// <param name="CheckedAt">UTC.</param>
/// <param name="CheckedByName">Who ticked it.</param>
public sealed record RoutineCheckInfo(Guid RoutineId, DateTime? ScheduledAt, DateTime CheckedAt, string CheckedByName);

/// <summary>
/// Ticking a routine off during a shift and unticking it again (see <see cref="ShiftRoutineCheck"/>). The caller (the portal controller) has
/// already established that the shift is the worker's own and InProgress and that the routine is one the shift window matched; this owns the
/// idempotent write. Ticking twice keeps the first who/when; a racing double tap that hits the unique index counts as the tick already
/// being there; unticking something that is not ticked is a no-op.
/// </summary>
public sealed class ShiftRoutineCheckService
{
    private readonly OdipDbContext _db;
    private readonly TimeProvider _clock;

    public ShiftRoutineCheckService(OdipDbContext db, TimeProvider? clock = null)
    {
        _db = db;
        _clock = clock ?? TimeProvider.System;
    }

    /// <summary>Every tick on <paramref name="completionId"/>, with who ticked it.</summary>
    public async Task<IReadOnlyList<RoutineCheckInfo>> GetChecksAsync(Guid completionId, CancellationToken ct)
    {
        var rows = await _db.ShiftRoutineChecks
            .Where(c => c.ShiftCompletionId == completionId)
            .Select(c => new { c.ParticipantRoutineId, c.ScheduledAt, c.CheckedAt, c.CheckedByUserId })
            .ToListAsync(ct);
        if (rows.Count == 0) return Array.Empty<RoutineCheckInfo>();

        var userIds = rows.Select(r => r.CheckedByUserId).Distinct().ToList();
        var names = (await _db.Users.Where(u => userIds.Contains(u.Id)).Select(u => new { u.Id, u.FirstName, u.LastName }).ToListAsync(ct))
            .ToDictionary(u => u.Id, u => $"{u.FirstName} {u.LastName}");
        return rows
            .Select(r => new RoutineCheckInfo(r.ParticipantRoutineId, r.ScheduledAt, r.CheckedAt, names.GetValueOrDefault(r.CheckedByUserId, string.Empty)))
            .ToList();
    }

    /// <summary>Ticks the routine occurrence done. Idempotent: an existing tick is left exactly as it was.</summary>
    public async Task CheckAsync(ShiftCompletion completion, Guid routineId, DateTime? scheduledAt, Guid userId, CancellationToken ct)
    {
        var exists = await _db.ShiftRoutineChecks.AnyAsync(
            c => c.ShiftCompletionId == completion.Id && c.ParticipantRoutineId == routineId && c.ScheduledAt == scheduledAt, ct);
        if (exists) return;

        var now = _clock.GetUtcNow().UtcDateTime;
        var created = new ShiftRoutineCheck
        {
            Id = Guid.NewGuid(), ShiftCompletionId = completion.Id, ParticipantRoutineId = routineId, ScheduledAt = scheduledAt,
            CheckedByUserId = userId, CheckedAt = now, CreatedAt = now, UpdatedAt = now,
        };
        _db.ShiftRoutineChecks.Add(created);
        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException pg
            && (pg.ConstraintName == ShiftRoutineCheck.UniqueTimedIndexName || pg.ConstraintName == ShiftRoutineCheck.UniqueUntimedIndexName))
        {
            // A racing double tap already ticked it - the outcome the caller wanted.
            _db.Entry(created).State = EntityState.Detached;
        }
    }

    /// <summary>Removes the tick (the delete is audited). Idempotent: nothing to remove is fine.</summary>
    public async Task UncheckAsync(Guid completionId, Guid routineId, DateTime? scheduledAt, CancellationToken ct)
    {
        var rows = await _db.ShiftRoutineChecks
            .Where(c => c.ShiftCompletionId == completionId && c.ParticipantRoutineId == routineId && c.ScheduledAt == scheduledAt)
            .ToListAsync(ct);
        if (rows.Count == 0) return;
        _db.ShiftRoutineChecks.RemoveRange(rows);
        await _db.SaveChangesAsync(ct);
    }
}
