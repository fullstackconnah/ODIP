using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Infrastructure.Rostering;

/// <summary>
/// Who is free for a shift: <see cref="RosterConflictService"/> with what it reads, assembled in one place for the single-shift check, the board, Start rostering and approval (2026-10-16, L5).
/// <see cref="LoadAsync"/> reads a window for some workers and participants; the board builds a <see cref="Snapshot"/> from what it has already loaded.
/// </summary>
public sealed class RosterAvailability(OdipDbContext db, IStaffUnavailabilityQuery unavailability)
{
    /// <summary>Reads what the rules need about these workers and participants over [from - 1, to + 1] (the day either side catches an overnight shift across the edge), one query each.</summary>
    public async Task<Snapshot> LoadAsync(IReadOnlyList<Guid> userIds, IReadOnlyList<Guid> participantIds, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var first = from.AddDays(-1);
        var last = to.AddDays(1);
        var staff = await db.Users.Where(u => userIds.Contains(u.Id)).ToListAsync(ct);
        var participants = await db.Participants.Where(p => participantIds.Contains(p.Id)).ToListAsync(ct);
        var shifts = await db.Shifts
            .Where(s => s.ServiceDate >= first && s.ServiceDate <= last && ((s.UserId != null && userIds.Contains(s.UserId.Value)) || participantIds.Contains(s.ParticipantId)))
            .ToListAsync(ct);
        var trips = await db.StaffAssignments
            .Where(a => userIds.Contains(a.UserId) && a.Status != AssignmentStatus.Cancelled && a.AssignmentStart <= last && a.AssignmentEnd >= first)
            .ToListAsync(ct);
        var windows = await unavailability.GetWindowsAsync(userIds, first, last, ct);
        var compatibility = await db.StaffParticipantCompatibilities
            .Where(c => userIds.Contains(c.UserId) && participantIds.Contains(c.ParticipantId))
            .ToDictionaryAsync(c => (c.UserId, c.ParticipantId), c => c.Level, ct);
        return new Snapshot(staff, participants, shifts, trips, windows, compatibility, await PublicHolidaysAsync(from, to, ct),
            await WeeklyHoursAsync(db, staff.Select(u => u.TenantId), ct));
    }

    /// <summary>
    /// Each organisation's weekly-hours warning (Settings > Alert windows), by tenant id. Read by explicit tenant id rather than the ambient filter so a SuperAdmin's mixed board
    /// judges each worker by their own organisation's figure. An organisation with no settings row is absent: callers fall back to <see cref="RosterConflictService.DefaultWeeklyHoursThreshold"/>.
    /// </summary>
    public static async Task<IReadOnlyDictionary<Guid, int>> WeeklyHoursAsync(OdipDbContext db, IEnumerable<Guid> tenantIds, CancellationToken ct)
    {
        var ids = tenantIds.Distinct().ToList();
        var rows = await db.AppSettings.IgnoreQueryFilters().Where(s => ids.Contains(s.TenantId)).Select(s => new { s.TenantId, s.WeeklyHoursWarning }).ToListAsync(ct);
        return rows.GroupBy(r => r.TenantId).ToDictionary(g => g.Key, g => g.First().WeeklyHoursWarning);
    }

    /// <summary>The organisation's figure from <see cref="WeeklyHoursAsync"/>, or the 38 hours that used to be fixed.</summary>
    public static decimal WeeklyHoursFor(IReadOnlyDictionary<Guid, int>? byTenant, Guid tenantId) =>
        byTenant is not null && byTenant.TryGetValue(tenantId, out var hours) ? hours : RosterConflictService.DefaultWeeklyHoursThreshold;

    /// <summary>
    /// PUBLIC_HOLIDAY source of truth (connection-map item 8): the same holidays as the claim engines
    /// and the budget ledger, read by the same <see cref="PublicHolidayLoader"/> — the synced rows AND
    /// the whole-day override rows (the feed misses days such as Boxing Day 2026) — with the same
    /// state-scoping: a holiday with no state applies everywhere, one scoped to a state only applies
    /// there, and the provider's own state (falling back to "VIC") decides which scoped rows count,
    /// matched in any case. Two queries per call (the synced rows and the override rows).
    /// </summary>
    public async Task<List<PublicHolidayRef>> PublicHolidaysAsync(DateOnly start, DateOnly end, CancellationToken ct)
    {
        var state = await db.ProviderSettings.Select(s => s.State).FirstOrDefaultAsync(ct);
        return PublicHolidayLoader.RosterRefsFor(await PublicHolidayLoader.LoadAsync(db, start, end, includePartDay: false, ct), state);
    }

