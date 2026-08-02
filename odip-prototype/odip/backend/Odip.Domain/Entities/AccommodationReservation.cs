using Odip.Domain.Enums;

namespace Odip.Domain.Entities;

/// <summary>
/// Trip-specific accommodation booking/reservation.
/// </summary>
public class AccommodationReservation
{
    public Guid Id { get; set; }
    public Guid TripInstanceId { get; set; }
    public TripInstance TripInstance { get; set; } = null!;
    public Guid AccommodationPropertyId { get; set; }
    public AccommodationProperty AccommodationProperty { get; set; } = null!;
    public DateOnly? RequestSentDate { get; set; }
    public DateOnly? DateBooked { get; set; }
    public DateOnly? DateConfirmed { get; set; }
    public DateOnly CheckInDate { get; set; }
    public DateOnly CheckOutDate { get; set; }
    public int? BedroomsReserved { get; set; }
    public int? BedsReserved { get; set; }
    public decimal? Cost { get; set; }
    public string? ConfirmationReference { get; set; }
    public ReservationStatus ReservationStatus { get; set; } = ReservationStatus.Researching;
    public string? Comments { get; set; }
    public string? CancellationReason { get; set; }
    public bool HasOverlapConflict { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public ICollection<BookingTask> Tasks { get; set; } = new List<BookingTask>();
}
