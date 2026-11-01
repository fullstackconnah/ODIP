using Odip.Domain.Enums;
using Odip.Domain.Rostering;

namespace Odip.Domain.Entities;

/// <summary>
/// One billable line within a <see cref="TripClaim"/>. Exactly one of
/// <see cref="ParticipantBookingId"/> (trip-kind claims) or <see cref="ShiftId"/> (shift-kind
/// claims) is set — enforced by the <c>CK_ClaimLineItem_ExactlyOneParent</c> DB check
/// constraint (shift-completion design spec §1) — never both, never neither.
/// </summary>
public class ClaimLineItem
{
    public Guid Id { get; set; }

    /// <summary>
    /// The organisation the line belongs to: its claim's. Set by its writer from the parent it already loaded; the tenant query filter hides a null row from everyone but a SuperAdmin with no organisation chosen.
    /// Not an <see cref="Interfaces.ITenantEntity"/>, whose TenantId is not nullable.
    /// </summary>
    // shortcut: nullable so the previous image, whose INSERTs leave it out, still works after a rollback (expand). Contract PR: re-run the backfill for any null, then make it NOT NULL and the entity an ITenantEntity.
    public Guid? TenantId { get; set; }
    public Guid TripClaimId { get; set; }
    public TripClaim TripClaim { get; set; } = null!;

    /// <summary>Set for Kind == Trip line items; null for Kind == Shift.</summary>
    public Guid? ParticipantBookingId { get; set; }
    public ParticipantBooking? ParticipantBooking { get; set; }

    /// <summary>Set for Kind == Shift line items (design spec §1/§3); null for Kind == Trip.</summary>
    public Guid? ShiftId { get; set; }
    public Shift? Shift { get; set; }

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
    /// <summary>When the line moved into Paid (UTC); null for a line paid before this was recorded, and for a line that is not Paid. Re-saving a Paid line keeps it.</summary>
    public DateTime? PaidAt { get; set; }
}
