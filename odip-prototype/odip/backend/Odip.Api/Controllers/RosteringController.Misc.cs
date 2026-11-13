using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Npgsql;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Api.Rostering;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Api.Services;

namespace Odip.Api.Controllers;

public partial class RosteringController
{
    // ══════════════════════════════════════════════════════════════
    // BOARD
    // ══════════════════════════════════════════════════════════════

    /// <summary>
    /// The whole week in one payload, discriminated on <paramref name="groupBy"/>
    /// (case-insensitive, defaults to <c>participant</c>; an unrecognised value 400s):
    /// participant mode returns one row per ACTIVE participant (shifts including unfilled
    /// ones, trip bars, scheduled hours, days without cover); staff mode returns the pass-1
    /// shape — one row per active staff member plus the unfilled-shift lane. Every finding
    /// across the week flattens into <see cref="RosterBoardDto.Exceptions"/> either way.
    /// Defaults to the current week when <paramref name="weekStart"/> is omitted; any date
    /// supplied is normalised to that week's Monday.
    /// <paramref name="staffId"/> (groupBy=staff) or <paramref name="participantId"/> (groupBy=participant) narrows the rows
    /// to that one person (spec 2026-10-28, the roster week on a profile). The findings are still computed against the whole week.
    /// </summary>
    [HttpGet("board")]
    public async Task<ActionResult<ApiResponse<RosterBoardDto>>> GetBoard(
        [FromQuery] DateOnly? weekStart, [FromQuery] string? groupBy, CancellationToken ct,
        [FromQuery] Guid? staffId = null, [FromQuery] Guid? participantId = null)
    {
        if (!TryParseGroupBy(groupBy, out var groupByValue))
        {
            return BadRequest(ApiResponse<RosterBoardDto>.Fail(
                $"Unrecognised groupBy value '{groupBy}'. Expected 'participant' or 'staff'."));
        }
        if (staffId is not null && participantId is not null) return BadRequest(ApiResponse<RosterBoardDto>.Fail("Pass staffId or participantId, not both."));
        if (staffId is not null && groupByValue != RosterBoardGroupBy.Staff) return BadRequest(ApiResponse<RosterBoardDto>.Fail("staffId needs groupBy=staff."));
        if (participantId is not null && groupByValue != RosterBoardGroupBy.Participant) return BadRequest(ApiResponse<RosterBoardDto>.Fail("participantId needs groupBy=participant."));

        var start = WeekStart(weekStart ?? await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct));
        var orgZone = (await ProviderTimeZoneResolver.ResolveAsync(_db, ct)).Zone; // shortcut: one organisation zone for the whole board, as PortalController's list does; per-location zones when a tenant spans zones
        var end = start.AddDays(6);
        var days = Enumerable.Range(0, 7).Select(i => start.AddDays(i)).ToList();

        // ── Bulk-load everything the week needs once, then compute findings in memory
        // for every shift — avoids one roster-check query set per shift (N+1). ──
        var readyParticipantIds = await ParticipantReadinessGate.ActiveReadyParticipants(_db)
            .Select(p => p.Id)
            .ToListAsync(ct);
        var readyParticipantIdSet = readyParticipantIds.ToHashSet();
        var weekShifts = await _db.Shifts
            // Existing shifts remain visible even when a participant subsequently becomes
            // incomplete. Read paths must not make scheduled work disappear; readiness gates
            // creation and new assignments below instead.
            .Where(s => s.ServiceDate >= start && s.ServiceDate <= end)
            .ToListAsync(ct);

        // Design spec §4.2: the board shows every active tenant user, of any role — no role
        // filter (the old Staff-only listing is gone now that Staff has merged into User).
        var activeStaff = await _db.Users
            .Where(s => s.IsActive)
            .OrderBy(s => s.LastName).ThenBy(s => s.FirstName)
            .ToListAsync(ct);
        var staffIds = activeStaff.Select(s => s.Id).ToList();
        var staffById = activeStaff.ToDictionary(s => s.Id);

        // CASUAL_FORTNIGHT_HOURS: the casuals' shifts in the other week of this fortnight, so a chip can warn about hours that sit outside the week on screen (the board display and weekly meters never see them).
        var fortnightStart = RosterFortnight.StartOf(start);
        var casualIds = activeStaff.Where(s => s.EmploymentType == EmploymentType.Casual).Select(s => s.Id).ToList();
        var otherWeekShifts = casualIds.Count == 0 ? new List<Shift>() : await _db.Shifts
            .Where(s => s.UserId != null && casualIds.Contains(s.UserId.Value) && s.Status != ShiftStatus.Cancelled
                        && s.ServiceDate >= fortnightStart && s.ServiceDate <= fortnightStart.AddDays(13) && (s.ServiceDate < start || s.ServiceDate > end))
            .ToListAsync(ct);

        var weekTripAssignments = await _db.StaffAssignments
            .Include(a => a.TripInstance)
            .Where(a => staffIds.Contains(a.UserId) && a.Status != AssignmentStatus.Cancelled
                        && a.AssignmentStart <= end.AddDays(1) && a.AssignmentEnd >= start) // +1 day: Sunday's overnight shift can meet Monday's trip; only findings see it (bars filter below)
            .ToListAsync(ct);

        var weekWindows = await _unavailabilityQuery.GetWindowsAsync(staffIds, start, end, ct);

        // The picker's "Available that day": whole days marked Available or Preferred with nothing against them. One day past the week, so a Sunday overnight shift can be checked; weekWindows itself stays the week (it feeds the leave bars).
        var availabilityRows = await _db.StaffAvailabilities
            .Where(a => staffIds.Contains(a.UserId)   // tenant scope: staffIds come from the filtered Users (StaffAvailability has no tenant filter)
                        && (a.AvailabilityType == AvailabilityType.Available || a.AvailabilityType == AvailabilityType.Preferred)
                        && a.StartDateTime < end.AddDays(2).ToDateTime(TimeOnly.MinValue)
                        && a.EndDateTime > start.ToDateTime(TimeOnly.MinValue))
            .ToListAsync(ct);
        var dayAfterWindows = await _unavailabilityQuery.GetWindowsAsync(staffIds, end.AddDays(1), end.AddDays(1), ct);
        var availableDays = AvailableDays.For(availabilityRows, weekWindows.Concat(dayAfterWindows), start, end.AddDays(1))
            .Select(d => new StaffAvailableDayDto { StaffId = d.UserId, Date = d.Date, Preferred = d.Preferred })
            .ToList();

        // PUBLIC_HOLIDAY (connection-map item 8): loaded once for the whole week and reused for
        // every shift's context below, same as weekShifts/weekTripAssignments/weekWindows — avoids
        // one PublicHolidays query per shift on the board.
        var weekPublicHolidays = await _availability.PublicHolidaysAsync(start, end, ct);

