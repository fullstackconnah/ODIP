using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// Master record for an accommodation property.
/// </summary>
public class AccommodationProperty : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }
    public string PropertyName { get; set; } = string.Empty;
    public string? ProviderOwner { get; set; }
    public string? Location { get; set; }
    public string? Region { get; set; }
    public string? Address { get; set; }
    public string? Suburb { get; set; }
    public string? State { get; set; }
    public string? Postcode { get; set; }
    public string? ContactPerson { get; set; }
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public string? Mobile { get; set; }
    public string? Website { get; set; }
    public bool IsFullyModified { get; set; }
    public bool IsSemiModified { get; set; }
    public bool IsWheelchairAccessible { get; set; }
    public string? AccessibilityNotes { get; set; }
    public int? BedroomCount { get; set; }
    public int? BedCount { get; set; }
    public int? MaxCapacity { get; set; }
    public string? BeddingConfiguration { get; set; }
    public string? HoistBathroomNotes { get; set; }
    public string? GeneralNotes { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public ICollection<AccommodationReservation> Reservations { get; set; } = new List<AccommodationReservation>();
}
