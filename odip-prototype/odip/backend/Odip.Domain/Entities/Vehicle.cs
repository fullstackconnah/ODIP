using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// Master record for a vehicle in the fleet.
/// </summary>
public class Vehicle : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }
    public string VehicleName { get; set; } = string.Empty;
    public string? Registration { get; set; }
    public VehicleType VehicleType { get; set; }
    public int TotalSeats { get; set; }
    public int WheelchairPositions { get; set; }
    public string? RampHoistDetails { get; set; }
    public string? DriverRequirements { get; set; }
    public bool IsInternal { get; set; } = true;
    public bool IsActive { get; set; } = true;
    public DateOnly? ServiceDueDate { get; set; }
    public DateOnly? RegistrationDueDate { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public ICollection<VehicleAssignment> Assignments { get; set; } = new List<VehicleAssignment>();
}