        // ── Every ACTIVE participant, not just ones with shifts this week — an empty week
        // is itself the coverage gap the participant-mode board exists to surface. Shifts
        // referencing a participant outside that active set (edge case) still need a name
        // for their ShiftDto/exception, so top up with whichever ids weekShifts references
        // that the active set didn't already cover — still just two queries total. ──
        // This is a read-only coordinator surface. Active non-draft participants remain visible
        // even when the current source is not approved (or their evidence later becomes stale),
        // so legacy bookings and shifts do not disappear. Every new placement goes through the
        // organisation's readiness mode (ParticipantReadiness.CheckAsync), and what is missing is
        // reported on each row and shift below (ReadinessIssues).
        var activeParticipants = await _db.Participants
            .Where(Participant.CanReceiveServicesRule)
            .OrderBy(p => p.LastName).ThenBy(p => p.FirstName)
            .ToListAsync(ct);
        var participantById = activeParticipants.ToDictionary(p => p.Id);
        var shiftParticipantIds = weekShifts.Select(s => s.ParticipantId).Distinct().ToList();
        var missingParticipantIds = shiftParticipantIds.Where(id => !participantById.ContainsKey(id)).ToList();
        if (missingParticipantIds.Count > 0)
        {
            var extraParticipants = await _db.Participants
                .Where(p => missingParticipantIds.Contains(p.Id))
                .ToListAsync(ct);
            foreach (var extra in extraParticipants) participantById[extra.Id] = extra;
        }
        var allParticipantIds = participantById.Keys.ToList();
        var displayParticipants = participantById.Values
            .Where(Participant.CanReceiveServices)
            .OrderBy(p => p.LastName).ThenBy(p => p.FirstName)
            .ToList();

        // Readiness (ParticipantReadiness): every participant row and shift says what is missing, in
        // either mode. An organisation that ENFORCES readiness also keeps the per-shift
        // PARTICIPANT_NOT_READY exception for a participant who fails the strict rule, exactly as
        // before. In Warn the gap is the quiet note on the row instead: an exception on every shift
        // of every participant would bury the findings that need a coordinator's attention.
        var readinessIssuesById = await ParticipantReadiness.IssuesAsync(_db, allParticipantIds, ct);
        var enforcingTenants = await ParticipantReadiness.EnforcingTenantsAsync(
            _db, participantById.Values.Select(p => p.TenantId), ct);

        var compatByPair = await _db.StaffParticipantCompatibilities
            .Where(c => staffIds.Contains(c.UserId) && allParticipantIds.Contains(c.ParticipantId))
            .ToDictionaryAsync(c => (c.UserId, c.ParticipantId), c => c.Level, ct);

        var weeklyHours = await RosterAvailability.WeeklyHoursAsync(_db, activeStaff.Select(u => u.TenantId), ct);
        // Workers on group activities are busy too (group activities D7): their staff rows go in as transient shifts, so the snapshot sees them but weekShifts (and so the board) never does.
        var staffBusy = await RosterAvailability.ActivityStaffBusyAsync(_db, staffIds, fortnightStart, fortnightStart.AddDays(13), ct);   // the fortnight always holds the week
        var availability = new RosterAvailability.Snapshot(activeStaff, participantById.Values, weekShifts.Concat(staffBusy.Where(b => b.ServiceDate >= start && b.ServiceDate <= end)).ToList(), weekTripAssignments, weekWindows, compatByPair, weekPublicHolidays, weeklyHours,
            otherWeekShifts.Concat(staffBusy.Where(b => (b.ServiceDate < start || b.ServiceDate > end) && casualIds.Contains(b.UserId!.Value))).ToList(), orgZone);

        // Group activities (PR1): while the switch is off the board carries none, so a stray row never shows. Cancelled activities are not listed.
        var groupActivitiesEnabled = _tenant?.TenantId is { } boardTenant
            && await _db.AppSettings.AsNoTracking().Where(s => s.TenantId == boardTenant).Select(s => s.GroupActivitiesEnabled).FirstOrDefaultAsync(ct);
        var groupActivities = groupActivitiesEnabled ? await new GroupActivityReader(_db, _availability).ForWeekAsync(start, end, ct) : new List<GroupActivityDto>();

        List<RosterFinding> FindingsFor(Shift shift)
        {
            if (!participantById.TryGetValue(shift.ParticipantId, out var participant)) return new List<RosterFinding>();
            var findings = availability.Check(shift);
            if (enforcingTenants.Contains(participant.TenantId) && !readyParticipantIdSet.Contains(shift.ParticipantId))
                findings.Add(new RosterFinding("PARTICIPANT_NOT_READY", RosterFindingSeverity.Warning, "Participant is not ready for new booking or rostering assignments."));
            return findings;
        }

        // ── Task 5 (connection map item 5): reuses weekWindows — already loaded above for the
        // staff-row leave bars — rather than issuing any per-shift query. Only ApprovedLeave and
        // an approved RecurringRule occurrence count; PendingLeave/PendingRecurringRule/Legacy
        // don't (those aren't "approved leave"). ──
        bool IsAssigneeOnApprovedLeave(Shift shift)
        {
            if (shift.UserId is null) return false;
            var shiftStart = shift.ServiceDate.ToDateTime(shift.StartTime);
            var shiftEndDate = shift.EndsNextDay ? shift.ServiceDate.AddDays(1) : shift.ServiceDate;
            var shiftEnd = shiftEndDate.ToDateTime(shift.EndTime);
            return weekWindows.Any(w => w.UserId == shift.UserId.Value
                && (w.Kind == UnavailabilityKind.ApprovedLeave || w.Kind == UnavailabilityKind.RecurringRule)
                && w.Start < shiftEnd && shiftStart < w.End);
        }

        // Which agreement (if any) each shift's pattern came from: two small queries for the whole week, not one per shift.
        var shiftSources = await ShiftSourcesAsync(weekShifts.Select(s => s.ShiftPatternId), ct);
        // Budget phase 3: where the Admin's review of each emergency or safety booking stands (one query, and only when the week holds one).
        var budgetReviews = await BudgetReviewsAsync(weekShifts, ct);
        var regulars = await RosterRegulars.ByPatternAsync(_db, weekShifts.Select(s => s.ShiftPatternId), ct);
        var claimReferences = await ClaimReferencesAsync(weekShifts.Where(s => s.Status == ShiftStatus.Completed).Select(s => s.Id), ct);
        var weekStarted = await WeekStartedAsync(_tenant?.TenantId, start, ct);
        var canStart = (await StartedWeeks.MondaysAsync(_db, _tenant?.TenantId, start, start, ct)).Count == 0;

