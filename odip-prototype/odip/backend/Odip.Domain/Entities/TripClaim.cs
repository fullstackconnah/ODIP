using Odip.Domain.Enums;

namespace Odip.Domain.Entities;

public class TripClaim
{
    public Guid Id { get; set; }
    public Guid TripInstanceId { get; set; }
    public TripInstance TripInstance { get; set; } = null!;

    public TripClaimStatus Status { get; set; } = TripClaimStatus.Draft;
    public string ClaimReference { get; set; } = string.Empty;
    public decimal TotalAmount { get; set; }
    public decimal TotalApprovedAmount { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? SubmittedDate { get; set; }
    public DateTime? PaidDate { get; set; }

    public Guid? AuthorisedByUserId { get; set; }
    public User? AuthorisedByUser { get; set; }

    public string? Notes { get; set; }

    public ICollection<ClaimLineItem> LineItems { get; set; } = new List<ClaimLineItem>();
}
