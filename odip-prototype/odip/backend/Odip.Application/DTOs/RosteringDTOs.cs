using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;

namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// ROSTERING DTOs (M4 pass 1)
// Property names must serialise to exactly the camelCase field names in the
// 2026-08-21-rostering-design.md spec's TypeScript block — a frontend is
// already built against them.
// ══════════════════════════════════════════════════════════════

/// <summary>Board-row compliance summary, evaluated once per staff member at the board's <c>weekStart</c>.</summary>
public enum RosterComplianceLevel
{
    Ok = 0,
    Warning = 1,
    Blocked = 2
}

public record RosterFindingDto
{
    public string Code { get; init; } = string.Empty;
    public RosterFindingSeverity Severity { get; init; }
    public string Message { get; init; } = string.Empty;
    /// <summary>True when this finding demands a non-empty override reason before the write can save — see RosteringController.EvaluateFindings.</summary>
    public bool RequiresReason { get; init; }
    /// <summary>The figures a budget finding (BUDGET_*) was worked out from, so a screen prints them and does no sum of its own. Omitted on every other finding.</summary>
    public BudgetFindingFiguresDto? Budget { get; init; }
}

/// <summary>The figures behind a budget finding: one pool in one funding period with the shift counted. Dollars, as the ledger says them; dates are calendar dates.</summary>
public record BudgetFindingFiguresDto
{
    public string PoolName { get; init; } = string.Empty;
    public DateOnly PeriodStart { get; init; }
    public DateOnly PeriodEnd { get; init; }
    public decimal Available { get; init; }
    public decimal Used { get; init; }
    /// <summary>What the period has left after what is used; negative once it is over.</summary>
    public decimal Remaining { get; init; }
    /// <summary>Used plus booked ahead, with this shift counted.</summary>
    public decimal Forecast { get; init; }
    /// <summary>What the period had booked ahead BEFORE this shift, so used + booked ahead + this shift is the forecast and a screen needs no sum of its own.</summary>
    public decimal BookedAhead { get; init; }
    /// <summary>The estimate of the shift itself, priced the way ODIP will claim it.</summary>
    public decimal ShiftCost { get; init; }
    /// <summary>How many of the period's shifts could not be priced (a sleepover, a group shift, no rate): they are $0 in every figure above, so the figures are not the whole period.</summary>
    public int UnpricedShiftCount { get; init; }
    /// <summary>How far the forecast is past what is available; zero when it is not.</summary>
    public decimal OverBy { get; init; }
}

/// <summary>Where the Admin's review of an emergency or safety booking over budget stands. There is no "approved": an emergency saves at once and is reviewed afterwards.</summary>
public enum BudgetReviewState
{
    Pending = 0,
    Reviewed = 1,
}

/// <summary>The Admin review task of a shift saved as an emergency or safety booking past its budget (omitted for every other shift).</summary>
public record BudgetReviewDto
{
    public BudgetReviewState State { get; init; }
    /// <summary>When the server recorded the emergency booking: the moment its review task was raised.</summary>
    public DateTime? RecordedAt { get; init; }
    public string? ReviewTaskTitle { get; init; }
    /// <summary>The provider's calendar date the task was completed on; omitted while it is pending.</summary>
    public DateOnly? ReviewedOn { get; init; }
    /// <summary>The Admin who completed the review (the task's owner, stamped when an Admin completes it); omitted while it is pending or when nobody is recorded.</summary>
    public string? ReviewedBy { get; init; }
}

