using Microsoft.EntityFrameworkCore;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Tasks;

/// <summary>See <see cref="IObligationTaskService"/>. Takes the caller's own tracked <see cref="OdipDbContext"/> — same context, so "same SaveChanges" needs no explicit transaction plumbing.</summary>
public sealed class ObligationTaskService : IObligationTaskService
{
    private readonly OdipDbContext _db;
    private readonly TimeProvider _clock;

    public ObligationTaskService(OdipDbContext db, TimeProvider? clock = null)
    {
        _db = db;
        _clock = clock ?? TimeProvider.System;
    }

    public async Task EnsureAsync(ObligationTaskSpec spec, CancellationToken ct = default)
    {
        var existing = await _db.BookingTasks.FirstOrDefaultAsync(t => t.SourceKey == spec.SourceKey, ct);
        if (existing != null)
        {
            // A closed obligation task never reopens itself — leave Completed/Cancelled alone.
            if (existing.Status == TaskItemStatus.NotStarted || existing.Status == TaskItemStatus.InProgress)
            {
                existing.Title = spec.Title;
                existing.DueDate = spec.DueDate;
                existing.UpdatedAt = DateTime.UtcNow;
            }
            return;
        }

        _db.BookingTasks.Add(new BookingTask
        {
            Id = Guid.NewGuid(),
            SourceKey = spec.SourceKey,
            TaskType = spec.Type,
            Title = spec.Title,
            DueDate = spec.DueDate,
            LinkTo = spec.LinkTo,
            ShiftId = spec.ShiftId,
            IncidentReportId = spec.IncidentReportId,
            MedicationAdministrationId = spec.MedicationAdministrationId,
            ShiftNoteId = spec.ShiftNoteId,
            LeaveRequestId = spec.LeaveRequestId,
            TripInstanceId = spec.TripInstanceId,
            Priority = spec.Priority,
            Status = TaskItemStatus.NotStarted,
        });
    }

    public Task CompleteAsync(string sourceKey, CancellationToken ct = default) =>
        CompleteMatchingAsync(t => t.SourceKey == sourceKey, ct);

    public Task CompleteByShiftAsync(Guid shiftId, TaskType type, CancellationToken ct = default) =>
        CompleteMatchingAsync(t => t.ShiftId == shiftId && t.TaskType == type, ct);

    public Task CompleteByLeaveAsync(Guid leaveId, CancellationToken ct = default) =>
        CompleteMatchingAsync(t => t.LeaveRequestId == leaveId && t.TaskType == TaskType.LeaveCoverage, ct);

    private async Task CompleteMatchingAsync(System.Linq.Expressions.Expression<Func<BookingTask, bool>> predicate, CancellationToken ct)
    {
        var matches = await _db.BookingTasks.Where(predicate)
            .Where(t => t.Status == TaskItemStatus.NotStarted || t.Status == TaskItemStatus.InProgress)
            .ToListAsync(ct);

        if (matches.Count == 0) return;

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var now = DateTime.UtcNow;
        foreach (var task in matches)
        {
            task.Status = TaskItemStatus.Completed;
            task.CompletedDate = today;
            task.AutoCompletedAt = now;
            task.UpdatedAt = now;
        }
    }
}
