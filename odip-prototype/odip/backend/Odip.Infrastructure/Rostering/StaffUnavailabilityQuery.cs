using Microsoft.EntityFrameworkCore;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Rostering;

/// <summary>
/// The single source every unavailability-aware caller (RosteringController's board and shift
/// checks, LeaveController's approve-time overlap search, and PR 3's StaffAssignmentsController)
/// goes through, replacing the RosteringController.LeaveTypes / RosterConflictService.UnavailableTypes
/// duplicated constants this feature retires. Unions three sources into one tagged
/// UnavailabilityWindow list — see UnavailabilityKind (Odip.Domain.Rostering.Services) for why
/// the window shape itself lives in Domain rather than here.
/// </summary>
public interface IStaffUnavailabilityQuery
{
    /// <summary>
    /// Every unavailability window for any of <paramref name="userIds"/> overlapping
    /// [<paramref name="from"/>, <paramref name="to"/>] (inclusive both ends): Approved + Pending
    /// LeaveRequest rows (whole-day windows), Approved RecurringUnavailability rows (expanded via
    /// RecurringUnavailabilityExpander — a Pending rule yields nothing), and legacy
    /// StaffAvailability Unavailable/Training rows (Leave-type rows no longer exist post the
    /// AddStaffLeaveAndRecurringUnavailability migration's data step).
    /// </summary>
    Task<IReadOnlyList<UnavailabilityWindow>> GetWindowsAsync(
        IReadOnlyList<Guid> userIds, DateOnly from, DateOnly to, CancellationToken ct);
}

public sealed class StaffUnavailabilityQuery : IStaffUnavailabilityQuery
{
    private readonly OdipDbContext _db;
    private readonly RecurringUnavailabilityExpander _expander = new();

    public StaffUnavailabilityQuery(OdipDbContext db) => _db = db;

    public async Task<IReadOnlyList<UnavailabilityWindow>> GetWindowsAsync(
        IReadOnlyList<Guid> userIds, DateOnly from, DateOnly to, CancellationToken ct)
    {
        if (userIds.Count == 0)
            return Array.Empty<UnavailabilityWindow>();

        var windows = new List<UnavailabilityWindow>();
        var rangeStart = from.ToDateTime(TimeOnly.MinValue);
        var rangeEndExclusive = to.AddDays(1).ToDateTime(TimeOnly.MinValue);

        // ── Leave: Approved + Pending, whole-day windows. Date-range predicate is pushed into
        // SQL (DateOnly compares translate natively to `date` in Npgsql) so this doesn't pull
        // every leave row for the tenure of each user just to filter it in memory. ──
        var leaveRequests = await _db.LeaveRequests
            .Where(l => userIds.Contains(l.UserId)
                        && (l.Status == LeaveStatus.Approved || l.Status == LeaveStatus.Pending)
                        && l.StartDate <= to && l.EndDate >= from)
            .ToListAsync(ct);
        foreach (var l in leaveRequests)
        {
            var start = l.StartDate.ToDateTime(TimeOnly.MinValue);
            var end = l.EndDate.AddDays(1).ToDateTime(TimeOnly.MinValue); // inclusive end date -> exclusive end-of-day
            if (start >= rangeEndExclusive || rangeStart >= end)
                continue;
            windows.Add(new UnavailabilityWindow(l.UserId, start, end,
                l.Status == LeaveStatus.Approved ? UnavailabilityKind.ApprovedLeave : UnavailabilityKind.PendingLeave));
        }

        // ── Recurring unavailability: Approved only, expanded to concrete occurrences. Effective-
        // range predicate is pushed into SQL for the same reason as the LeaveRequests query above
        // — so the board path doesn't scale with a user's tenure. ──
        var rules = await _db.RecurringUnavailabilities
            .Where(r => userIds.Contains(r.UserId) && r.Status == LeaveStatus.Approved
                        && r.EffectiveFrom <= to && (r.EffectiveTo == null || r.EffectiveTo >= from))
            .ToListAsync(ct);
        foreach (var rule in rules)
        {
            foreach (var date in _expander.Occurrences(rule, from, to))
            {
                windows.Add(new UnavailabilityWindow(
                    rule.UserId, date.ToDateTime(rule.StartTime), date.ToDateTime(rule.EndTime),
                    UnavailabilityKind.RecurringRule));
            }
        }

        // ── Legacy StaffAvailability: Unavailable/Training rows only. Leave-type rows no longer
        // exist after the migration's data step; Available/Preferred/Tentative never counted as
        // unavailability (matches the retired RosterConflictService.UnavailableTypes set, minus
        // Leave, which is now sourced from LeaveRequest above instead). ──
        var legacy = await _db.StaffAvailabilities
            .Where(a => userIds.Contains(a.UserId)
                        && (a.AvailabilityType == AvailabilityType.Unavailable || a.AvailabilityType == AvailabilityType.Training)
                        && a.StartDateTime < rangeEndExclusive && a.EndDateTime > rangeStart)
            .ToListAsync(ct);
        foreach (var a in legacy)
            windows.Add(new UnavailabilityWindow(a.UserId, a.StartDateTime, a.EndDateTime, UnavailabilityKind.Legacy,
                LegacySourceType: a.AvailabilityType, LegacyNotes: a.Notes));

        return windows;
    }
}
