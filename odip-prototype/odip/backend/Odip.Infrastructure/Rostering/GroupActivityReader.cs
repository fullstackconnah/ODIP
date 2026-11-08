using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Rostering;

/// <summary>
/// Builds <see cref="GroupActivityDto"/> (group activities D2): the activity, its participants (one per person, from their attached shifts), its workers and the findings. Cancelled shifts are
/// ignored, so a participant whose shift was cancelled neither counts for staff needed nor appears. Shared by the group-activity endpoints and the roster board.
/// </summary>
public sealed class GroupActivityReader(OdipDbContext db, RosterAvailability availability)
{
    public async Task<GroupActivityDto?> ReadAsync(Guid id, CancellationToken ct) =>
        (await BuildAsync(await db.GroupActivities.AsNoTracking().Where(a => a.Id == id).ToListAsync(ct), ct)).FirstOrDefault();

    /// <summary>The not-cancelled activities dated in [from, to], in date and start order.</summary>
    public async Task<List<GroupActivityDto>> ForWeekAsync(DateOnly from, DateOnly to, CancellationToken ct) =>
        await BuildAsync(await db.GroupActivities.AsNoTracking()
            .Where(a => a.ServiceDate >= from && a.ServiceDate <= to && a.Status != ShiftStatus.Cancelled)
            .OrderBy(a => a.ServiceDate).ThenBy(a => a.StartTime).ToListAsync(ct), ct);

    private async Task<List<GroupActivityDto>> BuildAsync(List<GroupActivity> activities, CancellationToken ct)
    {
        if (activities.Count == 0) return [];
        var ids = activities.Select(a => a.Id).ToList();
        var shifts = await db.Shifts.AsNoTracking().Where(s => s.GroupActivityId != null && ids.Contains(s.GroupActivityId.Value) && s.Status != ShiftStatus.Cancelled).ToListAsync(ct);
        var staffRows = await db.GroupActivityStaff.AsNoTracking().Where(r => ids.Contains(r.GroupActivityId)).ToListAsync(ct);
        var participantIds = shifts.Select(s => s.ParticipantId).Distinct().ToList();
        var userIds = staffRows.Select(r => r.UserId).Distinct().ToList();
        var participants = await db.Participants.AsNoTracking().Where(p => participantIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, ct);
        var users = await db.Users.AsNoTracking().Where(u => userIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, ct);
        var libraryIds = activities.Where(a => a.ActivityId != null).Select(a => a.ActivityId!.Value).ToList();
        var libraryNames = await db.Activities.AsNoTracking().Where(a => libraryIds.Contains(a.Id)).ToDictionaryAsync(a => a.Id, a => a.ActivityName, ct);
        var patternIds = shifts.Where(s => s.ShiftPatternId != null).Select(s => s.ShiftPatternId!.Value).Distinct().ToList();
        var patterns = await db.ShiftPatterns.AsNoTracking().Where(p => patternIds.Contains(p.Id)).ToDictionaryAsync(p => p.Id, ct);

        // One read of the rules for every worker and participant across the dates: the rows' findings are judged against the same snapshot.
        var snapshot = staffRows.Count == 0 ? null
            : await availability.LoadAsync(userIds, participantIds, activities.Min(a => a.ServiceDate), activities.Max(a => a.ServiceDate), ct);

        var result = new List<GroupActivityDto>();
        foreach (var activity in activities)
        {
            var mine = shifts.Where(s => s.GroupActivityId == activity.Id).ToList();
            var people = mine.GroupBy(s => s.ParticipantId).Select(g =>
            {
                var first = g.First();
                var pattern = g.Select(s => s.ShiftPatternId).FirstOrDefault(p => p != null) is { } patternId ? patterns.GetValueOrDefault(patternId) : null;
                var differs = pattern is not null && (pattern.StartTime != activity.StartTime || pattern.EndTime != activity.EndTime || pattern.EndsNextDay != activity.EndsNextDay);
                return new GroupActivityParticipantDto
                {
                    ParticipantId = g.Key, ParticipantName = participants.GetValueOrDefault(g.Key)?.FullName ?? string.Empty, Ratio = first.Ratio,
                    ShiftIds = g.Select(s => s.Id).ToList(), TimesDiffer = differs,
                    AgreementStartTime = differs ? pattern!.StartTime : null, AgreementEndTime = differs ? pattern!.EndTime : null,
                };
            }).OrderBy(p => p.ParticipantName).ToList();

            var rows = staffRows.Where(r => r.GroupActivityId == activity.Id).ToList();
            var staff = rows.Select(r => new GroupActivityStaffDto
            {
                Id = r.Id, StaffId = r.UserId, StaffName = users.GetValueOrDefault(r.UserId)?.FullName ?? string.Empty,
                StartTime = r.StartTime, EndTime = r.EndTime, EndsNextDay = r.EndsNextDay, Role = r.Role,
                Findings = snapshot is null || activity.Status == ShiftStatus.Cancelled ? []
                    : GroupActivityRules.CheckStaffPart(snapshot, activity, people.Select(p => p.ParticipantId), r.Id, r.UserId, r.StartTime, r.EndTime, r.EndsNextDay, null, null)
                        .Select(RosterGate.ToFindingDto).ToList(),
            }).OrderBy(s => s.StaffName).ToList();

            var needed = GroupActivityStaffing.StaffNeeded(people.Select(p => p.Ratio), activity.MinStaffRequired);
            var findings = new List<RosterFindingDto>();
            if (activity.Status != ShiftStatus.Cancelled && staff.Count < needed)
                findings.Add(new RosterFindingDto
                {
                    Code = RosterConflictService.ActivityStaffShort, Severity = RosterFindingSeverity.Warning, RequiresReason = false,
                    Message = $"{staff.Count} of {needed} staff on this activity.",
                });
            result.Add(new GroupActivityDto
            {
                Id = activity.Id, ServiceDate = activity.ServiceDate, StartTime = activity.StartTime, EndTime = activity.EndTime, EndsNextDay = activity.EndsNextDay,
                Title = activity.Title, ActivityId = activity.ActivityId, ActivityName = activity.ActivityId is { } a ? libraryNames.GetValueOrDefault(a) : null,
                Location = activity.Location, ServiceLocationId = activity.ServiceLocationId, Notes = activity.Notes, MinStaffRequired = activity.MinStaffRequired,
                Status = activity.Status, StaffNeeded = needed, StaffAssigned = staff.Count, Participants = people, Staff = staff, Findings = findings,
            });
        }

        return result;
    }
}

