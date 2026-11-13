using System.ComponentModel.DataAnnotations;
using Odip.Domain.Enums;
namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// TASK DTOs
// ══════════════════════════════════════════════════════════════

public record TaskDto
{
    public Guid Id { get; init; }
    public Guid? TripInstanceId { get; init; }
    public string? TripName { get; init; }
    public Guid? ParticipantBookingId { get; init; }
    public Guid? AccommodationReservationId { get; init; }
    public Guid? VehicleAssignmentId { get; init; }
    public Guid? StaffAssignmentId { get; init; }
    // Generic obligation source links (item 9 of the connection map) — set only on tasks raised
    // by IObligationTaskService, never on manually-created trip/booking tasks.
    public string? LinkTo { get; init; }
    public string? SourceKey { get; init; }
    public Guid? ShiftId { get; init; }
    public Guid? IncidentReportId { get; init; }
    public Guid? MedicationAdministrationId { get; init; }
    public Guid? ShiftNoteId { get; init; }
    public Guid? LeaveRequestId { get; init; }
    public TaskType TaskType { get; init; }
    public string Title { get; init; } = string.Empty;
    public Guid? OwnerId { get; init; }
    public string? OwnerName { get; init; }
    public TaskPriority Priority { get; init; }
    public DateOnly? DueDate { get; init; }
    public TaskItemStatus Status { get; init; }
    public DateOnly? CompletedDate { get; init; }
    public string? Notes { get; init; }
}

public record CreateTaskDto
{
    /// <summary>Optional: a task needs no trip (house upkeep, renewals). When sent it must be the caller's own trip.</summary>
    public Guid? TripInstanceId { get; init; }
    public Guid? ParticipantBookingId { get; init; }
    public Guid? AccommodationReservationId { get; init; }
    public Guid? VehicleAssignmentId { get; init; }
    public Guid? StaffAssignmentId { get; init; }
    public TaskType TaskType { get; init; }
    [Required, StringLength(300, MinimumLength = 1)]
    public string Title { get; init; } = string.Empty;
    public Guid? OwnerId { get; init; }
    public TaskPriority Priority { get; init; } = TaskPriority.Medium;
    public DateOnly? DueDate { get; init; }
    [StringLength(4000)]
    public string? Notes { get; init; }
}

public record UpdateTaskDto : CreateTaskDto
{
    public TaskItemStatus Status { get; init; }
    public DateOnly? CompletedDate { get; init; }
}

/// <summary>The one-tap Done: only the day it was completed; every other field of the task stays as the server has it.</summary>
public record CompleteTaskDto
{
    public DateOnly? CompletedDate { get; init; }
}

/// <summary>A status change from the Tasks page or a trip's Tasks tab: the new status and, for Completed, the day; every other field of the task stays as the server has it.</summary>
public record SetTaskStatusDto
{
    /// <summary>Null when the body names none: the server answers 400 rather than reading it as NotStarted and reopening the task.</summary>
    public TaskItemStatus? Status { get; init; }
    public DateOnly? CompletedDate { get; init; }
}

// ══════════════════════════════════════════════════════════════
// ACTIVITY DTOs
// ══════════════════════════════════════════════════════════════

public record ActivityDto
{
    public Guid Id { get; init; }
    public Guid? EventTemplateId { get; init; }
    public string ActivityName { get; init; } = string.Empty;
    public ActivityCategory Category { get; init; }
    public string? Location { get; init; }
    public string? AccessibilityNotes { get; init; }
    public string? SuitabilityNotes { get; init; }
    public string? Notes { get; init; }
    public bool IsActive { get; init; }
}

public record CreateActivityDto
{
    public Guid? EventTemplateId { get; init; }
    [Required, StringLength(200, MinimumLength = 1)]
    public string ActivityName { get; init; } = string.Empty;
    public ActivityCategory Category { get; init; }
    [StringLength(200)]
    public string? Location { get; init; }
    public string? AccessibilityNotes { get; init; }
    public string? SuitabilityNotes { get; init; }
    public string? Notes { get; init; }
    public bool IsActive { get; init; } = true;
}

public record UpdateActivityDto : CreateActivityDto { }

// ══════════════════════════════════════════════════════════════
// EVENT TEMPLATE DTOs
// ══════════════════════════════════════════════════════════════

public record EventTemplateDto
{
    public Guid Id { get; init; }
    public string EventCode { get; init; } = string.Empty;
    public string EventName { get; init; } = string.Empty;
    public string? DefaultDestination { get; init; }
    public string? DefaultRegion { get; init; }
    public string? PreferredTimeOfYear { get; init; }
    public int? StandardDurationDays { get; init; }
    public string? AccessibilityNotes { get; init; }
    public string? FullyModifiedAccommodationNotes { get; init; }
    public string? SemiModifiedAccommodationNotes { get; init; }
    public string? WheelchairAccessNotes { get; init; }
    public string? TypicalActivities { get; init; }
    public bool IsActive { get; init; }
}

public record CreateEventTemplateDto
{
    public string EventCode { get; init; } = string.Empty;
    public string EventName { get; init; } = string.Empty;
    public string? DefaultDestination { get; init; }
    public string? DefaultRegion { get; init; }
    public string? PreferredTimeOfYear { get; init; }
    public int? StandardDurationDays { get; init; }
    public string? AccessibilityNotes { get; init; }
    public string? FullyModifiedAccommodationNotes { get; init; }
    public string? SemiModifiedAccommodationNotes { get; init; }
    public string? WheelchairAccessNotes { get; init; }
    public string? TypicalActivities { get; init; }
    public bool IsActive { get; init; } = true;
}

public record UpdateEventTemplateDto : CreateEventTemplateDto { }
