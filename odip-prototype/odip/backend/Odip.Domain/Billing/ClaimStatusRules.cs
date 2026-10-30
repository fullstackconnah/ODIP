using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Domain.Billing;

/// <summary>The rules for a claim's status, shared by the claims controller and the NDIA file batches so the two can't drift.</summary>
public static class ClaimStatusRules
{
    /// <summary>The moves a claim's status may make (a claim saying the status it already has is not a move). What has gone to the NDIA keeps going forward: it is paid, part paid or rejected, and a rejected claim can be sent again.</summary>
    public static bool CanMove(TripClaimStatus from, TripClaimStatus to) => from == to || (from, to) switch
    {
        (TripClaimStatus.Draft or TripClaimStatus.Ready, TripClaimStatus.Submitted) => true,
        (TripClaimStatus.Submitted or TripClaimStatus.Approved, TripClaimStatus.Paid or TripClaimStatus.PartiallyPaid or TripClaimStatus.Rejected) => true,
        (TripClaimStatus.PartiallyPaid, TripClaimStatus.Paid) => true,
        (TripClaimStatus.Rejected, TripClaimStatus.Submitted) => true,
        _ => false,
    };

    /// <summary>The one place a claim's status is changed (the claim's own buttons, and every line paid or rejected): a real move stamps the day it was submitted or paid, and a repeat of the same status stamps nothing.</summary>
    public static void ApplyStatus(TripClaim claim, TripClaimStatus status, DateTime now)
    {
        var before = claim.Status;
        if (before == status) return;
        claim.Status = status;
        if (status == TripClaimStatus.Submitted) claim.SubmittedDate = now;
        if (status == TripClaimStatus.Paid) claim.PaidDate = now;
        KeepRejectionRecord(claim, before, now);
    }

    /// <summary>
    /// What a claim remembers about being rejected, kept in step with its status whichever way the status moved (the claim's own Mark as Rejected, or every line rejected): the moment it became Rejected
    /// is stamped once, and a claim that is no longer Rejected forgets the moment and the NDIA's code, so a later rejection starts afresh.
    /// </summary>
    public static void KeepRejectionRecord(TripClaim claim, TripClaimStatus before, DateTime now)
    {
        if (claim.Status == TripClaimStatus.Rejected)
        {
            if (before != TripClaimStatus.Rejected) claim.RejectedDate = now;
            return;
        }

        claim.RejectedDate = null;
        claim.RejectionCode = null;
    }

    /// <summary>Auto-updates a claim's status from its line statuses, along an allowed move only: every line paid on a draft claim does not make it paid. Partial auto-promotion is omitted intentionally.</summary>
    public static void RollUp(TripClaim claim, IReadOnlyCollection<ClaimLineItemStatus> lineStatuses, DateTime now)
    {
        var target = lineStatuses.All(s => s == ClaimLineItemStatus.Paid) ? TripClaimStatus.Paid
            : lineStatuses.All(s => s == ClaimLineItemStatus.Rejected) ? TripClaimStatus.Rejected
            : (TripClaimStatus?)null;
        if (target is { } t && CanMove(claim.Status, t)) ApplyStatus(claim, t, now);
    }
}
