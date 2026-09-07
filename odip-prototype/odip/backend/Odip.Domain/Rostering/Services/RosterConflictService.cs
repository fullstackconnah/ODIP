using System.Globalization;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Domain.Rostering.Services;

/// <summary>
/// One finding produced by <see cref="RosterConflictService"/> against a single candidate shift.
/// <see cref="RequiresReason"/> — new this feature — is true for a finding the Blocking/Warning
/// gate demands a non-empty override reason for; false means the finding still gets recorded in
/// AcknowledgedFindingCodes when the write saves, but no reason is required (e.g. a merely
/// pending leave request is a softer signal than an already-approved one).
/// </summary>
public sealed record RosterFinding(string Code, RosterFindingSeverity Severity, string Message, bool RequiresReason = false);

/// <summary>
/// Everything <see cref="RosterConflictService.Check"/> needs about the candidate's staff,
/// participant, and surrounding roster to evaluate every rule in one pass. Callers assemble
/// this from Infrastructure queries — the service itself does no I/O.
/// </summary>
/// <param name="Staff">The staff member being considered for the candidate shift.</param>
/// <param name="Participant">The participant the candidate shift is for.</param>
/// <param name="StaffShiftsInWeek">This staff member's other shifts in the candidate's week, excluding the candidate itself.</param>
/// <param name="ParticipantShiftsOnDate">Other shifts already rostered for this participant on the candidate's <see cref="Shift.ServiceDate"/>, excluding the candidate — used to judge whether a 2:1 slot is actually covered.</param>
/// <param name="TripAssignments">This staff member's trip assignments overlapping the candidate's <see cref="Shift.ServiceDate"/>.</param>
/// <param name="Availability">This staff member's unavailability windows (leave, recurring rules, legacy StaffAvailability rows) relevant to the candidate's window — see <see cref="Infrastructure.Rostering.StaffUnavailabilityQuery"/>.</param>
/// <param name="Compatibility">The staff-participant compatibility level (Allowed when no matrix row exists).</param>
/// <param name="WeeklyHoursThreshold">Weekly hours above which <c>OVER_HOURS</c> fires. See <see cref="RosterConflictService.DefaultWeeklyHoursThreshold"/>.</param>
public sealed record RosterCheckContext(
    User Staff,
    Participant Participant,
    IReadOnlyList<Shift> StaffShiftsInWeek,
    IReadOnlyList<Shift> ParticipantShiftsOnDate,
    IReadOnlyList<StaffAssignment> TripAssignments,
    IReadOnlyList<UnavailabilityWindow> Availability,
    CompatibilityLevel Compatibility,
    decimal WeeklyHoursThreshold);

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
    public const string CompatibilityExcluded = "COMPATIBILITY_EXCLUDED";
    public const string CredentialExpired = "CREDENTIAL_EXPIRED";
    public const string CompetencyMissing = "COMPETENCY_MISSING";
    public const string RatioShortfall = "RATIO_SHORTFALL";
    public const string OverHours = "OVER_HOURS";

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
    {
        var expiry = ctx.Staff.WorkerScreeningExpiryDate;
        if (expiry is null)
        {
            findings.Add(new RosterFinding(WscMissing, RosterFindingSeverity.Warning,
                $"{ctx.Staff.FullName} has no worker screening recorded — confirm it before the shift."));
            return;
        }

        if (expiry.Value < candidate.ServiceDate)
        {
            findings.Add(new RosterFinding(WscExpired, RosterFindingSeverity.Blocking,
                $"{ctx.Staff.FullName}'s worker screening expired {Fmt(expiry.Value)} — cannot roster."));
        }
    }

    private static void CheckDoubleBookedShift(Shift candidate, RosterCheckContext ctx, List<RosterFinding> findings)
    {
        var candidateWindow = ToWindow(candidate.ServiceDate, candidate.StartTime, candidate.EndTime, candidate.EndsNextDay);

        foreach (var other in ctx.StaffShiftsInWeek)
        {
            if (other.Id == candidate.Id)
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
    {
        foreach (var assignment in ctx.TripAssignments)
        {
            if (assignment.AssignmentStart <= candidate.ServiceDate && candidate.ServiceDate <= assignment.AssignmentEnd)
            {
                findings.Add(new RosterFinding(DoubleBookedTrip, RosterFindingSeverity.Warning,
                    $"{ctx.Staff.FullName} is assigned to a trip covering {Fmt(candidate.ServiceDate)}."));
            }
        }
    }

    /// <summary>
    /// One finding per overlapping <see cref="UnavailabilityWindow"/>, discriminated on
    /// <see cref="UnavailabilityKind"/>: an already-Approved leave request or recurring rule is a
    /// hard Warning that demands a reason (STAFF_ON_LEAVE / STAFF_RECURRING_UNAVAILABLE); a
    /// merely Pending leave request is a softer signal that needs none (STAFF_LEAVE_PENDING); a
    /// legacy StaffAvailability Unavailable/Training row keeps the original STAFF_UNAVAILABLE
    /// code and reason-not-required behaviour, unchanged from before this feature.
    /// </summary>
    private static void CheckStaffUnavailable(Shift candidate, RosterCheckContext ctx, List<RosterFinding> findings)
    {
        var candidateWindow = ToWindow(candidate.ServiceDate, candidate.StartTime, candidate.EndTime, candidate.EndsNextDay);

        foreach (var window in ctx.Availability)
        {
            if (window.Start >= candidateWindow.End || candidateWindow.Start >= window.End)
                continue;

            switch (window.Kind)
            {
                case UnavailabilityKind.Legacy:
                    findings.Add(new RosterFinding(StaffUnavailable, RosterFindingSeverity.Warning,
                        $"{ctx.Staff.FullName} is marked unavailable for part of {Fmt(candidate.ServiceDate)}."));
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
                        $"{ctx.Staff.FullName} is recurringly unavailable {window.Start:dddd} {window.Start:HH:mm}-{window.End:HH:mm}.",
                        RequiresReason: true));
                    break;
            }
        }
    }

    private static void CheckCompatibility(RosterCheckContext ctx, List<RosterFinding> findings)
    {
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
        if (candidate.Ratio != SupportRatio.TwoToOne) return;

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
                $"{ctx.Participant.FullName}'s 2:1 shift on {Fmt(candidate.ServiceDate)} has only " +
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
