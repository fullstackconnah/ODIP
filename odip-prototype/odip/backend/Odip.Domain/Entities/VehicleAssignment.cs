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
    public Guid? DriverUserId { get; set; }
    public User? DriverUser { get; set; }
    public int? SeatRequirement { get; set; }
    public int? WheelchairPositionRequirement { get; set; }
    public string? PickupTravelNotes { get; set; }
    public string? Comments { get; set; }
    /// <summary>Legacy silent overlap flag — now derived at write time from whether
    /// RosterConflictService.VehicleDoubleBooked fired (see VehicleAssignmentsController), so it
    /// can never be true on a successfully saved row: that finding is Blocking and the write is
    /// rejected before it would be persisted. Kept because VehiclesTab still reads it for its
    /// "Conflict" badge; single-sourced from the same rule as the gate rather than a second,
    /// independently-computed overlap query.</summary>
    public bool HasOverlapConflict { get; set; }
    public bool HasConflict { get; set; }
    /// <summary>Why the coordinator accepted a Warning finding when creating/updating this vehicle assignment.</summary>
    public string? OverrideReason { get; set; }
    /// <summary>Comma-separated RosterFinding.Code values the coordinator acknowledged.</summary>
    public string? AcknowledgedFindingCodes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public ICollection<BookingTask> Tasks { get; set; } = new List<BookingTask>();
}
