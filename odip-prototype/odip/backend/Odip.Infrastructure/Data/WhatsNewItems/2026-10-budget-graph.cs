using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_budget_graph = new(
    new Item("2026-10-budget-graph", "See how a budget is tracking",
        "See how a participant's budget is tracking: the Funding tab now charts what's used against an even spread of the plan and what the agreement expects.",
        Staff, false));
}
