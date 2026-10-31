using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>The checks a claim must pass to be sent to the NDIA, shared by the claims controller (the claim's own Submitted button) and the NDIA file batches.</summary>
public static class ClaimSubmission
{
    /// <summary>
    /// A draft made before the engines left out other-funded participants can still hold their lines: they are not claimed to the NDIS, so the claim can't be sent. The refusal's message, or null.
    /// </summary>
    public static async Task<string?> OtherFundedRefusalAsync(OdipDbContext db, TripClaim c, CancellationToken ct)
    {
        var lineParticipantIds = db.ClaimLineItems.Where(l => l.TripClaimId == c.Id && l.ParticipantBooking != null).Select(l => l.ParticipantBooking!.ParticipantId);
        var participants = await db.Participants.Where(p => p.Id == c.ParticipantId || lineParticipantIds.Contains(p.Id)).ToListAsync(ct);
        var otherFunded = participants.Where(Odip.Domain.Billing.ClaimFunding.IsOtherFunded).Select(p => p.FullName).Distinct().ToList();
        return otherFunded.Count == 0 ? null
            : $"{string.Join(", ", otherFunded)} {(otherFunded.Count == 1 ? "is" : "are")} funded another way, so this claim can't be submitted to the NDIS. Remove their lines or reject the claim.";
    }

    /// <summary>The reference of ANOTHER claim holding a line that still counts (the ledger's rule) for a shift or booking that <paramref name="lines"/> also hold; null when there is none. A rejected line or claim frees its shift, so it can be claimed again, and must not be billed twice.</summary>
    public static async Task<string?> HoldingTheSameAsync(OdipDbContext db, Guid claimId, IQueryable<ClaimLineItem> lines, CancellationToken ct) =>
        await db.ClaimLineItems.Where(BudgetLedgerService.ClaimLineStillCounts)
            .Where(o => o.TripClaimId != claimId && lines.Any(l => (l.ShiftId != null && l.ShiftId == o.ShiftId) || (l.ParticipantBookingId != null && l.ParticipantBookingId == o.ParticipantBookingId)))
            .Select(o => o.TripClaim.ClaimReference).FirstOrDefaultAsync(ct);
}
