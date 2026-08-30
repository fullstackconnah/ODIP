using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// Central hub entity — an actual scheduled trip departure.
/// </summary>
public class TripInstance : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }
    public string TripName { get; set; } = string.Empty;
    public string? TripCode { get; set; }
    public Guid? EventTemplateId { get; set; }
    public EventTemplate? EventTemplate { get; set; }
    public string? Destination { get; set; }
    public string? Region { get; set; }
    public DateOnly StartDate { get; set; }
    public int DurationDays { get; set; }
    public DateOnly EndDate => StartDate.AddDays(DurationDays - 1);
    public DateOnly OopDueDate => StartDate.AddDays(-90);
    public DateOnly? BookingCutoffDate { get; set; }
    public TripStatus Status { get; set; } = TripStatus.Draft;
    public Guid? LeadCoordinatorId { get; set; }
    public User? LeadCoordinator { get; set; }
    public int? MinParticipants { get; set; }
    public int? MaxParticipants { get; set; }
    public int? RequiredWheelchairCapacity { get; set; }
    public int? RequiredBeds { get; set; }
    public int? RequiredBedrooms { get; set; }
    public int? MinStaffRequired { get; set; }
    public decimal CalculatedStaffRequired { get; set; }
    public string? Notes { get; set; }
    public Guid? DefaultActivityGroupId { get; set; }
    public SupportActivityGroup? DefaultActivityGroup { get; set; }
    public decimal ActiveHoursPerDay { get; set; } = 8;
    public TimeOnly? DepartureTime { get; set; }
    public TimeOnly? ReturnTime { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public ICollection<ParticipantBooking> Bookings { get; set; } = new List<ParticipantBooking>();
    public ICollection<AccommodationReservation> AccommodationReservations { get; set; } = new List<AccommodationReservation>();
    public ICollection<VehicleAssignment> VehicleAssignments { get; set; } = new List<VehicleAssignment>();
    public ICollection<StaffAssignment> StaffAssignments { get; set; } = new List<StaffAssignment>();
    public ICollection<BookingTask> Tasks { get; set; } = new List<BookingTask>();
    public ICollection<TripDocument> Documents { get; set; } = new List<TripDocument>();
    public ICollection<TripDay> TripDays { get; set; } = new List<TripDay>();
    public ICollection<IncidentReport> IncidentReports { get; set; } = new List<IncidentReport>();
    public ICollection<TripClaim> TripClaims { get; set; } = new List<TripClaim>();
}
