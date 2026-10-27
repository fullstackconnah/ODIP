using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Domain.Billing;

/// <summary>The one rule for who is claimed to the NDIS: funded through the NDIS and holding an NDIS number. Every claim engine and the BPR export use it.</summary>
public static class ClaimFunding
{
    public const string OtherFundedNotClaimed = "Funded another way, so not claimed to the NDIS. Invoice them directly.";

    /// <summary>Funded another way. Checked before the NDIS number, because an old number can stay on the profile after a switch to Other.</summary>
    public static bool IsOtherFunded(Participant p) => p.FundingSource == ParticipantFundingSource.Other;
}
