using Odip.Domain.Enums;

namespace Odip.Domain.Entities;

/// <summary>
/// Junction table linking a Participant to a TripInstance (booking).
/// </summary>
public class ParticipantBooking
{
    public Guid Id { get; set; }
    public Guid TripInstanceId { get; set; }
    public TripInstance TripInstance { get; set; } = null!;
    public Guid ParticipantId { get; set; }
    public Participant Participant { get; set; } = null!;
    public BookingStatus BookingStatus { get; set; } = BookingStatus.Enquiry;
    public DateOnly BookingDate { get; set; }
    public SupportRatio? SupportRatioOverride { get; set; }
    public bool NightSupportRequired { get; set; }
    public bool WheelchairRequired { get; set; }
    public bool HighSupportRequired { get; set; }
    public bool HasRestrictivePracticeFlag { get; set; }
    public PlanType? PlanTypeOverride { get; set; }
    public string? FundingNotes { get; set; }
    public string? RoomPreference { get; set; }
    public string? TransportNotes { get; set; }
    public string? EquipmentNotes { get; set; }
    public string? RiskSupportNotes { get; set; }
    public PaymentStatus PaymentStatus { get; set; } = PaymentStatus.NotInvoiced;

    // Insurance tracking
    public string? InsuranceProvider { get; set; }
    public string? InsurancePolicyNumber { get; set; }
    public DateOnly? InsuranceCoverageStart { get; set; }
    public DateOnly? InsuranceCoverageEnd { get; set; }
    public InsuranceStatus InsuranceStatus { get; set; } = InsuranceStatus.None;
    public ClaimStatus ClaimStatus { get; set; } = ClaimStatus.NotClaimed;
    public DateOnly? CancellationNoticeDate { get; set; }

    public bool ActionRequired { get; set; }
    public string? BookingNotes { get; set; }
    public string? CancellationReason { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public ICollection<BookingTask> Tasks { get; set; } = new List<BookingTask>();
    public ICollection<TripDocument> Documents { get; set; } = new List<TripDocument>();
}
