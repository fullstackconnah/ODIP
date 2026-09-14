using Odip.Domain.Enums;

namespace Odip.Domain.Entities;

/// <summary>
/// A draft/submitted NDIS claim. <see cref="Kind"/> discriminates two shapes (shift-completion
/// design spec §1): <c>Trip</c> (the original shape) has <see cref="TripInstanceId"/> set and
/// <see cref="ParticipantId"/>/<see cref="PeriodFrom"/>/<see cref="PeriodTo"/> null; <c>Shift</c>
/// has the reverse. This invariant is documented here and enforced in
/// <c>ShiftClaimGenerationService</c>/<c>ClaimGenerationService</c> (the two writers), not by a
/// DB constraint — a check spanning five nullable columns was judged not worth the complexity
/// for a single-writer invariant. <see cref="ClaimLineItem"/>'s exactly-one-parent invariant
/// (the line-item-level equivalent) IS a DB check constraint — see that entity's doc comment.
/// </summary>
public class TripClaim
{
    public Guid Id { get; set; }

    public ClaimKind Kind { get; set; } = ClaimKind.Trip;

    /// <summary>Set for Kind == Trip; null for Kind == Shift.</summary>
    public Guid? TripInstanceId { get; set; }
    public TripInstance? TripInstance { get; set; }

    /// <summary>Set for Kind == Shift; null for Kind == Trip.</summary>
    public Guid? ParticipantId { get; set; }
    public Participant? Participant { get; set; }
    public DateOnly? PeriodFrom { get; set; }
    public DateOnly? PeriodTo { get; set; }

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
