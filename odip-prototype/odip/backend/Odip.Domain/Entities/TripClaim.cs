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

    /// <summary>
    /// "TC-{code}-{yyyyMMdd}-{first 6 of the claim id}" for <see cref="ClaimReference"/>, which is unique: the id part keeps apart two claims made the same day for one participant or trip
    /// (shift claims over different ranges; a rejected trip claim made again). The code is a NDIS number or trip code, at most 20 characters, so this is at most 39 of the column's 50.
    /// </summary>
    public static string ReferenceFor(string code, Guid claimId) =>
        $"TC-{code}-{DateTime.UtcNow.ToString("yyyyMMdd", System.Globalization.CultureInfo.InvariantCulture)}-{claimId.ToString("N")[..6].ToUpperInvariant()}";
    public decimal TotalAmount { get; set; }
    public decimal TotalApprovedAmount { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? SubmittedDate { get; set; }
    public DateTime? PaidDate { get; set; }

    /// <summary>
    /// The instant the claim was marked Rejected (a UTC instant, like <see cref="SubmittedDate"/> and <see cref="PaidDate"/>); null while it is not rejected, and for a claim rejected before this was
    /// recorded. The budget feature dates the NDIA's "the funds ran out" signal by it.
    /// </summary>
    public DateTime? RejectedDate { get; set; }

    /// <summary>
    /// The NDIA's code for why it refused the claim, when somebody recorded one (at most <see cref="Odip.Domain.Funding.NdiaRejectionCodes.MaxLength"/> characters): V17, V18, V27 and V28 say the money ran
    /// out (see <see cref="Odip.Domain.Funding.NdiaRejectionCodes.MeansNotEnoughFunds"/>); anything else is kept as it was typed. Set only while the claim is Rejected, and cleared when it leaves that status.
    /// </summary>
    public string? RejectionCode { get; set; }

    public Guid? AuthorisedByUserId { get; set; }
    public User? AuthorisedByUser { get; set; }

    public string? Notes { get; set; }

    public ICollection<ClaimLineItem> LineItems { get; set; } = new List<ClaimLineItem>();
}