        ShiftDto ToShiftDto(Shift shift, List<RosterFinding> findings)
        {
            participantById.TryGetValue(shift.ParticipantId, out var participant);
            User? staff = shift.UserId.HasValue ? staffById.GetValueOrDefault(shift.UserId.Value) : null;
            int? sourceVersion = null;
            var fromAgreement = shift.ShiftPatternId is { } patternId && shiftSources.TryGetValue(patternId, out sourceVersion);
            return new ShiftDto
            {
                Id = shift.Id, ParticipantId = shift.ParticipantId, ParticipantName = participant?.FullName ?? string.Empty,
                StaffId = shift.UserId, StaffName = staff?.FullName,
                ServiceDate = shift.ServiceDate, StartTime = shift.StartTime, EndTime = shift.EndTime, EndsNextDay = shift.EndsNextDay,
                DurationHours = ProviderLocalTime.RosteredHours(shift, orgZone), Ratio = shift.Ratio, NightType = shift.NightType, Status = shift.Status, CancellationReason = shift.CancellationReason,
                ShiftPatternId = shift.ShiftPatternId, Notes = shift.Notes, Location = shift.Location, ServiceLocationId = shift.ServiceLocationId, SupportGroupCode = shift.SupportGroupCode, ClaimReference = claimReferences.GetValueOrDefault(shift.Id), OverrideReason = shift.OverrideReason, Requirements = RequirementsOf(shift.RequirementsJson),
                GroupActivityId = shift.GroupActivityId, IsGroupLine = shift.GroupActivityId is null ? null : true,
                AcknowledgedFindingCodes = AcknowledgedCodesOf(shift), BudgetReview = budgetReviews.GetValueOrDefault(shift.Id),
                FromAgreement = fromAgreement ? true : null, SourceDraftVersion = sourceVersion,
                Findings = findings.Select(ToFindingDto).ToList(),
                AssigneeOnApprovedLeave = IsAssigneeOnApprovedLeave(shift),
                RegularUserId = LiveRegular(shift, regulars), RegularAwayReason = AwayReason(shift, regulars), IsRegular = IsRegular(shift, regulars),
                ReadinessIssues = ParticipantReadiness.IssuesOrNull(readinessIssuesById, shift.ParticipantId)
            };
        }

        // ── Findings are computed once per shift regardless of groupBy — "exceptions" is
        // the same flattened list either way, and both row-building branches below reuse
        // the same dictionary rather than re-running RosterConflictService.Check. ──
        var findingsByShiftId = weekShifts.ToDictionary(s => s.Id, FindingsFor);

        // A person filter narrows only what is emitted; the findings above still see the whole week (overlaps need the other shifts).
        bool Shown(Shift s) => (staffId is null || s.UserId == staffId) && (participantId is null || s.ParticipantId == participantId);

        var exceptions = new List<RosterExceptionDto>();
        foreach (var shift in weekShifts.Where(Shown))
        {
            participantById.TryGetValue(shift.ParticipantId, out var p);
            foreach (var finding in findingsByShiftId[shift.Id])
            {
                exceptions.Add(new RosterExceptionDto
                {
                    ShiftId = shift.Id, ParticipantName = p?.FullName ?? string.Empty,
                    ServiceDate = shift.ServiceDate, Finding = ToFindingDto(finding)
                });
            }

            // Task 5: surfaced independently of the RosterConflictService findings above (those
            // require the shift's staff+participant to both be in this week's active sets;
            // this doesn't) so the drawer sees an on-leave assignee even outside that overlap.
            if (IsAssigneeOnApprovedLeave(shift))
            {
                var staffName = staffById.GetValueOrDefault(shift.UserId!.Value)?.FullName ?? "The assigned staff member";
                exceptions.Add(new RosterExceptionDto
                {
                    ShiftId = shift.Id, ParticipantName = p?.FullName ?? string.Empty,
                    ServiceDate = shift.ServiceDate,
                    Finding = new RosterFindingDto
                    {
                        Code = "ASSIGNEE_ON_LEAVE",
                        Severity = RosterFindingSeverity.Warning,
                        Message = $"{staffName} is on approved leave on {shift.ServiceDate.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}",
                        RequiresReason = false
                    }
                });
            }
        }

