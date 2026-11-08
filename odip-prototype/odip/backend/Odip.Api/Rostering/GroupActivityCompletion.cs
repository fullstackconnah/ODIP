using Microsoft.EntityFrameworkCore;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Api.Rostering;

/// <summary>
/// The group activity completion trigger (GA PR3). When every staff row is approved, the activity's participant shifts complete with it: each gets one approved ShiftCompletion at its
/// rostered window, signed by the approving coordinator, and the activity becomes Completed. Those completions are not a worker's pay (the staff rows carry that), so every reader that
/// treats <c>SubmittedByUserId</c> as the worker skips shifts with a GroupActivityId.
/// </summary>
public static class GroupActivityCompletion
{
    /// <summary>
    /// Caller duty: hold the board lock, the participant locks, the staff row locks and a <see cref="ShiftRowLock"/> per attached shift (ascending), and pass the activity, rows and shifts re-read
    /// after them. Makes no <c>SaveChanges</c> call: the caller's single save covers it. Returns true when the activity completed.
    /// </summary>
    public static async Task<bool> CompleteIfAllApprovedAsync(
        OdipDbContext db, GroupActivity activity, IReadOnlyList<GroupActivityStaff> rows, IReadOnlyList<Shift> attached, Guid coordinatorId, DateTime now, CancellationToken ct)
    {
        if (activity.Status != ShiftStatus.InProgress || rows.Count == 0 || !rows.All(r => r.ReviewOutcome == ReviewOutcome.Approved)) return false;

        // Draft, Cancelled and already Completed shifts are left alone: a participant shift cancelled before the trigger stays Cancelled.
        var open = attached.Where(s => s.Status is ShiftStatus.Published or ShiftStatus.InProgress).ToList();
        var openIds = open.Select(s => s.Id).ToList();
        var done = (await db.ShiftCompletions.AsNoTracking().Where(c => openIds.Contains(c.ShiftId) && c.IsActive).Select(c => c.ShiftId).ToListAsync(ct)).ToHashSet();
        string? zoneId = null;
        foreach (var shift in open.Where(s => !done.Contains(s.Id)))
        {
            zoneId ??= (await ProviderTimeZoneResolver.ForShiftAsync(db, shift, ct)).Id;
            var (startUtc, endUtc) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(shift, zoneId);
            db.ShiftCompletions.Add(new ShiftCompletion
            {
                Id = Guid.NewGuid(), TenantId = shift.TenantId, ShiftId = shift.Id, ActualStart = startUtc, ActualEnd = endUtc, TimeZoneId = zoneId,
                SubmittedByUserId = coordinatorId, StartedAt = now, SubmittedAt = now, ReviewedByUserId = coordinatorId, ReviewedAt = now,
                ReviewOutcome = ReviewOutcome.Approved, VarianceMinutesStart = 0, VarianceMinutesEnd = 0, DetailsRequired = false, IsActive = true,
            });
            shift.Status = ShiftStatus.Completed;
            shift.UpdatedAt = now;
        }
        // Shifts that already had an active completion still move to Completed with the activity.
        foreach (var shift in open.Where(s => done.Contains(s.Id)))
        {
            shift.Status = ShiftStatus.Completed;
            shift.UpdatedAt = now;
        }
        activity.Status = ShiftStatus.Completed;
        activity.UpdatedAt = now;
        return true;
    }
}
