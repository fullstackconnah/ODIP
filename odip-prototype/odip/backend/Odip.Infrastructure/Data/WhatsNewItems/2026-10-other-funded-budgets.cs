using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_other_funded_budgets = new(38,
    new Item("2026-10-other-funded-budgets", "Other-funded participants leave the NDIS budget",
        "A participant who is funded another way no longer counts against an NDIS budget. Their shifts stop showing as pending NDIS money on the Budgets page and on their Funding tab, and their Claims tab now says to invoice their funder directly.",
        Staff, false));
}
