using Odip.Domain.Enums;

namespace Odip.Domain.Entities;

public class ClaimLineItem
{
    public Guid Id { get; set; }
    public Guid TripClaimId { get; set; }
    public TripClaim TripClaim { get; set; } = null!;
    public Guid ParticipantBookingId { get; set; }
    public ParticipantBooking ParticipantBooking { get; set; } = null!;

    public string SupportItemCode { get; set; } = string.Empty;
    public ClaimDayType DayType { get; set; }
    public DateOnly SupportsDeliveredFrom { get; set; }
    public DateOnly SupportsDeliveredTo { get; set; }

    public decimal Hours { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal TotalAmount { get; set; }

    public GSTCode GSTCode { get; set; }
    public ClaimType ClaimType { get; set; } = ClaimType.Standard;
    public string? CancellationReason { get; set; }
    public bool ParticipantApproved { get; set; }

    public ClaimLineItemStatus Status { get; set; } = ClaimLineItemStatus.Draft;
    public string? RejectionReason { get; set; }
    public decimal? PaidAmount { get; set; }
}
