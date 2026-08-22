using Odip.Domain.Enums;
using Odip.Domain.Rostering;

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

public record LeaveBarDto
{
    public DateOnly StartDate { get; init; }
    public DateOnly EndDate { get; init; }
    public AvailabilityType AvailabilityType { get; init; }
    public string? Notes { get; init; }
}

public record RosterStaffRowDto
{
    public Guid StaffId { get; init; }
    public string FullName { get; init; } = string.Empty;
    public StaffRole Role { get; init; }
    public RosterComplianceLevel Compliance { get; init; }
    public List<string> ComplianceNotes { get; init; } = new();
    public decimal RosteredHours { get; init; }
    public decimal TargetHours { get; init; }
    public List<ShiftDto> Shifts { get; init; } = new();
    public List<TripBarDto> TripBars { get; init; } = new();
    public List<LeaveBarDto> Leave { get; init; } = new();
}

public record RosterExceptionDto
{
    public Guid? ShiftId { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public DateOnly ServiceDate { get; init; }
    public RosterFindingDto Finding { get; init; } = null!;
}

public record RosterBoardDto
{
    public DateOnly WeekStart { get; init; }
    public List<DateOnly> Days { get; init; } = new();
    public List<RosterStaffRowDto> Rows { get; init; } = new();
    public List<ShiftDto> Unfilled { get; init; } = new();
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
