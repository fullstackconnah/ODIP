using System.Globalization;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Domain.Rostering.Services;

/// <summary>
/// One finding produced by <see cref="RosterConflictService"/> against a single candidate shift.
/// <see cref="RequiresReason"/> — new this feature — is true for a finding the Blocking/Warning
/// gate demands a non-empty override reason for; false means the finding still gets recorded in
/// AcknowledgedFindingCodes when the write saves, but no reason is required (e.g. a merely
/// pending leave request is a softer signal than an already-approved one). <see cref="Budget"/> is set only on the budget findings (budget phase 3): the figures the message was worked out from.
/// </summary>
public sealed record RosterFinding(string Code, RosterFindingSeverity Severity, string Message, bool RequiresReason = false, Odip.Domain.Funding.BudgetFindingFigures? Budget = null);

/// <summary>One public holiday relevant to the context's date range, used by
/// <see cref="RosterConflictService.Check"/> to fire <see cref="RosterConflictService.PublicHoliday"/>
/// when the candidate shift's <see cref="Shift.ServiceDate"/> matches. Callers load these from
/// <c>PublicHoliday</c> rows the same way <c>ClaimGenerationService</c> does (state-scoped via
/// ProviderSettings), then map to this lightweight record so the pure domain layer never sees EF entities.</summary>
public sealed record PublicHolidayRef(DateOnly Date, string Name);

/// <summary>
/// Everything <see cref="RosterConflictService.Check"/> needs about the candidate's staff,
/// participant, and surrounding roster to evaluate every rule in one pass. Callers assemble
/// this from Infrastructure queries — the service itself does no I/O.
/// </summary>
/// <param name="Staff">The staff member being considered for the candidate shift.</param>
/// <param name="Participant">The participant the candidate shift is for. Null for a trip-assignment
/// candidate (<see cref="RosterConflictService.CheckStaffAssignment"/>) — participant-scoped rules are skipped
/// entirely in that path, and <see cref="RosterConflictService"/>'s CheckCompatibility/CheckCompetencyMissing/
/// CheckRatioShortfall all no-op on a null Participant so <see cref="RosterConflictService.Check"/> stays
/// safe if it's ever called with one too.</param>
/// <param name="StaffShiftsInWeek">This staff member's other shifts in the candidate's week, excluding the candidate itself.</param>
/// <param name="ParticipantShiftsOnDate">Other shifts already rostered for this participant on the candidate's <see cref="Shift.ServiceDate"/>, excluding the candidate — used to judge whether a 2:1 slot is actually covered.</param>
/// <param name="TripAssignments">This staff member's trip assignments overlapping the candidate's <see cref="Shift.ServiceDate"/>.</param>
/// <param name="Availability">This staff member's unavailability windows (leave, recurring rules, legacy StaffAvailability rows) relevant to the candidate's window — see <see cref="Infrastructure.Rostering.StaffUnavailabilityQuery"/>.</param>
/// <param name="Compatibility">The staff-participant compatibility level (Allowed when no matrix row exists).</param>
/// <param name="WeeklyHoursThreshold">Weekly hours above which <c>OVER_HOURS</c> fires. See <see cref="RosterConflictService.DefaultWeeklyHoursThreshold"/>.</param>
/// <param name="PublicHolidays">Public holidays relevant to the candidate's date range, used by
/// <see cref="RosterConflictService.Check"/> to fire <see cref="RosterConflictService.PublicHoliday"/>.
/// Last positional parameter so existing callers keep compiling; null and an empty list are both
/// treated as "no holidays" — see <see cref="RosterConflictService.Check"/>.</param>
public sealed record RosterCheckContext(
    User Staff,
    Participant? Participant,
    IReadOnlyList<Shift> StaffShiftsInWeek,
    IReadOnlyList<Shift> ParticipantShiftsOnDate,
    IReadOnlyList<StaffAssignment> TripAssignments,
    IReadOnlyList<UnavailabilityWindow> Availability,
    CompatibilityLevel Compatibility,
    decimal WeeklyHoursThreshold,
    IReadOnlyList<PublicHolidayRef>? PublicHolidays = null);