        // Staff each trip on the board still needs. Counts every non-cancelled assignment on the trip, so it ignores the board's staff filter; one grouped query, not one per bar.
        async Task<Dictionary<Guid, int>> AssignedByTripAsync(IEnumerable<Guid> tripIds)
        {
            var ids = tripIds.Distinct().ToList();
            return await _db.StaffAssignments
                .Where(a => ids.Contains(a.TripInstanceId) && a.Status != AssignmentStatus.Cancelled)
                .GroupBy(a => a.TripInstanceId)
                .Select(g => new { TripId = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.TripId, x => x.Count, ct);
        }

        // The trip bars' daily start and finish (the trip's itinerary, see TripDayTimes). One grouped query for every trip on the board, not one per bar; returns the days for one bar's own range, inside the week.
        async Task<Func<TripInstance, DateOnly, DateOnly, List<TripBarDayDto>>> TripBarDaysAsync(IEnumerable<TripInstance> trips)
        {
            var ids = trips.Select(t => t.Id).Distinct().ToList();
            var rows = await _db.ScheduledActivities
                .Where(a => ids.Contains(a.TripDay.TripInstanceId) && a.TripDay.Date >= start && a.TripDay.Date <= end)
                .Select(a => new { a.TripDay.TripInstanceId, a.TripDay.Date, a.StartTime, a.EndTime, a.Status })
                .ToListAsync(ct);
            var byTrip = rows.ToLookup(r => r.TripInstanceId, r => new TripDayTimes.ActivityTime(r.Date, r.StartTime, r.EndTime, r.Status));
            return (trip, from, to) => TripDayTimes.For(trip, byTrip[trip.Id], from < start ? start : from, to > end ? end : to)
                .Select(d => new TripBarDayDto { Date = d.Date, Start = d.Start, Finish = d.Finish }).ToList();
        }

        RosterBoardDto board;

        if (groupByValue == RosterBoardGroupBy.Participant)
        {
            // Trips overlapping the week, for every participant with a row — an away-on-trip
            // week must read as covered, not as a gap. StartDate is filtered in SQL; EndDate
            // is a computed property (TripInstance.StartDate + DurationDays - 1) that EF
            // can't translate, so the EndDate half of the overlap test runs in memory on the
            // already-materialised list.
            var weekBookings = await _db.ParticipantBookings
                .Include(b => b.TripInstance)
                .Where(b => allParticipantIds.Contains(b.ParticipantId)
                            && b.BookingStatus != BookingStatus.Cancelled && b.BookingStatus != BookingStatus.NoLongerAttending
                            && b.TripInstance.StartDate <= end)
                .ToListAsync(ct);
            var weekTripBars = weekBookings.Where(b => b.TripInstance.EndDate >= start).ToList();
            var assignedByTrip = await AssignedByTripAsync(weekTripBars.Select(b => b.TripInstanceId));
            var daysFor = await TripBarDaysAsync(weekBookings.Select(b => b.TripInstance));

            TripBarDto ToParticipantTripBar(ParticipantBooking b) => new()
            {
                TripInstanceId = b.TripInstanceId, TripCode = b.TripInstance.TripCode, TripName = b.TripInstance.TripName,
                StartDate = b.TripInstance.StartDate, EndDate = b.TripInstance.EndDate, IsDriver = false,
                StaffShort = TripStaffing.StaffShort(b.TripInstance, assignedByTrip.GetValueOrDefault(b.TripInstanceId)),
                Days = daysFor(b.TripInstance, b.TripInstance.StartDate, b.TripInstance.EndDate)
            };

            var participantRows = new List<RosterParticipantRowDto>();
            foreach (var participant in displayParticipants.Where(p => participantId is null || p.Id == participantId))
            {
                var participantShifts = weekShifts.Where(s => s.ParticipantId == participant.Id).ToList();
                var shiftDtos = participantShifts.Select(s => ToShiftDto(s, findingsByShiftId[s.Id])).ToList();
                var myTripBars = weekBookings.Where(b => b.ParticipantId == participant.Id).Select(ToParticipantTripBar).ToList();
                var scheduledHours = participantShifts.Where(s => s.Status != ShiftStatus.Cancelled).Sum(s => ProviderLocalTime.RosteredHours(s, orgZone));
                var daysWithoutCover = days.Count(d =>
                    !participantShifts.Any(s => s.ServiceDate == d) &&
                    !myTripBars.Any(tb => tb.StartDate <= d && d <= tb.EndDate));

                participantRows.Add(new RosterParticipantRowDto
                {
                    ParticipantId = participant.Id, FullName = participant.FullName,
                    SupportRatio = participant.SupportRatio, OvernightSupport = participant.OvernightSupport,
                    HasRestrictivePractice = participant.HasRestrictivePracticeFlag,
                    InOnboarding = participant.IsDraft,
                    Shifts = shiftDtos, TripBars = myTripBars,
                    ScheduledHours = scheduledHours, DaysWithoutCover = daysWithoutCover,
                    ReadinessIssues = ParticipantReadiness.IssuesOrNull(readinessIssuesById, participant.Id),
                    // The rule of the PARTICIPANT_NOT_READY finding above: an organisation that enforces readiness, and a participant who fails it.
                    NotReadyForRostering = enforcingTenants.Contains(participant.TenantId) && !readyParticipantIdSet.Contains(participant.Id),
                });
            }

            board = new RosterBoardDto
            {
                WeekStart = start, WeekStarted = weekStarted, CanStart = canStart, Days = days, GroupBy = RosterBoardGroupBy.Participant,
                ParticipantRows = participantRows, Exceptions = exceptions, StaffAvailableDays = availableDays,
                GroupActivities = groupActivities, GroupActivitiesEnabled = groupActivitiesEnabled,
                PendingAgreements = await PendingAgreementsAsync(ct),
                // The leave the findings already loaded (weekWindows): leave requests only; recurring and legacy unavailability stay findings of the assign.
                StaffLeave = weekWindows
                    .Where(w => w.Kind is UnavailabilityKind.ApprovedLeave or UnavailabilityKind.PendingLeave)
                    .Select(w => new StaffLeaveDto
                    {
                        // w.End is exclusive (StaffUnavailabilityQuery), as for the staff rows' leave bars below.
                        StaffId = w.UserId, From = DateOnly.FromDateTime(w.Start), To = DateOnly.FromDateTime(w.End.AddTicks(-1)),
                        Status = w.Kind == UnavailabilityKind.ApprovedLeave ? LeaveStatus.Approved : LeaveStatus.Pending,
                    })
                    .ToList(),
                // The trip assignments the findings already loaded (weekTripAssignments), clipped like the staff rows' bars; no new query.
                StaffTrips = weekTripAssignments
                    .Where(a => a.AssignmentStart <= end)
                    .Select(a => new StaffTripDto { StaffId = a.UserId, TripInstanceId = a.TripInstanceId, TripName = a.TripInstance.TripName, From = a.AssignmentStart, To = a.AssignmentEnd })
                    .ToList(),
            };
        }
        else
        {
            var rows = new List<RosterStaffRowDto>();
            var assignedByTrip = await AssignedByTripAsync(weekTripAssignments.Where(a => a.AssignmentStart <= end).Select(a => a.TripInstanceId));
            var daysFor = await TripBarDaysAsync(weekTripAssignments.Where(a => a.AssignmentStart <= end).Select(a => a.TripInstance));

            foreach (var staff in activeStaff.Where(s => staffId is null || s.Id == staffId))
            {
                var staffShifts = weekShifts.Where(s => s.UserId == staff.Id).ToList();
                var shiftDtos = staffShifts.Select(s => ToShiftDto(s, findingsByShiftId[s.Id])).ToList();

                var (complianceLevel, complianceNotes) = ComputeCompliance(staff, start);
                var rosteredHours = staffShifts.Where(s => s.Status != ShiftStatus.Cancelled).Sum(s => ProviderLocalTime.RosteredHours(s, orgZone));

                var myTripBars = weekTripAssignments.Where(a => a.UserId == staff.Id && a.AssignmentStart <= end).Select(a => new TripBarDto
                {
                    TripInstanceId = a.TripInstanceId, TripCode = a.TripInstance.TripCode, TripName = a.TripInstance.TripName,
                    StartDate = a.AssignmentStart, EndDate = a.AssignmentEnd, IsDriver = a.IsDriver,
                    StaffShort = TripStaffing.StaffShort(a.TripInstance, assignedByTrip.GetValueOrDefault(a.TripInstanceId)),
                    Days = daysFor(a.TripInstance, a.AssignmentStart, a.AssignmentEnd)
                }).ToList();

                var myLeave = weekWindows
                    .Where(w => w.UserId == staff.Id)
                    .Select(w => new LeaveBarDto
                    {
                        // w.End is EXCLUSIVE (StaffUnavailabilityQuery builds whole-day leave as
                        // [StartDate 00:00, EndDate+1 00:00)) — subtract a tick to land on the
                        // last instant the window actually covers, so the bar's last day is correct.
                        StartDate = DateOnly.FromDateTime(w.Start), EndDate = DateOnly.FromDateTime(w.End.AddTicks(-1)), Kind = w.Kind,
                        // Legacy rows keep their source type for the bar label; leave/rule bars are labelled from Kind.
                        AvailabilityType = w.Kind == UnavailabilityKind.Legacy ? w.LegacySourceType : null,
                        Notes = w.Kind == UnavailabilityKind.Legacy ? w.LegacyNotes : null,
                        // Pending recurring occurrences need their time-of-day window too, exactly like
                        // approved ones, so LeaveBar can draw the same partial-day bar (with pending styling).
                        StartTime = w.Kind is UnavailabilityKind.RecurringRule or UnavailabilityKind.PendingRecurringRule
                            ? TimeOnly.FromDateTime(w.Start) : null,
                        EndTime = w.Kind is UnavailabilityKind.RecurringRule or UnavailabilityKind.PendingRecurringRule
                            ? TimeOnly.FromDateTime(w.End) : null,
                    }).ToList();

                rows.Add(new RosterStaffRowDto
                {
                    StaffId = staff.Id, FullName = staff.FullName, Role = staff.Position ?? Position.SupportWorker,
                    Compliance = complianceLevel, ComplianceNotes = complianceNotes,
                    RosteredHours = rosteredHours, TargetHours = RosterAvailability.WeeklyHoursFor(weeklyHours, staff.TenantId),
                    Shifts = shiftDtos, TripBars = myTripBars, Leave = myLeave
                });
            }

            // One staff member's week has no Unfilled lane: an empty list, never null (the client spreads it).
            var unfilled = staffId is null
                ? weekShifts.Where(s => s.UserId is null && s.GroupActivityId is null).Select(s => ToShiftDto(s, findingsByShiftId[s.Id])).ToList()
                : new List<ShiftDto>();

            board = new RosterBoardDto
            {
                WeekStart = start, WeekStarted = weekStarted, CanStart = canStart, Days = days, GroupBy = RosterBoardGroupBy.Staff,
                StaffRows = rows, Unfilled = unfilled, Exceptions = exceptions, StaffAvailableDays = availableDays,
                GroupActivities = groupActivities, GroupActivitiesEnabled = groupActivitiesEnabled
            };
        }

        return Ok(ApiResponse<RosterBoardDto>.Ok(board));
    }

