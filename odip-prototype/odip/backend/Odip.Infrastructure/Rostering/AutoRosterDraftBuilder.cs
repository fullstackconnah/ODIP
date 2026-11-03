using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Infrastructure.Rostering;

/// <summary>
/// R7 auto-roster, read-only: loads what <see cref="AutoRosterPlanner"/> needs for one Monday-start week of one organisation (the open shifts, the candidate pool, live regulars, ranks, readiness, the roster
/// rules' snapshot), runs it, and maps the plan to a draft. It saves nothing and sends nothing.
/// </summary>
public sealed class AutoRosterDraftBuilder(OdipDbContext db, RosterAvailability availability)
{
    public async Task<AutoRosterDraftDto> BuildAsync(Guid tenantId, DateOnly monday, DateTime now, CancellationToken ct)
    {
        var end = monday.AddDays(6);
        var weekShifts = await db.Shifts.AsNoTracking().Where(s => s.TenantId == tenantId && s.ServiceDate >= monday && s.ServiceDate <= end && s.Status != ShiftStatus.Cancelled).ToListAsync(ct);
        // The open shifts a coordinator could still staff: as the board's IsLockedForStaffChange, an assigned shift is never touched.
        var open = weekShifts.Where(s => s.UserId == null && s.Status is ShiftStatus.Draft or ShiftStatus.Published).ToList();
        var regulars = await RosterRegulars.ByPatternAsync(db, open.Select(s => s.ShiftPatternId), ct);

        var participantIds = open.Select(s => s.ParticipantId).Distinct().OrderBy(id => id).ToList();
        var participants = (await db.Participants.AsNoTracking().Where(p => participantIds.Contains(p.Id)).ToListAsync(ct)).ToDictionary(p => p.Id);
        var notReady = new HashSet<Guid>();
        foreach (var participantId in participantIds)
            if (!(await ParticipantReadiness.CheckAsync(db, participantId, ct)).Allowed) notReady.Add(participantId);

        // The pool (D5): this organisation's active support workers, and anyone who is a live regular here or is listed Preferred, Backup or Emergency for one of these participants, whatever their role.
        var ranks = await db.StaffParticipantCompatibilities.AsNoTracking().Where(c => participantIds.Contains(c.ParticipantId)).ToListAsync(ct);
        var listedIds = ranks.Where(c => CompatibilityOrder.IsRanked(c.Level)).Select(c => c.UserId).Distinct().ToList();
        var regularIds = regulars.Values.Distinct().ToList();
        var staff = await db.Users.AsNoTracking()
            .Where(u => u.TenantId == tenantId && u.IsActive && (u.Role == UserRole.SupportWorker || regularIds.Contains(u.Id) || listedIds.Contains(u.Id)))
            .OrderBy(u => u.Id).ToListAsync(ct);
        var poolIds = staff.Select(u => u.Id).ToList();

        var snapshot = await availability.LoadAsync(poolIds, participantIds, monday, end, ct);
        var weekly = RosterAvailability.WeeklyHoursFor(await RosterAvailability.WeeklyHoursAsync(db, [tenantId], ct), tenantId);
        var rostered = weekShifts.Where(s => s.UserId is not null).GroupBy(s => s.UserId!.Value).ToDictionary(g => g.Key, g => g.Sum(s => s.DurationHours));
        var workers = staff.Select(u =>
        {
            var (goal, isDefault) = AutoRosterRules.GoalFor(u, weekly);
            return new AutoRosterWorker(u.Id, u.FullName, goal, isDefault, rostered.GetValueOrDefault(u.Id));
        }).ToList();

        var plan = AutoRosterPlanner.Plan(new AutoRosterInput(open, workers, regulars,
            ranks.Where(c => poolIds.Contains(c.UserId)).ToDictionary(c => (c.UserId, c.ParticipantId), c => (c.Level, c.Rank)), notReady), new SnapshotAutoRosterOracle(snapshot));

        var shiftsById = open.ToDictionary(s => s.Id);
        var names = workers.ToDictionary(w => w.Id, w => w.Name);
        string PersonName(Shift s) => participants.TryGetValue(s.ParticipantId, out var p) ? p.FullName : "Participant";
        int? RankOf(int rank) => rank > 0 ? rank : null;
        // A split's two parts count towards each person's draft hours (the Hours tab counts each half's own hours).
        var draftHours = plan.Placements.Select(p => (Staff: p.StaffId, Hours: shiftsById[p.ShiftId].DurationHours))
            .Concat(plan.Splits.Select(x => (Staff: x.FirstStaffId, Hours: Shift.HoursBetween(shiftsById[x.ShiftId].StartTime, x.CutAt, false))))
            .Concat(plan.Splits.Select(x => (Staff: x.SecondStaffId, Hours: Shift.HoursBetween(x.CutAt, shiftsById[x.ShiftId].EndTime, false))))
            .GroupBy(x => x.Staff).ToDictionary(g => g.Key, g => g.Sum(x => x.Hours));
        var byId = staff.ToDictionary(u => u.Id);

        return new AutoRosterDraftDto
        {
            WeekStart = monday, GeneratedAt = now,
            Changes = plan.Placements.Select(p =>
            {
                var s = shiftsById[p.ShiftId];
                return new AutoRosterChangeDto
                {
                    ShiftId = s.Id, ParticipantId = s.ParticipantId, ParticipantName = PersonName(s), ServiceDate = s.ServiceDate, StartTime = s.StartTime, EndTime = s.EndTime,
                    StaffId = p.StaffId, StaffName = names[p.StaffId], Pick = p.Pick, Rank = RankOf(p.Rank), UnderGoal = p.UnderGoal, RegularAway = p.RegularAway,
                    Warnings = p.Warnings.Select(RosterGate.ToFindingDto).ToList(),
                    Alternates = p.Alternates.Select(a => new AutoRosterAlternateDto { StaffId = a.StaffId, StaffName = names[a.StaffId], Pick = a.Pick, Rank = RankOf(a.Rank) }).ToList(),
                };
            }).ToList(),
            Hours = workers.OrderBy(w => w.Name, StringComparer.OrdinalIgnoreCase).ThenBy(w => w.Id).Select(w => new AutoRosterHoursDto
            {
                StaffId = w.Id, StaffName = w.Name, EmploymentType = byId[w.Id].EmploymentType, GoalHours = w.Goal, GoalIsDefault = w.GoalIsDefault,
                RosteredHours = w.RosteredHours, DraftHours = draftHours.GetValueOrDefault(w.Id),
            }).ToList(),
            Splits = plan.Splits.Select(x =>
            {
                var s = shiftsById[x.ShiftId];
                return new AutoRosterSplitDto
                {
                    ShiftId = s.Id, ParticipantId = s.ParticipantId, ParticipantName = PersonName(s), ServiceDate = s.ServiceDate, StartTime = s.StartTime, EndTime = s.EndTime, CutAt = x.CutAt,
                    First = new AutoRosterSegmentDto { StaffId = x.FirstStaffId, StaffName = names[x.FirstStaffId] },
                    Second = new AutoRosterSegmentDto { StaffId = x.SecondStaffId, StaffName = names[x.SecondStaffId] },
                };
            }).ToList(),
            Uncovered = plan.Uncovered.Select(u =>
            {
                var s = shiftsById[u.ShiftId];
                return new AutoRosterUncoveredDto
                {
                    ShiftId = s.Id, ParticipantName = PersonName(s), ServiceDate = s.ServiceDate, StartTime = s.StartTime, EndTime = s.EndTime, Reason = u.Reason,
                    Recommendations = u.Recommendations.Select(r => new AutoRosterRecommendationDto { Kind = r.Kind, StaffId = r.StaffId, Text = r.Text }).ToList(),
                };
            }).ToList(),
        };
    }
}
