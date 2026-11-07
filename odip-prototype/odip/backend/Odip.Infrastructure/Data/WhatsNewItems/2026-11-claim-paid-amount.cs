using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_claim_paid_amount = new(
    new Item("2026-11-claim-paid-amount", "Paid amounts are checked",
        "A claim line marked paid can no longer record more than its total, or a zero amount.",
        Staff, false));
}