    /// <summary>How full the next weeks are (spec 2026-10-31): shifts, filled and open per week from this week's Monday in the provider's zone. Open = no worker and not Cancelled.</summary>
    [HttpGet("fill")]
    public async Task<ActionResult<ApiResponse<RosterFillDto>>> GetFill([FromQuery] int? weeks, CancellationToken ct)
    {
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
        var n = Math.Clamp(weeks ?? 8, 4, 8);
        return Ok(ApiResponse<RosterFillDto>.Ok(new RosterFillDto { Today = today, Weeks = await RosterFill.WeeksAsync(_db, WeekStart(today), n, ct) }));
    }

    /// <summary>
    /// Connection map item 12 — backs the participant hub's Rostering tab. Lives on
    /// RosteringController rather than ParticipantsController (absolute route override, same
    /// idiom CaregiverSubmissionsController uses for /participants/{id}/caregiver-link) so it
    /// picks up this controller's stricter SuperAdmin/Admin/Coordinator gate — matching every
    /// other rostering surface rather than ParticipantsController's plain [Authorize]. 404s if
    /// <paramref name="id"/> isn't in the caller's tenant, same as every other participant read,
    /// for free from _db.Participants' ambient tenant query filter.
    /// </summary>
    [HttpGet("/api/v1/participants/{id:guid}/rostering")]
    public async Task<ActionResult<ApiResponse<ParticipantRosteringDto>>> GetParticipantRostering(Guid id, CancellationToken ct)
    {
        // This is a read-only history/roster view. A participant who later becomes incomplete
        // must still have their existing scheduled work visible to authorised coordinators.
        var participant = await _db.Participants.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (participant == null)
            return NotFound(ApiResponse<ParticipantRosteringDto>.Fail("Participant not found."));

        var today = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
        var windowEnd = today.AddDays(28);

        var shifts = await _db.Shifts
            .Where(s => s.ParticipantId == id && s.ServiceDate >= today && s.ServiceDate <= windowEnd)
            .ToListAsync(ct);

        var staffIds = shifts.Where(s => s.UserId.HasValue).Select(s => s.UserId!.Value).Distinct().ToList();
        var staffById = await _db.Users.Where(u => staffIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, ct);
        var windows = await _unavailabilityQuery.GetWindowsAsync(staffIds, today, windowEnd, ct);
        var compatByStaff = await _db.StaffParticipantCompatibilities
            .Where(c => c.ParticipantId == id && staffIds.Contains(c.UserId))
            .ToDictionaryAsync(c => c.UserId, c => c.Level, ct);

        // Same ApprovedLeave-or-approved-RecurringRule rule as GetBoard's AssigneeOnApprovedLeave
        // (connection map item 5) — reuses the single windows load above, no per-shift query.
        bool IsAssigneeOnApprovedLeave(Shift shift)
        {
            if (shift.UserId is null) return false;
            var shiftStart = shift.ServiceDate.ToDateTime(shift.StartTime);
            var shiftEndDate = shift.EndsNextDay ? shift.ServiceDate.AddDays(1) : shift.ServiceDate;
            var shiftEnd = shiftEndDate.ToDateTime(shift.EndTime);
            return windows.Any(w => w.UserId == shift.UserId.Value
                && (w.Kind == UnavailabilityKind.ApprovedLeave || w.Kind == UnavailabilityKind.RecurringRule)
                && w.Start < shiftEnd && shiftStart < w.End);
        }

        var upcomingShifts = shifts
            .OrderBy(s => s.ServiceDate).ThenBy(s => s.StartTime)
            .Select(s => new ParticipantRosteringShiftDto
            {
                ShiftId = s.Id, ServiceDate = s.ServiceDate, StartTime = s.StartTime, EndTime = s.EndTime,
                EndsNextDay = s.EndsNextDay,
                StaffId = s.UserId,
                StaffName = s.UserId.HasValue ? staffById.GetValueOrDefault(s.UserId.Value)?.FullName : null,
                Status = s.Status,
                AssigneeOnApprovedLeave = IsAssigneeOnApprovedLeave(s)
            })
            .ToList();

        var assignedStaff = shifts
            .Where(s => s.UserId.HasValue)
            .GroupBy(s => s.UserId!.Value)
            .Select(g => new ParticipantRosteringStaffDto
            {
                StaffId = g.Key,
                StaffName = staffById.GetValueOrDefault(g.Key)?.FullName ?? string.Empty,
                ShiftCount = g.Count(),
                Compatibility = compatByStaff.TryGetValue(g.Key, out var level) ? level : CompatibilityLevel.Allowed
            })
            .OrderBy(s => s.StaffName)
            .ToList();

        return Ok(ApiResponse<ParticipantRosteringDto>.Ok(new ParticipantRosteringDto
        {
            UpcomingShifts = upcomingShifts,
            AssignedStaff = assignedStaff
        }));
    }

