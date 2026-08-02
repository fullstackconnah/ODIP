using Odip.Domain.Enums;

namespace Odip.Domain.Entities;

/// <summary>
/// Trip-specific vehicle allocation.
/// </summary>
public class VehicleAssignment
{
    public Guid Id { get; set; }
    public Guid TripInstanceId { get; set; }
    public TripInstance TripInstance { get; set; } = null!;
    public Guid VehicleId { get; set; }
    public Vehicle Vehicle { get; set; } = null!;
    public DateOnly? RequestedDate { get; set; }
    public DateOnly? ConfirmedDate { get; set; }
    public VehicleAssignmentStatus Status { get; set; } = VehicleAssignmentStatus.Requested;
    public Guid? DriverStaffId { get; set; }
    public Staff? DriverStaff { get; set; }
    public int? SeatRequirement { get; set; }
    public int? WheelchairPositionRequirement { get; set; }
    public string? PickupTravelNotes { get; set; }
    public string? Comments { get; set; }
    public bool HasOverlapConflict { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public ICollection<BookingTask> Tasks { get; set; } = new List<BookingTask>();
}