public record ShiftDto
{
    public Guid Id { get; init; }
    public Guid ParticipantId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public Guid? StaffId { get; init; }
    public string? StaffName { get; init; }
    public DateOnly ServiceDate { get; init; }
    public TimeOnly StartTime { get; init; }
    public TimeOnly EndTime { get; init; }
    public bool EndsNextDay { get; init; }
    public decimal DurationHours { get; init; }
    public SupportRatio Ratio { get; init; }
    public SleepoverType NightType { get; init; }
    public ShiftStatus Status { get; init; }
    public Guid? ShiftPatternId { get; init; }
    public string? Notes { get; init; }
    /// <summary>What the shift asks of a worker (gender, a driver, skills), copied from its pattern when it was generated: informational, shown as chips. Absent when it asks for nothing.</summary>
    public DraftBlockRequirementsDto? Requirements { get; init; }
    /// <summary>True when the pattern this shift was generated from was made by an agreement revision (plan builder, phase D); omitted otherwise. With <see cref="SourceDraftVersion"/> it is what the shift panel says ("From agreement v2"), so the panel needs no read of the pattern.</summary>
    public bool? FromAgreement { get; init; }
    /// <summary>The version of the agreement revision that pattern came from; omitted for a shift that did not come from one.</summary>
    public int? SourceDraftVersion { get; init; }
    public string? OverrideReason { get; init; }
    /// <summary>
    /// The finding codes the server stored when it saved this shift, for the over-budget marker on the board chip and in the panel: BUDGET_EMERGENCY for a shift accepted as an emergency or safety booking,
    /// BUDGET_FORECAST_OVER for one an Admin pushed over budget with a written reason. The server never stores either for a mere warning, so a marker read from here is never forged. Omitted when none.
    /// </summary>
    public List<string>? AcknowledgedFindingCodes { get; init; }
    /// <summary>The Admin review of an emergency or safety booking over budget; omitted for every other shift.</summary>
    public BudgetReviewDto? BudgetReview { get; init; }
    public List<RosterFindingDto> Findings { get; init; } = new();
    /// <summary>
    /// True when this shift has an assigned staff member (<see cref="StaffId"/> non-null) and
    /// that user has an ApprovedLeave (or approved RecurringRule) <c>UnavailabilityWindow</c>
    /// covering the shift's actual service window — computed fresh from the same
    /// IStaffUnavailabilityQuery load the board's leave bars already use, not from
    /// <see cref="Findings"/> (those only fire when the shift's participant/staff are both in
    /// this week's active sets; this flag has no such restriction). Also folded into
    /// <see cref="RosterBoardDto.Exceptions"/> as an ASSIGNEE_ON_LEAVE finding — see
    /// RosteringController.GetBoard.
    /// </summary>
    public bool AssigneeOnApprovedLeave { get; init; }
    /// <summary>
    /// What is missing before this shift's participant is fully ready (intake, onboarding, signed
    /// service agreement). Null (omitted from the JSON) when nothing is. In Warn mode this is a
    /// quiet warning and never blocks a save; see <c>ParticipantReadiness</c>.
    /// </summary>
    public List<string>? ReadinessIssues { get; init; }
}

public record TripBarDto
{
    public Guid TripInstanceId { get; init; }
    public string? TripCode { get; init; }
    public string TripName { get; init; } = string.Empty;
    public DateOnly StartDate { get; init; }
    public DateOnly EndDate { get; init; }
    public bool IsDriver { get; init; }
}

/// <summary>
/// One bar on the roster board's staff-grouped view. Sourced from IStaffUnavailabilityQuery
/// (approved + pending leave, approved + pending recurring occurrences, legacy StaffAvailability
/// rows) — see UnavailabilityKind for what Kind discriminates. AvailabilityType/Notes are
/// populated only for Kind == Legacy (the source StaffAvailability row's own values, carried
/// through UnavailabilityWindow.LegacySourceType/LegacyNotes); StartTime/EndTime are populated
/// only for Kind == RecurringRule or PendingRecurringRule (so the frontend can draw a partial-day
/// bar instead of a full-day one). Every field not relevant to a given row's Kind is left null,
/// never a default/zero value that could be misread as meaningful.
/// </summary>
public record LeaveBarDto
{
    public DateOnly StartDate { get; init; }
    public DateOnly EndDate { get; init; }
    public UnavailabilityKind Kind { get; init; }
    /// <summary>
    /// Compat fill — the current frontend labels the bar from availabilityType; PR 2 switches it to
    /// <c>Kind</c>, after which this may become null for non-legacy kinds. Legacy: the source
    /// StaffAvailability row's AvailabilityType (Unavailable or Training). ApprovedLeave/PendingLeave:
    /// AvailabilityType.Leave. RecurringRule/PendingRecurringRule: AvailabilityType.Unavailable.
    /// </summary>
    public AvailabilityType? AvailabilityType { get; init; }
    /// <summary>Legacy only — the source StaffAvailability row's free-text Notes.</summary>
    public string? Notes { get; init; }
    /// <summary>RecurringRule/PendingRecurringRule only — the occurrence's time-of-day start. Serialises the same way ShiftPatternDto.StartTime does (built-in System.Text.Json TimeOnly support, no custom converter).</summary>
    public TimeOnly? StartTime { get; init; }
    /// <summary>RecurringRule/PendingRecurringRule only — the occurrence's time-of-day end.</summary>
    public TimeOnly? EndTime { get; init; }
}