    /// <summary>
    /// The regular-away rule (L5) over shifts just generated (added to the context, not saved): in date, start and participant order, a shift whose worker is away is made open and remembers
    /// who and why; one whose worker is free stays theirs and counts as a booking for the shifts after it. Returns how many were made open.
    /// </summary>
    public async Task<int> MarkRegularsAwayAsync(IReadOnlyCollection<Shift> made, CancellationToken ct)
    {
        var assigned = made.Where(s => s.UserId != null).OrderBy(s => s.ServiceDate).ThenBy(s => s.StartTime).ThenBy(s => s.ParticipantId).ThenBy(s => s.ShiftPatternId).ToList();
        if (assigned.Count == 0) return 0;
        var snapshot = await LoadAsync(assigned.Select(s => s.UserId!.Value).Distinct().ToList(), assigned.Select(s => s.ParticipantId).Distinct().ToList(),
            assigned[0].ServiceDate, assigned.Max(s => s.ServiceDate), ct);
        var away = 0;
        foreach (var shift in assigned)
        {
            if (snapshot.AwayReason(shift) is { } reason)
            {
                shift.RegularUserId = shift.UserId;
                shift.RegularAwayReason = reason;
                shift.UserId = null;
                away++;
            }
            else snapshot.Add(shift);
        }

        return away;
    }

    /// <summary>What the rules read for a set of shifts, held in memory; <see cref="Check"/> builds each shift's <see cref="RosterCheckContext"/> as the controller's check did.</summary>
    public sealed class Snapshot(IEnumerable<User> staff, IEnumerable<Participant> participants, IEnumerable<Shift> shifts, IReadOnlyList<StaffAssignment> trips,
        IReadOnlyList<UnavailabilityWindow> windows, IReadOnlyDictionary<(Guid UserId, Guid ParticipantId), CompatibilityLevel> compatibility, IReadOnlyList<PublicHolidayRef> holidays,
        IReadOnlyDictionary<Guid, int>? weeklyHours = null)
    {
        // L5 and L-b: what makes a regular "away", as the short reason the chip shows. Pending leave is not away; an expired screening (R3) is.
        private static readonly Dictionary<string, string> AwayReasons = new()
        {
            [RosterConflictService.WscExpired] = "screening expired",
            [RosterConflictService.StaffOnLeave] = "on approved leave",
            [RosterConflictService.StaffUnavailable] = "unavailable",
            [RosterConflictService.StaffRecurringUnavailable] = "unavailable",
            [RosterConflictService.DoubleBookedShift] = "booked on another shift",
            [RosterConflictService.DoubleBookedTrip] = "on a trip",
        };

        private readonly Dictionary<Guid, User> _staff = staff.ToDictionary(u => u.Id);
        private readonly Dictionary<Guid, Participant> _participants = participants.ToDictionary(p => p.Id);
        private readonly List<Shift> _shifts = shifts.ToList();
        private readonly RosterConflictService _rules = new();

        /// <summary>Every finding for the candidate. Nothing when it has no worker, or its worker or participant is not in the snapshot (the board passes active staff only).</summary>
        public List<RosterFinding> Check(Shift candidate, Guid? excludeShiftId = null, Guid? leavingShiftId = null) => CheckCore(candidate, excludeShiftId, leavingShiftId, liveOnly: false);

        /// <summary>Why the candidate's worker cannot take it (L5), as a short reason (L-b), the first in the engine's order; null when they can.</summary>
        public string? AwayReason(Shift candidate)
        {
            if (candidate.UserId is not { } userId) return null;
            if (!_staff.TryGetValue(userId, out var worker) || !worker.IsActive) return "inactive";
            return CheckCore(candidate, null, null, liveOnly: true).Select(ReasonOf).FirstOrDefault(reason => reason is not null);
        }

        /// <summary>The short reason a finding makes its worker away (L-b), null when it does not: the mapped codes, and any other Blocking finding (B-S1) with a generic one.</summary>
        public static string? ReasonOf(RosterFinding finding) =>
            AwayReasons.GetValueOrDefault(finding.Code) ?? (finding.Severity == RosterFindingSeverity.Blocking ? "can't work this shift" : null);

        /// <summary>A shift placed in this batch: later checks see the worker as booked.</summary>
        public void Add(Shift shift) => _shifts.Add(shift);

        private List<RosterFinding> CheckCore(Shift candidate, Guid? excludeShiftId, Guid? leavingShiftId, bool liveOnly)
        {
            if (candidate.UserId is not { } userId || !_staff.TryGetValue(userId, out var worker) || !_participants.TryGetValue(candidate.ParticipantId, out var participant))
                return new List<RosterFinding>();
            var exclude = excludeShiftId ?? candidate.Id;
            var week = RosterWeek.MondayOf(candidate.ServiceDate);
            var ctx = new RosterCheckContext(worker, participant,
                _shifts.Where(s => s.UserId == userId && s.ServiceDate >= week.AddDays(-1) && s.ServiceDate <= week.AddDays(7) && s.Id != exclude && s.Id != leavingShiftId
                                   && !(liveOnly && s.Status == ShiftStatus.Cancelled)).ToList(),
                _shifts.Where(s => s.ParticipantId == candidate.ParticipantId && s.ServiceDate == candidate.ServiceDate && s.Id != exclude).ToList(),
                trips.Where(a => a.UserId == userId).ToList(),
                windows.Where(w => w.UserId == userId).ToList(),
                compatibility.TryGetValue((userId, candidate.ParticipantId), out var level) ? level : CompatibilityLevel.Allowed,
                WeeklyHoursFor(weeklyHours, worker.TenantId), holidays);
            return _rules.Check(candidate, ctx).ToList();
        }
    }
}