/// <summary>One other (non-cancelled) trip window this vehicle already covers, used by
/// <see cref="RosterConflictService.CheckVehicleAssignment"/> to detect an overlap. AssignmentId
/// lets the candidate's own prior row be excluded on an update, the same way
/// <see cref="RosterCheckContext.TripAssignments"/> works for staff.</summary>
public sealed record VehicleAssignmentWindow(Guid AssignmentId, DateOnly Start, DateOnly End);

/// <summary>
/// Everything <see cref="RosterConflictService.CheckVehicleAssignment"/> needs to evaluate the
/// vehicle rules against a candidate <see cref="VehicleAssignment"/>. Callers assemble this from
/// Infrastructure queries — the service itself does no I/O.
/// </summary>
/// <param name="Vehicle">The vehicle being considered for the candidate trip.</param>
/// <param name="OtherAssignments">This vehicle's other, non-cancelled/unavailable trip windows.</param>
/// <param name="ParticipantCount">Confirmed participants booked on the candidate's trip.</param>
/// <param name="WheelchairCount">Confirmed participants on the candidate's trip who require a wheelchair position.</param>
public sealed record VehicleCheckContext(
    Vehicle Vehicle,
    IReadOnlyList<VehicleAssignmentWindow> OtherAssignments,
    int ParticipantCount,
    int WheelchairCount);

/// <summary>
/// Pure domain rule engine for rostering a candidate <see cref="Shift"/>. Every finding is
/// Warning except <see cref="WscExpired"/>, the one regulatory hard stop — a worker screening
/// verified to have lapsed against the shift's <see cref="Shift.ServiceDate"/>. A screening that
/// simply hasn't been recorded yet (<see cref="WscMissing"/>) is a records gap, not a verdict on
/// the worker, and is only a Warning like everything else the coordinator may override by
/// supplying a reason. Takes data in, returns findings; no EF, no I/O, no system clock reads
/// (the candidate's own <see cref="Shift.ServiceDate"/> stands in for "today" throughout).
/// </summary>
public sealed class RosterConflictService
{
    /// <summary>Default weekly hours threshold used by <see cref="RosterCheckContext.WeeklyHoursThreshold"/> callers.</summary>
    public const decimal DefaultWeeklyHoursThreshold = 38m;

    public const string WscExpired = "WSC_EXPIRED";
    public const string WscMissing = "WSC_MISSING";
    public const string DoubleBookedShift = "DOUBLE_BOOKED_SHIFT";
    public const string DoubleBookedTrip = "DOUBLE_BOOKED_TRIP";
    public const string StaffUnavailable = "STAFF_UNAVAILABLE";
    public const string StaffOnLeave = "STAFF_ON_LEAVE";
    public const string StaffRecurringUnavailable = "STAFF_RECURRING_UNAVAILABLE";
    public const string StaffLeavePending = "STAFF_LEAVE_PENDING";
    public const string StaffRecurringPending = "STAFF_RECURRING_PENDING";
    public const string CompatibilityExcluded = "COMPATIBILITY_EXCLUDED";
    public const string CredentialExpired = "CREDENTIAL_EXPIRED";
    public const string CompetencyMissing = "COMPETENCY_MISSING";
    public const string RatioShortfall = "RATIO_SHORTFALL";
    public const string OverHours = "OVER_HOURS";
    public const string VehicleDoubleBooked = "VEHICLE_DOUBLE_BOOKED";
    public const string VehicleOverSeats = "VEHICLE_OVER_SEATS";
    public const string VehicleOverWheelchair = "VEHICLE_OVER_WHEELCHAIR";
    public const string PublicHoliday = "PUBLIC_HOLIDAY";

    /// <summary>Runs every rule against <paramref name="candidate"/> and returns every finding that fires.</summary>
    public IReadOnlyList<RosterFinding> Check(Shift candidate, RosterCheckContext ctx)
    {
        ArgumentNullException.ThrowIfNull(candidate);
        ArgumentNullException.ThrowIfNull(ctx);

        var findings = new List<RosterFinding>();

        CheckWorkerScreening(candidate, ctx, findings);
        CheckDoubleBookedShift(candidate, ctx, findings);
        CheckDoubleBookedTrip(candidate, ctx, findings);
        CheckStaffUnavailable(candidate, ctx, findings);
        CheckCompatibility(ctx, findings);
        CheckCredentialExpired(candidate, ctx, findings);
        CheckCompetencyMissing(candidate, ctx, findings);
        CheckRatioShortfall(candidate, ctx, findings);
        CheckOverHours(candidate, ctx, findings);
        CheckPublicHoliday(candidate, ctx, findings);

        return findings;
    }

