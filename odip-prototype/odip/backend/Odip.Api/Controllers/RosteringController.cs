using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
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

/// <summary>
/// Rostering API (M4 pass 1): the week roster board, shift CRUD, weekly shift-pattern
/// generation, and the staff-participant compatibility matrix. Gated to
/// <c>SuperAdmin,Admin,Coordinator</c> on every action including reads — deliberately
/// STRICTER than <see cref="ScheduleController"/>'s plain <c>[Authorize]</c> (that
/// controller's posture is a separate, pre-existing issue and out of scope here; do not
/// "harmonise" the two). Rostering is coordinator work: the board exposes participant
/// support needs and staff credential/compliance status, and the frontend already excludes
/// rostering from a SupportWorker's visible pages (<c>SUPPORT_WORKER_PAGES</c>) — that
/// nav-level exclusion is not access control on its own, so the API must enforce the same
/// restriction itself rather than relying on the UI to hide it. Every write that touches a
/// shift runs <see cref="RosterConflictService.Check"/> before saving; see
/// <see cref="EvaluateFindings"/> for the Blocking/Warning/override gate.
/// </summary>
[ApiController]
[Authorize(Roles = "SuperAdmin,Admin,Coordinator")]
[Route("api/v1/rostering")]
public class RosteringController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly RosterShiftGenerator _generator;
    private readonly StaffCompatibilityLinkService _compatLink;
    private readonly IStaffUnavailabilityQuery _unavailabilityQuery;
    private readonly RosterAvailability _availability;
    private readonly IConfiguration? _config;

    private readonly Odip.Application.Interfaces.INotificationRaiser _notificationRaiser;
    private readonly Odip.Application.Interfaces.IObligationTaskService _obligationTasks;
    private readonly ShiftPackageService _package;
    // The request's clock: a test fixes it. Every calendar rule uses the PROVIDER's date from it (ProviderTimeZoneResolver.TodayAsync), never the UTC date.
    private readonly TimeProvider _clock;
    // Budget phase 3: the budget check of a one-off shift, which needs to know whose money it may show (the caller's organisation). Without a tenant on the request there is no budget check.
    private readonly ICurrentTenant? _tenant;
    private readonly ShiftBudgetCheck? _budget;
    private readonly ShiftBudgetEffect? _budgetEffect;
    private readonly ILogger<RosteringController>? _logger;

    public RosteringController(
        OdipDbContext db, StaffCompatibilityLinkService compatLink, IStaffUnavailabilityQuery unavailabilityQuery,
        IConfiguration? config = null, Odip.Application.Interfaces.INotificationRaiser? notificationRaiser = null,
        Odip.Application.Interfaces.IObligationTaskService? obligationTasks = null,
        ShiftPackageService? package = null, TimeProvider? clock = null, RosterShiftGenerator? generator = null,
        ICurrentTenant? tenant = null, ShiftBudgetCheck? budget = null, ShiftBudgetEffect? budgetEffect = null, ILogger<RosteringController>? logger = null)
    {
        _logger = logger;
        _db = db;
        _generator = generator ?? new RosterShiftGenerator();
        _clock = clock ?? TimeProvider.System;
        _tenant = tenant;
        _budget = budget ?? (tenant is null ? null : new ShiftBudgetCheck(db, new BudgetLedgerService(db, _clock)));
        _budgetEffect = budgetEffect ?? (tenant is null ? null : new ShiftBudgetEffect(db, new BudgetLedgerService(db, _clock)));
        _compatLink = compatLink;
        _unavailabilityQuery = unavailabilityQuery;
        _availability = new RosterAvailability(db, unavailabilityQuery);
        _config = config;
        _notificationRaiser = notificationRaiser ?? new Odip.Infrastructure.Notifications.NotificationRaiser(db);
        _obligationTasks = obligationTasks ?? new Odip.Infrastructure.Tasks.ObligationTaskService(db);
        _package = package ?? new ShiftPackageService(db);
    }

    private int VarianceReviewMinutes => ShiftCompletionMapper.ClampVarianceReviewMinutes(_config?.GetValue<int>("Rostering:VarianceReviewMinutes", 15) ?? 15);

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
    /// </summary>
    [HttpGet("board")]
    public async Task<ActionResult<ApiResponse<RosterBoardDto>>> GetBoard(
        [FromQuery] DateOnly? weekStart, [FromQuery] string? groupBy, CancellationToken ct)
    {
        if (!TryParseGroupBy(groupBy, out var groupByValue))
        {
            return BadRequest(ApiResponse<RosterBoardDto>.Fail(
                $"Unrecognised groupBy value '{groupBy}'. Expected 'participant' or 'staff'."));
        }

        var start = WeekStart(weekStart ?? await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct));
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

        var weekTripAssignments = await _db.StaffAssignments
            .Include(a => a.TripInstance)
            .Where(a => staffIds.Contains(a.UserId) && a.Status != AssignmentStatus.Cancelled
                        && a.AssignmentStart <= end.AddDays(1) && a.AssignmentEnd >= start) // +1 day: Sunday's overnight shift can meet Monday's trip; only findings see it (bars filter below)
            .ToListAsync(ct);

        var weekWindows = await _unavailabilityQuery.GetWindowsAsync(staffIds, start, end, ct);

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
        var availability = new RosterAvailability.Snapshot(activeStaff, participantById.Values, weekShifts, weekTripAssignments, weekWindows, compatByPair, weekPublicHolidays, weeklyHours);

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
        var regulars = await RegularsAsync(weekShifts.Select(s => s.ShiftPatternId), ct);
        var weekStarted = await WeekStartedAsync(_tenant?.TenantId, start, ct);

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
                DurationHours = shift.DurationHours, Ratio = shift.Ratio, NightType = shift.NightType, Status = shift.Status,
                ShiftPatternId = shift.ShiftPatternId, Notes = shift.Notes, OverrideReason = shift.OverrideReason, Requirements = RequirementsOf(shift.RequirementsJson),
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

        var exceptions = new List<RosterExceptionDto>();
        foreach (var shift in weekShifts)
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

            TripBarDto ToParticipantTripBar(ParticipantBooking b) => new()
            {
                TripInstanceId = b.TripInstanceId, TripCode = b.TripInstance.TripCode, TripName = b.TripInstance.TripName,
                StartDate = b.TripInstance.StartDate, EndDate = b.TripInstance.EndDate, IsDriver = false
            };

            var participantRows = new List<RosterParticipantRowDto>();
            foreach (var participant in displayParticipants)
            {
                var participantShifts = weekShifts.Where(s => s.ParticipantId == participant.Id).ToList();
                var shiftDtos = participantShifts.Select(s => ToShiftDto(s, findingsByShiftId[s.Id])).ToList();
                var myTripBars = weekBookings.Where(b => b.ParticipantId == participant.Id).Select(ToParticipantTripBar).ToList();
                var scheduledHours = participantShifts.Where(s => s.Status != ShiftStatus.Cancelled).Sum(s => s.DurationHours);
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
                WeekStart = start, WeekStarted = weekStarted, Days = days, GroupBy = RosterBoardGroupBy.Participant,
                ParticipantRows = participantRows, Exceptions = exceptions,
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
            };
        }
        else
        {
            var rows = new List<RosterStaffRowDto>();

            foreach (var staff in activeStaff)
            {
                var staffShifts = weekShifts.Where(s => s.UserId == staff.Id).ToList();
                var shiftDtos = staffShifts.Select(s => ToShiftDto(s, findingsByShiftId[s.Id])).ToList();

                var (complianceLevel, complianceNotes) = ComputeCompliance(staff, start);
                var rosteredHours = staffShifts.Where(s => s.Status != ShiftStatus.Cancelled).Sum(s => s.DurationHours);

                var myTripBars = weekTripAssignments.Where(a => a.UserId == staff.Id && a.AssignmentStart <= end).Select(a => new TripBarDto
                {
                    TripInstanceId = a.TripInstanceId, TripCode = a.TripInstance.TripCode, TripName = a.TripInstance.TripName,
                    StartDate = a.AssignmentStart, EndDate = a.AssignmentEnd, IsDriver = a.IsDriver
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

            var unfilled = weekShifts
                .Where(s => s.UserId is null)
                .Select(s => ToShiftDto(s, findingsByShiftId[s.Id]))
                .ToList();

            board = new RosterBoardDto
            {
                WeekStart = start, WeekStarted = weekStarted, Days = days, GroupBy = RosterBoardGroupBy.Staff,
                StaffRows = rows, Unfilled = unfilled, Exceptions = exceptions
            };
        }

        return Ok(ApiResponse<RosterBoardDto>.Ok(board));
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

    // ══════════════════════════════════════════════════════════════
    // SHIFTS
    // ══════════════════════════════════════════════════════════════

    /// <summary>Dry-run findings for a candidate shift. Never writes — the same check every gated write runs, exposed for live validation as the coordinator edits.</summary>
    [HttpPost("shifts/check")]
    public async Task<ActionResult<ApiResponse<List<RosterFindingDto>>>> CheckShift(
        [FromBody] CheckShiftDto dto, CancellationToken ct)
    {
        if (Shift.HoursBetween(dto.StartTime, dto.EndTime, dto.EndsNextDay) <= 0m) return BadRequest(ApiResponse<List<RosterFindingDto>>.Fail(ShiftEndsBeforeItStartsMessage, ShiftNoLengthCode));

        var refError = await ValidateRefsAsync(dto.ParticipantId, dto.StaffId, ct);
        if (refError != null) return BadRequest(ApiResponse<List<RosterFindingDto>>.Fail(refError));

        var candidate = new Shift
        {
            Id = dto.Id ?? Guid.Empty, ParticipantId = dto.ParticipantId, UserId = dto.StaffId,
            ServiceDate = dto.ServiceDate, StartTime = dto.StartTime, EndTime = dto.EndTime, EndsNextDay = dto.EndsNextDay,
            Ratio = dto.Ratio, NightType = dto.NightType
        };

        var findings = await CheckAsync(candidate, dto.Id, ct);

        // Budget phase 3: after the domain check and OUTSIDE its early return for an unfilled shift (a budget is about the participant, not the worker). The envelope's message carries the one
        // informational line a shift the estimator cannot price gets; it is not a finding and never blocks.
        var budget = await CheckBudgetAsync(candidate, dto.Id, dto.Status, ct);
        findings.AddRange(budget.Findings);
        return Ok(ApiResponse<List<RosterFindingDto>>.Ok(findings.Select(ToFindingDto).ToList(), budget.Note));
    }

    /// <summary>Create a shift. Runs the roster check before saving — see <see cref="EvaluateFindings"/>.</summary>
    [HttpPost("shifts")]
    public async Task<ActionResult<ApiResponse<ShiftDto>>> CreateShift(
        [FromBody] CreateShiftDto dto, CancellationToken ct)
    {
        if (dto.MoveFromShiftId is not null && dto.StaffId is null) return BadRequest(ApiResponse<ShiftDto>.Fail("Name the person who is moving."));
        // An open shift names nobody, so there is no double-booking for a second create to miss: only a named worker takes the board's lock.
        if (dto.StaffId is null) return await CreateShiftCoreAsync(dto, null, ct);
        try
        {
            // The board's lock order: two creates for one worker, or a create and a move, are taken in turn, so the later one reads the earlier one's shift (DOUBLE_BOOKED_SHIFT).
            // An empty-day move (deep review S6) then locks the source row and reads it, as move-staff does.
            await using var held = await RosterBoardLockAsync(ct);
            Shift? from = null;
            if (dto.MoveFromShiftId is { } fromId)
            {
                await LockShiftRowsAsync("\"Id\" = {0}", new object[] { fromId }, ct);
                from = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == fromId, ct);
                if (from is null) return NotFound(ApiResponse<ShiftDto>.Fail("Shift not found."));
                if (IsLockedForStaffChange(from.Status))
                    return Conflict(ApiResponse<ShiftDto>.Fail(ShiftLockedForStaffMessage, ShiftErrorCodes.ShiftStatusLocked));
                // The person the page carried is no longer on the shift they left: never clear somebody else by surprise.
                if (from.UserId != dto.StaffId) return Conflict(ApiResponse<ShiftDto>.Fail(BoardChangedMessage, ShiftErrorCodes.ShiftBoardChanged));
            }
            var result = await CreateShiftCoreAsync(dto, from, ct);
            if (result.Result is OkObjectResult) await held.CommitAsync(ct);
            return result;
        }
        catch (RosterBusyException)
        {
            return Conflict(ApiResponse<ShiftDto>.Fail(RosterBoardBusyMessage));
        }
    }

    /// <summary>The body of <see cref="CreateShift"/>. With <paramref name="movingFrom"/> (already locked and checked) the person leaves it in the same save.</summary>
    private async Task<ActionResult<ApiResponse<ShiftDto>>> CreateShiftCoreAsync(CreateShiftDto dto, Shift? movingFrom, CancellationToken ct)
    {
        if (Shift.HoursBetween(dto.StartTime, dto.EndTime, dto.EndsNextDay) <= 0m) return BadRequest(ApiResponse<ShiftDto>.Fail(ShiftEndsBeforeItStartsMessage, ShiftNoLengthCode));

        var refError = await ValidateRefsAsync(dto.ParticipantId, dto.StaffId, ct);
        if (refError != null) return BadRequest(ApiResponse<ShiftDto>.Fail(refError));

        var shift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = dto.ParticipantId, UserId = dto.StaffId,
            ServiceDate = dto.ServiceDate, StartTime = dto.StartTime, EndTime = dto.EndTime, EndsNextDay = dto.EndsNextDay,
            // No ShiftPatternId: a pattern link is the server's (the generator sets it). One a request names is dropped, or a hand-made shift could call itself routine and walk round the hard limit (C3).
            Ratio = dto.Ratio, NightType = dto.NightType, Notes = dto.Notes,
            Status = ShiftStatus.Draft
        };

        // A person moving here is judged without the shift they leave (no false DOUBLE_BOOKED_SHIFT against it).
        var findings = await CheckAsync(shift, null, ct, leavingShiftId: movingFrom?.Id);
        findings.AddRange((await CheckBudgetAsync(shift, null, ShiftStatus.Draft, ct)).Findings);

        var budgetGate = ShiftBudgetGate.Resolve(findings, dto.Emergency, dto.OverrideReason);
        if (budgetGate.Error != null) return BadRequest(ApiResponse<ShiftDto>.Fail(budgetGate.Error));
        var rejection = EvaluateFindings(budgetGate.GateFindings, dto.OverrideReason);
        if (rejection != null) return UnprocessableEntity(rejection);

        ApplyOverride(shift, findings, budgetGate, dto.OverrideReason, dto.AcknowledgedFindingCodes);
        if (budgetGate.EmergencyAccepted) await RaiseEmergencyReviewAsync(shift, ct);

        _db.Shifts.Add(shift);
        if (movingFrom is not null)
        {
            var mover = movingFrom.UserId;
            ApplyStaff(movingFrom, null, new List<RosterFinding>(), null, null);
            // Item 9 of the connection map: the shift they left no longer waits to be re-covered for leave.
            await _obligationTasks.CompleteByShiftAsync(movingFrom.Id, TaskType.LeaveCoverage, ct);
            await NotifyStaffChangeAsync(movingFrom, mover, wasPublished: movingFrom.Status == ShiftStatus.Published, ct);
        }
        await _db.SaveChangesAsync(ct);

        // No GET /shifts/{id} route exists in the spec's API table (the board and shift-list
        // reads all go through GET /board) — an Ok response is the correct shape here rather
        // than CreatedAtAction pointing at a nonexistent action.
        return Ok(ApiResponse<ShiftDto>.Ok(await ToShiftDtoAsync(shift, findings, ct)));
    }

    /// <summary>Update a shift. Re-runs the roster check against the edited candidate (excluding the shift's own prior row) before saving.</summary>
    [HttpPut("shifts/{id:guid}")]
    public async Task<ActionResult<ApiResponse<ShiftDto>>> UpdateShift(
        Guid id, [FromBody] UpdateShiftDto dto, CancellationToken ct)
    {
        try
        {
            // The board's lock order (deep review S1), as /assign and move-staff take it: a PUT that changes the worker or the status waits for a Publish week or a move
            // of the same organisation, then reads the shift as it is now, so it never writes over a publish or a move from a stale read and its notices tell the truth.
            await using var held = await RosterBoardLockAsync(ct);
            await LockShiftRowsAsync("\"Id\" = {0}", new object[] { id }, ct);
            var result = await UpdateShiftLockedAsync(id, dto, ct);
            if (result.Result is OkObjectResult) await held.CommitAsync(ct);
            return result;
        }
        catch (RosterBusyException)
        {
            return Conflict(ApiResponse<ShiftDto>.Fail(RosterBoardBusyMessage));
        }
    }

    /// <summary>The body of <see cref="UpdateShift"/>, run under its locks.</summary>
    private async Task<ActionResult<ApiResponse<ShiftDto>>> UpdateShiftLockedAsync(Guid id, UpdateShiftDto dto, CancellationToken ct)
    {
        var shift = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (shift == null) return NotFound(ApiResponse<ShiftDto>.Fail("Shift not found."));
        if (dto.ExpectsStaff && dto.ExpectedStaffId != shift.UserId)
            return Conflict(ApiResponse<ShiftDto>.Fail(BoardChangedMessage, ShiftErrorCodes.ShiftBoardChanged));
        // A started, finished or cancelled shift keeps its worker here too, as /assign and a drop do (decision 8; post-merge review S2): its completion and timesheet
        // belong to that worker. Every other edit the rules below allow still saves.
        if (dto.StaffId != shift.UserId && IsLockedForStaffChange(shift.Status) && !(shift.Status == ShiftStatus.Cancelled && dto.Status != ShiftStatus.Cancelled))
            return Conflict(ApiResponse<ShiftDto>.Fail(ShiftLockedForStaffMessage, ShiftErrorCodes.ShiftStatusLocked));
        // Its participant too: a claim bills a Completed shift to Shift.ParticipantId (ShiftClaimGenerationService), so moving it would charge another participant's budget.
        if (dto.ParticipantId != shift.ParticipantId && IsLockedForStaffChange(shift.Status) && !(shift.Status == ShiftStatus.Cancelled && dto.Status != ShiftStatus.Cancelled))
            return Conflict(ApiResponse<ShiftDto>.Fail(ShiftLockedForParticipantMessage, ShiftErrorCodes.ShiftStatusLocked));

        // A shift has to end after it starts. The rule is for times somebody is setting now: an edit that leaves the shift's times alone, or cancels it, never trips it, because rows saved before this rule
        // may already be wrong and the panel must still be able to annotate, assign and cancel them (a started shift's times are locked and could not be mended at all).
        // Reopening a cancelled shift is somebody setting it live again: the same times must not bring a shift with no length back to life (phase 3 review, N1).
        var timesChanged = dto.StartTime != shift.StartTime || dto.EndTime != shift.EndTime || dto.EndsNextDay != shift.EndsNextDay;
        var reopening = shift.Status == ShiftStatus.Cancelled && dto.Status != ShiftStatus.Cancelled;
        if ((timesChanged || reopening) && dto.Status != ShiftStatus.Cancelled && Shift.HoursBetween(dto.StartTime, dto.EndTime, dto.EndsNextDay) <= 0m)
            return BadRequest(ApiResponse<ShiftDto>.Fail(ShiftEndsBeforeItStartsMessage, ShiftNoLengthCode));

        // An existing legacy shift can still be status-managed after readiness is lost. Moving
        // it to another participant or assigning/reassigning staff is a new placement and must
        // remain fail-closed.
        var changesPlacement = dto.ParticipantId != shift.ParticipantId || dto.StaffId != shift.UserId;
        if (changesPlacement)
        {
            var refError = await ValidateRefsAsync(dto.ParticipantId, dto.StaffId, ct);
            if (refError != null) return BadRequest(ApiResponse<ShiftDto>.Fail(refError));
        }

        // Un-cancelling is allowed (critique P2 — pre-PR this was reachable and the spec's own
        // matrix left it a product-ruling gap): Cancelled -> Draft/Published passes, alongside the
        // existing Draft<->Published toggle and either status -> Cancelled. Every transition
        // into/out of InProgress/PendingReview/Completed stays locked to the completion endpoints.
        var fromAllowed = shift.Status is ShiftStatus.Draft or ShiftStatus.Published or ShiftStatus.Cancelled;
        var toAllowed = dto.Status is ShiftStatus.Draft or ShiftStatus.Published or ShiftStatus.Cancelled;
        if (dto.Status != shift.Status && !(fromAllowed && toAllowed))
            return Conflict(ApiResponse<ShiftDto>.Fail(
                "This shift's status can only be changed by starting, finishing, approving or returning it.",
                ShiftErrorCodes.ShiftStatusLocked));

        // F6: once a shift has moved past Published (worker has started it), its rostered
        // ServiceDate/StartTime/EndTime/EndsNextDay are locked — the active ShiftCompletion's
        // variance is computed against those values, so editing them out from under an
        // in-flight or already-reviewed completion would silently invalidate it. Every other
        // field (Notes, Ratio, NightType, etc.) remains editable on these statuses; the worker is refused above.
        if (shift.Status is ShiftStatus.InProgress or ShiftStatus.PendingReview or ShiftStatus.Completed
            && (dto.ServiceDate != shift.ServiceDate || dto.StartTime != shift.StartTime
                || dto.EndTime != shift.EndTime || dto.EndsNextDay != shift.EndsNextDay))
            return Conflict(ApiResponse<ShiftDto>.Fail(
                "Shift times cannot be changed after the shift has started. Return the completion to the worker first.",
                ShiftErrorCodes.ShiftTimesLocked));

        var candidate = new Shift
        {
            Id = shift.Id, ParticipantId = dto.ParticipantId, UserId = dto.StaffId,
            ServiceDate = dto.ServiceDate, StartTime = dto.StartTime, EndTime = dto.EndTime, EndsNextDay = dto.EndsNextDay,
            Ratio = dto.Ratio, NightType = dto.NightType
        };

        var findings = await CheckAsync(candidate, shift.Id, ct);
        findings.AddRange((await CheckBudgetAsync(candidate, shift.Id, dto.Status, ct)).Findings);

        var budgetGate = ShiftBudgetGate.Resolve(findings, dto.Emergency, dto.OverrideReason);
        if (budgetGate.Error != null) return BadRequest(ApiResponse<ShiftDto>.Fail(budgetGate.Error));
        var rejection = EvaluateFindings(budgetGate.GateFindings, dto.OverrideReason);
        if (rejection != null) return UnprocessableEntity(rejection);

        var previousUserId = shift.UserId;
        var previousStatus = shift.Status;
        // What the shift holds now, for the budget rules: a save that does not decide the budget again keeps the over-budget acknowledgement it already has.
        var previousReason = shift.OverrideReason;
        var previousCodes = shift.AcknowledgedFindingCodes;
        shift.ParticipantId = dto.ParticipantId; shift.UserId = dto.StaffId;
        if (shift.UserId is not null) { shift.RegularUserId = null; shift.RegularAwayReason = null; }   // assigning anyone ends "regular away" (L5)
        shift.ServiceDate = dto.ServiceDate; shift.StartTime = dto.StartTime; shift.EndTime = dto.EndTime;
        shift.EndsNextDay = dto.EndsNextDay; shift.Ratio = dto.Ratio; shift.NightType = dto.NightType;
        // The saved pattern link stays as the server set it: an edit never cuts a pattern shift loose from its pattern, and a link a request names is never stored (C3).
        shift.Notes = dto.Notes; shift.Status = dto.Status;
        shift.UpdatedAt = DateTime.UtcNow;
        ApplyOverride(shift, findings, budgetGate, dto.OverrideReason, dto.AcknowledgedFindingCodes, previousReason, previousCodes);
        if (budgetGate.EmergencyAccepted) await RaiseEmergencyReviewAsync(shift, ct);

        // Item 9 of the connection map: reassigning the shift away from the on-leave staff
        // member (or clearing it) — or cancelling it outright — closes the LeaveCoverage
        // obligation it was raised against. Re-assigning it back to the SAME staff member (no
        // UserId change) while it stays Published leaves the task open.
        if (previousUserId != shift.UserId || shift.Status == ShiftStatus.Cancelled)
            await _obligationTasks.CompleteByShiftAsync(shift.Id, TaskType.LeaveCoverage, ct);

        // The slide-over's Staff field is the menus' way to assign (the brief, section 7), so a PUT tells people exactly as a drop does; becoming Published tells the worker (decision 9).
        // shortcut: two coordinators editing ONE shift in the slide-over is still last-write-wins on the worker (the PUT carries no ExpectedStaffId as the board's drops do), though the
        // locks above keep it from writing over a publish or a move; add one if that ever collides.
        await NotifyStaffChangeAsync(shift, previousUserId, wasPublished: previousStatus == ShiftStatus.Published, ct);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<ShiftDto>.Ok(await ToShiftDtoAsync(shift, findings, ct)));
    }

    /// <summary>
    /// Delete a shift outright. Not roster-checked — removing a shift can never itself create a conflict. The shift's OWN handover
    /// acknowledgements (a worker marking the previous handover as read, recorded against the shift they read it from) go with it: they only
    /// say that a reader saw a handover from that shift, they mean nothing without it, and they are restricted by a foreign key, so without
    /// this a Published shift whose worker had opened the handover could not be deleted (500, a foreign-key violation) - the everyday case
    /// of a sick call or a re-roster by delete. They are removed in the same save (one transaction) and the removal is audited. The
    /// acknowledgements OTHER shifts made of THIS shift's handover are not touched: the shift has none while it has no completion, and a
    /// shift with a completion is still refused by the completion's own foreign key, as before.
    /// </summary>
    [HttpDelete("shifts/{id:guid}")]
    public async Task<ActionResult<ApiResponse<bool>>> DeleteShift(Guid id, CancellationToken ct)
    {
        try
        {
            // The board's lock order, as /assign, move-staff and PUT take it: a Delete is ordered with a Publish week or a move of the organisation and reads the shift as it is now.
            await using var held = await RosterBoardLockAsync(ct);
            await LockShiftRowsAsync("\"Id\" = {0}", new object[] { id }, ct);
            var result = await DeleteShiftLockedAsync(id, ct);
            if (result.Result is OkObjectResult) await held.CommitAsync(ct);
            return result;
        }
        catch (RosterBusyException)
        {
            return Conflict(ApiResponse<bool>.Fail(RosterBoardBusyMessage));
        }
    }

    /// <summary>The body of <see cref="DeleteShift"/>, run under its locks.</summary>
    private async Task<ActionResult<ApiResponse<bool>>> DeleteShiftLockedAsync(Guid id, CancellationToken ct)
    {
        var shift = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (shift == null) return NotFound(ApiResponse<bool>.Fail("Shift not found."));
        // A started or finished shift has a completion (and notes) behind it, held by a Restrict foreign key: refuse it as the other writes do, never a 500.
        if (shift.Status is ShiftStatus.InProgress or ShiftStatus.PendingReview or ShiftStatus.Completed)
            return Conflict(ApiResponse<bool>.Fail(ShiftNotDeletableMessage, ShiftErrorCodes.ShiftStatusLocked));
        // The Restrict keys are on ROWS, not statuses: a returned shift is Published again with its inactive completion, and a worker can note any non-Draft shift of their own. Under the row lock, so a
        // note or completion cannot slip in between the check and the delete.
        if (await _db.ShiftCompletions.AnyAsync(c => c.ShiftId == id, ct) || await _db.ShiftNotes.AnyAsync(n => n.ShiftId == id, ct))
            return Conflict(ApiResponse<bool>.Fail(ShiftHasRecordsMessage, ShiftErrorCodes.ShiftStatusLocked));

        // Item 9: deleting the shift removes whatever coverage gap it represented.
        await _obligationTasks.CompleteByShiftAsync(shift.Id, TaskType.LeaveCoverage, ct);

        // A Published shift's worker is told it is gone: the shift ends with no worker, as an unassign would.
        var worker = shift.UserId;
        shift.UserId = null;
        await NotifyStaffChangeAsync(shift, worker, wasPublished: shift.Status == ShiftStatus.Published, ct);

        _db.HandoverAcknowledgements.RemoveRange(await _db.HandoverAcknowledgements.Where(a => a.ShiftId == shift.Id).ToListAsync(ct));
        _db.Shifts.Remove(shift);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }

    /// <summary>Set or clear a shift's staff member. Clearing (StaffId null) always succeeds — an unfilled shift skips every staff-dependent rule.</summary>
    [HttpPost("shifts/{id:guid}/assign")]
    public async Task<ActionResult<ApiResponse<ShiftDto>>> AssignShift(
        Guid id, [FromBody] AssignShiftDto dto, CancellationToken ct)
    {
        try
        {
            // The board's lock order (deep review M1): the organisation's board lock, then the row, then the read, so the ExpectedStaffId check and the write cannot be split by
            // another drop, a move-staff or a PUT on this shift.
            await using var held = await RosterBoardLockAsync(ct);
            await LockShiftRowsAsync("\"Id\" = {0}", new object[] { id }, ct);
            var result = await AssignShiftLockedAsync(id, dto, ct);
            if (result.Result is OkObjectResult) await held.CommitAsync(ct);
            return result;
        }
        catch (RosterBusyException)
        {
            return Conflict(ApiResponse<ShiftDto>.Fail(RosterBoardBusyMessage));
        }
    }

    /// <summary>The body of <see cref="AssignShift"/>, run under its locks.</summary>
    private async Task<ActionResult<ApiResponse<ShiftDto>>> AssignShiftLockedAsync(Guid id, AssignShiftDto dto, CancellationToken ct)
    {
        var shift = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (shift == null) return NotFound(ApiResponse<ShiftDto>.Fail("Shift not found."));
        if (IsLockedForStaffChange(shift.Status))
            return Conflict(ApiResponse<ShiftDto>.Fail(ShiftLockedForStaffMessage, ShiftErrorCodes.ShiftStatusLocked));
        // A drop names who the board showed (nobody, or the person the prompt offered to replace): someone changed the shift since, so say so rather than replace them by surprise.
        if (dto.ExpectsStaff && dto.ExpectedStaffId != shift.UserId)
            return Conflict(ApiResponse<ShiftDto>.Fail(BoardChangedMessage, ShiftErrorCodes.ShiftBoardChanged));

        if (dto.StaffId.HasValue && !await _db.Users.AnyAsync(s => s.Id == dto.StaffId.Value && s.IsActive, ct))
            return BadRequest(ApiResponse<ShiftDto>.Fail("Staff member not found."));

        // Clearing an old assignment is safe management, but assigning or reassigning staff
        // is a new operational placement and goes through the readiness check: Warn lets it
        // proceed (the response carries what is missing), Enforce refuses it as it always did.
        if (dto.StaffId != shift.UserId && dto.StaffId.HasValue
            && !(await ParticipantReadiness.CheckAsync(_db, shift.ParticipantId, ct)).Allowed)
            return BadRequest(ApiResponse<ShiftDto>.Fail(ParticipantReadinessGate.NotReadyMessage));

        var candidate = WithWorker(shift, dto.StaffId);

        var findings = await CheckAsync(candidate, shift.Id, ct);
        var rejection = EvaluateFindings(findings, dto.OverrideReason);
        if (rejection != null) return UnprocessableEntity(rejection);

        var previousUserId = shift.UserId;
        ApplyStaff(shift, dto.StaffId, findings, dto.OverrideReason, dto.AcknowledgedFindingCodes);

        // Item 9 of the connection map: reassigning away from (or clearing) the on-leave staff
        // member closes the LeaveCoverage obligation raised against this shift.
        if (previousUserId != shift.UserId)
            await _obligationTasks.CompleteByShiftAsync(shift.Id, TaskType.LeaveCoverage, ct);

        // An assignment leaves the status as it was: only a Published shift tells anybody (decision 9).
        await NotifyStaffChangeAsync(shift, previousUserId, wasPublished: shift.Status == ShiftStatus.Published, ct);

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<ShiftDto>.Ok(await ToShiftDtoAsync(shift, findings, ct)));
    }

    /// <summary>
    /// Roster drag and drop (2026-10-14): carries the person on FromShiftId to ToShiftId in one all-or-nothing write. Move: onto an unfilled shift; the source becomes unfilled.
    /// Replace: the target's worker comes off; the source becomes unfilled. Swap: the two change places. Each person is judged against the shift they land on, with the shift they leave
    /// ignored (no false DOUBLE_BOOKED). A swap's two checks go through one gate (Blocking refuses, a warning needs the reason), and nothing is written unless all of it passes: one save,
    /// with its notices. Runs under the organisation's roster lock and reads both shifts after taking it, so a target filled or emptied since the board was drawn is refused (409).
    /// </summary>
    [HttpPost("shifts/move-staff")]
    public async Task<ActionResult<ApiResponse<ShiftDto>>> MoveStaff([FromBody] MoveStaffDto dto, CancellationToken ct)
    {
        if (dto.FromShiftId == dto.ToShiftId) return BadRequest(ApiResponse<ShiftDto>.Fail("Pick a different shift to move them to."));
        try
        {
            await using var held = await RosterBoardLockAsync(ct);
            // Lock order (shared with the agreement approval): the organisation's board lock, then the shift rows by Id, as /assign, the PUT and the moving create take them; both rows are held until the save.
            await LockShiftRowsAsync("\"Id\" IN ({0}, {1})", new object[] { dto.FromShiftId, dto.ToShiftId }, ct);
            var from = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == dto.FromShiftId, ct);
            var to = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == dto.ToShiftId, ct);
            // The query filter keeps both in the caller's organisation; a SuperAdmin with no tenant sees all of them, so they must also share one.
            if (from is null || to is null || from.TenantId != to.TenantId) return NotFound(ApiResponse<ShiftDto>.Fail("Shift not found."));
            if (IsLockedForStaffChange(from.Status) || IsLockedForStaffChange(to.Status))
                return Conflict(ApiResponse<ShiftDto>.Fail(ShiftLockedForStaffMessage, ShiftErrorCodes.ShiftStatusLocked));
            // The person the page carried is no longer on the source (or nobody is): never move somebody else by surprise.
            if (from.UserId is not { } mover || (dto.StaffId is { } carried && carried != mover)) return Conflict(ApiResponse<ShiftDto>.Fail(BoardChangedMessage, ShiftErrorCodes.ShiftBoardChanged));
            if (to.UserId == mover) return BadRequest(ApiResponse<ShiftDto>.Fail("They are already on that shift."));
            // Drawn as Needs staff but filled since (Move), drawn filled but emptied since (Swap), or someone other than the person drawn there is on it now (Replace, Swap):
            // never take somebody off, or swap with somebody, by surprise.
            if ((dto.Mode == MoveStaffMode.Move && to.UserId is not null) || (dto.Mode == MoveStaffMode.Swap && to.UserId is null)
                || (dto.Mode != MoveStaffMode.Move && dto.ExpectedToStaffId is { } shown && shown != to.UserId))
                return Conflict(ApiResponse<ShiftDto>.Fail(BoardChangedMessage, ShiftErrorCodes.ShiftBoardChanged));

            var displaced = to.UserId;
            var back = dto.Mode == MoveStaffMode.Swap ? displaced : null;   // who lands on the source
            var refusal = await PlacementRefusalAsync(mover, to.ParticipantId, ct)
                ?? (back is { } b ? await PlacementRefusalAsync(b, from.ParticipantId, ct) : null);
            if (refusal != null) return BadRequest(ApiResponse<ShiftDto>.Fail(refusal));

            var toFindings = await CheckAsync(WithWorker(to, mover), to.Id, ct, leavingShiftId: from.Id);
            var fromFindings = back is { } swapped ? await CheckAsync(WithWorker(from, swapped), from.Id, ct, leavingShiftId: to.Id) : new List<RosterFinding>();
            var rejection = EvaluateFindings(toFindings.Concat(fromFindings).ToList(), dto.OverrideReason);
            if (rejection != null) return UnprocessableEntity(rejection);

            ApplyStaff(to, mover, toFindings, dto.OverrideReason, dto.AcknowledgedFindingCodes);
            // The source takes the swapped person, or nobody (and then no reason of its own, as a clear on /assign).
            ApplyStaff(from, back, fromFindings, back is null ? null : dto.OverrideReason, back is null ? null : dto.AcknowledgedFindingCodes);
            // Item 9 of the connection map: both shifts changed hands, so neither still waits to be re-covered for leave.
            await _obligationTasks.CompleteByShiftAsync(to.Id, TaskType.LeaveCoverage, ct);
            await _obligationTasks.CompleteByShiftAsync(from.Id, TaskType.LeaveCoverage, ct);
            await NotifyStaffChangeAsync(to, displaced, wasPublished: to.Status == ShiftStatus.Published, ct);
            await NotifyStaffChangeAsync(from, mover, wasPublished: from.Status == ShiftStatus.Published, ct);

            await _db.SaveChangesAsync(ct);
            await held.CommitAsync(ct);
            return Ok(ApiResponse<ShiftDto>.Ok(await ToShiftDtoAsync(to, toFindings, ct)));
        }
        catch (RosterBusyException)
        {
            return Conflict(ApiResponse<ShiftDto>.Fail(RosterBoardBusyMessage));
        }
    }

    /// <summary>
    /// Publish week (roster drag and drop, 2026-10-14): every Draft shift of the organisation in the Monday-start week holding <paramref name="weekStart"/>, for every participant the board
    /// shows, unfilled ones too, becomes Published, and each worker on one from the provider's today on is told (ShiftAssigned). A filled Draft whose worker now has a Blocking finding stays
    /// Draft and is counted as skipped, as a PUT publishing it alone would be refused. Under the organisation's roster lock: a second publish at the same time waits, finds nothing left, and
    /// tells nobody twice.
    /// </summary>
    [HttpPost("weeks/{weekStart}/publish")]
    public async Task<ActionResult<ApiResponse<PublishWeekResultDto>>> PublishWeek(DateOnly weekStart, CancellationToken ct)
    {
        // A SuperAdmin who has not chosen an organisation has no tenant filter: a publish then would reach every organisation's week.
        if (_tenant?.TenantId is not { } tenantId) return BadRequest(ApiResponse<PublishWeekResultDto>.Fail("Choose an organisation to publish its week."));
        var start = WeekStart(weekStart);
        var end = start.AddDays(6);
        try
        {
            await using var held = await RosterBoardLockAsync(ct);
            // Hold the week's Draft rows until this commits, then read them. A PUT takes the board lock too, so it waits for the publish; any other writer of a draft row (a
            // completion endpoint, the generator) either waits here or committed first and is read below as it is, so a publish never writes Published over it.
            await LockShiftRowsAsync("\"TenantId\" = {0} AND \"Status\" = {1} AND \"ServiceDate\" >= {2} AND \"ServiceDate\" <= {3}",
                new object[] { tenantId, (int)ShiftStatus.Draft, start, end }, ct);
            var shown = _db.Participants.Where(Participant.CanReceiveServicesRule).Select(p => p.Id);
            var drafts = await _db.Shifts
                .Where(s => s.TenantId == tenantId && s.Status == ShiftStatus.Draft && s.ServiceDate >= start && s.ServiceDate <= end && shown.Contains(s.ParticipantId))
                .ToListAsync(ct);
            var today = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
            // WSC_EXPIRED is the engine's only Blocking finding, so only a draft whose worker's screening has lapsed by its day needs the full roster check: one query for every worker.
            var workerIds = drafts.Where(s => s.UserId.HasValue).Select(s => s.UserId!.Value).Distinct().ToList();
            var screeningExpiry = await _db.Users.Where(u => workerIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.WorkerScreeningExpiryDate, ct);

            var published = new List<Shift>();
            var skipped = 0;
            foreach (var shift in drafts)
            {
                // shortcut: only a lapsed screening is re-checked (the one Blocking rule today); check every filled draft again if another Blocking rule is added.
                var mayBeBlocked = shift.UserId is { } worker && screeningExpiry.GetValueOrDefault(worker) is { } expiry && expiry < shift.ServiceDate;
                if (mayBeBlocked && (await CheckAsync(shift, shift.Id, ct)).Any(f => f.Severity == RosterFindingSeverity.Blocking)) { skipped++; continue; }
                shift.Status = ShiftStatus.Published;
                shift.UpdatedAt = DateTime.UtcNow;
                published.Add(shift);
            }

            // One notice per worker, listing every shift of theirs this publish put out, earliest first (fix round 1). A shift whose day has gone is published for the
            // record, but nobody is told about it now.
            var toTell = published.Where(s => s.UserId.HasValue && s.ServiceDate >= today).GroupBy(s => s.UserId!.Value).ToList();
            var participantIds = published.Select(s => s.ParticipantId).Distinct().ToList();
            var toTellIds = toTell.Select(g => g.Key).ToList();
            var participantNames = await _db.Participants.Where(p => participantIds.Contains(p.Id))
                .ToDictionaryAsync(p => p.Id, p => (p.FirstName + " " + p.LastName).Trim(), ct);
            var emails = await _db.Users.Where(u => toTellIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.Email, ct);
            foreach (var worker in toTell)
            {
                if (!emails.TryGetValue(worker.Key, out var email)) continue;
                var shifts = worker.OrderBy(s => s.ServiceDate).ThenBy(s => s.StartTime).ToList();
                string NameOf(Shift s) => participantNames.GetValueOrDefault(s.ParticipantId) ?? "a participant";
                var first = shifts[0];
                // No dedupe: Publish week only publishes Drafts under the board lock, so a repeat publish finds none to tell about.
                await _notificationRaiser.RaiseAsync(
                    Odip.Domain.Notifications.NotificationEventType.ShiftAssigned, "Shift", first.Id, new[] { worker.Key },
                    new Odip.Infrastructure.Notifications.Templates.ShiftAssignedPayload(email, NameOf(first), first.ServiceDate, first.StartTime, first.EndTime,
                        shifts.Skip(1).Select(s => new Odip.Infrastructure.Notifications.Templates.ShiftAssignedLine(NameOf(s), s.ServiceDate, s.StartTime, s.EndTime)).ToList()), ct, dedupe: false);
            }

            await _db.SaveChangesAsync(ct);
            await held.CommitAsync(ct);
            return Ok(ApiResponse<PublishWeekResultDto>.Ok(new PublishWeekResultDto
            {
                Published = published.Count,
                Notified = toTell.Count(g => emails.ContainsKey(g.Key)),
                Unfilled = published.Count(s => s.UserId is null),
                Skipped = skipped,
            }));
        }
        catch (RosterBusyException)
        {
            return Conflict(ApiResponse<PublishWeekResultDto>.Fail(RosterBoardBusyMessage));
        }
    }

    /// <summary>
    /// Start rostering (2026-10-16, L4): makes the scheduled shifts of the Monday-start week holding <paramref name="weekStart"/>, for every live agreement pattern of a participant who may be rostered,
    /// then applies the regular-away rule (L5) and marks the week started, in one transaction under the organisation's board lock. Each participant's generation lock is taken too (it joins the
    /// transaction), so an approval or a Generate for them waits and then sees the week as started. Any week may be started; a started one is 409 roster-week-started.
    /// </summary>
    [HttpPost("weeks/{weekStart}/start")]
    public async Task<ActionResult<ApiResponse<StartWeekResultDto>>> StartWeek(DateOnly weekStart, CancellationToken ct)
    {
        // As Publish week: a SuperAdmin with no organisation chosen has no tenant filter.
        if (_tenant?.TenantId is not { } tenantId) return BadRequest(ApiResponse<StartWeekResultDto>.Fail("Choose an organisation to start its week."));
        var start = WeekStart(weekStart);
        var end = start.AddDays(6);
        try
        {
            await using var held = await RosterBoardLockAsync(ct);
            if (await WeekStartedAsync(tenantId, start, ct)) return WeekAlreadyStarted();

            var participantIds = await AgreementPatternsLiveIn(tenantId, start, end).Select(p => p.ParticipantId).Distinct().OrderBy(id => id).ToListAsync(ct);
            var made = new List<Shift>();
            var skipped = new List<Guid>();
            foreach (var participantId in participantIds)
            {
                if (!(await ParticipantReadiness.CheckAsync(_db, participantId, ct)).Allowed) { skipped.Add(participantId); continue; }
                // shortcut: the board lock is held while each participant's lock is waited for in turn (up to LockWait each), so a slow generation makes drag and drop answer busy; take the participant locks without waiting if that bites.
                await using var participantLock = await RosterGenerationLock.AcquireAsync(_db, participantId, ct, _generator.LockWait);
                // Read again under the lock: an approval that ended or replaced a pattern a moment ago is seen.
                var patterns = await AgreementPatternsLiveIn(tenantId, start, end).Where(p => p.ParticipantId == participantId).ToListAsync(ct);
                made.AddRange((await _generator.AddAsync(_db, patterns, start, end, ct)).MadeShifts);
            }

            var away = await _availability.MarkRegularsAwayAsync(made, ct);
            _db.RosterWeeks.Add(new RosterWeek { Id = Guid.NewGuid(), TenantId = tenantId, WeekStart = start, StartedAt = _clock.GetUtcNow().UtcDateTime, StartedByUserId = ResolveCurrentUserId() });
            await _db.SaveChangesAsync(ct);
            await held.CommitAsync(ct);
            return Ok(ApiResponse<StartWeekResultDto>.Ok(await StartWeekResultAsync(start, made, skipped, away, ct)));
        }
        catch (RosterBusyException)
        {
            return Conflict(ApiResponse<StartWeekResultDto>.Fail(RosterBoardBusyMessage));
        }
        // A Generate (L10) or another Start marked the week started between the check and this save: the unique row decides, and nothing of this Start is kept.
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            return WeekAlreadyStarted();
        }
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

        if (withoutIncident == true)
            items = items.Where(i => i.IncidentId == null).ToList();

        return Ok(ApiResponse<List<FlaggedShiftNoteDto>>.Ok(items));
    }

    // ══════════════════════════════════════════════════════════════
    // SHIFT COMPLETION REVIEW (design spec §2/§3)
    // ══════════════════════════════════════════════════════════════

    /// <summary>
    /// The review queue. status defaults to PendingReview; other ShiftStatus values let the
    /// queue show shifts in other states (e.g. Completed, for already-approved history). Only
    /// shifts with a current active ShiftCompletion row are included.
    ///
    /// Critique I2: this used to materialise every matching Shift/ShiftCompletion, sort in
    /// memory, then Skip/Take the in-memory list — paging only the response body, not the work.
    /// The orchestrator's ruling for the fix (see the review) was deliberately NOT "persist an
    /// IsOutlierVariance boolean at Finish" — that would encode the currently-configured
    /// Rostering:VarianceReviewMinutes threshold as data and go stale the moment the threshold
    /// changed. Instead the outlier predicate is evaluated per-row in SQL, against the
    /// already-persisted VarianceMinutesStart/VarianceMinutesEnd columns and the live threshold,
    /// so both the sort and the Skip/Take run in the database.
    ///
    /// The one piece that stays out of SQL is the true timezone-converted RosteredStart (needs a
    /// per-row TimeZoneInfo call EF can't translate) — the ORDER BY tiebreak below uses the raw
    /// Shift.ServiceDate/Shift.StartTime instead. Within one IANA zone these are monotonic with
    /// the converted RosteredStart for any single calendar ServiceDate (a DST transition would
    /// have to fall inside the shift's own service day to diverge them), and every existing test
    /// fixture uses one zone, so the ordering this endpoint returns is unchanged; it only stops
    /// being byte-for-byte identical to the old in-memory sort in the DST-transition-day/
    /// multi-timezone-tenant edge case the old code could reach only because it fully
    /// materialised the timezone conversion for every row anyway.
    /// </summary>
    [HttpGet("completions")]
    public async Task<ActionResult<ApiResponse<PagedResult<CompletionQueueItemDto>>>> GetCompletions(
        [FromQuery] ShiftStatus? status, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default, [FromQuery] string? after = null)
    {
        (page, pageSize) = PagingParams.Clamp(page, pageSize);
        var statusFilter = status ?? ShiftStatus.PendingReview;
        // Keyset paging (the dashboard reads the whole queue while others decide rows): `after` is the last row's sort key, so a row decided between two
        // page requests cannot move another across the page edge the way OFFSET does. `page` is ignored when it is given.
        CompletionCursor? cursor = null;
        if (after is not null)
        {
            if (!CompletionCursor.TryParse(after, out var parsed))
                return BadRequest(ApiResponse<PagedResult<CompletionQueueItemDto>>.Fail("The cursor was not valid."));
            cursor = parsed;
        }
        var thresholdMinutes = VarianceReviewMinutes;

        // Only shifts with a current active completion (inner join, not a dictionary lookup after
        // the fact) — narrows the row set the ORDER BY/Skip/Take below has to work over.
        var joined =
            from s in _db.Shifts
            join c in _db.ShiftCompletions on s.Id equals c.ShiftId
            where s.Status == statusFilter && c.IsActive
            select new { Shift = s, Completion = c };

        if (from.HasValue) joined = joined.Where(x => x.Shift.ServiceDate >= from.Value);
        if (to.HasValue) joined = joined.Where(x => x.Shift.ServiceDate <= to.Value);

        // Outlier-first (critique P1 — "no signal for what actually needs attention"), then
        // chronological. Math.Abs(int) and the boolean comparison both translate to SQL; no
        // nullable column is involved here (VarianceMinutesStart/End are non-nullable ints), so
        // the Postgres-vs-EF-InMemory null-ordering trap the hardening PR hit elsewhere
        // (GetShiftCompletions' SubmittedAt sort) doesn't apply to this key.
        var keyed = joined.Select(x => new
        {
            x.Shift, x.Completion,
            Outlier = Math.Abs(x.Completion.VarianceMinutesStart) > thresholdMinutes || Math.Abs(x.Completion.VarianceMinutesEnd) > thresholdMinutes,
        });
        // The whole queue, counted before the cursor window on purpose: the client wants the queue size, not the rest after the cursor.
        var totalCount = await keyed.CountAsync(ct);
        var windowed = keyed;
        if (cursor is { } cur)
        {
            var (cOutlier, cDate, cStart, cId) = (cur.Outlier, cur.ServiceDate, cur.StartTime, cur.ShiftId);
            // Outliers sort first: after an outlier row come later outliers by the date, start and id keys, then every non-outlier; after a non-outlier only later non-outliers.
            windowed = keyed.Where(x => (cOutlier && !x.Outlier)
                || (x.Outlier == cOutlier && (x.Shift.ServiceDate > cDate
                    || (x.Shift.ServiceDate == cDate && (x.Shift.StartTime > cStart
                        || (x.Shift.StartTime == cStart && x.Shift.Id.CompareTo(cId) > 0))))));
        }
        var ordered = windowed
            .OrderByDescending(x => x.Outlier)
            .ThenBy(x => x.Shift.ServiceDate)
            .ThenBy(x => x.Shift.StartTime)
            .ThenBy(x => x.Shift.Id);   // unique: tied rows must page in one order, or a row at a page edge is repeated and another never read

        // Narrow projection (critique P2 — "hydrates full graphs") applied AFTER Skip/Take, so
        // only the requested page's rows are ever materialised.
        var pageRows = await ordered
            .Skip(cursor is null ? (page - 1) * pageSize : 0)
            .Take(pageSize)
            .Select(x => new
            {
                x.Outlier, x.Shift.Id, x.Shift.TenantId, x.Shift.ServiceDate, x.Shift.StartTime, x.Shift.EndTime, x.Shift.EndsNextDay, x.Shift.Status, x.Shift.ReturnCount, x.Shift.ParticipantId,
                ParticipantName = x.Shift.Participant != null ? x.Shift.Participant.FullName : string.Empty,
                StaffName = x.Shift.User != null ? x.Shift.User.FullName : string.Empty,
                CompletionId = x.Completion.Id, x.Completion.TimeZoneId, x.Completion.ActualStart, x.Completion.ActualEnd,
                x.Completion.VarianceMinutesStart, x.Completion.VarianceMinutesEnd, x.Completion.StartWasManual,
                TimesAdjusted = x.Completion.OriginalActualStart != null || x.Completion.OriginalActualEnd != null,
            })
            .ToListAsync(ct);

        // Doses without an outcome and break minutes for the page's rows (bounded by the page size).
        var extras = await ShiftCompletionMapper.QueueExtrasAsync(
            _db,
            pageRows.Select(r => new ShiftCompletionMapper.QueueExtrasInput(
                r.Id, r.TenantId, r.CompletionId, r.ParticipantId, r.ServiceDate, r.StartTime, r.EndTime, r.EndsNextDay, r.ActualStart, r.ActualEnd)).ToList(),
            ct);

        var items = pageRows.Select(row =>
        {
            var rosteredShift = new Shift
            {
                ServiceDate = row.ServiceDate, StartTime = row.StartTime, EndTime = row.EndTime, EndsNextDay = row.EndsNextDay,
            };
            var (rosteredStartUtc, rosteredEndUtc) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(rosteredShift, row.TimeZoneId);
            var isOutlier = ShiftCompletionMapper.IsOutlierVariance(row.VarianceMinutesStart, row.VarianceMinutesEnd, thresholdMinutes);
            return new CompletionQueueItemDto(
                row.Id, row.CompletionId, row.ParticipantName, row.StaffName,
                row.ServiceDate, rosteredStartUtc, rosteredEndUtc, row.ActualStart, row.ActualEnd,
                row.VarianceMinutesStart, row.VarianceMinutesEnd, row.Status,
                row.TimeZoneId, isOutlier, thresholdMinutes, row.ReturnCount,
                extras[row.CompletionId].DosesWithoutOutcome, extras[row.CompletionId].BreakMinutes, row.StartWasManual, row.TimesAdjusted,
                extras[row.CompletionId].IncidentCount);
        }).ToList();

        return Ok(ApiResponse<PagedResult<CompletionQueueItemDto>>.Ok(
            new PagedResult<CompletionQueueItemDto>
            {
                Items = items, Page = page, PageSize = pageSize, TotalCount = totalCount,
                NextCursor = pageRows.Count == 0 ? null : new CompletionCursor(pageRows[^1].Outlier, pageRows[^1].ServiceDate, pageRows[^1].StartTime, pageRows[^1].Id).ToString(),
            }));
    }

    /// <summary>The sort key of one queue row (outlier first, then date, start time and shift id), as the opaque `after` token of GetCompletions.</summary>
    private readonly record struct CompletionCursor(bool Outlier, DateOnly ServiceDate, TimeOnly StartTime, Guid ShiftId)
    {
        public override string ToString() => string.Join('|', Outlier ? "1" : "0", ServiceDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            StartTime.ToString("HH:mm:ss.fffffff", CultureInfo.InvariantCulture), ShiftId);

        public static bool TryParse(string value, out CompletionCursor cursor)
        {
            cursor = default;
            var parts = value.Split('|');
            if (parts.Length != 4 || parts[0] is not ("0" or "1")
                || !DateOnly.TryParseExact(parts[1], "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
                || !TimeOnly.TryParseExact(parts[2], "HH:mm:ss.fffffff", CultureInfo.InvariantCulture, DateTimeStyles.None, out var start)
                || !Guid.TryParse(parts[3], out var id)) return false;
            cursor = new CompletionCursor(parts[0] == "1", date, start, id);
            return true;
        }
    }

    /// <summary>
    /// What became of the shifts a bulk run sent: their review status, for the dashboard to tell a row that was decided from one the paged queue read
    /// merely skipped. Tenant-scoped through the Shift query filter, like the queue; an id that is not the caller's is simply absent.
    /// </summary>
    [HttpGet("completions/statuses")]
    public async Task<ActionResult<ApiResponse<List<CompletionStatusDto>>>> GetCompletionStatuses([FromQuery] Guid[] shiftIds, CancellationToken ct = default)
    {
        if (shiftIds.Length > PagingParams.MaxPageSize)
            return BadRequest(ApiResponse<List<CompletionStatusDto>>.Fail($"Ask for at most {PagingParams.MaxPageSize} shifts at a time."));
        var rows = await _db.Shifts.Where(s => shiftIds.Contains(s.Id)).Select(s => new CompletionStatusDto(s.Id, s.Status)).ToListAsync(ct);
        return Ok(ApiResponse<List<CompletionStatusDto>>.Ok(rows));
    }

    /// <summary>
    /// The current active ShiftCompletion for one shift, or 404 if none exists. Deliverable 2
    /// reverse link: this is the one completion surface that populates
    /// <see cref="ShiftCompletionDto.Incidents"/> — the list endpoint below and Approve/Return
    /// leave it empty (see <see cref="ToShiftCompletionDtoAsync"/> remarks).
    /// </summary>
    [HttpGet("shifts/{id:guid}/completion")]
    public async Task<ActionResult<ApiResponse<ShiftCompletionDto>>> GetShiftCompletion(Guid id, CancellationToken ct)
    {
        var completion = await _db.ShiftCompletions
            .Where(c => c.ShiftId == id && c.IsActive)
            .FirstOrDefaultAsync(ct);
        if (completion is null)
            return NotFound(ApiResponse<ShiftCompletionDto>.Fail("Shift completion not found.", ShiftErrorCodes.ShiftCompletionNotFound));

        var shiftReturnCount = await _db.Shifts.Where(s => s.Id == id).Select(s => s.ReturnCount).FirstOrDefaultAsync(ct);
        return Ok(ApiResponse<ShiftCompletionDto>.Ok(await ToShiftCompletionDtoAsync(completion, shiftReturnCount, ct, includeIncidents: true)));
    }

    /// <summary>
    /// Everything a coordinator needs to review one submitted shift in a single call (shift package, PR 3): the active
    /// completion (times, variance, breaks, net worked minutes, handover, the "nothing to note" confirmation, incidents),
    /// every scheduled dose due in the rostered window with its outcome, PRN doses given during the shift, and the shift
    /// notes. Same 404 as <see cref="GetShiftCompletion"/> when the shift has no active completion. Read-only: the Approve and
    /// Return endpoints are unchanged.
    /// </summary>
    [HttpGet("shifts/{id:guid}/completion/review")]
    public async Task<ActionResult<ApiResponse<ShiftCompletionReviewDto>>> GetShiftCompletionReview(Guid id, CancellationToken ct)
    {
        var completion = await _db.ShiftCompletions.Where(c => c.ShiftId == id && c.IsActive).FirstOrDefaultAsync(ct);
        var shift = completion is null ? null : await _db.Shifts.Include(s => s.Participant).FirstOrDefaultAsync(s => s.Id == id, ct);
        if (completion is null || shift is null)
            return NotFound(ApiResponse<ShiftCompletionReviewDto>.Fail("Shift completion not found.", ShiftErrorCodes.ShiftCompletionNotFound));

        var completionDto = await ToShiftCompletionDtoAsync(completion, shift.ReturnCount, ct, includeIncidents: true);
        return Ok(ApiResponse<ShiftCompletionReviewDto>.Ok(await _package.BuildReviewAsync(shift, completion, completionDto, ct)));
    }

    /// <summary>
    /// Every completion for one shift, active and inactive, newest first — the review history
    /// PR2's review page needs (critique P2: "the resubmitting worker sees ReturnCount and nothing
    /// about why" — this is the coordinator-side counterpart). Same 404 rule as
    /// GetShiftCompletion: no rows for this ShiftId (whether the shift itself doesn't exist, or it
    /// simply hasn't been started yet) 404s identically — this surface never distinguishes them.
    /// </summary>
    [HttpGet("shifts/{id:guid}/completions")]
    public async Task<ActionResult<ApiResponse<List<ShiftCompletionDto>>>> GetShiftCompletions(Guid id, CancellationToken ct)
    {
        var completions = await _db.ShiftCompletions
            .Where(c => c.ShiftId == id)
            // SubmittedAt is null while InProgress; Postgres sorts DESC NULLS FIRST, LINQ-to-Objects NULLS LAST — coalesce so the key is total.
            .OrderByDescending(c => c.SubmittedAt ?? c.StartedAt)
            .ThenByDescending(c => c.StartedAt)
            .ToListAsync(ct);
        if (completions.Count == 0)
            return NotFound(ApiResponse<List<ShiftCompletionDto>>.Fail("Shift completion not found.", ShiftErrorCodes.ShiftCompletionNotFound));

        var thresholdMinutes = VarianceReviewMinutes;
        // All rows share ShiftId == id, so ReturnCount is fetched once (critique M7) instead of
        // once per completion.
        var shiftReturnCount = await _db.Shifts.Where(s => s.Id == id).Select(s => s.ReturnCount).FirstOrDefaultAsync(ct);
        var dtos = new List<ShiftCompletionDto>();
        foreach (var c in completions)
            dtos.Add(await ShiftCompletionMapper.ToDtoAsync(_db, c, thresholdMinutes, shiftReturnCount, ct));
        return Ok(ApiResponse<List<ShiftCompletionDto>>.Ok(dtos));
    }

    /// <summary>
    /// Office approves a PendingReview shift. 404 if no shift or no active ShiftCompletion; 409
    /// SHIFT_NOT_PENDING_REVIEW if not PendingReview. No notification here — only Finish and
    /// Return raise one (deferred to the notifications spec, out of scope for this PR).
    /// </summary>
    [HttpPost("shifts/{id:guid}/completion/approve")]
    public async Task<ActionResult<ApiResponse<ShiftCompletionDto>>> ApproveCompletion(Guid id, CancellationToken ct, [FromQuery] bool requireClean = false)
    {
        var reviewerId = ResolveCurrentUserId();
        if (reviewerId is null)
            return Unauthorized(ApiResponse<ShiftCompletionDto>.Fail(
                "Your session is missing a user identity. Sign in again.", "AUTH_USER_MISSING"));

        var (shift, completion, error) = await ResolvePendingReviewCompletionAsync(id, ct);
        if (error is not null) return error;
        // The dashboard's one tap asks for this: a flag that appeared since its queue read refuses rather than approves. The Completions page approves
        // a flagged shift deliberately, after its review, so it leaves this off.
        if (requireClean && (await ShiftCompletionMapper.ShiftsNeedingReviewAsync(_db, [(shift!, completion!)], VarianceReviewMinutes, ct)).Count > 0)
            return Conflict(ApiResponse<ShiftCompletionDto>.Fail(NeedsReviewMessage, ShiftErrorCodes.ShiftNeedsReview));

        var now = DateTime.UtcNow;
        completion!.ReviewedByUserId = reviewerId;
        completion.ReviewedAt = now;
        completion.ReviewOutcome = ReviewOutcome.Approved;
        completion.UpdatedAt = now;

        shift!.Status = ShiftStatus.Completed;
        shift.UpdatedAt = now;

        await EmploymentHeroTimesheets.EnqueueAsync(_db, shift.TenantId, [(shift, completion)], now, ct);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<ShiftCompletionDto>.Ok(await ToShiftCompletionDtoAsync(completion, shift.ReturnCount, ct)));
    }

    /// <summary>
    /// Office returns a PendingReview shift to the worker for correction. Same 404/409 as
    /// Approve, plus 400 if reason is blank. Sets ReviewOutcome = Returned, IsActive = false
    /// (excluding this row from the "current" 1:1 without deleting it), increments
    /// Shift.ReturnCount, flips Shift.Status back to Published.
    /// </summary>
    [HttpPost("shifts/{id:guid}/completion/return")]
    public async Task<ActionResult<ApiResponse<ShiftCompletionDto>>> ReturnCompletion(
        Guid id, [FromBody] ReturnCompletionDto dto, CancellationToken ct)
    {
        var reviewerId = ResolveCurrentUserId();
        if (reviewerId is null)
            return Unauthorized(ApiResponse<ShiftCompletionDto>.Fail(
                "Your session is missing a user identity. Sign in again.", "AUTH_USER_MISSING"));

        var (shift, completion, error) = await ResolvePendingReviewCompletionAsync(id, ct);
        if (error is not null) return error;

        var trimmedReason = (dto.Reason ?? string.Empty).Trim(); // JSON null must not NRE
        if (trimmedReason.Length == 0)
            return BadRequest(ApiResponse<ShiftCompletionDto>.Fail("A return reason is required.", ShiftErrorCodes.ShiftReturnReasonRequired));
        if (trimmedReason.Length > 500)
            return BadRequest(ApiResponse<ShiftCompletionDto>.Fail("Return reason must be 500 characters or fewer.", ShiftErrorCodes.ShiftReturnReasonTooLong));

        // SHIFT_ALREADY_CLAIMED (design spec §3) — now reachable: PR 3's AddShiftClaims
        // migration gives ClaimLineItem a ShiftId, and ShiftClaimGenerationService can attach a
        // claim line to a Completed shift. A shift can only reach here (PendingReview) again via
        // an un-cancel + re-Start/Finish cycle, but defend the invariant regardless.
        var claimedLine = await _db.ClaimLineItems.FirstOrDefaultAsync(l => l.ShiftId == id, ct);
        if (claimedLine is not null)
        {
            var claimReference = await _db.TripClaims
                .Where(c => c.Id == claimedLine.TripClaimId)
                .Select(c => c.ClaimReference)
                .FirstOrDefaultAsync(ct);
            return Conflict(ApiResponse<ShiftCompletionDto>.Fail(
                $"This shift has already been claimed ({claimReference}).", ShiftErrorCodes.ShiftAlreadyClaimed));
        }

        var now = DateTime.UtcNow;
        completion!.ReviewedByUserId = reviewerId;
        completion.ReviewedAt = now;
        completion.ReviewOutcome = ReviewOutcome.Returned;
        completion.ReturnReason = trimmedReason;
        completion.IsActive = false;
        completion.UpdatedAt = now;

        shift!.Status = ShiftStatus.Published;
        shift.ReturnCount += 1;
        shift.UpdatedAt = now;

        // NotificationEventType.ShiftCompletionReturned — reserved by the notifications spec,
        // wired here now the shift-completion feature exists (design spec §5, sibling event).
        // Recipient is the worker (completion.SubmittedByUserId), not the reviewer.
        var returnedWorker = await _db.Users.FirstOrDefaultAsync(u => u.Id == completion.SubmittedByUserId, ct);
        if (returnedWorker is not null)
        {
            var participantName = await _db.Participants.Where(p => p.Id == shift.ParticipantId)
                .Select(p => (p.FirstName + " " + p.LastName).Trim()).FirstOrDefaultAsync(ct) ?? "a participant";
            await _notificationRaiser.RaiseAsync(
                Odip.Domain.Notifications.NotificationEventType.ShiftCompletionReturned, "ShiftCompletion", completion.Id,
                new[] { returnedWorker.Id },
                new Odip.Infrastructure.Notifications.Templates.ShiftCompletionReturnedPayload(
                    returnedWorker.Email, participantName, shift.ServiceDate, trimmedReason),
                ct);
        }

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<ShiftCompletionDto>.Ok(await ToShiftCompletionDtoAsync(completion, shift.ReturnCount, ct)));
    }

    /// <summary>
    /// Approves up to 100 PendingReview shifts in one call (critique P3 — "no batch approve"; the
    /// queue previously had no way to clear a day's clean submissions at once). Each id follows
    /// exactly the single-approve rules via <see cref="ResolvePendingReviewCompletion"/> — a
    /// failure on one id doesn't abort the batch. Two bulk queries load every shift/completion the
    /// batch could need up front (critique M3 — this used to run
    /// ResolvePendingReviewCompletionAsync per id, up to 2N round-trips) instead of querying per
    /// id; the classification rules themselves are shared with the single-approve/return path via
    /// ResolvePendingReviewCompletion, so per-item results/codes are unchanged. One
    /// SaveChangesAsync at the end; overall response is always 200 even when some items failed,
    /// since the response body itself reports per-item outcome.
    /// </summary>
    [HttpPost("completions/approve-batch")]
    public async Task<ActionResult<ApiResponse<List<ApproveBatchResultDto>>>> ApproveBatch(
        [FromBody] ApproveBatchDto dto, CancellationToken ct)
    {
        if (dto.ShiftIds is null || dto.ShiftIds.Count == 0 || dto.ShiftIds.Count > 100)
            return BadRequest(ApiResponse<List<ApproveBatchResultDto>>.Fail(
                "Select between 1 and 100 shifts.", ShiftErrorCodes.ShiftBatchSizeInvalid));

        var reviewerId = ResolveCurrentUserId();
        if (reviewerId is null)
            return Unauthorized(ApiResponse<List<ApproveBatchResultDto>>.Fail(
                "Your session is missing a user identity. Sign in again.", "AUTH_USER_MISSING"));

        var now = DateTime.UtcNow;
        var results = new List<ApproveBatchResultDto>();
        var approved = new List<(Shift Shift, ShiftCompletion Completion)>();

        // De-dup: EF identity resolution would hand the second occurrence the already-approved tracked entity and report a false SHIFT_NOT_PENDING_REVIEW.
        var distinctIds = dto.ShiftIds.Distinct().ToList();

        // Two bulk queries instead of up to 2N round-trips (critique M3). completionsByShiftId is
        // a superset of what every id actually needs (it doesn't pre-filter on shift status), but
        // that's cheaper than querying per id and doesn't change the outcome below.
        var shiftsById = await _db.Shifts
            .Where(s => distinctIds.Contains(s.Id))
            .ToDictionaryAsync(s => s.Id, ct);
        var completionsByShiftId = await _db.ShiftCompletions
            .Where(c => distinctIds.Contains(c.ShiftId) && c.IsActive)
            .ToDictionaryAsync(c => c.ShiftId, ct);

        var resolved = distinctIds.Select(shiftId =>
        {
            shiftsById.TryGetValue(shiftId, out var shift);
            completionsByShiftId.TryGetValue(shiftId, out var completion);
            return (ShiftId: shiftId, Resolved: ResolvePendingReviewCompletion(shift, completion));
        }).ToList();
        // Clean only (the dashboard's Complete all): the queue's flags re-read now, in one pass for the batch; a flagged shift is skipped, never approved.
        var needsReview = dto.CleanOnly
            ? await ShiftCompletionMapper.ShiftsNeedingReviewAsync(_db,
                resolved.Where(r => r.Resolved.Error is null).Select(r => (r.Resolved.Shift!, r.Resolved.Completion!)).ToList(), VarianceReviewMinutes, ct)
            : new HashSet<Guid>();

        foreach (var (shiftId, (resolvedShift, resolvedCompletion, error)) in resolved)
        {
            if (error is not null)
            {
                var (code, message) = ExtractBatchFailure(error);
                results.Add(new ApproveBatchResultDto(shiftId, false, code, message));
                continue;
            }
            if (needsReview.Contains(shiftId))
            {
                results.Add(new ApproveBatchResultDto(shiftId, false, ShiftErrorCodes.ShiftNeedsReview, NeedsReviewMessage));
                continue;
            }

            resolvedCompletion!.ReviewedByUserId = reviewerId;
            resolvedCompletion.ReviewedAt = now;
            resolvedCompletion.ReviewOutcome = ReviewOutcome.Approved;
            resolvedCompletion.UpdatedAt = now;

            resolvedShift!.Status = ShiftStatus.Completed;
            resolvedShift.UpdatedAt = now;

            approved.Add((resolvedShift, resolvedCompletion));
            results.Add(new ApproveBatchResultDto(shiftId, true, null, null));
        }

        foreach (var group in approved.GroupBy(p => p.Shift.TenantId))
            await EmploymentHeroTimesheets.EnqueueAsync(_db, group.Key, group.ToList(), now, ct);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<List<ApproveBatchResultDto>>.Ok(results));
    }

    // ══════════════════════════════════════════════════════════════
    // SHIFT PATTERNS
    // ══════════════════════════════════════════════════════════════

    /// <summary>List patterns, optionally filtered by participant.</summary>
    [HttpGet("patterns")]
    public async Task<ActionResult<ApiResponse<List<ShiftPatternDto>>>> GetPatterns(
        [FromQuery] Guid? participantId, CancellationToken ct)
    {
        var query = _db.ShiftPatterns.Include(p => p.Participant).Include(p => p.DefaultUser).AsQueryable();
        if (participantId.HasValue) query = query.Where(p => p.ParticipantId == participantId.Value);

        var patterns = await query.OrderBy(p => p.DayOfWeek).ThenBy(p => p.StartTime).ToListAsync(ct);
        var versions = await SourceVersionsAsync(patterns, ct);
        return Ok(ApiResponse<List<ShiftPatternDto>>.Ok(patterns.Select(p => ToPatternDto(p, versions)).ToList()));
    }

    /// <summary>Get a single pattern.</summary>
    [HttpGet("patterns/{id:guid}")]
    public async Task<ActionResult<ApiResponse<ShiftPatternDto>>> GetPatternById(Guid id, CancellationToken ct)
    {
        var pattern = await _db.ShiftPatterns.Include(p => p.Participant).Include(p => p.DefaultUser)
            .FirstOrDefaultAsync(p => p.Id == id, ct);
        if (pattern == null) return NotFound(ApiResponse<ShiftPatternDto>.Fail("Pattern not found."));

        return Ok(ApiResponse<ShiftPatternDto>.Ok(ToPatternDto(pattern, await SourceVersionsAsync(new[] { pattern }, ct))));
    }

    /// <summary>Create a weekly-recurring shift pattern. Not roster-checked — generation checks its own candidates via <c>POST /shifts/check</c> if the frontend chooses to.</summary>
    [HttpPost("patterns")]
    public async Task<ActionResult<ApiResponse<ShiftPatternDto>>> CreatePattern(
        [FromBody] CreateShiftPatternDto dto, CancellationToken ct)
    {
        // A pattern makes shifts, so it needs a length like one (phase 3 review, N2): a pattern with none would make shifts the budget cannot price.
        if (Shift.HoursBetween(dto.StartTime, dto.EndTime, dto.EndsNextDay) <= 0m) return BadRequest(ApiResponse<ShiftPatternDto>.Fail(ShiftEndsBeforeItStartsMessage, ShiftNoLengthCode));
        if (!(await ParticipantReadiness.CheckAsync(_db, dto.ParticipantId, ct)).Allowed)
            return BadRequest(ApiResponse<ShiftPatternDto>.Fail(ParticipantReadinessGate.NotReadyMessage));
        if (dto.DefaultStaffId.HasValue && !await _db.Users.AnyAsync(s => s.Id == dto.DefaultStaffId.Value && s.IsActive, ct))
            return BadRequest(ApiResponse<ShiftPatternDto>.Fail("Staff member not found."));

        var pattern = new ShiftPattern
        {
            Id = Guid.NewGuid(), ParticipantId = dto.ParticipantId, DefaultUserId = dto.DefaultStaffId,
            DayOfWeek = dto.DayOfWeek, StartTime = dto.StartTime, EndTime = dto.EndTime, EndsNextDay = dto.EndsNextDay,
            Ratio = dto.Ratio, NightType = dto.NightType, EffectiveFrom = dto.EffectiveFrom, EffectiveTo = dto.EffectiveTo,
            IsActive = dto.IsActive, Notes = dto.Notes
        };
        _db.ShiftPatterns.Add(pattern);
        await _db.SaveChangesAsync(ct);

        return CreatedAtAction(nameof(GetPatternById), new { id = pattern.Id },
            ApiResponse<ShiftPatternDto>.Ok(await LoadPatternDtoAsync(pattern.Id, ct)));
    }

    /// <summary>
    /// Update a pattern's definition. Does not touch shifts already generated from it. A pattern an approved agreement made keeps the agreement's participant, day, times, ratio, night type and
    /// dates: a change to any of them is a 409 <c>agreement-pattern</c> naming the revision, because it is a change to the agreement (POST .../pattern-change saves it as a new revision for
    /// approval). Its default staff, notes and active are the coordinator's own and save here.
    /// </summary>
    [HttpPut("patterns/{id:guid}")]
    public async Task<ActionResult<ApiResponse<ShiftPatternDto>>> UpdatePattern(
        Guid id, [FromBody] UpdateShiftPatternDto dto, CancellationToken ct)
    {
        var participantId = await _db.ShiftPatterns.Where(p => p.Id == id).Select(p => (Guid?)p.ParticipantId).FirstOrDefaultAsync(ct);
        if (participantId is null) return NotFound(ApiResponse<ShiftPatternDto>.Fail("Pattern not found."));
        // REV281B: the regular is a concurrency token, so a change must not commit between a generation's load and its save: queue behind the participant's generation lock, as the generators do.
        RosterGenerationLock lockTaken;
        try { lockTaken = await RosterGenerationLock.AcquireAsync(_db, participantId.Value, ct, _generator.LockWait); }
        catch (RosterBusyException busy) { return Conflict(ApiResponse<ShiftPatternDto>.Fail(busy.Message)); }
        await using var held = lockTaken;
        var pattern = await _db.ShiftPatterns.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (pattern == null) return NotFound(ApiResponse<ShiftPatternDto>.Fail("Pattern not found."));

        // The rule is for times somebody is setting now, as for a shift: an edit that leaves the times alone (deactivating a pattern saved before the rule) is never refused.
        var timesChanged = dto.StartTime != pattern.StartTime || dto.EndTime != pattern.EndTime || dto.EndsNextDay != pattern.EndsNextDay;
        if (timesChanged && Shift.HoursBetween(dto.StartTime, dto.EndTime, dto.EndsNextDay) <= 0m) return BadRequest(ApiResponse<ShiftPatternDto>.Fail(ShiftEndsBeforeItStartsMessage, ShiftNoLengthCode));
        if (pattern.SourceDraftId is { } source && ChangesTheAgreement(pattern, dto)) return AgreementPatternConflict(source, AgreementPatternEditMessage);

        if (!(await ParticipantReadiness.CheckAsync(_db, dto.ParticipantId, ct)).Allowed)
            return BadRequest(ApiResponse<ShiftPatternDto>.Fail(ParticipantReadinessGate.NotReadyMessage));
        if (dto.DefaultStaffId.HasValue && !await _db.Users.AnyAsync(s => s.Id == dto.DefaultStaffId.Value && s.IsActive, ct))
            return BadRequest(ApiResponse<ShiftPatternDto>.Fail("Staff member not found."));

        pattern.ParticipantId = dto.ParticipantId; pattern.DefaultUserId = dto.DefaultStaffId;
        pattern.DayOfWeek = dto.DayOfWeek; pattern.StartTime = dto.StartTime; pattern.EndTime = dto.EndTime;
        pattern.EndsNextDay = dto.EndsNextDay; pattern.Ratio = dto.Ratio; pattern.NightType = dto.NightType;
        pattern.EffectiveFrom = dto.EffectiveFrom; pattern.EffectiveTo = dto.EffectiveTo; pattern.IsActive = dto.IsActive;
        pattern.Notes = dto.Notes;

        // DefaultUserId is a concurrency token (REV281B): a regular changed since this load is the stale-board 409, not a silent overwrite.
        try { await _db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { return Conflict(ApiResponse<ShiftPatternDto>.Fail(PatternChangedMessage)); }
        await held.CommitAsync(ct);
        return Ok(ApiResponse<ShiftPatternDto>.Ok(await LoadPatternDtoAsync(pattern.Id, ct)));
    }

    /// <summary>The code of the 409 that refuses a change only the agreement can make; the screen reads it with <c>data.draftId</c>.</summary>
    public const string AgreementPatternCode = "agreement-pattern";

    private const string AgreementPatternEditMessage = "This pattern comes from a service agreement. Its day, times, ratio, night type, dates and participant are the agreement's: change it through the agreement, which saves a new revision for approval. Default staff, notes and active can be changed here.";
    private const string AgreementPatternDeleteMessage = "This pattern comes from a service agreement, so it ends through the agreement: save a new revision without it and approve that. To stop it making shifts now, switch it off.";

    /// <summary>The fields an agreement sets on a pattern it made. A change to any of them is a change to the agreement.</summary>
    private static bool ChangesTheAgreement(ShiftPattern pattern, CreateShiftPatternDto dto) =>
        dto.ParticipantId != pattern.ParticipantId || dto.DayOfWeek != pattern.DayOfWeek || dto.StartTime != pattern.StartTime || dto.EndTime != pattern.EndTime
        || dto.EndsNextDay != pattern.EndsNextDay || dto.Ratio != pattern.Ratio || dto.NightType != pattern.NightType || dto.EffectiveFrom != pattern.EffectiveFrom || dto.EffectiveTo != pattern.EffectiveTo;

    /// <summary>The 409 for a change only the agreement can make: the revision whose approval made the pattern, for the screen to open.</summary>
    private ConflictObjectResult AgreementPatternConflict(Guid draftId, string message) => Conflict(new ApiResponse<AgreementPatternConflictDto>
    {
        Success = false, Data = new AgreementPatternConflictDto { DraftId = draftId }, Errors = new List<string> { message }, Code = AgreementPatternCode,
    });

    /// <summary>Delete a pattern. Shifts already generated from it are left in place (provenance only, no cascade). A pattern an agreement made is refused (409 <c>agreement-pattern</c>): it ends through a revision.</summary>
    [HttpDelete("patterns/{id:guid}")]
    public async Task<ActionResult<ApiResponse<bool>>> DeletePattern(Guid id, CancellationToken ct)
    {
        var pattern = await _db.ShiftPatterns.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (pattern == null) return NotFound(ApiResponse<bool>.Fail("Pattern not found."));
        if (pattern.SourceDraftId is { } source) return AgreementPatternConflict(source, AgreementPatternDeleteMessage);

        _db.ShiftPatterns.Remove(pattern);
        // The regular is a concurrency token, so a SetRegular that commits between the load and the delete makes this a 409 (reload and delete again), not a 500.
        try { await _db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { return Conflict(ApiResponse<bool>.Fail(PatternChangedMessage)); }
        return Ok(ApiResponse<bool>.Ok(true));
    }

    /// <summary>
    /// Materialise a pattern into concrete Draft shifts across [from, to] through <see cref="RosterShiftGenerator"/>, the one place that does it (the approval of an agreement revision and the
    /// daily top-up use it too). Idempotent: any date in range that already carries a shift with this pattern's Id is skipped rather than duplicated, so running the same range twice in a
    /// row creates nothing the second time; so is a day the pattern's agreement plan skips for a public holiday, and concurrent calls for one participant take turns.
    /// </summary>
    [HttpPost("patterns/{id:guid}/generate")]
    public async Task<ActionResult<ApiResponse<GeneratePatternResultDto>>> GeneratePattern(
        Guid id, [FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken ct)
    {
        // Not tracked: the generator takes the participant lock and then loads the pattern tracked, and a tracked copy read here would be returned to it stale (a SetRegular committing in between would make its save a concurrency 500).
        var pattern = await _db.ShiftPatterns.AsNoTracking().FirstOrDefaultAsync(p => p.Id == id, ct);
        if (pattern == null) return NotFound(ApiResponse<GeneratePatternResultDto>.Fail("Pattern not found."));
        if (!(await ParticipantReadiness.CheckAsync(_db, pattern.ParticipantId, ct)).Allowed)
            return BadRequest(ApiResponse<GeneratePatternResultDto>.Fail(ParticipantReadinessGate.NotReadyMessage));

        try
        {
            // A person's own window: it only moves how far the pattern has been generated when it joins on to what was covered (or, when nothing was yet, to the first day the top-up would make: the provider's today),
            // so the daily top-up can still fill a gap before it.
            var today = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
            // The board's lock order, as Start week: the organisation's board lock first, so a plain create for the same worker is taken in turn with this; the generator's participant lock joins that transaction, so the board lock commits.
            ShiftGeneration generated;
            await using (var held = await RosterBoardLockAsync(ct))
            {
                generated = await _generator.GenerateAsync(_db, pattern.ParticipantId, new[] { pattern.Id }, from, to, ct, onlyWhenContiguous: true, providerToday: today, availability: _availability);
                await held.CommitAsync(ct);
            }
            await MarkWeeksStartedAsync(pattern.TenantId, generated.MadeShifts, ct);
            var warnings = await BudgetWarningsAsync(pattern.ParticipantId, generated.MadeShifts, ct);
            return Ok(ApiResponse<GeneratePatternResultDto>.Ok(new GeneratePatternResultDto { Created = generated.Created, Skipped = generated.Skipped, BudgetWarnings = warnings }));
        }
        catch (RosterBusyException busy)
        {
            return Conflict(ApiResponse<GeneratePatternResultDto>.Fail(busy.Message));
        }
    }

    /// <summary>
    /// L10: a Generate that made shifts in a week nobody has started starts it, so the board no longer offers Start there. Saved after the generation's own commit, one week at a time:
    /// a Start that wins the unique row for a week makes it started anyway.
    /// </summary>
    private async Task MarkWeeksStartedAsync(Guid tenantId, IReadOnlyList<Shift> made, CancellationToken ct)
    {
        var weeks = made.Select(s => RosterWeek.MondayOf(s.ServiceDate)).Distinct().ToList();
        if (weeks.Count == 0) return;
        var started = await _db.RosterWeeks.Where(w => w.TenantId == tenantId && weeks.Contains(w.WeekStart)).Select(w => w.WeekStart).ToListAsync(ct);
        foreach (var monday in weeks.Except(started))
        {
            var week = _db.RosterWeeks.Add(new RosterWeek { Id = Guid.NewGuid(), TenantId = tenantId, WeekStart = monday, StartedAt = _clock.GetUtcNow().UtcDateTime, StartedByUserId = ResolveCurrentUserId() });
            try { await _db.SaveChangesAsync(ct); }
            catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation }) { week.State = EntityState.Detached; }
        }
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
        return Ok(ApiResponse<List<CompatibilityRowDto>>.Ok(rows.Select(ToCompatibilityDto).ToList()));
    }

    /// <summary>Upsert one compatibility cell (StaffId, ParticipantId).</summary>
    [HttpPut("compatibility")]
    public async Task<ActionResult<ApiResponse<CompatibilityRowDto>>> UpsertCompatibility(
        [FromBody] UpsertCompatibilityDto dto, CancellationToken ct)
    {
        if (!await _db.Users.AnyAsync(s => s.Id == dto.StaffId && s.IsActive, ct))
            return BadRequest(ApiResponse<CompatibilityRowDto>.Fail("Staff member not found."));
        if (!(await ParticipantReadiness.CheckAsync(_db, dto.ParticipantId, ct)).Allowed)
            return BadRequest(ApiResponse<CompatibilityRowDto>.Fail(ParticipantReadinessGate.NotReadyMessage));

        var row = await _db.StaffParticipantCompatibilities
            .FirstOrDefaultAsync(c => c.UserId == dto.StaffId && c.ParticipantId == dto.ParticipantId, ct);
        // Absence of a row means Allowed (the entity's documented sparse default) — same value
        // StaffCompatibilityLinkService.SyncFromCompatibilityUpsertAsync expects for a new row.
        var previousLevel = row?.Level ?? CompatibilityLevel.Allowed;

        if (row == null)
        {
            row = new StaffParticipantCompatibility { Id = Guid.NewGuid(), UserId = dto.StaffId, ParticipantId = dto.ParticipantId };
            _db.StaffParticipantCompatibilities.Add(row);
        }

        row.Level = dto.Level;
        row.Reason = dto.Reason;
        row.UpdatedAt = DateTime.UtcNow;
        // This endpoint is the compatibility matrix's only human-facing writer — every call
        // takes ownership of the row away from the participant-preferred-staff auto-link (task
        // 6d; see StaffCompatibilityLinkService for why).
        row.AutoLinked = false;

        // Task 6d: reflect a Preferred mark (or a move off it) back onto the participant's
        // PreferredUserId, in the same transaction as this compatibility write.
        await _compatLink.SyncFromCompatibilityUpsertAsync(row, previousLevel, ct);

        await ParticipantGroupRevisions.SaveBumpingAsync(_db, ct);

        var loaded = await _db.StaffParticipantCompatibilities
            .Include(c => c.User).Include(c => c.Participant)
            .FirstAsync(c => c.Id == row.Id, ct);
        return Ok(ApiResponse<CompatibilityRowDto>.Ok(ToCompatibilityDto(loaded)));
    }

    // ══════════════════════════════════════════════════════════════
    // HELPERS
    // ══════════════════════════════════════════════════════════════

    /// <summary>Monday of the week containing <paramref name="date"/>.</summary>
    private static DateOnly WeekStart(DateOnly date) => RosterWeek.MondayOf(date);

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

    private static RosterFindingDto ToFindingDto(RosterFinding f) => RosterGate.ToFindingDto(f);

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

    private static ShiftPatternDto ToPatternDto(ShiftPattern p, IReadOnlyDictionary<Guid, int>? sourceVersions = null) => new()
    {
        Id = p.Id, ParticipantId = p.ParticipantId, ParticipantName = p.Participant?.FullName ?? string.Empty,
        DefaultStaffId = p.DefaultUserId, DefaultStaffName = p.DefaultUser?.FullName,
        DayOfWeek = p.DayOfWeek, StartTime = p.StartTime, EndTime = p.EndTime, EndsNextDay = p.EndsNextDay,
        Ratio = p.Ratio, NightType = p.NightType, EffectiveFrom = p.EffectiveFrom, EffectiveTo = p.EffectiveTo,
        IsActive = p.IsActive, Notes = p.Notes,
        SourceDraftId = p.SourceDraftId, SourceBlockKey = p.SourceBlockKey, WorkerSlot = p.WorkerSlot,
        SourceDraftVersion = p.SourceDraftId is { } source && sourceVersions is not null && sourceVersions.TryGetValue(source, out var version) ? version : null,
        Requirements = RequirementsOf(p.RequirementsJson),
    };

    /// <summary>What a pattern or a shift asks of a worker, read from its stored JSON; none when it was never given any.</summary>
    private static DraftBlockRequirementsDto? RequirementsOf(string? json) => string.IsNullOrWhiteSpace(json) ? null : DraftJson.ReadRequirements(json);

    /// <summary>The versions of the agreement revisions the given patterns were made from (one query), for the "From agreement v2" badge.</summary>
    private async Task<Dictionary<Guid, int>> SourceVersionsAsync(IEnumerable<ShiftPattern> patterns, CancellationToken ct)
    {
        var ids = patterns.Where(p => p.SourceDraftId is not null).Select(p => p.SourceDraftId!.Value).Distinct().ToList();
        return ids.Count == 0 ? new() : await _db.ServiceAgreementDrafts.AsNoTracking().Where(d => ids.Contains(d.Id)).ToDictionaryAsync(d => d.Id, d => d.Version, ct);
    }

    /// <summary>
    /// For shifts generated from an agreement's patterns: by pattern id, the version of the revision the pattern was made from (null if that cannot be read). A pattern that is not in it is hand-made, so its
    /// shifts say nothing about an agreement. Two small queries for the whole set of shifts.
    /// </summary>
    private async Task<Dictionary<Guid, int?>> ShiftSourcesAsync(IEnumerable<Guid?> patternIds, CancellationToken ct)
    {
        var ids = patternIds.Where(id => id.HasValue).Select(id => id!.Value).Distinct().ToList();
        if (ids.Count == 0) return new();
        var made = await _db.ShiftPatterns.AsNoTracking().Where(p => ids.Contains(p.Id) && p.SourceDraftId != null).Select(p => new { p.Id, DraftId = p.SourceDraftId!.Value }).ToListAsync(ct);
        if (made.Count == 0) return new();
        var draftIds = made.Select(p => p.DraftId).Distinct().ToList();
        var versions = await _db.ServiceAgreementDrafts.AsNoTracking().Where(d => draftIds.Contains(d.Id)).ToDictionaryAsync(d => d.Id, d => d.Version, ct);
        return made.ToDictionary(p => p.Id, p => versions.TryGetValue(p.DraftId, out var version) ? (int?)version : null);
    }

    /// <summary>
    /// For the board's notice (spec 2026-10-15; lead decision L10): every participant whose newest agreement revision waits for an approval for rostering, with a board row or not.
    /// A participant still in onboarding has no row, and theirs is the agreement nobody can otherwise see.
    /// - Newest: no newer revision of theirs in the same organisation (the shape ParticipantReadinessGate already runs on Npgsql).
    /// - Waits: not approved; made from blocks (blocks and a stored answer: the approval service's HandTyped rule); not ended on the provider's calendar.
    /// - Archived participants (neither active nor a draft) are left out (L11).
    /// One query, read only. The query filters keep it to the caller's organisation, and each revision is matched to its own participant's organisation, because a SuperAdmin's context sees all of them.
    /// </summary>
    private async Task<List<PendingAgreementDto>> PendingAgreementsAsync(CancellationToken ct)
    {
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
        var waiting = await _db.ServiceAgreementDrafts.AsNoTracking()
            .Where(d => d.AgreementEndDate >= today && d.Blocks.Any() && d.PricingJson != null
                && !_db.ServiceAgreementDrafts.Any(newer => newer.ParticipantId == d.ParticipantId && newer.TenantId == d.TenantId && newer.Version > d.Version)
                && !_db.ServiceAgreementDraftApprovals.Any(a => a.DraftId == d.Id && a.TenantId == d.TenantId))
            .Join(_db.Participants.AsNoTracking().Where(p => p.IsActive || p.IsDraft), d => d.ParticipantId, p => p.Id, (d, p) => new { d.Id, d.Version, d.TenantId, d.PricingJson, Participant = p })
            .Where(x => x.Participant.TenantId == x.TenantId)
            .ToListAsync(ct);
        return waiting
            .Where(x => DraftJson.ReadQuote(x.PricingJson) is not null)   // the approval service's own HandTyped test: a stored answer it can read
            .OrderBy(x => x.Participant.LastName).ThenBy(x => x.Participant.FirstName)
            .Select(x => new PendingAgreementDto
            {
                ParticipantId = x.Participant.Id, DisplayName = x.Participant.FullName, DraftId = x.Id, Version = x.Version,
                CanReceiveServices = Participant.CanReceiveServices(x.Participant),
            })
            .ToList();
    }

    private static CompatibilityRowDto ToCompatibilityDto(StaffParticipantCompatibility c) => new()
    {
        Id = c.Id, StaffId = c.UserId, StaffName = c.User?.FullName ?? string.Empty,
        ParticipantId = c.ParticipantId, ParticipantName = c.Participant?.FullName ?? string.Empty,
        Level = c.Level, Reason = c.Reason, UpdatedAt = c.UpdatedAt
    };

    /// <summary>Maps a ShiftCompletion to its DTO — thin wrapper so this and PortalController's
    /// identical mapping need to stay in one place; see <see cref="ShiftCompletionMapper"/>.
    /// <paramref name="includeIncidents"/> forwards to the mapper's own parameter — only
    /// GetShiftCompletion passes true (see that method's remarks).</summary>
    private Task<ShiftCompletionDto> ToShiftCompletionDtoAsync(ShiftCompletion c, int shiftReturnCount, CancellationToken ct, bool includeIncidents = false)
        => ShiftCompletionMapper.ToDtoAsync(_db, c, VarianceReviewMinutes, shiftReturnCount, ct, includeIncidents);

    /// <summary>
    /// Resolves a PendingReview shift and its active ShiftCompletion for Approve/Return, or the
    /// ActionResult to short-circuit with. Preserves the existing check order: shift-404 ->
    /// status-409 -> completion-404. Extracted (critique P3) from the identical block previously
    /// duplicated across ApproveCompletion/ReturnCompletion.
    /// </summary>
    private async Task<(Shift? Shift, ShiftCompletion? Completion, ActionResult<ApiResponse<ShiftCompletionDto>>? Error)> ResolvePendingReviewCompletionAsync(Guid shiftId, CancellationToken ct)
    {
        var shift = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == shiftId, ct);
        var completion = shift is not null && shift.Status == ShiftStatus.PendingReview
            ? await _db.ShiftCompletions.FirstOrDefaultAsync(c => c.ShiftId == shiftId && c.IsActive, ct)
            : null;
        return ResolvePendingReviewCompletion(shift, completion);
    }

    /// <summary>
    /// The pure classification rules ResolvePendingReviewCompletionAsync applies, extracted
    /// (critique M3) so ApproveBatch can run them in memory over shift/completion dictionaries it
    /// loaded with two bulk queries instead of calling the async, per-id version 2N times. Same
    /// check order as before: shift-404 -&gt; status-409 -&gt; completion-404.
    /// </summary>
    private (Shift? Shift, ShiftCompletion? Completion, ActionResult<ApiResponse<ShiftCompletionDto>>? Error) ResolvePendingReviewCompletion(Shift? shift, ShiftCompletion? completion)
    {
        if (shift is null)
            return (null, null, NotFound(ApiResponse<ShiftCompletionDto>.Fail("Shift not found.")));

        if (shift.Status != ShiftStatus.PendingReview)
            return (null, null, Conflict(ApiResponse<ShiftCompletionDto>.Fail(
                "This shift isn't awaiting review.", ShiftErrorCodes.ShiftNotPendingReview)));

        if (completion is null)
            return (null, null, NotFound(ApiResponse<ShiftCompletionDto>.Fail("Shift completion not found.", ShiftErrorCodes.ShiftCompletionNotFound)));

        return (shift, completion, null);
    }

    private const string NeedsReviewMessage = "This shift needs review now: open it on the Completions page.";

    /// <summary>Unwraps the Code/Message a single-approve rejection would have returned, for the batch's per-item report.</summary>
    private static (string? Code, string? Message) ExtractBatchFailure(ActionResult<ApiResponse<ShiftCompletionDto>> error)
    {
        var value = error.Result switch
        {
            ConflictObjectResult conflict => conflict.Value as ApiResponse<ShiftCompletionDto>,
            NotFoundObjectResult notFound => notFound.Value as ApiResponse<ShiftCompletionDto>,
            _ => null,
        };
        return (value?.Code, value?.Errors?.FirstOrDefault());
    }

    /// <summary>
    /// Null when the caller's JWT has no resolvable NameIdentifier claim — previously silently
    /// fell back to Guid.Empty, which the audit trail would then record as the reviewer (critique
    /// P3). Callers must check for null and 401 rather than proceed.
    /// </summary>
    private Guid? ResolveCurrentUserId()
    {
        var claim = User?.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        return Guid.TryParse(claim, out var id) ? id : null;
    }

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

    /// <summary>By pattern id, the pattern's regular (its default worker): one query for the board's "Regular" marker.</summary>
    private async Task<Dictionary<Guid, Guid>> RegularsAsync(IEnumerable<Guid?> patternIds, CancellationToken ct)
    {
        var ids = patternIds.Where(id => id.HasValue).Select(id => id!.Value).Distinct().ToList();
        if (ids.Count == 0) return new();
        return await _db.ShiftPatterns.AsNoTracking().Where(p => ids.Contains(p.Id) && p.DefaultUserId != null).ToDictionaryAsync(p => p.Id, p => p.DefaultUserId!.Value, ct);
    }

    private static Guid? LiveRegular(Shift shift, Dictionary<Guid, Guid> regulars) =>
        shift.ShiftPatternId is { } patternId && regulars.TryGetValue(patternId, out var regular) ? regular : null;

    /// <summary>DEEP-S3: the stored reason only while it still describes the slot's live regular; once someone else is the regular, or nobody, it is stale.</summary>
    private static string? AwayReason(Shift shift, Dictionary<Guid, Guid> regulars) =>
        shift.RegularUserId is { } was && was == LiveRegular(shift, regulars) ? shift.RegularAwayReason : null;

    private static bool? IsRegular(Shift shift, Dictionary<Guid, Guid> regulars) =>
        shift.UserId is { } worker && LiveRegular(shift, regulars) == worker ? true : null;

    private async Task<ShiftPatternDto> LoadPatternDtoAsync(Guid id, CancellationToken ct)
    {
        var pattern = await _db.ShiftPatterns.Include(p => p.Participant).Include(p => p.DefaultUser)
            .FirstAsync(p => p.Id == id, ct);
        return ToPatternDto(pattern, await SourceVersionsAsync(new[] { pattern }, ct));
    }

    private async Task<ShiftDto> ToShiftDtoAsync(Shift shift, List<RosterFinding> findings, CancellationToken ct)
    {
        var participant = await _db.Participants.FirstOrDefaultAsync(p => p.Id == shift.ParticipantId, ct);
        var staff = shift.UserId.HasValue
            ? await _db.Users.FirstOrDefaultAsync(s => s.Id == shift.UserId.Value, ct)
            : null;
        var readinessIssues = await ParticipantReadiness.IssuesAsync(_db, new[] { shift.ParticipantId }, ct);
        int? sourceVersion = null;
        var fromAgreement = shift.ShiftPatternId is { } patternId && (await ShiftSourcesAsync(new[] { shift.ShiftPatternId }, ct)).TryGetValue(patternId, out sourceVersion);
        var regulars = await RegularsAsync(new[] { shift.ShiftPatternId }, ct);

        return new ShiftDto
        {
            Id = shift.Id, ParticipantId = shift.ParticipantId, ParticipantName = participant?.FullName ?? string.Empty,
            StaffId = shift.UserId, StaffName = staff?.FullName,
            ServiceDate = shift.ServiceDate, StartTime = shift.StartTime, EndTime = shift.EndTime, EndsNextDay = shift.EndsNextDay,
            DurationHours = shift.DurationHours, Ratio = shift.Ratio, NightType = shift.NightType, Status = shift.Status,
            ShiftPatternId = shift.ShiftPatternId, Notes = shift.Notes, OverrideReason = shift.OverrideReason, Requirements = RequirementsOf(shift.RequirementsJson),
            AcknowledgedFindingCodes = AcknowledgedCodesOf(shift), BudgetReview = (await BudgetReviewsAsync(new[] { shift }, ct)).GetValueOrDefault(shift.Id),
            FromAgreement = fromAgreement ? true : null, SourceDraftVersion = sourceVersion,
            Findings = findings.Select(ToFindingDto).ToList(),
            RegularUserId = LiveRegular(shift, regulars), RegularAwayReason = AwayReason(shift, regulars), IsRegular = IsRegular(shift, regulars),
            ReadinessIssues = ParticipantReadiness.IssuesOrNull(readinessIssues, shift.ParticipantId)
        };
    }

    /// <summary>The finding codes stored with the shift, for the over-budget marker; null (omitted from the JSON) when it holds none.</summary>
    private static List<string>? AcknowledgedCodesOf(Shift shift) => ShiftBudgetGate.SplitCodes(shift.AcknowledgedFindingCodes) is { Count: > 0 } codes ? codes : null;

    /// <summary>
    /// Where the Admin's review of each emergency or safety booking stands, for the shifts that carry the emergency code: the review task raised with the booking (pending until it is completed). One query, and none when
    /// no shift holds the code. There is no "approved": a booking saves at once and is reviewed afterwards.
    /// </summary>
    private async Task<Dictionary<Guid, BudgetReviewDto>> BudgetReviewsAsync(IEnumerable<Shift> shifts, CancellationToken ct)
    {
        var ids = shifts.Where(s => ShiftBudgetGate.SplitCodes(s.AcknowledgedFindingCodes).Contains(BudgetFindingCodes.Emergency)).Select(s => s.Id).ToList();
        if (ids.Count == 0) return new Dictionary<Guid, BudgetReviewDto>();

        var tasks = await _db.BookingTasks.AsNoTracking()
            .Where(t => t.TaskType == TaskType.BudgetEmergencyReview && t.ShiftId != null && ids.Contains(t.ShiftId.Value))
            .Select(t => new { ShiftId = t.ShiftId!.Value, t.Title, t.Status, t.SourceKey, t.CreatedAt, t.CompletedDate, OwnerName = t.Owner != null ? (t.Owner.FirstName + " " + t.Owner.LastName).Trim() : null })
            .ToListAsync(ct);
        return tasks.GroupBy(t => t.ShiftId).ToDictionary(g => g.Key, g =>
        {
            var task = g.OrderByDescending(t => t.SourceKey!.Length).ThenByDescending(t => t.SourceKey).First();   // the newest review of the shift: :2 and :3 follow the first
            var reviewed = task.Status == TaskItemStatus.Completed;
            return new BudgetReviewDto
            {
                State = reviewed ? BudgetReviewState.Reviewed : BudgetReviewState.Pending, RecordedAt = task.CreatedAt, ReviewTaskTitle = task.Title, ReviewedOn = reviewed ? task.CompletedDate : null,
                ReviewedBy = reviewed ? task.OwnerName : null,
            };
        });
    }

    /// <summary>
    /// Participant must exist; staff, when supplied, must exist and be active (§4.4). Same-tenant
    /// scoping comes for free from _db.Users' ambient OdipDbContext query filter. Returns a
    /// user-facing error string, or null when both refs are valid.
    /// </summary>
    private async Task<string?> ValidateRefsAsync(Guid participantId, Guid? staffId, CancellationToken ct)
    {
        // Every one-off creation/update/assignment validation funnels through this readiness
        // check. A participant who does not exist, is a draft, or is inactive is refused in either
        // mode; beyond that, Enforce refuses incomplete intake, a missing/incomplete onboarding
        // record and missing signed-agreement evidence, while Warn lets the write proceed and
        // reports what is missing on the response (ShiftDto.ReadinessIssues).
        if (!(await ParticipantReadiness.CheckAsync(_db, participantId, ct)).Allowed)
            return ParticipantReadinessGate.NotReadyMessage;
        if (staffId.HasValue && !await _db.Users.AnyAsync(s => s.Id == staffId.Value && s.IsActive, ct))
            return "Staff member not found.";
        return null;
    }

    /// <summary>
    /// Builds the <see cref="RosterCheckContext"/> for <paramref name="candidate"/> and runs
    /// <see cref="RosterConflictService.Check"/>. Unfilled shifts (<see cref="Shift.UserId"/>
    /// null) skip every staff-dependent rule entirely, per the M4 design brief, rather than
    /// attempting to load a staff member that doesn't exist. <paramref name="excludeId"/> is
    /// the shift's own prior Id on an update/assign (falls back to <paramref name="candidate"/>'s
    /// own Id), so a shift never conflicts with itself.
    /// </summary>
    private async Task<List<RosterFinding>> CheckAsync(Shift candidate, Guid? excludeId, CancellationToken ct, Guid? leavingShiftId = null)
    {
        if (candidate.UserId is not { } userId) return new List<RosterFinding>();
        var weekStart = WeekStart(candidate.ServiceDate);
        // A person being moved or swapped off leavingShiftId is judged without it: no DOUBLE_BOOKED_SHIFT or OVER_HOURS against the shift they are leaving (roster drag and drop, 2026-10-14).
        // shortcut: participantShiftsOnDate still counts them on the shift they leave, so a swap inside one 2:1 pair can warn RATIO_SHORTFALL falsely; filter it there too if pairs get swapped often.
        // The week and the day either side (RosterAvailability.LoadAsync), as before: an overnight shift across the week edge is double-booking checked; OVER_HOURS still counts the candidate's own week.
        var snapshot = await _availability.LoadAsync([userId], [candidate.ParticipantId], weekStart, weekStart.AddDays(6), ct);
        return snapshot.Check(candidate, excludeId ?? candidate.Id, leavingShiftId);
    }

    /// <summary>
    /// The Blocking/RequiresReason/override gate every roster write runs through: any Blocking
    /// finding rejects the write regardless of <paramref name="overrideReason"/>; any finding
    /// with RequiresReason true needs a non-empty reason; a write whose findings are all
    /// RequiresReason == false may proceed with no reason at all (ApplyOverride still records
    /// their codes in AcknowledgedFindingCodes — see that method — so the board can show why a
    /// cell looks tentative without ever having asked for input). Returns the 422 response body
    /// to return, or null when the write may proceed.
    /// </summary>
    private ApiResponse<List<RosterFindingDto>>? EvaluateFindings(List<RosterFinding> findings, string? overrideReason) =>
        RosterGate.EvaluateFindings(findings, overrideReason);

    /// <summary>
    /// Persists (or clears) the override fields to match the outcome <see cref="EvaluateFindings"/> already approved, with the budget rules of <see cref="ShiftBudgetGate"/> on top: the over-budget
    /// acknowledgements are the server's alone, and a save that does not decide the budget again keeps the one the shift already has (<paramref name="previousReason"/>, <paramref name="previousCodes"/>).
    /// </summary>
    private static void ApplyOverride(
        Shift shift, List<RosterFinding> findings, ShiftBudgetGate.Decision budgetGate, string? overrideReason, List<string>? acknowledgedCodes, string? previousReason = null, string? previousCodes = null)
    {
        var (reason, codes) = ShiftBudgetGate.ToStore(findings, budgetGate, overrideReason, acknowledgedCodes, previousReason, previousCodes);
        shift.OverrideReason = reason;
        shift.AcknowledgedFindingCodes = codes;
    }

    /// <summary>Roster drag and drop (2026-10-14), decision 8: a shift that has started, waits for review, is finished or is cancelled keeps its worker; only its completion endpoints move it on.</summary>
    private static bool IsLockedForStaffChange(ShiftStatus status) =>
        status is ShiftStatus.InProgress or ShiftStatus.PendingReview or ShiftStatus.Completed or ShiftStatus.Cancelled;

    private const string ShiftLockedForStaffMessage = "This shift has started, finished or been cancelled, so its worker can't be changed here.";
    private const string ShiftNotDeletableMessage = "This shift has been started or finished, so it can't be deleted.";
    private const string ShiftHasRecordsMessage = "This shift has notes or a timesheet behind it, so it can't be deleted. Cancel it instead.";
    private const string ShiftLockedForParticipantMessage = "This shift has started, finished or been cancelled, so its participant can't be changed here.";

    /// <summary>What a pattern edit or delete made on an out-of-date page is refused with (409): UpdatePattern and DeletePattern when the regular changed under them.</summary>
    private const string PatternChangedMessage = "This pattern changed after you opened it. Reload and try again.";

    /// <summary>What a drop made on an out-of-date board is refused with (409): /assign with ExpectedStaffId, and move-staff.</summary>
    private const string BoardChangedMessage = "This shift changed after the board was loaded. Refresh the board and try again.";

    /// <summary>The shift as it would be with <paramref name="userId"/> on it: the candidate the roster check judges.</summary>
    private static Shift WithWorker(Shift shift, Guid? userId) => new()
    {
        Id = shift.Id, ParticipantId = shift.ParticipantId, UserId = userId,
        ServiceDate = shift.ServiceDate, StartTime = shift.StartTime, EndTime = shift.EndTime,
        EndsNextDay = shift.EndsNextDay, Ratio = shift.Ratio, NightType = shift.NightType
    };

    /// <summary>Puts <paramref name="userId"/> on the shift (null clears it) with the override fields the findings just approved. Assigning a worker is not a budget moment: the shift keeps the over-budget acknowledgement it already has.</summary>
    private static void ApplyStaff(Shift shift, Guid? userId, List<RosterFinding> findings, string? overrideReason, List<string>? acknowledgedCodes)
    {
        var previousReason = shift.OverrideReason;
        var previousCodes = shift.AcknowledgedFindingCodes;
        shift.UserId = userId;
        if (userId is not null) { shift.RegularUserId = null; shift.RegularAwayReason = null; }   // assigning anyone ends "regular away" (L5)
        shift.UpdatedAt = DateTime.UtcNow;
        ApplyOverride(shift, findings, ShiftBudgetGate.Decision.NoEmergency(findings), overrideReason, acknowledgedCodes, previousReason, previousCodes);
    }

    /// <summary>
    /// Roster drag and drop (2026-10-14), decision 9: a worker hears about a shift only once it is Published. Call it once the shift holds its new worker and status, before the
    /// caller's one save, so the outbox rows commit with the change (a refused write sends nothing). The worker on a Published shift gets ShiftAssigned when it is newly theirs or
    /// has just become Published; whoever came off a shift that was already Published gets ShiftUnassigned, even when the same save takes it off Published (deep review S2). Draft changes, and a
    /// Published shift going back to Draft or Cancelled with its worker kept, stay silent.
    /// </summary>
    private async Task NotifyStaffChangeAsync(Shift shift, Guid? previousUserId, bool wasPublished, CancellationToken ct)
    {
        var assignedTo = shift.Status == ShiftStatus.Published && shift.UserId is { } now && (now != previousUserId || !wasPublished) ? now : (Guid?)null;
        var takenOff = wasPublished && previousUserId is { } before && before != shift.UserId ? before : (Guid?)null;
        if (assignedTo is null && takenOff is null) return;

        var participantName = await _db.Participants.Where(p => p.Id == shift.ParticipantId)
            .Select(p => (p.FirstName + " " + p.LastName).Trim()).FirstOrDefaultAsync(ct) ?? "a participant";
        if (assignedTo is { } a && await _db.Users.FirstOrDefaultAsync(u => u.Id == a, ct) is { } assigned)
            await _notificationRaiser.RaiseAsync(
                Odip.Domain.Notifications.NotificationEventType.ShiftAssigned, "Shift", shift.Id, new[] { assigned.Id },
                new Odip.Infrastructure.Notifications.Templates.ShiftAssignedPayload(assigned.Email, participantName, shift.ServiceDate, shift.StartTime, shift.EndTime), ct);
        if (takenOff is { } t && await _db.Users.FirstOrDefaultAsync(u => u.Id == t, ct) is { } removed)
            await _notificationRaiser.RaiseAsync(
                Odip.Domain.Notifications.NotificationEventType.ShiftUnassigned, "Shift", shift.Id, new[] { removed.Id },
                new Odip.Infrastructure.Notifications.Templates.ShiftUnassignedPayload(removed.Email, participantName, shift.ServiceDate, shift.StartTime, shift.EndTime), ct);
    }

    /// <summary>
    /// The organisation's lock for the board's own writes (roster drag and drop, 2026-10-14): move-staff and Publish week hold it, so two drops, or a drop and a publish, never interleave,
    /// even across participants (one person dropped onto two overlapping shifts at once). It is the generator's <see cref="RosterGenerationLock"/>, keyed on the tenant under a scope of its
    /// own: a move only changes who works a shift, so it has nothing to wait for in a generation. A no-op off PostgreSQL. Read what you change AFTER taking it.
    /// </summary>
    // shortcut: an unscoped SuperAdmin holds their own home organisation's key (every token carries tenant_id), so their writes to another organisation's roster do not exclude its
    // coordinators; key the lock on the shift's TenantId if SuperAdmins edit rosters unscoped.
    private Task<RosterGenerationLock> RosterBoardLockAsync(CancellationToken ct) =>
        RosterGenerationLock.AcquireAsync(_db, _tenant?.TenantId ?? Guid.Empty, ct, _generator.LockWait, scope: "roster-board");

    /// <summary>The placement rules of /assign for one person landing on one participant's shift: an active worker and a participant ready for a new placement. Null when both hold.</summary>
    private async Task<string?> PlacementRefusalAsync(Guid userId, Guid participantId, CancellationToken ct)
    {
        if (!await _db.Users.AnyAsync(u => u.Id == userId && u.IsActive, ct)) return "Staff member not found.";
        return (await ParticipantReadiness.CheckAsync(_db, participantId, ct)).Allowed ? null : ParticipantReadinessGate.NotReadyMessage;
    }

    /// <summary>
    /// Locks the shift rows <paramref name="where"/> picks (a fixed predicate; values only as parameters) FOR UPDATE, in Id order: the order the agreement approval locks its participant's rows in,
    /// so two lockers never take the same rows in opposite orders. Call it after the board lock. The wait is bounded like the advisory lock's, and a wait that runs out, or a deadlock PostgreSQL
    /// breaks, is a <see cref="RosterBusyException"/> (409 busy), never a raw 500. A no-op off PostgreSQL.
    /// </summary>
    private async Task LockShiftRowsAsync(string where, object[] parameters, CancellationToken ct)
    {
        if (!_db.Database.IsNpgsql()) return;
        // Raw SQL skips the tenant query filter, so name the caller's organisation (post-merge review N5): another organisation's row is never locked, and a guessed id answers
        // 404 at once from the filtered read rather than waiting on, and so revealing, a row someone else is writing.
        if (_tenant is { IsSuperAdmin: false, TenantId: { } tenantId })
        {
            where = string.Create(CultureInfo.InvariantCulture, $"({where}) AND \"TenantId\" = {{{parameters.Length}}}");
            parameters = [.. parameters, tenantId];
        }
        var sql = string.Create(CultureInfo.InvariantCulture,
            $"SET LOCAL lock_timeout = {(int)_generator.LockWait.TotalMilliseconds}; SELECT 1 FROM \"Shifts\" WHERE {where} ORDER BY \"Id\" FOR UPDATE; SET LOCAL lock_timeout TO DEFAULT");
        try
        {
            await _db.Database.ExecuteSqlRawAsync(sql, parameters, ct);
        }
        catch (PostgresException ex) when (ex.SqlState is PostgresErrorCodes.LockNotAvailable or PostgresErrorCodes.DeadlockDetected)
        {
            throw new RosterBusyException();
        }
    }

    /// <summary>What a board write answers when the organisation's roster lock stayed held too long (RosterBusyException speaks of one participant's roster; this lock is the whole organisation's).</summary>
    private const string RosterBoardBusyMessage = "Another change to the roster is still running. Wait a moment, then try again.";

    /// <summary>The code of Start's 409 for a week already started (L4): not "busy", so the board and the e2e helper can tell them apart.</summary>
    public const string RosterWeekStartedCode = "roster-week-started";

    /// <summary>The code of SetRegular's 409 for a pattern that has ended (REV274): the pattern no longer generates, so it has no regular to change.</summary>
    public const string PatternEndedCode = "pattern-ended";

    private ConflictObjectResult WeekAlreadyStarted() => Conflict(ApiResponse<StartWeekResultDto>.Fail("This week has already been started.", RosterWeekStartedCode));

    /// <summary>Whether the week from <paramref name="monday"/> is started, by the one rule (<see cref="StartedWeeks"/>).</summary>
    private async Task<bool> WeekStartedAsync(Guid? tenantId, DateOnly monday, CancellationToken ct) => (await StartedWeeks.MondaysAsync(_db, tenantId, monday, monday, ct)).Count > 0;

    /// <summary>The organisation's agreement patterns (an approved revision made them) that are switched on and live on some day of [start, end]: what Start rostering generates (L4).</summary>
    private IQueryable<ShiftPattern> AgreementPatternsLiveIn(Guid tenantId, DateOnly start, DateOnly end) =>
        _db.ShiftPatterns.Where(p => p.TenantId == tenantId && p.SourceDraftId != null && p.IsActive && p.EffectiveFrom <= end && (p.EffectiveTo == null || p.EffectiveTo >= start));

    /// <summary>Start's answer, after its commit: the names of the participants it skipped, and the budget warnings of what it made (never a failure: BudgetWarningsAsync logs and drops one).</summary>
    private async Task<StartWeekResultDto> StartWeekResultAsync(DateOnly start, List<Shift> made, List<Guid> skipped, int away, CancellationToken ct)
    {
        var involved = skipped.Concat(made.Select(s => s.ParticipantId)).Distinct().ToList();
        var names = await _db.Participants.AsNoTracking().Where(p => involved.Contains(p.Id)).ToDictionaryAsync(p => p.Id, p => (p.FirstName + " " + p.LastName).Trim(), ct);
        var budget = new List<StartWeekParticipantDto>();
        foreach (var forParticipant in made.GroupBy(s => s.ParticipantId))
            if (await BudgetWarningsAsync(forParticipant.Key, forParticipant.ToList(), ct) is { } warnings)
                budget.Add(new StartWeekParticipantDto { ParticipantId = forParticipant.Key, FullName = names.GetValueOrDefault(forParticipant.Key) ?? string.Empty, Warnings = warnings });
        return new StartWeekResultDto
        {
            WeekStart = start, Created = made.Count, AssignedToRegulars = made.Count(s => s.UserId != null), RegularAway = away,
            Skipped = skipped.Select(id => new StartWeekParticipantDto { ParticipantId = id, FullName = names.GetValueOrDefault(id) ?? string.Empty }).ToList(),
            BudgetWarnings = budget.Count > 0 ? budget : null,
        };
    }

    /// <summary>
    /// Where the shifts just made take a pool past its funding for a period (budget phase 3), as warnings; null when there are none to say. A warning only, in every mode: the shifts exist, and a budget that could
    /// not be worked out must never turn a successful Generate into a failure, so a failure here is logged and the result goes out without warnings.
    /// </summary>
    private async Task<List<BudgetWarningDto>?> BudgetWarningsAsync(Guid participantId, IReadOnlyList<Shift> made, CancellationToken ct)
    {
        if (_budgetEffect is null || _tenant?.TenantId is not { } tenantId || made.Count == 0) return null;
        try
        {
            var warnings = await _budgetEffect.ForShiftsAsync(tenantId, participantId, made.Select(PlannedShift.Of).ToList(), ct);
            return warnings.Count > 0 ? warnings : null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger?.LogWarning(ex, "The budget warnings for the shifts just generated for participant {ParticipantId} could not be worked out; the result is returned without them", participantId);
            return null;
        }
    }

    private bool CallerIsAdmin => User?.IsInRole("Admin") == true || User?.IsInRole("SuperAdmin") == true;

    /// <summary>What a shift whose end is not after its start is refused with: an overnight shift is one that "ends the next day" (the phase 3 review, C1: without it the shift had a negative length and a negative price).</summary>
    private const string ShiftEndsBeforeItStartsMessage = "The shift must end after it starts. Tick 'Ends the next day' for an overnight shift.";

    /// <summary>The machine-readable code of that refusal (the dry run, a create and an update of a shift, a pattern's create and update). The screens answer it under End time and recognise it by this code, with the sentence only as their fallback, so the wording can change without breaking them.</summary>
    private const string ShiftNoLengthCode = "shift-no-length";

    /// <summary>
    /// The budget check of the candidate shift (budget phase 3), quiet when the request has no organisation to show money for. <paramref name="existingId"/> is the saved shift an edit replaces, <paramref name="status"/>
    /// the status it would be saved with. Whether the shift is routine is read from the saved shift's own pattern link, never from the request (C3).
    /// </summary>
    private async Task<ShiftBudgetOutcome> CheckBudgetAsync(Shift candidate, Guid? existingId, ShiftStatus? status, CancellationToken ct)
    {
        if (_budget is null || _tenant?.TenantId is not { } tenantId) return ShiftBudgetOutcome.Quiet;
        return await _budget.CheckAsync(new ShiftBudgetRequest(
            tenantId, candidate.ParticipantId, existingId == Guid.Empty ? null : existingId, candidate.ServiceDate, candidate.StartTime, candidate.EndTime, candidate.EndsNextDay,
            candidate.Ratio, candidate.NightType, status, CallerIsAdmin), ct);
    }

    /// <summary>
    /// Raises the Admin's review of a shift just accepted as an emergency or safety booking over budget: one open task for the shift at a time (idempotent on its source key, so a retry or a second save of
    /// the same shift never doubles it), due the provider's tomorrow, owned by the shift's organisation, and committed with the shift in the caller's own save. The first review is
    /// <c>budget-emergency:{shiftId}</c>. A review an Admin has closed is never reopened, so a further emergency on the same shift (a bigger overrun nobody has looked at) gets its own,
    /// <c>budget-emergency:{shiftId}:2</c>, then <c>:3</c>, so the shift's marker never reads "Reviewed" over an overrun that was never reviewed (the phase 3 review, C4).
    /// </summary>
    private async Task RaiseEmergencyReviewAsync(Shift shift, CancellationToken ct)
    {
        var participant = await _db.Participants.AsNoTracking().FirstAsync(p => p.Id == shift.ParticipantId, ct);
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, participant.TenantId, _clock, ct);
        var date = shift.ServiceDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var earlier = await _db.BookingTasks.AsNoTracking()
            .Where(t => t.ShiftId == shift.Id && t.TaskType == TaskType.BudgetEmergencyReview)
            .OrderBy(t => t.SourceKey!.Length).ThenBy(t => t.SourceKey)   // the keys run :2, :3 after the first, so the last is the newest
            .Select(t => new { t.SourceKey, t.Status })
            .ToListAsync(ct);
        var newest = earlier.LastOrDefault();
        var sourceKey = newest == null ? $"budget-emergency:{shift.Id}"
            : newest.Status is TaskItemStatus.Completed or TaskItemStatus.Cancelled ? $"budget-emergency:{shift.Id}:{earlier.Count + 1}"
            : newest.SourceKey!;
        await _obligationTasks.EnsureAsync(new Odip.Application.Interfaces.ObligationTaskSpec(
            SourceKey: sourceKey,
            Type: TaskType.BudgetEmergencyReview,
            Title: string.Create(CultureInfo.InvariantCulture, $"Review emergency shift over budget: {participant.FullName} on {shift.ServiceDate:d MMM yyyy}"),
            DueDate: today.AddDays(1),
            LinkTo: $"/rostering?date={date}&participant={participant.Id}",
            ShiftId: shift.Id,
            TenantId: participant.TenantId), ct);
    }

    /// <summary>Staff-level compliance for the board row, evaluated once at the week's Monday — independent of any specific shift's findings.</summary>
    private static (RosterComplianceLevel Level, List<string> Notes) ComputeCompliance(User staff, DateOnly weekStart)
    {
        // Blocked only for a screening that has genuinely lapsed — a verified regulatory
        // prohibition. A screening that simply hasn't been recorded yet is a records gap, not
        // a verdict on the worker, and only downgrades to Warning below (mirrors WSC_EXPIRED
        // vs WSC_MISSING in RosterConflictService).
        if (staff.WorkerScreeningExpiryDate is { } expiry && expiry < weekStart)
        {
            return (RosterComplianceLevel.Blocked, new List<string>
            {
                $"{staff.FullName}'s worker screening expired {expiry.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}."
            });
        }

        var notes = new List<string>();
        if (staff.WorkerScreeningExpiryDate is null)
            notes.Add($"{staff.FullName} has no worker screening recorded — confirm it before the shift.");
        if (staff.IsFirstAidQualified && staff.FirstAidExpiryDate is { } firstAid && firstAid < weekStart)
            notes.Add($"{staff.FullName}'s first aid certificate expired {firstAid.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}.");
        if (staff.IsDriverEligible && staff.DriverLicenceExpiryDate is { } licence && licence < weekStart)
            notes.Add($"{staff.FullName}'s driver licence expired {licence.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}.");
        if (staff.IsManualHandlingCompetent && staff.ManualHandlingExpiryDate is { } manualHandling && manualHandling < weekStart)
            notes.Add($"{staff.FullName}'s manual handling competency expired {manualHandling.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}.");
        if (staff.IsMedicationCompetent && staff.MedicationCompetencyExpiryDate is { } medication && medication < weekStart)
            notes.Add($"{staff.FullName}'s medication competency expired {medication.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}.");

        return notes.Count > 0 ? (RosterComplianceLevel.Warning, notes) : (RosterComplianceLevel.Ok, notes);
    }
}
