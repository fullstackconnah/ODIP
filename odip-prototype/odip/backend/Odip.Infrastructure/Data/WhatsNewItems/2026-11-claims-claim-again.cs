using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_claims_claim_again = new(
    new Item("2026-11-claims-claim-again", "Claim a rejected claim again",
        "Open a rejected shift claim and choose Claim again. Bunya Support deletes it and makes a new draft claim for the same shifts.",
        Staff, false));
}
