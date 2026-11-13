using System.ComponentModel.DataAnnotations;
using Odip.Domain.Enums;
namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// VEHICLE DTOs
// ══════════════════════════════════════════════════════════════

public record VehicleListDto
{
    public Guid Id { get; init; }
    public string VehicleName { get; init; } = string.Empty;
    public string? Registration { get; init; }
    public VehicleType VehicleType { get; init; }
    public int TotalSeats { get; init; }
    public int WheelchairPositions { get; init; }
    public bool IsInternal { get; init; }
    public bool IsActive { get; init; }
    public DateOnly? ServiceDueDate { get; init; }
    public DateOnly? RegistrationDueDate { get; init; }
}

public record VehicleDetailDto : VehicleListDto
{
    public string? RampHoistDetails { get; init; }
    public string? DriverRequirements { get; init; }
    public string? Notes { get; init; }
}

public record CreateVehicleDto
{
    [Required, StringLength(100, MinimumLength = 1)]
    public string VehicleName { get; init; } = string.Empty;
    [StringLength(20)]
    public string? Registration { get; init; }
    public VehicleType VehicleType { get; init; }
    [Range(0, 100)]
    public int TotalSeats { get; init; }
    [Range(0, 20)]
    public int WheelchairPositions { get; init; }
    [StringLength(1000)]
    public string? RampHoistDetails { get; init; }
    [StringLength(1000)]
    public string? DriverRequirements { get; init; }
    public bool IsInternal { get; init; } = true;
    public bool IsActive { get; init; } = true;
    public DateOnly? ServiceDueDate { get; init; }
    public DateOnly? RegistrationDueDate { get; init; }
    public string? Notes { get; init; }
}

public record UpdateVehicleDto : CreateVehicleDto { }

// ══════════════════════════════════════════════════════════════
// VEHICLE ASSIGNMENT DTOs
// ══════════════════════════════════════════════════════════════

public record VehicleAssignmentDto
{
    public Guid Id { get; init; }
    public Guid TripInstanceId { get; init; }
    public Guid VehicleId { get; init; }
    public string? VehicleName { get; init; }
    public string? Registration { get; init; }
    public VehicleAssignmentStatus Status { get; init; }
    public DateOnly? RequestedDate { get; init; }
    public DateOnly? ConfirmedDate { get; init; }
    public Guid? DriverStaffId { get; init; }
    public string? DriverName { get; init; }
    public int? SeatRequirement { get; init; }
    public int? WheelchairPositionRequirement { get; init; }
    public string? PickupTravelNotes { get; init; }
    public string? Comments { get; init; }
    public bool HasOverlapConflict { get; init; }
    public bool HasConflict { get; init; }
    public string? OverrideReason { get; init; }
    public string? AcknowledgedFindingCodes { get; init; }
}

public record CreateVehicleAssignmentDto
{
    public Guid TripInstanceId { get; init; }
    public Guid VehicleId { get; init; }
    public Guid? DriverStaffId { get; init; }
    public int? SeatRequirement { get; init; }
    public int? WheelchairPositionRequirement { get; init; }
    public string? PickupTravelNotes { get; init; }
    public string? Comments { get; init; }
    /// <summary>Required when the candidate carries a RequiresReason finding; ignored (never enough) for a Blocking finding.</summary>
    [StringLength(2000)]
    public string? OverrideReason { get; init; }
    /// <summary>Finding codes the coordinator is acknowledging. Defaults to every current finding's code when omitted.</summary>
    public List<string>? AcknowledgedFindingCodes { get; init; }
}

public record UpdateVehicleAssignmentDto : CreateVehicleAssignmentDto
{
    public VehicleAssignmentStatus Status { get; init; }
    public DateOnly? ConfirmedDate { get; init; }
}

/// <summary>Dry-run input for POST /vehicle-assignments/check — mirrors CheckStaffAssignmentDto's shape for the vehicle-assignment analogue.</summary>
public record CheckVehicleAssignmentDto
{
    public Guid VehicleId { get; init; }
    public Guid TripInstanceId { get; init; }
    /// <summary>The existing assignment being re-checked, if any — excluded from its own conflict queries. Null for a brand-new candidate.</summary>
    public Guid? ExcludeAssignmentId { get; init; }
}