    /// <summary>
    /// Read-only shift notes for the roster slide-over (NOTES-01) — coordinators/admins read
    /// via this surface; only the assigned support worker creates/edits their own, through
    /// PortalController. Newest first.
    /// </summary>
    [HttpGet("shifts/{id:guid}/notes")]
    public async Task<ActionResult<ApiResponse<List<ShiftNoteDto>>>> GetShiftNotes(Guid id, CancellationToken ct)
    {
        var shiftExists = await _db.Shifts.AnyAsync(s => s.Id == id, ct);
        if (!shiftExists) return NotFound(ApiResponse<List<ShiftNoteDto>>.Fail("Shift not found."));

        var notes = await _db.ShiftNotes
            .Where(n => n.ShiftId == id)
            .OrderByDescending(n => n.CreatedAt)
            .ToListAsync(ct);

        var incidentIds = await GetIncidentIdsByShiftNoteIdsAsync(notes.Select(n => n.Id).ToList(), ct);
        return Ok(ApiResponse<List<ShiftNoteDto>>.Ok(
            notes.Select(n => ToShiftNoteDto(n, LookupIncidentId(incidentIds, n.Id))).ToList()));
    }

    /// <summary>
    /// Connection-map Deliverable 3: coordinator work queue of flagged shift notes — notes whose
    /// keyword scan (NOTES-02) matched at least one category, oldest first. <paramref
    /// name="withoutIncident"/> = true narrows to notes with no active incident yet filed against
    /// them (IncidentReport.ShiftNoteId), the exact set the queue exists to surface; omitted/false
    /// returns every flagged note regardless of incident state. <paramref name="from"/>/<paramref
    /// name="to"/> filter on the parent Shift's ServiceDate. Tenant-scoped for free — ShiftNote is
    /// its own ITenantEntity (ambient OdipDbContext query filter), same as every other read here.
    /// </summary>
    [HttpGet("flagged-notes")]
    public async Task<ActionResult<ApiResponse<List<FlaggedShiftNoteDto>>>> GetFlaggedShiftNotes(
        [FromQuery] bool? withoutIncident, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
    {
        var query = _db.ShiftNotes
            .Include(n => n.Shift).ThenInclude(s => s!.Participant)
            .Include(n => n.Shift).ThenInclude(s => s!.User)
            .Where(n => n.FlaggedCategories != ShiftNoteFlagCategory.None);

        if (from.HasValue) query = query.Where(n => n.Shift!.ServiceDate >= from.Value);
        if (to.HasValue) query = query.Where(n => n.Shift!.ServiceDate <= to.Value);
        // Same predicate as GetIncidentIdsByShiftNoteIdsAsync: an active incident filed against the note.
        if (withoutIncident == true) query = query.Where(n => !_db.IncidentReports.Any(i => i.IsActive && i.ShiftNoteId == n.Id));

        var notes = await query.OrderBy(n => n.CreatedAt).ToListAsync(ct);

        var incidentIds = await GetIncidentIdsByShiftNoteIdsAsync(notes.Select(n => n.Id).ToList(), ct);

        var items = notes.Select(n => new FlaggedShiftNoteDto
        {
            ShiftNoteId = n.Id,
            ShiftId = n.ShiftId,
            ShiftDate = n.Shift!.ServiceDate,
            StartTime = n.Shift.StartTime,
            EndTime = n.Shift.EndTime,
            EndsNextDay = n.Shift.EndsNextDay,
            ParticipantId = n.Shift.ParticipantId,
            ParticipantName = n.Shift.Participant != null ? n.Shift.Participant.FullName : string.Empty,
            StaffId = n.Shift.UserId,
            StaffName = n.Shift.User != null ? n.Shift.User.FullName : null,
            // Same ShiftNoteKeywordVocabulary.ToCategoryNames-produced shape as ShiftNoteDto's own
            // FlaggedCategories, not the raw [Flags] enum.
            FlaggedCategories = ShiftNoteKeywordVocabulary.ToCategoryNames(n.FlaggedCategories),
            Excerpt = n.Body.Length > 200 ? n.Body.Substring(0, 200) : n.Body,
            CreatedAt = n.CreatedAt,
            IncidentId = LookupIncidentId(incidentIds, n.Id),
        }).ToList();

        return Ok(ApiResponse<List<FlaggedShiftNoteDto>>.Ok(items));
    }

    // ══════════════════════════════════════════════════════════════
    // COMPATIBILITY MATRIX
    // ══════════════════════════════════════════════════════════════

    /// <summary>List compatibility rows, optionally filtered by participant. Absence of a row for a pair means Allowed — this only returns rows that actually exist.</summary>
    [HttpGet("compatibility")]
    public async Task<ActionResult<ApiResponse<List<CompatibilityRowDto>>>> GetCompatibility(
        [FromQuery] Guid? participantId, CancellationToken ct)
    {
        var query = _db.StaffParticipantCompatibilities.Include(c => c.User).Include(c => c.Participant).AsQueryable();
        if (participantId.HasValue) query = query.Where(c => c.ParticipantId == participantId.Value);

        var rows = await query.ToListAsync(ct);
        // One participant: the CompatibilityOrder. All participants: by participant, then that order.
        static (int Tier, int Rank, string Name) Key(StaffParticipantCompatibility c) => CompatibilityOrder.Key(c.Level, c.Rank, c.User?.FullName);
        var ordered = participantId.HasValue
            ? rows.OrderBy(Key, CompatibilityOrder.Comparer)
            : rows.OrderBy(c => c.Participant?.FullName ?? string.Empty, StringComparer.OrdinalIgnoreCase).ThenBy(c => c.ParticipantId).ThenBy(Key, CompatibilityOrder.Comparer);
        return Ok(ApiResponse<List<CompatibilityRowDto>>.Ok(ordered.Select(ToCompatibilityDto).ToList()));
    }

    /// <summary>Upsert one compatibility cell (StaffId, ParticipantId).</summary>
    [HttpPut("compatibility")]
    public async Task<ActionResult<ApiResponse<CompatibilityRowDto>>> UpsertCompatibility(
        [FromBody] UpsertCompatibilityDto dto, CancellationToken ct)
    {
        if (dto.Rank is < 1)
            return BadRequest(ApiResponse<CompatibilityRowDto>.Fail("Rank must be 1 or more."));
        if (!await _db.Users.AnyAsync(s => s.Id == dto.StaffId && s.IsActive, ct))
            return BadRequest(ApiResponse<CompatibilityRowDto>.Fail("Staff member not found."));
        if (!(await ParticipantReadiness.CheckAsync(_db, dto.ParticipantId, ct)).Allowed)
            return BadRequest(ApiResponse<CompatibilityRowDto>.Fail(ParticipantReadinessGate.NotReadyMessage));

        Guid rowId;
        try { rowId = await WriteCompatibilityAsync(dto, ct); }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // Two first writes for one pair raced and the other won. Drop the losing insert and what was staged with it,
            // then redo the write: the row exists now, so it updates it, with previousLevel read from it.
            _db.ChangeTracker.Clear();
            rowId = await WriteCompatibilityAsync(dto, ct);
        }

        var loaded = await _db.StaffParticipantCompatibilities
            .Include(c => c.User).Include(c => c.Participant)
            .FirstAsync(c => c.Id == rowId, ct);
        return Ok(ApiResponse<CompatibilityRowDto>.Ok(ToCompatibilityDto(loaded)));
    }

