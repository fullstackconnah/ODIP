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
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public ICollection<BookingTask> Tasks { get; set; } = new List<BookingTask>();
}
