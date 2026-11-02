using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_claims_cancellation = new(
    new Item("2026-11-claims-cancellation", "Claim a short-notice cancellation",
        "Claim a shift that was cancelled with less than 7 days' notice from the Claims screen. Choose New claim, then A cancellation.",
        Staff, false));
}