    /// <summary>Finds or creates the (staff, participant) row, applies the dto, syncs the preferred link and places it in its tier, then saves.</summary>
    private async Task<Guid> WriteCompatibilityAsync(UpsertCompatibilityDto dto, CancellationToken ct)
    {
        var row = await _db.StaffParticipantCompatibilities
            .FirstOrDefaultAsync(c => c.UserId == dto.StaffId && c.ParticipantId == dto.ParticipantId, ct);
        // Absence of a row means Allowed (the entity's documented sparse default) — same value
        // StaffCompatibilityLinkService.SyncFromCompatibilityUpsertAsync expects for a new row.
        var previousLevel = row?.Level ?? CompatibilityLevel.Allowed;

        if (row == null)
        {
            row = new StaffParticipantCompatibility
            {
                Id = Guid.NewGuid(), UserId = dto.StaffId, ParticipantId = dto.ParticipantId,
                TenantId = await _db.Participants.Where(p => p.Id == dto.ParticipantId).Select(p => p.TenantId).FirstAsync(ct),
            };
            _db.StaffParticipantCompatibilities.Add(row);
        }

        row.Level = dto.Level;
        row.Reason = string.IsNullOrWhiteSpace(dto.Reason) ? null : dto.Reason.Trim(); // the reason is optional
        row.UpdatedAt = DateTime.UtcNow;
        // This endpoint is the compatibility matrix's only human-facing writer — every call
        // takes ownership of the row away from the participant-preferred-staff auto-link (task
        // 6d; see StaffCompatibilityLinkService for why).
        row.AutoLinked = false;

        // Task 6d: reflect a Preferred mark (or a move off it) back onto the participant's
        // PreferredUserId, in the same transaction as this compatibility write.
        await _compatLink.SyncFromCompatibilityUpsertAsync(row, previousLevel, ct);

        // R8a: place the row in its tier and renumber the tier(s) it touches, in this same save.
        await _compatLink.PlaceAsync(row, previousLevel, dto.Rank, ct);

        await ParticipantGroupRevisions.SaveBumpingAsync(_db, ct);
        return row.Id;
    }