    /// <summary>
    /// Trip-side analogue of <see cref="Check(Shift, RosterCheckContext)"/> for a candidate
    /// StaffAssignment: WSC, double-booked-shift, double-booked-trip and staff-unavailability rules
    /// only — participant-scoped rules (compatibility, credential/competency, ratio, over-hours) are
    /// skipped outright rather than merely tolerated, since a trip assignment carries no participant
    /// at all. See docs/specs/2026-09-07-staff-leave-unavailability-design.md §3. Trip windows are
    /// whole days: AssignmentStart 00:00 through the day AFTER AssignmentEnd at 00:00 (AssignmentEnd
    /// itself is inclusive). ctx.Participant is expected to be null — build the context the same way
    /// StaffAssignmentsController.CheckAsync does.
    /// <see cref="PublicHoliday"/> is deliberately NOT evaluated here (connection-map item 8): a
    /// trip assignment spans multiple days and the claim already prices any public holiday inside
    /// that span via <c>ClaimGenerationService</c>/<c>DayTypeResolver</c> — re-surfacing it as a
    /// per-shift roster warning would be noise on a candidate that isn't a single-day Shift anyway.
    /// </summary>
    public IReadOnlyList<RosterFinding> CheckStaffAssignment(
        DateOnly assignmentStart, DateOnly assignmentEnd, Guid excludeAssignmentId, RosterCheckContext ctx)
    {
        ArgumentNullException.ThrowIfNull(ctx);

        var findings = new List<RosterFinding>();
        var window = (Start: assignmentStart.ToDateTime(TimeOnly.MinValue), End: assignmentEnd.AddDays(1).ToDateTime(TimeOnly.MinValue));

        CheckWorkerScreeningForDate(assignmentStart, ctx, findings);
        CheckDoubleBookedShiftForWindow(window, Guid.Empty, ctx, findings);
        CheckDoubleBookedTripForRange(assignmentStart, assignmentEnd, excludeAssignmentId, ctx, findings);
        CheckStaffUnavailableForWindow(window, assignmentStart, ctx, findings);

        return findings;
    }

    /// <summary>
    /// Vehicle-side analogue of <see cref="Check(Shift, RosterCheckContext)"/>/
    /// <see cref="CheckStaffAssignment"/> for a candidate <see cref="VehicleAssignment"/>. Exactly
    /// three rules per the 2026-09-09 audit ruling — servicing windows, registration and insurance
    /// expiry were explicitly rejected and must not be added here:
    /// 1. The same vehicle assigned to two trips whose time windows overlap — Blocking.
    /// 2. Participants on the trip exceed the vehicle's <see cref="Vehicle.TotalSeats"/> — RequiresReason.
    /// 3. Wheelchair users on the trip exceed the vehicle's <see cref="Vehicle.WheelchairPositions"/> — RequiresReason.
    /// excludeAssignmentId is the assignment's own prior Id on an update (or Guid.Empty for a
    /// brand-new candidate / the dry-run check), so an assignment never conflicts with itself.
    /// </summary>
    public IReadOnlyList<RosterFinding> CheckVehicleAssignment(
        DateOnly tripStart, DateOnly tripEnd, Guid excludeAssignmentId, VehicleCheckContext ctx)
    {
        ArgumentNullException.ThrowIfNull(ctx);

        var findings = new List<RosterFinding>();
        var vehicle = ctx.Vehicle;

        foreach (var other in ctx.OtherAssignments)
        {
            if (other.AssignmentId == excludeAssignmentId)
                continue;

            if (other.Start <= tripEnd && tripStart <= other.End)
            {
                findings.Add(new RosterFinding(VehicleDoubleBooked, RosterFindingSeverity.Blocking,
                    $"{vehicle.VehicleName} is already assigned to a trip covering {Fmt(other.Start)}-{Fmt(other.End)}."));
            }
        }

        if (ctx.ParticipantCount > vehicle.TotalSeats)
        {
            findings.Add(new RosterFinding(VehicleOverSeats, RosterFindingSeverity.Warning,
                $"{vehicle.VehicleName} seats {vehicle.TotalSeats} but this trip has {ctx.ParticipantCount} participants.",
                RequiresReason: true));
        }

        if (ctx.WheelchairCount > vehicle.WheelchairPositions)
        {
            findings.Add(new RosterFinding(VehicleOverWheelchair, RosterFindingSeverity.Warning,
                $"{vehicle.VehicleName} has {vehicle.WheelchairPositions} wheelchair position(s) but this trip has {ctx.WheelchairCount} wheelchair users.",
                RequiresReason: true));
        }

        return findings;
    }

