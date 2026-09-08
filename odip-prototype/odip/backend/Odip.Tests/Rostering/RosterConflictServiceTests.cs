using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Xunit;

namespace Odip.Tests.Rostering;

public class RosterConflictServiceTests
{
    private static readonly Guid TenantId = Guid.NewGuid();
    private static readonly DateOnly ServiceDate = new(2026, 8, 24); // Monday

    // ── Helpers ──────────────────────────────────────────────

    private static User CompliantStaff() => new()
    {
        Id = Guid.NewGuid(),
        TenantId = TenantId,
        FirstName = "Ben",
        LastName = "Turner",
        WorkerScreeningNumber = "WSC-123",
        WorkerScreeningExpiryDate = new DateOnly(2027, 1, 1),
        IsFirstAidQualified = true,
        FirstAidExpiryDate = new DateOnly(2027, 1, 1),
        IsDriverEligible = true,
        DriverLicenceExpiryDate = new DateOnly(2027, 1, 1),
        IsManualHandlingCompetent = true,
        ManualHandlingExpiryDate = new DateOnly(2027, 1, 1),
        IsMedicationCompetent = true,
        MedicationCompetencyExpiryDate = new DateOnly(2027, 1, 1),
        IsOvernightEligible = true,
    };

    private static Participant CompliantParticipant() => new()
    {
        Id = Guid.NewGuid(),
        TenantId = TenantId,
        FirstName = "Amy",
        LastName = "Ng",
    };

    private static Shift CandidateShift(
        User staff,
        Participant participant,
        DateOnly? serviceDate = null,
        TimeOnly? start = null,
        TimeOnly? end = null,
        bool endsNextDay = false,
        SupportRatio ratio = SupportRatio.OneToOne,
        SleepoverType nightType = SleepoverType.None) => new()
    {
        Id = Guid.NewGuid(),
        TenantId = TenantId,
        ParticipantId = participant.Id,
        Participant = participant,
        UserId = staff.Id,
        User = staff,
        ServiceDate = serviceDate ?? ServiceDate,
        StartTime = start ?? new TimeOnly(9, 0),
        EndTime = end ?? new TimeOnly(17, 0),
        EndsNextDay = endsNextDay,
        Ratio = ratio,
        NightType = nightType,
    };

    private static RosterCheckContext CompliantContext(
        User staff,
        Participant? participant,
        IReadOnlyList<Shift>? staffShiftsInWeek = null,
        IReadOnlyList<Shift>? participantShiftsOnDate = null,
        IReadOnlyList<StaffAssignment>? tripAssignments = null,
        IReadOnlyList<UnavailabilityWindow>? availability = null,
        CompatibilityLevel compatibility = CompatibilityLevel.Allowed,
        decimal weeklyHoursThreshold = RosterConflictService.DefaultWeeklyHoursThreshold) => new(
        Staff: staff,
        Participant: participant,
        StaffShiftsInWeek: staffShiftsInWeek ?? Array.Empty<Shift>(),
        ParticipantShiftsOnDate: participantShiftsOnDate ?? Array.Empty<Shift>(),
        TripAssignments: tripAssignments ?? Array.Empty<StaffAssignment>(),
        Availability: availability ?? Array.Empty<UnavailabilityWindow>(),
        Compatibility: compatibility,
        WeeklyHoursThreshold: weeklyHoursThreshold);

    private static bool HasCode(IReadOnlyList<RosterFinding> findings, string code) =>
        findings.Any(f => f.Code == code);

    // ── WSC_EXPIRED / WSC_MISSING ─────────────────────────────

