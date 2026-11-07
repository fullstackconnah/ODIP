using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_claim_left_out_reasons = new(
    new Item("2026-11-claim-left-out-reasons", "Shorter messages for shifts left out of a claim",
        "Messages about shifts left out of a claim no longer repeat the participant's name.",
        Staff, false));
}