    /// <summary>
    /// Two distinct facts get two distinct findings. A null
    /// <see cref="Staff.WorkerScreeningExpiryDate"/> means nobody has entered the number yet —
    /// a data gap, not a verdict on the worker — and fires <see cref="WscMissing"/> (Warning).
    /// An expiry date earlier than the candidate's <see cref="Shift.ServiceDate"/> means the
    /// worker is verifiably unscreened — a regulatory prohibition — and fires
    /// <see cref="WscExpired"/> (Blocking), the only Blocking finding this engine produces.
    /// </summary>
    private static void CheckWorkerScreening(Shift candidate, RosterCheckContext ctx, List<RosterFinding> findings)
        => CheckWorkerScreeningForDate(candidate.ServiceDate, ctx, findings);

    /// <summary>Core WSC rule, decoupled from Shift so CheckStaffAssignment can reuse it against an assignment's start date.</summary>
    private static void CheckWorkerScreeningForDate(DateOnly referenceDate, RosterCheckContext ctx, List<RosterFinding> findings)
    {
        var expiry = ctx.Staff.WorkerScreeningExpiryDate;
        if (expiry is null)
        {
            findings.Add(new RosterFinding(WscMissing, RosterFindingSeverity.Warning,
                $"{ctx.Staff.FullName} has no worker screening recorded — confirm it before the shift."));
            return;
        }

        if (expiry.Value < referenceDate)
        {
            findings.Add(new RosterFinding(WscExpired, RosterFindingSeverity.Blocking,
                $"{ctx.Staff.FullName}'s worker screening expired {Fmt(expiry.Value)} — cannot roster."));
        }
    }

    private static void CheckDoubleBookedShift(Shift candidate, RosterCheckContext ctx, List<RosterFinding> findings)
    {
        var candidateWindow = ToWindow(candidate.ServiceDate, candidate.StartTime, candidate.EndTime, candidate.EndsNextDay);
        CheckDoubleBookedShiftForWindow(candidateWindow, candidate.Id, ctx, findings);
    }

    /// <summary>Core overlap rule, decoupled from Shift so CheckStaffAssignment can reuse it — excludeShiftId
    /// is Guid.Empty for a trip-assignment candidate (nothing to exclude, it isn't itself a Shift row).</summary>
    private static void CheckDoubleBookedShiftForWindow((DateTime Start, DateTime End) candidateWindow, Guid excludeShiftId, RosterCheckContext ctx, List<RosterFinding> findings)
    {
        foreach (var other in ctx.StaffShiftsInWeek)
        {
            if (other.Id == excludeShiftId)
                continue;

            var otherWindow = ToWindow(other.ServiceDate, other.StartTime, other.EndTime, other.EndsNextDay);
            if (Overlaps(candidateWindow, otherWindow))
            {
                findings.Add(new RosterFinding(DoubleBookedShift, RosterFindingSeverity.Warning,
                    $"{ctx.Staff.FullName} already has a shift on {Fmt(other.ServiceDate)} that overlaps this one."));
            }
        }
    }

    private static void CheckDoubleBookedTrip(Shift candidate, RosterCheckContext ctx, List<RosterFinding> findings)
        => CheckDoubleBookedTripForRange(candidate.ServiceDate, candidate.ServiceDate, Guid.Empty, ctx, findings);