    [Fact]
    public void Missing_worker_screening_produces_a_warning_finding_not_blocking()
    {
        var staff = CompliantStaff();
        staff.WorkerScreeningExpiryDate = null;
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant);

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant));

        var finding = Assert.Single(findings, f => f.Code == RosterConflictService.WscMissing);
        Assert.Equal(RosterFindingSeverity.Warning, finding.Severity);
        Assert.Contains("Ben Turner", finding.Message);
        Assert.DoesNotContain(findings, f => f.Severity == RosterFindingSeverity.Blocking);
    }

    [Fact]
    public void Worker_screening_expiring_after_the_service_date_produces_no_finding()
    {
        var staff = CompliantStaff();
        staff.WorkerScreeningExpiryDate = ServiceDate.AddDays(1);
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant);

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant));

        Assert.False(HasCode(findings, RosterConflictService.WscExpired));
    }

    [Fact]
    public void Worker_screening_expired_before_the_service_date_produces_a_blocking_finding()
    {
        var staff = CompliantStaff();
        staff.WorkerScreeningExpiryDate = new DateOnly(2026, 2, 12);
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant);

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant));

        var finding = Assert.Single(findings, f => f.Code == RosterConflictService.WscExpired);
        Assert.Equal(RosterFindingSeverity.Blocking, finding.Severity);
        Assert.Equal("Ben Turner's worker screening expired 12 Feb 2026 — cannot roster.", finding.Message);
    }

    [Fact]
    public void Missing_and_expired_worker_screening_produce_mutually_exclusive_codes()
    {
        var participant = CompliantParticipant();

        var missingStaff = CompliantStaff();
        missingStaff.WorkerScreeningExpiryDate = null;
        var missingCandidate = CandidateShift(missingStaff, participant);
        var missingFindings = new RosterConflictService().Check(missingCandidate, CompliantContext(missingStaff, participant));

        Assert.True(HasCode(missingFindings, RosterConflictService.WscMissing));
        Assert.False(HasCode(missingFindings, RosterConflictService.WscExpired));

        var expiredStaff = CompliantStaff();
        expiredStaff.WorkerScreeningExpiryDate = new DateOnly(2026, 2, 12); // before ServiceDate
        var expiredCandidate = CandidateShift(expiredStaff, participant);
        var expiredFindings = new RosterConflictService().Check(expiredCandidate, CompliantContext(expiredStaff, participant));

        Assert.True(HasCode(expiredFindings, RosterConflictService.WscExpired));
        Assert.False(HasCode(expiredFindings, RosterConflictService.WscMissing));
    }

    [Fact]
    public void Worker_screening_expired_is_the_only_blocking_finding_the_engine_can_ever_emit()
    {
        // Trigger every other rule at once: missing WSC would only add a Warning, so use a
        // staff/participant/context combination that also fires WSC_EXPIRED plus every
        // remaining Warning-producing rule, and assert no finding other than WSC_EXPIRED is
        // ever Blocking - this guards the invariant against future drift.
        var staff = CompliantStaff();
        staff.WorkerScreeningExpiryDate = new DateOnly(2026, 2, 12); // expired -> WSC_EXPIRED
        staff.DriverLicenceExpiryDate = ServiceDate.AddDays(-1); // -> CREDENTIAL_EXPIRED (IsFirstAidQualified below already forces COMPETENCY_MISSING, so an expired first aid date wouldn't fire this rule)
        staff.IsFirstAidQualified = false; // -> COMPETENCY_MISSING (high support)
        staff.IsOvernightEligible = false; // -> COMPETENCY_MISSING (overnight)
        staff.IsManualHandlingCompetent = false; // -> COMPETENCY_MISSING (hoist)

        var participant = CompliantParticipant();
        participant.IsHighSupport = true;
        participant.RequiresHoist = true;

        var candidate = CandidateShift(staff, participant, ratio: SupportRatio.TwoToOne, nightType: SleepoverType.ActiveNight);

        var otherShift = CandidateShift(staff, participant, serviceDate: ServiceDate.AddDays(1),
            start: new TimeOnly(9, 0), end: new TimeOnly(17, 0));
        var overlapping = CandidateShift(staff, participant, start: new TimeOnly(16, 0), end: new TimeOnly(20, 0));
        var assignment = new StaffAssignment
        {
            Id = Guid.NewGuid(), UserId = staff.Id, User = staff,
            AssignmentStart = ServiceDate.AddDays(-1), AssignmentEnd = ServiceDate.AddDays(1),
        };
        var availability = new UnavailabilityWindow(
            staff.Id, ServiceDate.ToDateTime(new TimeOnly(8, 0)), ServiceDate.ToDateTime(new TimeOnly(12, 0)),
            UnavailabilityKind.Legacy);

        var findings = new RosterConflictService().Check(candidate, CompliantContext(
            staff, participant,
            staffShiftsInWeek: new[] { otherShift, overlapping },
            tripAssignments: new[] { assignment },
            availability: new[] { availability },
            compatibility: CompatibilityLevel.Excluded,
            weeklyHoursThreshold: 1m));

        // Sanity check: every other rule really did fire, so this test is exercising what it claims to.
        Assert.True(HasCode(findings, RosterConflictService.DoubleBookedShift));
        Assert.True(HasCode(findings, RosterConflictService.DoubleBookedTrip));
        Assert.True(HasCode(findings, RosterConflictService.StaffUnavailable));
        Assert.True(HasCode(findings, RosterConflictService.CompatibilityExcluded));
        Assert.True(HasCode(findings, RosterConflictService.CredentialExpired));
        Assert.True(HasCode(findings, RosterConflictService.CompetencyMissing));
        Assert.True(HasCode(findings, RosterConflictService.RatioShortfall));
        Assert.True(HasCode(findings, RosterConflictService.OverHours));
        Assert.True(HasCode(findings, RosterConflictService.WscExpired));

        var blocking = findings.Where(f => f.Severity == RosterFindingSeverity.Blocking).ToList();
        var blockingFinding = Assert.Single(blocking);
        Assert.Equal(RosterConflictService.WscExpired, blockingFinding.Code);
    }

    // ── DOUBLE_BOOKED_SHIFT ──────────────────────────────────

    [Fact]
    public void Overlapping_shift_for_the_same_staff_member_fires_double_booked_shift()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant, start: new TimeOnly(9, 0), end: new TimeOnly(17, 0));
        var other = CandidateShift(staff, participant, start: new TimeOnly(16, 0), end: new TimeOnly(20, 0));

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant, staffShiftsInWeek: new[] { other }));

        Assert.True(HasCode(findings, RosterConflictService.DoubleBookedShift));
    }

    [Fact]
    public void Non_overlapping_shift_for_the_same_staff_member_does_not_fire_double_booked_shift()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant, start: new TimeOnly(9, 0), end: new TimeOnly(12, 0));
        var other = CandidateShift(staff, participant, start: new TimeOnly(13, 0), end: new TimeOnly(17, 0));

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant, staffShiftsInWeek: new[] { other }));

        Assert.False(HasCode(findings, RosterConflictService.DoubleBookedShift));
    }

    [Fact]
    public void An_overnight_shift_crossing_midnight_correctly_overlaps_the_following_mornings_shift()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();

        // Existing shift: Monday 22:00 -> Tuesday 06:00.
        var overnight = CandidateShift(
            staff, participant,
            serviceDate: new DateOnly(2026, 8, 24),
            start: new TimeOnly(22, 0), end: new TimeOnly(6, 0), endsNextDay: true);

        // Candidate: Tuesday 05:00 -> 09:00 - overlaps the tail of the overnight shift.
        var candidate = CandidateShift(
            staff, participant,
            serviceDate: new DateOnly(2026, 8, 25),
            start: new TimeOnly(5, 0), end: new TimeOnly(9, 0));

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant, staffShiftsInWeek: new[] { overnight }));

        Assert.True(HasCode(findings, RosterConflictService.DoubleBookedShift));
    }

    // ── DOUBLE_BOOKED_TRIP ───────────────────────────────────

    [Fact]
    public void Trip_assignment_covering_the_service_date_fires_double_booked_trip()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant);
        var assignment = new StaffAssignment
        {
            Id = Guid.NewGuid(),
            UserId = staff.Id,
            User = staff,
            AssignmentStart = ServiceDate.AddDays(-1),
            AssignmentEnd = ServiceDate.AddDays(1),
        };

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant, tripAssignments: new[] { assignment }));

        Assert.True(HasCode(findings, RosterConflictService.DoubleBookedTrip));
    }

    [Fact]
    public void Trip_assignment_not_covering_the_service_date_does_not_fire_double_booked_trip()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant);
        var assignment = new StaffAssignment
        {
            Id = Guid.NewGuid(),
            UserId = staff.Id,
            User = staff,
            AssignmentStart = ServiceDate.AddDays(5),
            AssignmentEnd = ServiceDate.AddDays(7),
        };

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant, tripAssignments: new[] { assignment }));

        Assert.False(HasCode(findings, RosterConflictService.DoubleBookedTrip));
    }

    // ── STAFF_UNAVAILABLE ────────────────────────────────────

    [Fact]
    public void Unavailable_record_overlapping_the_shift_window_fires_staff_unavailable()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant, start: new TimeOnly(9, 0), end: new TimeOnly(17, 0));
        var availability = new UnavailabilityWindow(
            staff.Id, ServiceDate.ToDateTime(new TimeOnly(8, 0)), ServiceDate.ToDateTime(new TimeOnly(12, 0)),
            UnavailabilityKind.Legacy);

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant, availability: new[] { availability }));

        Assert.True(HasCode(findings, RosterConflictService.StaffUnavailable));
        Assert.False(findings.Single(f => f.Code == RosterConflictService.StaffUnavailable).RequiresReason);
    }

    // ── COMPATIBILITY_EXCLUDED ───────────────────────────────

    [Fact]
    public void Excluded_compatibility_fires_compatibility_excluded()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant);

        var findings = new RosterConflictService().Check(
            candidate, CompliantContext(staff, participant, compatibility: CompatibilityLevel.Excluded));

        Assert.True(HasCode(findings, RosterConflictService.CompatibilityExcluded));
    }

    [Fact]
    public void Allowed_compatibility_does_not_fire_compatibility_excluded()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant);

        var findings = new RosterConflictService().Check(
            candidate, CompliantContext(staff, participant, compatibility: CompatibilityLevel.Allowed));

        Assert.False(HasCode(findings, RosterConflictService.CompatibilityExcluded));
    }

    // ── CREDENTIAL_EXPIRED ───────────────────────────────────

    [Fact]
    public void Expired_first_aid_certificate_fires_credential_expired()
    {
        var staff = CompliantStaff();
        staff.FirstAidExpiryDate = ServiceDate.AddDays(-1);
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant);

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant));

        Assert.True(HasCode(findings, RosterConflictService.CredentialExpired));
    }

    [Fact]
    public void Current_first_aid_certificate_does_not_fire_credential_expired()
    {
        var staff = CompliantStaff();
        staff.FirstAidExpiryDate = ServiceDate.AddDays(1);
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant);

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant));

        Assert.False(HasCode(findings, RosterConflictService.CredentialExpired));
    }

    // ── COMPETENCY_MISSING ───────────────────────────────────

    [Fact]
    public void High_support_participant_with_a_non_first_aid_staff_member_fires_competency_missing()
    {
        var staff = CompliantStaff();
        staff.IsFirstAidQualified = false;
        var participant = CompliantParticipant();
        participant.IsHighSupport = true;
        var candidate = CandidateShift(staff, participant);

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant));

        Assert.True(HasCode(findings, RosterConflictService.CompetencyMissing));
    }

    [Fact]
    public void High_support_participant_with_a_first_aid_qualified_staff_member_does_not_fire_competency_missing()
    {
        var staff = CompliantStaff();
        staff.IsFirstAidQualified = true;
        var participant = CompliantParticipant();
        participant.IsHighSupport = true;
        var candidate = CandidateShift(staff, participant);

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant));

        Assert.False(HasCode(findings, RosterConflictService.CompetencyMissing));
    }

    // ── RATIO_SHORTFALL ──────────────────────────────────────

    [Fact]
    public void Two_to_one_ratio_with_no_sibling_shift_fires_ratio_shortfall()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant, ratio: SupportRatio.TwoToOne);

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant));

        Assert.True(HasCode(findings, RosterConflictService.RatioShortfall));
    }

    [Fact]
    public void Two_to_one_ratio_covered_by_a_second_worker_does_not_fire_ratio_shortfall()
    {
        var staff = CompliantStaff();
        var second = CompliantStaff();
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant, ratio: SupportRatio.TwoToOne);
        var sibling = CandidateShift(second, participant, ratio: SupportRatio.TwoToOne);

        var findings = new RosterConflictService().Check(
            candidate, CompliantContext(staff, participant, participantShiftsOnDate: new[] { sibling }));

        Assert.False(HasCode(findings, RosterConflictService.RatioShortfall));
    }

    [Fact]
    public void Two_to_one_ratio_with_the_same_worker_twice_still_fires_ratio_shortfall()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant, ratio: SupportRatio.TwoToOne);
        var sibling = CandidateShift(staff, participant, ratio: SupportRatio.TwoToOne);

        var findings = new RosterConflictService().Check(
            candidate, CompliantContext(staff, participant, participantShiftsOnDate: new[] { sibling }));

        Assert.True(HasCode(findings, RosterConflictService.RatioShortfall));
    }

    [Fact]
    public void Two_to_one_ratio_with_a_non_overlapping_sibling_still_fires_ratio_shortfall()
    {
        var staff = CompliantStaff();
        var second = CompliantStaff();
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant, ratio: SupportRatio.TwoToOne);
        var evening = CandidateShift(second, participant, ratio: SupportRatio.TwoToOne,
            start: new TimeOnly(18, 0), end: new TimeOnly(22, 0));

        var findings = new RosterConflictService().Check(
            candidate, CompliantContext(staff, participant, participantShiftsOnDate: new[] { evening }));

        Assert.True(HasCode(findings, RosterConflictService.RatioShortfall));
    }

    [Fact]
    public void Two_to_one_ratio_with_an_unfilled_sibling_still_fires_ratio_shortfall()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant, ratio: SupportRatio.TwoToOne);
        var unfilled = CandidateShift(staff, participant, ratio: SupportRatio.TwoToOne);
        unfilled.UserId = null;
        unfilled.User = null;

        var findings = new RosterConflictService().Check(
            candidate, CompliantContext(staff, participant, participantShiftsOnDate: new[] { unfilled }));

        Assert.True(HasCode(findings, RosterConflictService.RatioShortfall));
    }

    [Fact]
    public void One_to_one_ratio_does_not_fire_ratio_shortfall()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant, ratio: SupportRatio.OneToOne);

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant));

        Assert.False(HasCode(findings, RosterConflictService.RatioShortfall));
    }

    // ── OVER_HOURS ───────────────────────────────────────────

    [Fact]
    public void Weekly_total_over_the_threshold_fires_over_hours()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant, start: new TimeOnly(9, 0), end: new TimeOnly(17, 0)); // 8h
        var otherShift = CandidateShift(
            staff, participant,
            serviceDate: ServiceDate.AddDays(1),
            start: new TimeOnly(9, 0), end: new TimeOnly(19, 0)); // 10h

        var findings = new RosterConflictService().Check(
            candidate,
            CompliantContext(staff, participant, staffShiftsInWeek: new[] { otherShift }, weeklyHoursThreshold: 15m));

        Assert.True(HasCode(findings, RosterConflictService.OverHours));
    }

    [Fact]
    public void Weekly_total_under_the_threshold_does_not_fire_over_hours()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant, start: new TimeOnly(9, 0), end: new TimeOnly(17, 0)); // 8h

        var findings = new RosterConflictService().Check(
            candidate,
            CompliantContext(staff, participant, weeklyHoursThreshold: 15m));

        Assert.False(HasCode(findings, RosterConflictService.OverHours));
    }

    [Fact]
    public void Over_hours_counts_the_candidates_own_hours_in_the_weekly_total()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        // Other shifts alone total 30h - under a 35h threshold. Adding the 9h candidate must push it over.
        var otherShifts = new[]
        {
            CandidateShift(staff, participant, serviceDate: ServiceDate.AddDays(1), start: new TimeOnly(0, 0), end: new TimeOnly(15, 0)), // 15h
            CandidateShift(staff, participant, serviceDate: ServiceDate.AddDays(2), start: new TimeOnly(0, 0), end: new TimeOnly(15, 0)), // 15h
        };
        var candidate = CandidateShift(staff, participant, start: new TimeOnly(9, 0), end: new TimeOnly(18, 0)); // 9h

        var withoutCandidateTotal = otherShifts.Sum(s => s.DurationHours);
        Assert.Equal(30m, withoutCandidateTotal);

        var findings = new RosterConflictService().Check(
            candidate,
            CompliantContext(staff, participant, staffShiftsInWeek: otherShifts, weeklyHoursThreshold: 35m));

        // 30h from other shifts alone would not breach 35h - only counting the candidate's 9h does (39h).
        Assert.True(HasCode(findings, RosterConflictService.OverHours));
    }

    // ── Fully compliant ──────────────────────────────────────

    [Fact]
    public void Fully_compliant_staff_and_participant_pairing_returns_no_findings()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant);

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant));

        Assert.Empty(findings);
    }

    // ── STAFF_ON_LEAVE / STAFF_RECURRING_UNAVAILABLE / STAFF_LEAVE_PENDING ──

    [Fact]
    public void Approved_leave_window_fires_staff_on_leave_and_requires_a_reason()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant, start: new TimeOnly(9, 0), end: new TimeOnly(17, 0));
        var window = new UnavailabilityWindow(
            staff.Id, ServiceDate.ToDateTime(new TimeOnly(0, 0)), ServiceDate.AddDays(1).ToDateTime(new TimeOnly(0, 0)),
            UnavailabilityKind.ApprovedLeave);

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant, availability: new[] { window }));

        var finding = Assert.Single(findings, f => f.Code == RosterConflictService.StaffOnLeave);
        Assert.True(finding.RequiresReason);
        Assert.Equal(RosterFindingSeverity.Warning, finding.Severity);
        Assert.False(HasCode(findings, RosterConflictService.StaffUnavailable));
    }

    [Fact]
    public void Pending_leave_window_fires_staff_leave_pending_and_does_not_require_a_reason()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant, start: new TimeOnly(9, 0), end: new TimeOnly(17, 0));
        var window = new UnavailabilityWindow(
            staff.Id, ServiceDate.ToDateTime(new TimeOnly(0, 0)), ServiceDate.AddDays(1).ToDateTime(new TimeOnly(0, 0)),
            UnavailabilityKind.PendingLeave);

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant, availability: new[] { window }));

        var finding = Assert.Single(findings, f => f.Code == RosterConflictService.StaffLeavePending);
        Assert.False(finding.RequiresReason);
    }

    [Fact]
    public void Approved_recurring_window_fires_staff_recurring_unavailable_and_requires_a_reason()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant, start: new TimeOnly(9, 0), end: new TimeOnly(17, 0));
        var window = new UnavailabilityWindow(
            staff.Id, ServiceDate.ToDateTime(new TimeOnly(8, 0)), ServiceDate.ToDateTime(new TimeOnly(12, 0)),
            UnavailabilityKind.RecurringRule);

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant, availability: new[] { window }));

        var finding = Assert.Single(findings, f => f.Code == RosterConflictService.StaffRecurringUnavailable);
        Assert.True(finding.RequiresReason);
        Assert.Contains("Monday", finding.Message); // ServiceDate (2026-08-24) is a Monday
    }

    [Fact]
    public void Non_overlapping_unavailability_window_fires_nothing()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant, start: new TimeOnly(9, 0), end: new TimeOnly(12, 0));
        var window = new UnavailabilityWindow(
            staff.Id, ServiceDate.ToDateTime(new TimeOnly(13, 0)), ServiceDate.ToDateTime(new TimeOnly(17, 0)),
            UnavailabilityKind.ApprovedLeave);

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant, availability: new[] { window }));

        Assert.False(HasCode(findings, RosterConflictService.StaffOnLeave));
    }

    [Fact]
    public void Legacy_window_still_fires_staff_unavailable_without_requiring_a_reason()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant, start: new TimeOnly(9, 0), end: new TimeOnly(17, 0));
        var window = new UnavailabilityWindow(
            staff.Id, ServiceDate.ToDateTime(new TimeOnly(8, 0)), ServiceDate.ToDateTime(new TimeOnly(12, 0)),
            UnavailabilityKind.Legacy);

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant, availability: new[] { window }));

        var finding = Assert.Single(findings, f => f.Code == RosterConflictService.StaffUnavailable);
        Assert.False(finding.RequiresReason);
    }

    [Fact]
    public void Every_other_finding_still_defaults_RequiresReason_to_false()
    {
        var staff = CompliantStaff();
        staff.WorkerScreeningExpiryDate = null; // WSC_MISSING
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant);

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, participant));

        Assert.All(findings, f => Assert.False(f.RequiresReason));
    }

    // ── Trip-side parity: null-participant tolerance + CheckStaffAssignment ──

    [Fact]
    public void Check_ToleratesNullParticipant_SkipsParticipantScopedFindings()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        var candidate = CandidateShift(staff, participant, ratio: SupportRatio.TwoToOne);

        var findings = new RosterConflictService().Check(candidate, CompliantContext(staff, null, compatibility: CompatibilityLevel.Excluded));

        Assert.DoesNotContain(findings, f => f.Code == RosterConflictService.CompatibilityExcluded);
        Assert.DoesNotContain(findings, f => f.Code == RosterConflictService.CompetencyMissing);
        Assert.DoesNotContain(findings, f => f.Code == RosterConflictService.RatioShortfall);
    }

    [Fact]
    public void CheckStaffAssignment_ApprovedLeaveOverlappingWholeDayWindow_FiresStaffOnLeave()
    {
        var staff = CompliantStaff();
        var window = new UnavailabilityWindow(staff.Id,
            new DateTime(2026, 9, 10), new DateTime(2026, 9, 13), UnavailabilityKind.ApprovedLeave);
        var ctx = CompliantContext(staff, null, availability: new[] { window });

        var findings = new RosterConflictService().CheckStaffAssignment(
            new DateOnly(2026, 9, 11), new DateOnly(2026, 9, 12), Guid.Empty, ctx);

        var finding = Assert.Single(findings, f => f.Code == RosterConflictService.StaffOnLeave);
        Assert.True(finding.RequiresReason);
    }

    [Fact]
    public void CheckStaffAssignment_NeverProducesParticipantScopedCodes()
    {
        var staff = CompliantStaff();
        var ctx = CompliantContext(staff, null, compatibility: CompatibilityLevel.Excluded);

        var findings = new RosterConflictService().CheckStaffAssignment(
            new DateOnly(2026, 9, 11), new DateOnly(2026, 9, 12), Guid.Empty, ctx);

        Assert.DoesNotContain(findings, f => f.Code == RosterConflictService.CompatibilityExcluded);
        Assert.DoesNotContain(findings, f => f.Code == RosterConflictService.CompetencyMissing);
        Assert.DoesNotContain(findings, f => f.Code == RosterConflictService.RatioShortfall);
        Assert.DoesNotContain(findings, f => f.Code == RosterConflictService.OverHours);
    }

    [Fact]
    public void CheckStaffAssignment_ExpiredScreeningAtAssignmentStart_FiresBlockingWscExpired()
    {
        var staff = CompliantStaff();
        staff.WorkerScreeningExpiryDate = new DateOnly(2026, 9, 1);
        var ctx = CompliantContext(staff, null);

        var findings = new RosterConflictService().CheckStaffAssignment(
            new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12), Guid.Empty, ctx);

        var finding = Assert.Single(findings, f => f.Code == RosterConflictService.WscExpired);
        Assert.Equal(RosterFindingSeverity.Blocking, finding.Severity);
    }

    [Fact]
    public void CheckStaffAssignment_ExcludesItsOwnPriorAssignmentFromDoubleBookedTrip()
    {
        var staff = CompliantStaff();
        var selfId = Guid.NewGuid();
        var selfAssignment = new StaffAssignment
        {
            Id = selfId, UserId = staff.Id, TripInstanceId = Guid.NewGuid(),
            AssignmentStart = new DateOnly(2026, 9, 10), AssignmentEnd = new DateOnly(2026, 9, 12),
        };
        var ctx = CompliantContext(staff, null, tripAssignments: new[] { selfAssignment });

        var findings = new RosterConflictService().CheckStaffAssignment(
            new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12), selfId, ctx);

        Assert.DoesNotContain(findings, f => f.Code == RosterConflictService.DoubleBookedTrip);
    }

    [Fact]
    public void CheckStaffAssignment_OverlappingOtherTripAssignment_FiresDoubleBookedTrip()
    {
        var staff = CompliantStaff();
        var other = new StaffAssignment
        {
            Id = Guid.NewGuid(), UserId = staff.Id, TripInstanceId = Guid.NewGuid(),
            AssignmentStart = new DateOnly(2026, 9, 11), AssignmentEnd = new DateOnly(2026, 9, 13),
        };
        var ctx = CompliantContext(staff, null, tripAssignments: new[] { other });

        var findings = new RosterConflictService().CheckStaffAssignment(
            new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12), Guid.Empty, ctx);

        Assert.True(HasCode(findings, RosterConflictService.DoubleBookedTrip));
    }

    [Fact]
    public void CheckStaffAssignment_OverlappingShiftInWindow_FiresDoubleBookedShift()
    {
        var staff = CompliantStaff();
        var participant = CompliantParticipant();
        var shift = CandidateShift(staff, participant, serviceDate: new DateOnly(2026, 9, 11));
        var ctx = CompliantContext(staff, null, staffShiftsInWeek: new[] { shift });

        var findings = new RosterConflictService().CheckStaffAssignment(
            new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12), Guid.Empty, ctx);

        Assert.True(HasCode(findings, RosterConflictService.DoubleBookedShift));
    }
}
