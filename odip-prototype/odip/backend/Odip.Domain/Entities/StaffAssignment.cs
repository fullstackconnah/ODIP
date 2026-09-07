using Odip.Domain.Enums;

namespace Odip.Domain.Entities;

/// <summary>
/// Junction: Staff ↔ TripInstance assignment.
/// </summary>
public class StaffAssignment
{
    public Guid Id { get; set; }
    public Guid TripInstanceId { get; set; }
    public TripInstance TripInstance { get; set; } = null!;
    public Guid UserId { get; set; }
    public User User { get; set; } = null!;
    public string? AssignmentRole { get; set; }
    public DateOnly AssignmentStart { get; set; }
    public DateOnly AssignmentEnd { get; set; }
    public AssignmentStatus Status { get; set; } = AssignmentStatus.Proposed;
    public bool IsDriver { get; set; }
    public SleepoverType SleepoverType { get; set; } = SleepoverType.None;
    public string? ShiftNotes { get; set; }
    public bool HasConflict { get; set; }
    /// <summary>Why the coordinator accepted a Warning finding when creating/updating this trip assignment. Wired by PR 3 (StaffAssignmentsController); the column and property land now so the migration stays single and additive.</summary>
    public string? OverrideReason { get; set; }
    /// <summary>Comma-separated RosterFinding.Code values the coordinator acknowledged. Wired by PR 3.</summary>
    public string? AcknowledgedFindingCodes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public ICollection<BookingTask> Tasks { get; set; } = new List<BookingTask>();
}
