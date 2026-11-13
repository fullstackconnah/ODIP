using Odip.Domain.Enums;
using Odip.Domain.Rostering;
namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// SCHEDULE OVERVIEW DTOs
// ══════════════════════════════════════════════════════════════

public record ScheduleOverviewDto
{
    public List<ScheduleTripDto> Trips { get; init; } = new();
    public List<ScheduleStaffDto> Staff { get; init; } = new();
    public List<ScheduleVehicleDto> Vehicles { get; init; } = new();
}

public record ScheduleTripDto
{
    public Guid Id { get; init; }
    public string TripName { get; init; } = string.Empty;
    public string? TripCode { get; init; }
    public string? Destination { get; init; }
    public string? Region { get; init; }
    public DateOnly StartDate { get; init; }
    public DateOnly EndDate { get; init; }
    public int DurationDays { get; init; }
    public TripStatus Status { get; init; }
    public int? MaxParticipants { get; init; }
    public int CurrentParticipantCount { get; init; }
    public int? MinStaffRequired { get; init; }
    public int? StaffRequired { get; init; }
    public int StaffAssignedCount { get; init; }
    public int StaffShort { get; init; }
    public int VehicleAssignedCount { get; init; }
    public string? LeadCoordinatorName { get; init; }
    public int PreferenceMatchCount { get; init; }
}

public record ScheduleStaffDto
{
    public Guid Id { get; init; }
    public string FirstName { get; init; } = string.Empty;
    public string LastName { get; init; } = string.Empty;
    public string FullName { get; init; } = string.Empty;
    public Position Role { get; init; }
    public string? Region { get; init; }
    public bool IsDriverEligible { get; init; }
    public bool IsFirstAidQualified { get; init; }
    public bool IsMedicationCompetent { get; init; }
    public bool IsManualHandlingCompetent { get; init; }
    public bool IsOvernightEligible { get; init; }
    public List<ScheduleStaffTripStatusDto> TripStatuses { get; init; } = new();
    public List<ScheduleAvailabilityItemDto> Availability { get; init; } = new();
    public List<TripPreferenceDto> PreferredForTrips { get; init; } = new();
}

/// <summary>Source of a <see cref="ScheduleAvailabilityItemDto"/> row.</summary>
public enum ScheduleAvailabilityKind { Leave, RecurringRule, Legacy }

/// <summary>
/// A single unified availability/unavailability record for a staff member on the schedule board,
/// sourced directly from LeaveRequest, RecurringUnavailability, or the legacy StaffAvailability
/// table (Kind says which) — not from the expanded IStaffUnavailabilityQuery windows used for the
/// per-trip status cells. See docs/specs/2026-09-07-staff-leave-unavailability-design.md.
/// </summary>
public record ScheduleAvailabilityItemDto
{
    public Guid Id { get; init; }
    public ScheduleAvailabilityKind Kind { get; init; }
    public LeaveStatus? Status { get; init; }          // Leave/RecurringRule only; null for Legacy
    public LeaveType? LeaveType { get; init; }         // Leave only
    public AvailabilityType? AvailabilityType { get; init; } // Legacy only
    public DateOnly StartDate { get; init; }           // Leave.StartDate | Rule.EffectiveFrom | Legacy StartDateTime.Date
    public DateOnly? EndDate { get; init; }            // Leave.EndDate | Rule.EffectiveTo (nullable) | Legacy EndDateTime.Date
    public DayOfWeek? DayOfWeek { get; init; }         // RecurringRule only
    public TimeOnly? StartTime { get; init; }          // RecurringRule only
    public TimeOnly? EndTime { get; init; }            // RecurringRule only
    public string? Notes { get; init; }                // Leave.Reason | Rule.Notes | Legacy.Notes
}

public record ScheduleStaffTripStatusDto
{
    public Guid TripId { get; init; }
    /// Available, Unavailable, Assigned, Conflict
    public string Status { get; init; } = string.Empty;
    public string? AssignmentRole { get; init; }
    public AssignmentStatus? AssignmentStatus { get; init; }
    public Guid? AssignmentId { get; init; }
}

public record TripPreferenceDto(Guid TripId, int ParticipantCount);

public record ScheduleVehicleDto
{
    public Guid Id { get; init; }
    public string VehicleName { get; init; } = string.Empty;
    public string? Registration { get; init; }
    public VehicleType VehicleType { get; init; }
    public int TotalSeats { get; init; }
    public int WheelchairPositions { get; init; }
    public bool IsInternal { get; init; }
    public List<ScheduleVehicleTripStatusDto> TripStatuses { get; init; } = new();
}

public record ScheduleVehicleTripStatusDto
{
    public Guid TripId { get; init; }
    /// Available, Assigned, Conflict
    public string Status { get; init; } = string.Empty;
    public VehicleAssignmentStatus? AssignmentStatus { get; init; }
}
