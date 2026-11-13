using System.ComponentModel.DataAnnotations;
using Odip.Domain.Enums;
namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// ACCOMMODATION DTOs
// ══════════════════════════════════════════════════════════════

public record AccommodationListDto
{
    public Guid Id { get; init; }
    public string PropertyName { get; init; } = string.Empty;
    public string? Location { get; init; }
    public string? Region { get; init; }
    public string? Address { get; init; }
    public string? Suburb { get; init; }
    public string? State { get; init; }
    public string? Postcode { get; init; }
    public bool IsFullyModified { get; init; }
    public bool IsSemiModified { get; init; }
    public bool IsWheelchairAccessible { get; init; }
    public int? BedroomCount { get; init; }
    public int? BedCount { get; init; }
    public int? MaxCapacity { get; init; }
    public bool IsActive { get; init; }
}

public record AccommodationDetailDto : AccommodationListDto
{
    public string? ProviderOwner { get; init; }
    public string? ContactPerson { get; init; }
    public string? Email { get; init; }
    public string? Phone { get; init; }
    public string? Mobile { get; init; }
    public string? Website { get; init; }
    public string? AccessibilityNotes { get; init; }
    public string? BeddingConfiguration { get; init; }
    public string? HoistBathroomNotes { get; init; }
    public string? GeneralNotes { get; init; }
}

public record CreateAccommodationDto
{
    [Required, StringLength(200, MinimumLength = 1)]
    public string PropertyName { get; init; } = string.Empty;
    [StringLength(200)]
    public string? ProviderOwner { get; init; }
    [StringLength(200)]
    public string? Location { get; init; }
    [StringLength(100)]
    public string? Region { get; init; }
    [StringLength(500)]
    public string? Address { get; init; }
    [StringLength(100)]
    public string? Suburb { get; init; }
    [StringLength(50)]
    public string? State { get; init; }
    [StringLength(10)]
    public string? Postcode { get; init; }
    [StringLength(200)]
    public string? ContactPerson { get; init; }
    [StringLength(200), EmailAddress]
    public string? Email { get; init; }
    [StringLength(50)]
    public string? Phone { get; init; }
    [StringLength(50)]
    public string? Mobile { get; init; }
    [StringLength(500)]
    public string? Website { get; init; }
    public bool IsFullyModified { get; init; }
    public bool IsSemiModified { get; init; }
    public bool IsWheelchairAccessible { get; init; }
    public string? AccessibilityNotes { get; init; }
    public int? BedroomCount { get; init; }
    public int? BedCount { get; init; }
    public int? MaxCapacity { get; init; }
    public string? BeddingConfiguration { get; init; }
    public string? HoistBathroomNotes { get; init; }
    public string? GeneralNotes { get; init; }
    public bool IsActive { get; init; } = true;
}

public record UpdateAccommodationDto : CreateAccommodationDto { }

// ══════════════════════════════════════════════════════════════
// RESERVATION DTOs
// ══════════════════════════════════════════════════════════════

public record ReservationDto
{
    public Guid Id { get; init; }
    public Guid TripInstanceId { get; init; }
    public string? TripName { get; init; }
    public Guid AccommodationPropertyId { get; init; }
    public string? PropertyName { get; init; }
    public DateOnly? RequestSentDate { get; init; }
    public DateOnly? DateBooked { get; init; }
    public DateOnly? DateConfirmed { get; init; }
    public DateOnly CheckInDate { get; init; }
    public DateOnly CheckOutDate { get; init; }
    public int? BedroomsReserved { get; init; }
    public int? BedsReserved { get; init; }
    public decimal? Cost { get; init; }
    public string? ConfirmationReference { get; init; }
    public ReservationStatus ReservationStatus { get; init; }
    public string? Comments { get; init; }
    public string? CancellationReason { get; init; }
    public bool HasOverlapConflict { get; init; }
}

public record CreateReservationDto
{
    public Guid TripInstanceId { get; init; }
    public Guid AccommodationPropertyId { get; init; }
    public DateOnly? RequestSentDate { get; init; }
    public DateOnly CheckInDate { get; init; }
    public DateOnly CheckOutDate { get; init; }
    public int? BedroomsReserved { get; init; }
    public int? BedsReserved { get; init; }
    public decimal? Cost { get; init; }
    public string? Comments { get; init; }
    public ReservationStatus ReservationStatus { get; init; } = ReservationStatus.Researching;
}

public record UpdateReservationDto : CreateReservationDto
{
    public DateOnly? DateBooked { get; init; }
    public DateOnly? DateConfirmed { get; init; }
    public string? ConfirmationReference { get; init; }
    public string? CancellationReason { get; init; }
}
