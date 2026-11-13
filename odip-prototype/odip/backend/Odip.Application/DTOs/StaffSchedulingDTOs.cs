using System.ComponentModel.DataAnnotations;
using Odip.Application.Serialization;
using Odip.Domain.Enums;
namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// STAFF AVAILABILITY DTOs
// ══════════════════════════════════════════════════════════════

public record StaffAvailabilityDto
{
    public Guid Id { get; init; }
    public Guid StaffId { get; init; }
    [WallClock]
    public DateTime StartDateTime { get; init; }
    [WallClock]
    public DateTime EndDateTime { get; init; }
    public AvailabilityType AvailabilityType { get; init; }
    public bool IsRecurring { get; init; }
    public string? RecurrenceNotes { get; init; }
    public string? Notes { get; init; }
}

public record CreateStaffAvailabilityDto
{
    public Guid StaffId { get; init; }
    [WallClock]
    public DateTime StartDateTime { get; init; }
    [WallClock]
    public DateTime EndDateTime { get; init; }
    public AvailabilityType AvailabilityType { get; init; }
    public bool IsRecurring { get; init; }
    public string? RecurrenceNotes { get; init; }
    public string? Notes { get; init; }
}

public record UpdateStaffAvailabilityDto : CreateStaffAvailabilityDto { }

// ══════════════════════════════════════════════════════════════
// STAFF ASSIGNMENT DTOs
// ══════════════════════════════════════════════════════════════

public record StaffAssignmentDto
{
    public Guid Id { get; init; }
    public Guid TripInstanceId { get; init; }
    public string? TripName { get; init; }
    public Guid StaffId { get; init; }
    public string? StaffName { get; init; }
    public string? AssignmentRole { get; init; }
    public DateOnly AssignmentStart { get; init; }
    public DateOnly AssignmentEnd { get; init; }
    public AssignmentStatus Status { get; init; }
    public bool IsDriver { get; init; }
    public SleepoverType SleepoverType { get; init; }
    public string? ShiftNotes { get; init; }
    public bool HasConflict { get; init; }
    public string? OverrideReason { get; init; }
    public string? AcknowledgedFindingCodes { get; init; }
}

public record CreateStaffAssignmentDto
{
    public Guid TripInstanceId { get; init; }
    public Guid StaffId { get; init; }
    public string? AssignmentRole { get; init; }
    public DateOnly AssignmentStart { get; init; }
    public DateOnly AssignmentEnd { get; init; }
    public bool IsDriver { get; init; }
    public SleepoverType SleepoverType { get; init; } = SleepoverType.None;
    public string? ShiftNotes { get; init; }
    /// <summary>Required when the candidate carries a RequiresReason finding; ignored (never enough) for a Blocking finding.</summary>
    [StringLength(2000)]
    public string? OverrideReason { get; init; }
    /// <summary>Finding codes the coordinator is acknowledging. Defaults to every current finding's code when omitted.</summary>
    public List<string>? AcknowledgedFindingCodes { get; init; }
}

public record UpdateStaffAssignmentDto : CreateStaffAssignmentDto
{
    public AssignmentStatus Status { get; init; }
}

/// <summary>Dry-run input for POST /staff-assignments/check — mirrors CheckShiftDto's shape for the trip-assignment analogue.</summary>
public record CheckStaffAssignmentDto
{
    public Guid StaffId { get; init; }
    public Guid TripInstanceId { get; init; }
    public DateOnly AssignmentStart { get; init; }
    public DateOnly AssignmentEnd { get; init; }
    /// <summary>The existing assignment being re-checked, if any — excluded from its own conflict queries. Null for a brand-new candidate.</summary>
    public Guid? ExcludeAssignmentId { get; init; }
}

// ══════════════════════════════════════════════════════════════
// SCHEDULE DTOs
// ══════════════════════════════════════════════════════════════

public record TripDayDto
{
    public Guid Id { get; init; }
    public Guid TripInstanceId { get; init; }
    public int DayNumber { get; init; }
    public DateOnly Date { get; init; }
    public string? DayTitle { get; init; }
    public string? DayNotes { get; init; }
    public List<ScheduledActivityDto> ScheduledActivities { get; init; } = new();
}

public record UpdateTripDayDto
{
    public string? DayTitle { get; init; }
    public string? DayNotes { get; init; }
}

public record ScheduledActivityDto
{
    public Guid Id { get; init; }
    public Guid TripDayId { get; init; }
    public Guid? ActivityId { get; init; }
    public string Title { get; init; } = string.Empty;
    public TimeOnly? StartTime { get; init; }
    public TimeOnly? EndTime { get; init; }
    public string? Location { get; init; }
    public string? AccessibilityNotes { get; init; }
    public string? Notes { get; init; }
    public int SortOrder { get; init; }
    public ScheduledActivityStatus Status { get; init; }
    public string? BookingReference { get; init; }
    public string? ProviderName { get; init; }
    public string? ProviderPhone { get; init; }
    public string? ProviderEmail { get; init; }
    public string? ProviderWebsite { get; init; }
    public decimal? EstimatedCost { get; init; }
    public ActivityCategory? Category { get; init; }
}

public record CreateScheduledActivityDto
{
    public Guid? ActivityId { get; init; }
    [Required, StringLength(200, MinimumLength = 1)]
    public string Title { get; init; } = string.Empty;
    public TimeOnly? StartTime { get; init; }
    public TimeOnly? EndTime { get; init; }
    [StringLength(300)]
    public string? Location { get; init; }
    [StringLength(2000)]
    public string? AccessibilityNotes { get; init; }
    [StringLength(4000)]
    public string? Notes { get; init; }
    [Range(0, 1000)]
    public int SortOrder { get; init; }
    public ScheduledActivityStatus Status { get; init; } = ScheduledActivityStatus.Planned;
    [StringLength(200)]
    public string? BookingReference { get; init; }
    [StringLength(200)]
    public string? ProviderName { get; init; }
    [StringLength(50)]
    public string? ProviderPhone { get; init; }
    [StringLength(200), EmailAddress]
    public string? ProviderEmail { get; init; }
    [StringLength(500), Url]
    public string? ProviderWebsite { get; init; }
    [Range(0, 999999.99)]
    public decimal? EstimatedCost { get; init; }
}

public record UpdateScheduledActivityDto
{
    public Guid? ActivityId { get; init; }
    [StringLength(200)]
    public string Title { get; init; } = string.Empty;
    public TimeOnly? StartTime { get; init; }
    public TimeOnly? EndTime { get; init; }
    public string? Location { get; init; }
    public string? AccessibilityNotes { get; init; }
    public string? Notes { get; init; }
    public int SortOrder { get; init; }
    public ScheduledActivityStatus Status { get; init; }
    [StringLength(200)]
    public string? BookingReference { get; init; }
    [StringLength(200)]
    public string? ProviderName { get; init; }
    [StringLength(50)]
    public string? ProviderPhone { get; init; }
    [StringLength(200)]
    public string? ProviderEmail { get; init; }
    [StringLength(500)]
    public string? ProviderWebsite { get; init; }
    public decimal? EstimatedCost { get; init; }
}
