using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Rostering;

/// <summary>
/// The unified availability-list projection over LeaveRequests + RecurringUnavailabilities +
/// legacy StaffAvailability rows for a set of staff ids and a date window — extracted (pure
/// move) from ScheduleController.GetScheduleOverview's per-staff <c>Availability</c> projection
/// so the staff hub's overview endpoint (item 12) can share it verbatim instead of duplicating
/// the three queries. Deliberately distinct from <see cref="IStaffUnavailabilityQuery"/>: that
/// interface returns expanded/tagged <c>UnavailabilityWindow</c> occurrences used for
/// availability-aware conflict checks (trip status cells, roster findings); this one returns the
/// raw source records as <see cref="ScheduleAvailabilityItemDto"/> for display, including the
/// legacy StaffAvailability rows of EVERY AvailabilityType (Available/Preferred/Tentative too,
/// not just Unavailable/Training/Leave) — see ScheduleAvailabilityItemDto's own doc comment.
/// </summary>
public interface IStaffAvailabilityItemsQuery
{
    /// <summary>
    /// Every ScheduleAvailabilityItemDto for any of <paramref name="userIds"/> overlapping
    /// [<paramref name="from"/>, <paramref name="to"/>] (inclusive both ends), keyed by user id.
    /// ScheduleAvailabilityItemDto itself carries no UserId (see its doc comment), so the
    /// grouping happens here rather than on the returned DTO. Each user's items are ordered by
    /// StartDate, matching ScheduleController's pre-extraction behaviour. A missing key on the
    /// returned lookup yields an empty sequence (ILookup's own contract) rather than null.
    /// </summary>
    Task<ILookup<Guid, ScheduleAvailabilityItemDto>> GetAsync(
        IReadOnlyList<Guid> userIds, DateOnly from, DateOnly to, CancellationToken ct);
}

public sealed class StaffAvailabilityItemsQuery : IStaffAvailabilityItemsQuery
{
    private readonly OdipDbContext _db;

    public StaffAvailabilityItemsQuery(OdipDbContext db) => _db = db;

    public async Task<ILookup<Guid, ScheduleAvailabilityItemDto>> GetAsync(
        IReadOnlyList<Guid> userIds, DateOnly from, DateOnly to, CancellationToken ct)
    {
        if (userIds.Count == 0)
            return Array.Empty<(Guid UserId, ScheduleAvailabilityItemDto Dto)>().ToLookup(x => x.UserId, x => x.Dto);

        var rangeStart = from.ToDateTime(TimeOnly.MinValue);
        var rangeEnd = to.ToDateTime(TimeOnly.MaxValue);

        // Leave: Pending + Approved only (Declined/Cancelled rows are never shown) — unchanged
        // from the pre-extraction ScheduleController query.
        var leaveRequests = await _db.LeaveRequests
            .Where(l => userIds.Contains(l.UserId)
                && (l.Status == LeaveStatus.Pending || l.Status == LeaveStatus.Approved)
                && l.EndDate >= from && l.StartDate <= to)
            .ToListAsync(ct);

        // Recurring rules: Pending + Approved only, same as above.
        var recurringRules = await _db.RecurringUnavailabilities
            .Where(r => userIds.Contains(r.UserId)
                && (r.Status == LeaveStatus.Pending || r.Status == LeaveStatus.Approved)
                && r.EffectiveFrom <= to && (r.EffectiveTo == null || r.EffectiveTo >= from))
            .ToListAsync(ct);

        // Legacy StaffAvailability: EVERY AvailabilityType, unlike IStaffUnavailabilityQuery's
        // Unavailable/Training/Leave-only filter — this is the raw record list for display, not
        // an unavailability check.
        var legacyAvailability = await _db.StaffAvailabilities
            .Where(a => userIds.Contains(a.UserId)
                && a.StartDateTime < rangeEnd && a.EndDateTime > rangeStart)
            .ToListAsync(ct);

        var items = leaveRequests
            .Select(l => (l.UserId, Dto: new ScheduleAvailabilityItemDto
            {
                Id = l.Id, Kind = ScheduleAvailabilityKind.Leave, Status = l.Status,
                LeaveType = l.LeaveType, StartDate = l.StartDate, EndDate = l.EndDate,
                Notes = l.Reason,
            }))
            .Concat(recurringRules.Select(r => (r.UserId, Dto: new ScheduleAvailabilityItemDto
            {
                Id = r.Id, Kind = ScheduleAvailabilityKind.RecurringRule, Status = r.Status,
                StartDate = r.EffectiveFrom, EndDate = r.EffectiveTo, DayOfWeek = r.DayOfWeek,
                StartTime = r.StartTime, EndTime = r.EndTime, Notes = r.Notes,
            })))
            .Concat(legacyAvailability.Select(a => (a.UserId, Dto: new ScheduleAvailabilityItemDto
            {
                Id = a.Id, Kind = ScheduleAvailabilityKind.Legacy, AvailabilityType = a.AvailabilityType,
                StartDate = DateOnly.FromDateTime(a.StartDateTime), EndDate = DateOnly.FromDateTime(a.EndDateTime),
                Notes = a.Notes,
            })))
            .OrderBy(x => x.Dto.StartDate)
            .ToList();

        return items.ToLookup(x => x.UserId, x => x.Dto);
    }
}