/// <summary>The roster rules for a worker's part of a group activity, in one place for the add-staff gate and the reader (group activities D7).</summary>
public static class GroupActivityRules
{
    /// <summary>
    /// The worker's part judged against each attached participant: a transient shift with the row's own times, the worker, that participant and OneToOne (a staff row has no ratio of its own;
    /// <see cref="Shift.GroupActivityId"/> also stops the ratio-shortfall rule). Findings are merged and de-duplicated by code. With no participant the placeholder one (<paramref name="activity"/>'s id)
    /// is judged, which the caller must have added with <see cref="RosterAvailability.Snapshot.AddParticipant"/>. <paramref name="leavingShiftId"/> is the shift a converting worker leaves.
    /// </summary>
    public static List<RosterFinding> CheckStaffPart(RosterAvailability.Snapshot snapshot, GroupActivity activity, IEnumerable<Guid> participantIds, Guid rowId, Guid userId,
        TimeOnly start, TimeOnly end, bool endsNextDay, Guid? leavingShiftId, bool? callerIsAdmin)
    {
        var judged = participantIds.Distinct().ToList();
        if (judged.Count == 0) judged.Add(activity.Id);
        var findings = new List<RosterFinding>();
        foreach (var participantId in judged)
        {
            var candidate = new Shift
            {
                Id = rowId, TenantId = activity.TenantId, ParticipantId = participantId, UserId = userId, ServiceDate = activity.ServiceDate,
                StartTime = start, EndTime = end, EndsNextDay = endsNextDay, Ratio = SupportRatio.OneToOne, GroupActivityId = activity.Id,
            };
            foreach (var finding in snapshot.Check(candidate, rowId, leavingShiftId, callerIsAdmin))
                if (findings.All(f => f.Code != finding.Code)) findings.Add(finding);
        }

        return findings;
    }
}