    /// <summary>
    /// Parses the board's <c>groupBy</c> query param case-insensitively. Missing/empty
    /// defaults to <see cref="RosterBoardGroupBy.Participant"/>; anything other than
    /// "participant" or "staff" fails so the caller can 400 rather than silently defaulting.
    /// </summary>
    private static bool TryParseGroupBy(string? raw, out RosterBoardGroupBy result)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            result = RosterBoardGroupBy.Participant;
            return true;
        }

        if (string.Equals(raw, "participant", StringComparison.OrdinalIgnoreCase))
        {
            result = RosterBoardGroupBy.Participant;
            return true;
        }

        if (string.Equals(raw, "staff", StringComparison.OrdinalIgnoreCase))
        {
            result = RosterBoardGroupBy.Staff;
            return true;
        }

        result = default;
        return false;
    }

    private static ShiftNoteDto ToShiftNoteDto(ShiftNote n, Guid? incidentId) => new(
        n.Id, n.ShiftId, n.AuthorUserId, n.AuthorName, n.Body, n.CreatedAt, n.UpdatedAt,
        ShiftNoteKeywordVocabulary.ToCategoryNames(n.FlaggedCategories), n.FlagsAcknowledgedAt, incidentId);

    /// <summary>
    /// Connection-map reverse link (Deliverable 2): for the given shift-note ids, the newest
    /// active IncidentReport whose ShiftNoteId points back at each one — ONE query for the whole
    /// batch (never per-row), same idiom as MedicationsController's administration-id lookup.
    /// </summary>
    private async Task<Dictionary<Guid, Guid>> GetIncidentIdsByShiftNoteIdsAsync(IReadOnlyCollection<Guid> shiftNoteIds, CancellationToken ct)
    {
        if (shiftNoteIds.Count == 0) return new Dictionary<Guid, Guid>();
        var rows = await _db.IncidentReports
            .Where(i => i.IsActive && i.ShiftNoteId != null && shiftNoteIds.Contains(i.ShiftNoteId.Value))
            .Select(i => new { NoteId = i.ShiftNoteId!.Value, i.Id, i.CreatedAt })
            .ToListAsync(ct);
        return rows
            .GroupBy(r => r.NoteId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(r => r.CreatedAt).First().Id);
    }

    /// <summary>Dictionary&lt;Guid, Guid&gt;.GetValueOrDefault returns Guid.Empty (not null) for a
    /// missing key, which would wrongly stand in for "no incident" — this is the null-correct
    /// lookup every incident-id-map read in this class uses instead.</summary>
    private static Guid? LookupIncidentId(Dictionary<Guid, Guid> map, Guid key) =>
        map.TryGetValue(key, out var incidentId) ? incidentId : null;

    /// <summary>
    /// For the board's notice (spec 2026-10-15; lead decision L10): every participant whose newest agreement revision waits for an approval for rostering, with a board row or not.
    /// A participant still in onboarding has no row, and theirs is the agreement nobody can otherwise see.
    /// - Newest: no newer revision of the same agreement in the same organisation (the shape ParticipantReadinessGate already runs on Npgsql).
    /// - Waits: not approved; made from blocks (blocks and a stored answer: the approval service's HandTyped rule); not ended on the provider's calendar.
    /// - Archived participants (neither active nor a draft) are left out (L11).
    /// One query, read only. The query filters keep it to the caller's organisation, and each revision is matched to its own participant's organisation, because a SuperAdmin's context sees all of them.
    /// </summary>
    private async Task<List<PendingAgreementDto>> PendingAgreementsAsync(CancellationToken ct)
    {
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
        var waiting = await _db.ServiceAgreementDrafts.AsNoTracking()
            .Where(d => d.AgreementEndDate >= today && d.Blocks.Any() && d.PricingJson != null
                && !_db.ServiceAgreementDrafts.Any(newer => newer.ParticipantId == d.ParticipantId && newer.TenantId == d.TenantId && newer.AgreementId == d.AgreementId && newer.Version > d.Version)
                && !_db.ServiceAgreementDraftApprovals.Any(a => a.DraftId == d.Id && a.TenantId == d.TenantId))
            .Join(_db.Participants.AsNoTracking().Where(p => p.IsActive || p.IsDraft), d => d.ParticipantId, p => p.Id, (d, p) => new { d.Id, d.Version, d.TenantId, d.PricingJson, d.AgreementId, d.AgreementKind, d.AgreementName, Participant = p })
            .Where(x => x.Participant.TenantId == x.TenantId)
            .ToListAsync(ct);
        return waiting
            .Where(x => DraftJson.ReadQuote(x.PricingJson) is not null)   // the approval service's own HandTyped test: a stored answer it can read
            .OrderBy(x => x.Participant.LastName).ThenBy(x => x.Participant.FirstName).ThenBy(x => x.AgreementId)
            .Select(x => new PendingAgreementDto
            {
                ParticipantId = x.Participant.Id, DisplayName = x.Participant.FullName, DraftId = x.Id, Version = x.Version,
                AgreementId = x.AgreementId, AgreementKind = x.AgreementKind, AgreementName = x.AgreementName,
                CanReceiveServices = Participant.CanReceiveServices(x.Participant),
            })
            .ToList();
    }

    private static CompatibilityRowDto ToCompatibilityDto(StaffParticipantCompatibility c) => new()
    {
        Id = c.Id, StaffId = c.UserId, StaffName = c.User?.FullName ?? string.Empty,
        ParticipantId = c.ParticipantId, ParticipantName = c.Participant?.FullName ?? string.Empty,
        Level = c.Level, Rank = c.Rank, Reason = c.Reason, UpdatedAt = c.UpdatedAt
    };

    /// <summary>
    /// Start rostering (2026-10-16, L2): makes <c>StaffId</c> the regular of the pattern's slot (its default worker), or clears it with null. No shift changes: it applies from the next generated week.
    /// An agreement's pattern takes it too, as its default staff is the coordinator's own (UpdatePattern).
    /// REV274: <c>ShiftId</c> is the shift the coordinator was shown. An edited occurrence keeps its pattern link while its day, times or participant differ from the pattern's slot, so the server compares the
    /// two itself and refuses a stale board (409); a Make also needs that shift's own worker; an ended pattern has no regular to change (409 pattern-ended).
    /// </summary>
    [HttpPut("patterns/{id:guid}/regular")]
    public async Task<ActionResult<ApiResponse<ShiftPatternDto>>> SetRegular(Guid id, [FromBody] SetRegularDto dto, CancellationToken ct)
    {
        var participantId = await _db.ShiftPatterns.Where(p => p.Id == id).Select(p => (Guid?)p.ParticipantId).FirstOrDefaultAsync(ct);
        if (participantId is null) return NotFound(ApiResponse<ShiftPatternDto>.Fail("Pattern not found."));
        // REV281B: queue behind the participant's generation lock (see UpdatePattern), and read the pattern and its successors under it.
        RosterGenerationLock lockTaken;
        try { lockTaken = await RosterGenerationLock.AcquireAsync(_db, participantId.Value, ct, _generator.LockWait); }
        catch (RosterBusyException busy) { return Conflict(ApiResponse<ShiftPatternDto>.Fail(busy.Message)); }
        await using var held = lockTaken;
        var pattern = await _db.ShiftPatterns.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (pattern == null) return NotFound(ApiResponse<ShiftPatternDto>.Fail("Pattern not found."));
        var shown = await _db.Shifts.AsNoTracking().FirstOrDefaultAsync(s => s.Id == dto.ShiftId, ct);
        if (shown is null || shown.ShiftPatternId != id || shown.ParticipantId != pattern.ParticipantId || shown.ServiceDate.DayOfWeek != pattern.DayOfWeek
            || shown.StartTime != pattern.StartTime || shown.EndTime != pattern.EndTime || shown.EndsNextDay != pattern.EndsNextDay
            || (dto.StaffId.HasValue && shown.UserId != dto.StaffId))
            return Conflict(ApiResponse<ShiftPatternDto>.Fail(BoardChangedMessage, ShiftErrorCodes.ShiftBoardChanged));
        if (!pattern.IsActive || pattern.EffectiveTo < await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct))
            return Conflict(ApiResponse<ShiftPatternDto>.Fail("This shift's agreement pattern has ended, so it has no regular to change.", PatternEndedCode));
        if (dto.StaffId.HasValue && !await _db.Users.AnyAsync(s => s.Id == dto.StaffId.Value && s.IsActive, ct))
            return BadRequest(ApiResponse<ShiftPatternDto>.Fail("Staff member not found."));
        if (dto.StaffId.HasValue && dto.StaffId != pattern.DefaultUserId && await MarkedNoRefusalAsync(pattern.ParticipantId, dto.StaffId.Value, ct) is { } markedNo)
            return BadRequest(ApiResponse<ShiftPatternDto>.Fail(markedNo));
        // shortcut: a client that omits ExpectedRegularId (a tab opened before this deploy) skips this check and can still send a stale Stop; the token below only catches a change between our load and save. Such tabs are protected after one reload; upgrade by requiring the field once old tabs are gone.
        // REV281B: the regular the coordinator was shown must still be the live one. DefaultUserId is also a concurrency token, so a change between this load and the save is refused at the UPDATE.
        if (dto.ExpectedRegularId is { } seen && (seen == Guid.Empty ? null : seen) != pattern.DefaultUserId)
            return Conflict(ApiResponse<ShiftPatternDto>.Fail(BoardChangedMessage, ShiftErrorCodes.ShiftBoardChanged));
        var was = pattern.DefaultUserId;
        pattern.DefaultUserId = dto.StaffId;
        // REV281B: a renewal's successor starts later and was copied this worker, and the next started week is made from it, so the change has to reach it too (in memory: the asks are jsonb).
        if (pattern.EffectiveTo is { } endsOn)
            foreach (var next in (await _db.ShiftPatterns.Where(p => p.ParticipantId == pattern.ParticipantId && p.IsActive && p.Id != pattern.Id && p.EffectiveFrom > endsOn).ToListAsync(ct))
                .Where(n => n.DefaultUserId == was && ServiceAgreementApprovalService.SameSupport(pattern, n)))   // only the approval's copy: a regular chosen on the renewal stays
                next.DefaultUserId = dto.StaffId;
        try { await _db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { return Conflict(ApiResponse<ShiftPatternDto>.Fail(BoardChangedMessage, ShiftErrorCodes.ShiftBoardChanged)); }
        await held.CommitAsync(ct);
        return Ok(ApiResponse<ShiftPatternDto>.Ok(await LoadPatternDtoAsync(pattern.Id, ct)));
    }

    /// <summary>The code of SetRegular's 409 for a pattern that has ended (REV274): the pattern no longer generates, so it has no regular to change.</summary>
    public const string PatternEndedCode = "pattern-ended";

    /// <summary>Whether the week from <paramref name="monday"/> is rostered (the board's WeekStarted: a row or any pattern's shift, <see cref="StartedWeeks.RosteredMondaysAsync"/>); Start's own rule is the agreement-only <see cref="StartedWeeks.MondaysAsync"/>.</summary>
    private async Task<bool> WeekStartedAsync(Guid? tenantId, DateOnly monday, CancellationToken ct) => (await StartedWeeks.RosteredMondaysAsync(_db, tenantId, monday, monday, ct)).Count > 0;
}
