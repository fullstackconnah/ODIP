using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_other_funded_claims = new(32,
    new Item("2026-10-other-funded-claims", "Participants funded another way are left out of claims",
        "A participant who is funded another way is no longer included in NDIS claims, even if an old NDIS number is still on their profile. The claim lists them as left out and says to invoice them directly.",
        Staff, false));
}