    /// <summary>Core overlap rule, decoupled from Shift so CheckStaffAssignment can reuse it against a
    /// multi-day AssignmentStart..AssignmentEnd range; excludeAssignmentId skips the assignment's own
    /// prior row on an update. For the Shift path rangeStart == rangeEnd, so the message text is
    /// byte-identical to the pre-extraction version.</summary>
    private static void CheckDoubleBookedTripForRange(DateOnly rangeStart, DateOnly rangeEnd, Guid excludeAssignmentId, RosterCheckContext ctx, List<RosterFinding> findings)
    {
        foreach (var assignment in ctx.TripAssignments)
        {
            if (assignment.Id == excludeAssignmentId)
                continue;

            if (assignment.AssignmentStart <= rangeEnd && rangeStart <= assignment.AssignmentEnd)
            {
                var when = rangeStart == rangeEnd ? Fmt(rangeStart) : $"{Fmt(rangeStart)}-{Fmt(rangeEnd)}";
                findings.Add(new RosterFinding(DoubleBookedTrip, RosterFindingSeverity.Warning,
                    $"{ctx.Staff.FullName} is assigned to a trip covering {when}."));
            }
        }
    }

    /// <summary>
    /// One finding per overlapping <see cref="UnavailabilityWindow"/>, discriminated on
    /// <see cref="UnavailabilityKind"/>: an already-Approved leave request or recurring rule is a
    /// hard Warning that demands a reason (STAFF_ON_LEAVE / STAFF_RECURRING_UNAVAILABLE); a
    /// merely Pending leave request or Pending recurring rule is a softer signal that needs none
    /// (STAFF_LEAVE_PENDING / STAFF_RECURRING_PENDING — the 2026-09-09 audit ruling requires a
    /// pending recurring rule get exactly the same treatment a pending leave request already
    /// gets, never the Approved rule's Blocking-adjacent RequiresReason treatment); a legacy
    /// StaffAvailability Unavailable/Training row keeps the original STAFF_UNAVAILABLE code and
    /// reason-not-required behaviour, unchanged from before this feature.
    /// </summary>
    private static void CheckStaffUnavailable(Shift candidate, RosterCheckContext ctx, List<RosterFinding> findings)
    {
        var candidateWindow = ToWindow(candidate.ServiceDate, candidate.StartTime, candidate.EndTime, candidate.EndsNextDay);
        CheckStaffUnavailableForWindow(candidateWindow, candidate.ServiceDate, ctx, findings);
    }

    /// <summary>Core rule, decoupled from Shift so CheckStaffAssignment can reuse it. referenceDate is
    /// only used in the Legacy-kind message text (the ApprovedLeave/PendingLeave/RecurringRule
    /// messages don't need one) — for the Shift path this is candidate.ServiceDate, byte-identical to
    /// the pre-extraction message; for the trip path this is the assignment's start date.</summary>
    private static void CheckStaffUnavailableForWindow((DateTime Start, DateTime End) candidateWindow, DateOnly referenceDate, RosterCheckContext ctx, List<RosterFinding> findings)
    {
        foreach (var window in ctx.Availability)
        {
            if (window.Start >= candidateWindow.End || candidateWindow.Start >= window.End)
                continue;

            switch (window.Kind)
            {
                case UnavailabilityKind.Legacy:
                    findings.Add(new RosterFinding(StaffUnavailable, RosterFindingSeverity.Warning,
                        $"{ctx.Staff.FullName} is marked unavailable for part of {Fmt(referenceDate)}."));
                    break;
                case UnavailabilityKind.ApprovedLeave:
                    findings.Add(new RosterFinding(StaffOnLeave, RosterFindingSeverity.Warning,
                        $"{ctx.Staff.FullName}'s approved leave covers this window — cannot roster without a reason.",
                        RequiresReason: true));
                    break;
                case UnavailabilityKind.PendingLeave:
                    findings.Add(new RosterFinding(StaffLeavePending, RosterFindingSeverity.Warning,
                        $"{ctx.Staff.FullName} has a pending leave request covering this window."));
                    break;
                case UnavailabilityKind.RecurringRule:
                    findings.Add(new RosterFinding(StaffRecurringUnavailable, RosterFindingSeverity.Warning,
                        $"{ctx.Staff.FullName} is recurringly unavailable {window.Start.ToString("dddd HH:mm", CultureInfo.InvariantCulture)}-{window.End.ToString("HH:mm", CultureInfo.InvariantCulture)}.",
                        RequiresReason: true));
                    break;
                case UnavailabilityKind.PendingRecurringRule:
                    findings.Add(new RosterFinding(StaffRecurringPending, RosterFindingSeverity.Warning,
                        $"{ctx.Staff.FullName} has a pending recurring unavailability request covering {window.Start.ToString("dddd HH:mm", CultureInfo.InvariantCulture)}-{window.End.ToString("HH:mm", CultureInfo.InvariantCulture)}."));
                    break;
            }
        }
    }

