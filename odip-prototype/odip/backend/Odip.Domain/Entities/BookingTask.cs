using Odip.Domain.Enums;

namespace Odip.Domain.Entities;

/// <summary>
/// Actions and follow-ups linked to a trip or booking.
/// </summary>
public class BookingTask
{
    public Guid Id { get; set; }
    public Guid TripInstanceId { get; set; }
    public TripInstance TripInstance { get; set; } = null!;
    public Guid? ParticipantBookingId { get; set; }
    public ParticipantBooking? ParticipantBooking { get; set; }
    public Guid? AccommodationReservationId { get; set; }
    public AccommodationReservation? AccommodationReservation { get; set; }
    public Guid? VehicleAssignmentId { get; set; }
    public VehicleAssignment? VehicleAssignment { get; set; }
    public Guid? StaffAssignmentId { get; set; }
    public StaffAssignment? StaffAssignment { get; set; }
    public TaskType TaskType { get; set; }
    public string Title { get; set; } = string.Empty;
    public Guid? OwnerId { get; set; }
    public Staff? Owner { get; set; }
    public TaskPriority Priority { get; set; } = TaskPriority.Medium;
    public DateOnly? DueDate { get; set; }
    public TaskItemStatus Status { get; set; } = TaskItemStatus.NotStarted;
    public DateOnly? CompletedDate { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
