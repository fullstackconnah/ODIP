using System.ComponentModel.DataAnnotations;
using Odip.Domain.Enums;
namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// DASHBOARD DTOs
// ══════════════════════════════════════════════════════════════

/// <summary>What the dashboard's Get set up card reads: counts and facts for one organisation. FirstPublishedWeekStart is the Monday of the earliest non-Draft, non-Cancelled shift (a week was published, even if its shifts have since moved on).</summary>
public record SetupStatusDto(int StaffCount, int ParticipantCount, int ParticipantsWithPlanCount, DateOnly? FirstPublishedWeekStart, bool HasInvoice, bool EmploymentHeroAvailable);

public record DashboardSummaryDto
{
    public int UpcomingTripCount { get; init; }
    public int ActiveParticipantCount { get; init; }
    public int OutstandingTaskCount { get; init; }
    public int OverdueTaskCount { get; init; }
    public int ConflictCount { get; init; }
    public int TripsMissingAccommodation { get; init; }
    public int TripsMissingVehicles { get; init; }
    public int TripsMissingStaff { get; init; }
    public int OpenIncidentCount { get; init; }
    public int QscOverdueCount { get; init; }
    /// <summary>Monthly restrictive practice reports past their due date; Admin, Coordinator and SuperAdmin only, 0 for other roles.</summary>
    public int RpMonthlyReportsOverdueCount { get; init; }
    public List<TripListDto> UpcomingTrips { get; init; } = new();
}

// ══════════════════════════════════════════════════════════════
// ITINERARY DTOs (read-only composite view)
// ══════════════════════════════════════════════════════════════

public record ItineraryDto
{
    public Guid TripId { get; init; }
    public string TripName { get; init; } = string.Empty;
    /// <summary>The trip's own organisation, named on the exported PDF.</summary>
    public string? OrganisationName { get; init; }
    public string? TripCode { get; init; }
    public string? Destination { get; init; }
    public string? Region { get; init; }
    public DateOnly StartDate { get; init; }
    public DateOnly EndDate { get; init; }
    public int DurationDays { get; init; }
    public TripStatus Status { get; init; }
    public string? LeadCoordinatorName { get; init; }
    public string? Notes { get; init; }
    public int ParticipantCount { get; init; }
    public int StaffCount { get; init; }
    public decimal TotalEstimatedCost { get; init; }
    public List<ItineraryParticipantDto> Participants { get; init; } = new();
    public List<ItineraryAccommodationDto> Accommodation { get; init; } = new();
    public List<ItineraryVehicleDto> Vehicles { get; init; } = new();
    public List<ItineraryStaffDto> Staff { get; init; } = new();
    public List<ItineraryDayDto> Days { get; init; } = new();
}

public record ItineraryParticipantDto
{
    public Guid Id { get; init; }
    public string Name { get; init; } = string.Empty;
    public bool WheelchairRequired { get; init; }
    public bool HighSupportRequired { get; init; }
    public bool NightSupportRequired { get; init; }
    public SupportRatio? SupportRatio { get; init; }
    public string? MobilityNotes { get; init; }
    public string? MedicalSummary { get; init; }
}

public record ItineraryAccommodationDto
{
    public string PropertyName { get; init; } = string.Empty;
    public string? Address { get; init; }
    public string? Suburb { get; init; }
    public string? State { get; init; }
    public string? Phone { get; init; }
    public DateOnly CheckInDate { get; init; }
    public DateOnly CheckOutDate { get; init; }
    public int? BedroomsReserved { get; init; }
    public int? BedsReserved { get; init; }
    public string? ConfirmationReference { get; init; }
    public ReservationStatus ReservationStatus { get; init; }
    public decimal? Cost { get; init; }
    public string? Comments { get; init; }
}

public record ItineraryVehicleDto
{
    public string VehicleName { get; init; } = string.Empty;
    public string? Registration { get; init; }
    public VehicleType VehicleType { get; init; }
    public int TotalSeats { get; init; }
    public int WheelchairPositions { get; init; }
    public string? DriverName { get; init; }
    public VehicleAssignmentStatus Status { get; init; }
    public string? PickupTravelNotes { get; init; }
}

public record ItineraryStaffDto
{
    public string Name { get; init; } = string.Empty;
    public string? Role { get; init; }
    public string? Email { get; init; }
    public string? Mobile { get; init; }
    public DateOnly AssignmentStart { get; init; }
    public DateOnly AssignmentEnd { get; init; }
    public bool IsDriver { get; init; }
    public SleepoverType SleepoverType { get; init; }
    public AssignmentStatus Status { get; init; }
}

public record ItineraryDayDto
{
    public int DayNumber { get; init; }
    public DateOnly Date { get; init; }
    public string? DayTitle { get; init; }
    public string? DayNotes { get; init; }
    public List<ItineraryActivityDto> Activities { get; init; } = new();
    public List<ItineraryDayAccommodationEventDto> AccommodationEvents { get; init; } = new();
    public List<string> StaffOnDuty { get; init; } = new();
}

public record ItineraryActivityDto
{
    public string Title { get; init; } = string.Empty;
    public TimeOnly? StartTime { get; init; }
    public TimeOnly? EndTime { get; init; }
    public string? Location { get; init; }
    public ActivityCategory? Category { get; init; }
    public ScheduledActivityStatus Status { get; init; }
    public string? AccessibilityNotes { get; init; }
    public string? Notes { get; init; }
    public string? BookingReference { get; init; }
    public string? ProviderName { get; init; }
    public string? ProviderPhone { get; init; }
    public decimal? EstimatedCost { get; init; }
}

public record ItineraryDayAccommodationEventDto
{
    public string EventType { get; init; } = string.Empty; // "Check-in" or "Check-out"
    public string PropertyName { get; init; } = string.Empty;
    public string? Address { get; init; }
    public string? ConfirmationReference { get; init; }
}
