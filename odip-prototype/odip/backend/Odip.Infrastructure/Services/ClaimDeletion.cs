using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>What deleting a claim checks and does, shared by the claim's Delete button and "Claim again" so the two can never disagree about when a claim may go.</summary>
public static class ClaimDeletion
{
    /// <summary>Why the claim (with its <see cref="TripClaim.LineItems"/> loaded) can't be deleted, or null. <c>Conflict</c> is a 409 (state that can change), otherwise a 400.</summary>
    public static async Task<(bool Conflict, string Message)?> RefusalAsync(OdipDbContext db, TripClaim claim, CancellationToken ct)
    {
        var lineIds = claim.LineItems.Select(l => l.Id).ToList();
        var inFile = await db.ClaimBatchLines.AsNoTracking()
            .Where(b => b.ClaimLineItemId != null && lineIds.Contains(b.ClaimLineItemId.Value) && b.Outcome == ClaimBatchLineOutcome.Pending
                && (b.Batch.Status == ClaimBatchStatus.Built || b.Batch.Status == ClaimBatchStatus.Uploaded))
            .Select(b => b.Batch.FileName).FirstOrDefaultAsync(ct);
        if (inFile != null) return (true, $"This claim is in {inFile}. Discard that file first.");

        // A claim that has gone to the NDIA keeps its lines and payment record (deleting a paid or part-paid one makes supports already paid claimable again). Rejected stays deletable on purpose:
        // its lines are locked and it cannot go back to Draft, so delete-and-regenerate is the only way to correct an NDIA rejection.
        if (claim.Status is not (TripClaimStatus.Draft or TripClaimStatus.Ready or TripClaimStatus.Rejected or TripClaimStatus.Cancelled))
            return (false, "A claim that has gone to the NDIA can't be deleted unless it was rejected.");

        // An invoice that stands must be voided first (Xero PR1, spec 5.5): its number never disappears. Voided and credited rows and credit notes stay after the delete, their claim link set null.
        var live = await db.Invoices.Where(i => i.TripClaimId == claim.Id && i.Kind == InvoiceKind.Invoice && i.Status == InvoiceStatus.Issued)
            .OrderBy(i => i.Number).Select(i => i.DisplayNumber).ToListAsync(ct);
        if (live.Count > 0) return (true, $"Void {JoinAnd(live)} first, then delete the claim.");
        return null;
    }

    /// <summary>Resets the participant bookings the claim held to unclaimed, then removes the claim and its lines (the caller saves). A shift becomes claimable again simply by its line being removed.</summary>
    public static async Task RemoveAsync(OdipDbContext db, TripClaim claim, CancellationToken ct)
    {
        // Shift-completion design spec, delivery PR 3: Kind == Shift line items have ParticipantBookingId == null, so they are filtered out rather than passed as nulls into the lookup.
        var bookingIds = claim.LineItems
            .Where(l => l.ParticipantBookingId.HasValue)
            .Select(l => l.ParticipantBookingId!.Value)
            .Distinct()
            .ToList();
        var bookings = await db.ParticipantBookings
            .Where(b => bookingIds.Contains(b.Id))
            .ToListAsync(ct);
        foreach (var booking in bookings)
            booking.ClaimStatus = ClaimStatus.NotClaimed;

        db.ClaimLineItems.RemoveRange(claim.LineItems);
        db.TripClaims.Remove(claim);
    }

    /// <summary>"A", "A and B", "A, B and C".</summary>
    private static string JoinAnd(IReadOnlyList<string> items) =>
        items.Count == 1 ? items[0] : $"{string.Join(", ", items.Take(items.Count - 1))} and {items[^1]}";
}
