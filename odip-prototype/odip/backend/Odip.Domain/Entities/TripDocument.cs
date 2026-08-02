using Odip.Domain.Enums;

namespace Odip.Domain.Entities;

/// <summary>
/// Document metadata index linked to a trip.
/// </summary>
public class TripDocument
{
    public Guid Id { get; set; }
    public Guid TripInstanceId { get; set; }
    public TripInstance TripInstance { get; set; } = null!;
    public Guid? ParticipantBookingId { get; set; }
    public ParticipantBooking? ParticipantBooking { get; set; }
    public DocumentType DocumentType { get; set; }
    public string FileName { get; set; } = string.Empty;
    public string? FilePath { get; set; }
    public long? FileSize { get; set; }
    public DateOnly? DocumentDate { get; set; }
    public string? Notes { get; set; }
    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
