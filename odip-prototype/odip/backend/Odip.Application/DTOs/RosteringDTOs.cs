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
    public string? OverrideReason { get; init; }
    public List<RosterFindingDto> Findings { get; init; } = new();
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
/// (approved + pending leave, approved recurring occurrences, legacy StaffAvailability rows) —
/// see UnavailabilityKind for what Kind discriminates. AvailabilityType/Notes are populated only
/// for Kind == Legacy (the source StaffAvailability row's own values, carried through
/// UnavailabilityWindow.LegacySourceType/LegacyNotes); StartTime/EndTime are populated only for
/// Kind == RecurringRule (so the frontend can draw a partial-day bar instead of a full-day one).
/// Every field not relevant to a given row's Kind is left null, never a default/zero value that
/// could be misread as meaningful.
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
    /// AvailabilityType.Leave. RecurringRule: AvailabilityType.Unavailable.
    /// </summary>
    public AvailabilityType? AvailabilityType { get; init; }
    /// <summary>Legacy only — the source StaffAvailability row's free-text Notes.</summary>
    public string? Notes { get; init; }
    /// <summary>RecurringRule only — the occurrence's time-of-day start. Serialises the same way ShiftPatternDto.StartTime does (built-in System.Text.Json TimeOnly support, no custom converter).</summary>
    public TimeOnly? StartTime { get; init; }
    /// <summary>RecurringRule only — the occurrence's time-of-day end.</summary>
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
}

public record RosterExceptionDto
{
    public Guid? ShiftId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public DateOnly ServiceDate { get; init; }
    public RosterFindingDto Finding { get; init; } = null!;
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
    public Guid? ShiftPatternId { get; init; }
    public string? Notes { get; init; }
    /// <summary>Required when the shift carries Warning findings; ignored (never enough) for Blocking findings.</summary>
    public string? OverrideReason { get; init; }
    /// <summary>Finding codes the coordinator is acknowledging. Defaults to every current finding's code when omitted.</summary>
    public List<string>? AcknowledgedFindingCodes { get; init; }
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