public record RosterStaffRowDto
{
    public Guid StaffId { get; init; }
    public string FullName { get; init; } = string.Empty;
    public Position Role { get; init; }
    public RosterComplianceLevel Compliance { get; init; }
    public List<string> ComplianceNotes { get; init; } = new();
    public decimal RosteredHours { get; init; }
    public decimal TargetHours { get; init; }
    public List<ShiftDto> Shifts { get; init; } = new();
    public List<TripBarDto> TripBars { get; init; } = new();
    public List<LeaveBarDto> Leave { get; init; } = new();
}

/// <summary>
/// One participant's week on the board (M4 pass 2). Every ACTIVE participant gets a row,
/// whether or not they have shifts — an empty row is a visible coverage gap. Unfilled shifts
/// belong here too (see <see cref="Shift.StaffId"/>) — there is no separate unfilled lane in
/// participant mode, that stays a staff-view concept.
/// </summary>
public record RosterParticipantRowDto
{
    public Guid ParticipantId { get; init; }
    public string FullName { get; init; } = string.Empty;
    public SupportRatio SupportRatio { get; init; }
    public OvernightSupportType OvernightSupport { get; init; }
    public bool HasRestrictivePractice { get; init; }
    /// <summary>Includes unfilled shifts (StaffId null).</summary>
    public List<ShiftDto> Shifts { get; init; } = new();
    /// <summary>From ParticipantBooking joined to TripInstance, for trips overlapping the week.</summary>
    public List<TripBarDto> TripBars { get; init; } = new();
    public decimal ScheduledHours { get; init; }
    /// <summary>Days in the week with neither a shift nor a trip covering them.</summary>
    public int DaysWithoutCover { get; init; }
    /// <summary>
    /// What is missing before this participant is fully ready (intake, onboarding, signed service
    /// agreement). Null (omitted from the JSON) when nothing is. Every active, non-draft
    /// participant has a row either way: in Warn mode this is the quiet warning on it.
    /// </summary>
    public List<string>? ReadinessIssues { get; init; }
}

public record RosterExceptionDto
{
    public Guid? ShiftId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public DateOnly ServiceDate { get; init; }
    public RosterFindingDto Finding { get; init; } = null!;
}

/// <summary>
/// Connection map item 12 — one row of GET /participants/{id}/rostering's upcomingShifts (next 28
/// days). StaffId/StaffName are left null for an unfilled shift, which serialises out entirely
/// under Program.cs's JsonIgnoreCondition.WhenWritingNull — matching the frontend's optional
/// staffId?/staffName? fields (never sent as an explicit null).
/// </summary>
public record ParticipantRosteringShiftDto
{
    public Guid ShiftId { get; init; }
    public DateOnly ServiceDate { get; init; }
    public TimeOnly StartTime { get; init; }
    public TimeOnly EndTime { get; init; }
    public bool EndsNextDay { get; init; }
    public Guid? StaffId { get; init; }
    public string? StaffName { get; init; }
    public ShiftStatus Status { get; init; }
    /// <summary>See ShiftDto.AssigneeOnApprovedLeave — true when the assigned staff member's leave was approved after the assignment was made, so this filled shift is actually a hole.</summary>
    public bool AssigneeOnApprovedLeave { get; init; }
}