    private static void CheckCompatibility(RosterCheckContext ctx, List<RosterFinding> findings)
    {
        if (ctx.Participant is null) return;

        if (ctx.Compatibility == CompatibilityLevel.Excluded)
        {
            findings.Add(new RosterFinding(CompatibilityExcluded, RosterFindingSeverity.Warning,
                $"{ctx.Staff.FullName} is marked Excluded for {ctx.Participant.FullName}."));
        }
    }

    private static void CheckCredentialExpired(Shift candidate, RosterCheckContext ctx, List<RosterFinding> findings)
    {
        var staff = ctx.Staff;
        var serviceDate = candidate.ServiceDate;

        if (staff.IsFirstAidQualified && staff.FirstAidExpiryDate is { } firstAid && firstAid < serviceDate)
            findings.Add(new RosterFinding(CredentialExpired, RosterFindingSeverity.Warning,
                $"{staff.FullName}'s first aid certificate expired {Fmt(firstAid)}."));

        if (staff.IsDriverEligible && staff.DriverLicenceExpiryDate is { } licence && licence < serviceDate)
            findings.Add(new RosterFinding(CredentialExpired, RosterFindingSeverity.Warning,
                $"{staff.FullName}'s driver licence expired {Fmt(licence)}."));

        if (staff.IsManualHandlingCompetent && staff.ManualHandlingExpiryDate is { } manualHandling && manualHandling < serviceDate)
            findings.Add(new RosterFinding(CredentialExpired, RosterFindingSeverity.Warning,
                $"{staff.FullName}'s manual handling competency expired {Fmt(manualHandling)}."));

        if (staff.IsMedicationCompetent && staff.MedicationCompetencyExpiryDate is { } medication && medication < serviceDate)
            findings.Add(new RosterFinding(CredentialExpired, RosterFindingSeverity.Warning,
                $"{staff.FullName}'s medication competency expired {Fmt(medication)}."));
    }

    /// <summary>
    /// Fires when the shift's support need outstrips the candidate staff member's flagged
    /// competencies. Mapping per the M4 design brief, derived from fields that already exist
    /// on <see cref="Entities.Participant"/> and <see cref="Entities.Staff"/>:
    /// overnight support requires <see cref="User.IsOvernightEligible"/>; hoist, standing
    /// machine or wheelchair mobility requires <see cref="User.IsManualHandlingCompetent"/>;
    /// high or intensive support requires <see cref="User.IsFirstAidQualified"/>.
    /// </summary>
    private static void CheckCompetencyMissing(Shift candidate, RosterCheckContext ctx, List<RosterFinding> findings)
    {
        var staff = ctx.Staff;
        var participant = ctx.Participant;
        if (participant is null) return;

        if ((participant.OvernightSupport != OvernightSupportType.None || candidate.NightType != SleepoverType.None)
            && !staff.IsOvernightEligible)
        {
            findings.Add(new RosterFinding(CompetencyMissing, RosterFindingSeverity.Warning,
                $"{staff.FullName} is not overnight-eligible but this shift requires overnight support for {participant.FullName}."));
        }

        if ((participant.RequiresHoist || participant.RequiresStandingMachine || participant.MobilityAidWheelchair)
            && !staff.IsManualHandlingCompetent)
        {
            findings.Add(new RosterFinding(CompetencyMissing, RosterFindingSeverity.Warning,
                $"{staff.FullName} is not manual handling competent but {participant.FullName} requires it."));
        }

        if ((participant.IsHighSupport || participant.IsIntensiveSupport) && !staff.IsFirstAidQualified)
        {
            findings.Add(new RosterFinding(CompetencyMissing, RosterFindingSeverity.Warning,
                $"{staff.FullName} is not first aid qualified but {participant.FullName} requires high or intensive support."));
        }
    }

