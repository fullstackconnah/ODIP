using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;

namespace Odip.Api.Rostering;

/// <summary>A worker's group activity rows (GA PR3) as the portal DTO: shared by my-shifts and the Start and Finish answers.</summary>
public static class PortalActivityShifts
{
    /// <summary>
    /// The caller's rows on activities that are not Draft or Cancelled: in the date window, or Started on any date (a forgotten finish stays visible); an Approved row drops off once its day is past.
    /// </summary>
    public static async Task<List<PortalActivityShiftDto>> ListAsync(OdipDbContext db, Guid staffId, DateOnly from, DateOnly to, DateOnly today, CancellationToken ct)
    {
        var rows = await db.GroupActivityStaff.AsNoTracking().Include(r => r.GroupActivity)
            .Where(r => r.UserId == staffId && r.GroupActivity!.Status != ShiftStatus.Draft && r.GroupActivity.Status != ShiftStatus.Cancelled
                && ((r.GroupActivity.ServiceDate >= from && r.GroupActivity.ServiceDate <= to)
                    || (r.ActualStart != null && r.SubmittedAt == null))
                && !(r.ReviewOutcome == ReviewOutcome.Approved && r.GroupActivity.ServiceDate < today))
            .ToListAsync(ct);
        return await ToDtosAsync(db, rows, ct);
    }

    public static async Task<List<PortalActivityShiftDto>> ToDtosAsync(OdipDbContext db, List<GroupActivityStaff> rows, CancellationToken ct)
    {
        if (rows.Count == 0) return [];
        var activityIds = rows.Select(r => r.GroupActivityId).Distinct().ToList();
        // A worker belongs to one organisation, so one zone serves every row (as GroupActivityReader.BuildAsync does).
        var zone = (await ProviderTimeZoneResolver.ResolveAsync(db, rows[0].TenantId, ct)).Zone;
        // A no-show stays in the list (the card shows it with a badge); a shift cancelled earlier through the board does not.
        var people = (await db.Shifts.AsNoTracking().Include(s => s.Participant)
            .Where(s => s.GroupActivityId != null && activityIds.Contains(s.GroupActivityId.Value) && (s.Status != ShiftStatus.Cancelled || s.CancelledAt != null) && s.Participant != null)
            .ToListAsync(ct)).Where(s => s.Status != ShiftStatus.Cancelled || GroupActivityReader.IsNoShow(s, zone)).ToLookup(s => s.GroupActivityId!.Value);
        return rows
            .OrderBy(r => r.GroupActivity!.ServiceDate).ThenBy(r => r.StartTime)
            .Select(r => new PortalActivityShiftDto(
                r.Id, r.GroupActivityId, r.GroupActivity!.Title, r.GroupActivity.ServiceDate, r.StartTime, r.EndTime, r.EndsNextDay,
                r.GroupActivity.Location, r.Role, r.State.ToString(), r.ActualStart, r.ActualEnd, r.BreakStartedAt, r.BreakEndedAt,
                people[r.GroupActivityId].OrderBy(s => s.Participant!.FullName).Select(s => new PortalActivityParticipantDto(s.Id, s.ParticipantId, s.Participant!.FullName, s.Status == ShiftStatus.Cancelled)).ToList()))
            .ToList();
    }
}