/// <summary>Connection map item 12 — one row of GET /participants/{id}/rostering's assignedStaff (distinct staff on those shifts).</summary>
public record ParticipantRosteringStaffDto
{
    public Guid StaffId { get; init; }
    public string StaffName { get; init; } = string.Empty;
    public int ShiftCount { get; init; }
    /// <summary>From StaffParticipantCompatibility, or Allowed when no row exists for the pair.</summary>
    public CompatibilityLevel Compatibility { get; init; }
}

/// <summary>
/// Connection map item 12 — GET /participants/{id}/rostering, backing the participant hub's
/// Rostering tab: who's rostered on for this participant and what's coming up, without sending
/// the coordinator all the way to the full roster board.
/// </summary>
public record ParticipantRosteringDto
{
    public List<ParticipantRosteringShiftDto> UpcomingShifts { get; init; } = new();
    public List<ParticipantRosteringStaffDto> AssignedStaff { get; init; } = new();
}

/// <summary>Which axis <see cref="RosterBoardDto"/> is grouped by. Drives which of the two row shapes is populated.</summary>
public enum RosterBoardGroupBy
{
    Participant = 0,
    Staff = 1
}

/// <summary>
/// The week roster board, discriminated on <see cref="GroupBy"/>: participant mode populates
/// <see cref="ParticipantRows"/> only; staff mode populates <see cref="StaffRows"/> and
/// <see cref="Unfilled"/> only. The unused side is left null so it serialises out entirely
/// (Program.cs's JsonIgnoreCondition.WhenWritingNull) rather than as an empty array — a
/// consumer should never see both sides populated at once.
/// </summary>
public record RosterBoardDto
{
    public DateOnly WeekStart { get; init; }
    public List<DateOnly> Days { get; init; } = new();
    public RosterBoardGroupBy GroupBy { get; init; }
    public List<RosterParticipantRowDto>? ParticipantRows { get; init; }
    public List<RosterStaffRowDto>? StaffRows { get; init; }
    public List<ShiftDto>? Unfilled { get; init; }
    public List<RosterExceptionDto> Exceptions { get; init; } = new();
}

// ── Shift write DTOs ─────────────────────────────────────────────

public record CreateShiftDto
{
    public Guid ParticipantId { get; init; }
    /// <summary>Null leaves the shift unfilled.</summary>
    public Guid? StaffId { get; init; }
    public DateOnly ServiceDate { get; init; }
    public TimeOnly StartTime { get; init; }
    public TimeOnly EndTime { get; init; }
    public bool EndsNextDay { get; init; }
    public SupportRatio Ratio { get; init; }
    public SleepoverType NightType { get; init; }
    /// <summary>Ignored: the server never takes a pattern link from a request. It sets the link itself when it generates a shift from a pattern, and the budget's one-off rule reads only that saved link, so naming a pattern cannot dodge a hard limit.</summary>
    public Guid? ShiftPatternId { get; init; }
    public string? Notes { get; init; }
    /// <summary>Required when the shift carries Warning findings; ignored (never enough) for Blocking findings.</summary>
    public string? OverrideReason { get; init; }
    /// <summary>Finding codes the coordinator is acknowledging. Defaults to every current finding's code when omitted.</summary>
    public List<string>? AcknowledgedFindingCodes { get; init; }
    /// <summary>
    /// "Emergency or safety" (budget phase 3): the shift goes ahead over budget without an Admin first, and an Admin reviews it afterwards. The description is <see cref="OverrideReason"/>
    /// (at least 10 characters once trimmed). It only means something when the check found the shift over budget; the path is open in every mode and cannot be switched off.
    /// </summary>
    public bool Emergency { get; init; }
}

public record UpdateShiftDto : CreateShiftDto
{
    public ShiftStatus Status { get; init; } = ShiftStatus.Draft;
}

public record AssignShiftDto
{
    /// <summary>Null clears the assignment (the shift becomes unfilled), which never produces findings.</summary>
    public Guid? StaffId { get; init; }
    public string? OverrideReason { get; init; }
    public List<string>? AcknowledgedFindingCodes { get; init; }
}