    /// <summary>
    /// A <see cref="Shift"/> row carries exactly one <see cref="Shift.UserId"/>, so 2:1 coverage
    /// is modelled as two overlapping Shift rows for the same participant and date, each with its
    /// own staff member — <see cref="RosterCheckContext.ParticipantShiftsOnDate"/> supplies the
    /// sibling shifts to look for. Fires whenever fewer than two distinct, non-null staff IDs
    /// cover the candidate's time window: an unfilled sibling, a sibling in a different time
    /// window, or the same staff member double-booked onto both all still leave the slot short.
    /// </summary>
    private static void CheckRatioShortfall(Shift candidate, RosterCheckContext ctx, List<RosterFinding> findings)
    {
        var participant = ctx.Participant;
        if (candidate.Ratio != SupportRatio.TwoToOne || participant is null) return;

        var window = ToWindow(candidate.ServiceDate, candidate.StartTime, candidate.EndTime, candidate.EndsNextDay);

        var covering = ctx.ParticipantShiftsOnDate
            .Where(s => Overlaps(window, ToWindow(s.ServiceDate, s.StartTime, s.EndTime, s.EndsNextDay)))
            .Select(s => s.UserId)
            .Append(candidate.UserId)
            .Where(id => id.HasValue)
            .Select(id => id!.Value)
            .Distinct()
            .Count();

        if (covering < 2)
        {
            findings.Add(new RosterFinding(RatioShortfall, RosterFindingSeverity.Warning,
                $"{participant.FullName}'s 2:1 shift on {Fmt(candidate.ServiceDate)} has only " +
                $"{covering} of 2 support workers rostered."));
        }
    }

    private static void CheckOverHours(Shift candidate, RosterCheckContext ctx, List<RosterFinding> findings)
    {
        var total = ctx.StaffShiftsInWeek.Sum(s => s.DurationHours) + candidate.DurationHours;
        if (total > ctx.WeeklyHoursThreshold)
        {
            findings.Add(new RosterFinding(OverHours, RosterFindingSeverity.Warning,
                $"{ctx.Staff.FullName}'s rostered hours for the week ({total:0.##}h) exceed the {ctx.WeeklyHoursThreshold:0.##}h threshold."));
        }
    }

    /// <summary>
    /// Fires when the candidate shift's <see cref="Shift.ServiceDate"/> matches a date in
    /// <see cref="RosterCheckContext.PublicHolidays"/> — an overnight shift (<see cref="Shift.EndsNextDay"/>)
    /// only checks its ServiceDate, not the day it ends on, matching how a Shift is a single-day
    /// record everywhere else in this service. Never RequiresReason: a public holiday is
    /// informational for the coordinator, not a conflict to resolve. Not called from
    /// <see cref="CheckStaffAssignment"/> — see that method's summary for why.
    /// </summary>
    private static void CheckPublicHoliday(Shift candidate, RosterCheckContext ctx, List<RosterFinding> findings)
    {
        var holiday = ctx.PublicHolidays?.FirstOrDefault(h => h.Date == candidate.ServiceDate);
        if (holiday is null) return;

        var when = candidate.ServiceDate.ToString("ddd d MMM", CultureInfo.InvariantCulture);
        findings.Add(new RosterFinding(PublicHoliday, RosterFindingSeverity.Warning,
            $"{when} is a public holiday ({holiday.Name}).", RequiresReason: false));
    }

    private static (DateTime Start, DateTime End) ToWindow(DateOnly serviceDate, TimeOnly start, TimeOnly end, bool endsNextDay)
    {
        var startDt = serviceDate.ToDateTime(start);
        var endDate = endsNextDay ? serviceDate.AddDays(1) : serviceDate;
        var endDt = endDate.ToDateTime(end);
        return (startDt, endDt);
    }

    private static bool Overlaps((DateTime Start, DateTime End) a, (DateTime Start, DateTime End) b) =>
        a.Start < b.End && b.Start < a.End;

    private static string Fmt(DateOnly date) => date.ToString("d MMM yyyy", CultureInfo.InvariantCulture);
}
