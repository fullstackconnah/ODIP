using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_budgets_one_status = new(
    new Item("2026-11-budgets-one-status", "One status for each budget",
        "On the Bunya Support Budgets page, every pool now shows one status. A pool the NDIA has refused a claim for lack of funds reads Funds ran out, and one spending faster than its period allows reads Spending fast. The filters are now All, Needs attention and On track.",
        Staff, false));
}