/// <summary>Dry-run input for <c>POST /shifts/check</c> — the same shape as a candidate shift, minus persistence fields.</summary>
public record CheckShiftDto
{
    /// <summary>The existing shift being re-checked, if any — excluded from its own conflict queries. Null for a brand-new candidate.</summary>
    public Guid? Id { get; init; }
    public Guid ParticipantId { get; init; }
    public Guid? StaffId { get; init; }
    public DateOnly ServiceDate { get; init; }
    public TimeOnly StartTime { get; init; }
    public TimeOnly EndTime { get; init; }
    public bool EndsNextDay { get; init; }
    public SupportRatio Ratio { get; init; }
    public SleepoverType NightType { get; init; }
    /// <summary>The status the shift would be saved with (budget phase 3): a shift about to be cancelled costs nothing and has no budget finding. Omitted means the shift's own status, or a new Draft.</summary>
    public ShiftStatus? Status { get; init; }
}

// ── Shift pattern DTOs ───────────────────────────────────────────

public record ShiftPatternDto
{
    public Guid Id { get; init; }
    public Guid ParticipantId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public Guid? DefaultStaffId { get; init; }
    public string? DefaultStaffName { get; init; }
    public DayOfWeek DayOfWeek { get; init; }
    public TimeOnly StartTime { get; init; }
    public TimeOnly EndTime { get; init; }
    public bool EndsNextDay { get; init; }
    public SupportRatio Ratio { get; init; }
    public SleepoverType NightType { get; init; }
    public DateOnly EffectiveFrom { get; init; }
    public DateOnly? EffectiveTo { get; init; }
    public bool IsActive { get; init; }
    public string? Notes { get; init; }
    /// <summary>The agreement revision whose approval made this pattern (plan builder, phase D); absent for a hand-made or demo pattern.</summary>
    public Guid? SourceDraftId { get; init; }
    /// <summary>The block of that revision this pattern is one weekday of.</summary>
    public string? SourceBlockKey { get; init; }
    /// <summary>The version of that revision, for "From agreement v2".</summary>
    public int? SourceDraftVersion { get; init; }
    /// <summary>Which of the workers a block asks for at once this pattern is (a 2:1 support is slots 1 and 2).</summary>
    public int? WorkerSlot { get; init; }
    /// <summary>What the pattern's shifts ask of a worker (gender, a driver, skills), shown as chips; informational. Absent when the pattern asks for nothing or was made by hand.</summary>
    public DraftBlockRequirementsDto? Requirements { get; init; }
}

public record CreateShiftPatternDto
{
    public Guid ParticipantId { get; init; }
    public Guid? DefaultStaffId { get; init; }
    public DayOfWeek DayOfWeek { get; init; }
    public TimeOnly StartTime { get; init; }
    public TimeOnly EndTime { get; init; }
    public bool EndsNextDay { get; init; }
    public SupportRatio Ratio { get; init; }
    public SleepoverType NightType { get; init; }
    public DateOnly EffectiveFrom { get; init; }
    public DateOnly? EffectiveTo { get; init; }
    public bool IsActive { get; init; } = true;
    public string? Notes { get; init; }
}

public record UpdateShiftPatternDto : CreateShiftPatternDto;

public record GeneratePatternResultDto
{
    public int Created { get; init; }
    public int Skipped { get; init; }
    /// <summary>
    /// Where the shifts just made take a pool past its funding for a period (budget phase 3), one entry for each pool and period. Never a reason to refuse: the shifts are made. Omitted when
    /// nothing is past its funding, or the participant has no budget recorded.
    /// </summary>
    public List<BudgetWarningDto>? BudgetWarnings { get; init; }
}

// ── Compatibility matrix DTOs ────────────────────────────────────

public record CompatibilityRowDto
{
    public Guid Id { get; init; }
    public Guid StaffId { get; init; }
    public string StaffName { get; init; } = string.Empty;
    public Guid ParticipantId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public CompatibilityLevel Level { get; init; }
    public string? Reason { get; init; }
    public DateTime UpdatedAt { get; init; }
}

public record UpsertCompatibilityDto
{
    public Guid StaffId { get; init; }
    public Guid ParticipantId { get; init; }
    public CompatibilityLevel Level { get; init; }
    public string? Reason { get; init; }
}
