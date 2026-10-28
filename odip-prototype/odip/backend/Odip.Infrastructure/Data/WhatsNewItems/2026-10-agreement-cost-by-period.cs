using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_agreement_cost_by_period =
    new(new Item("2026-10-agreement-cost-by-period", "See what an agreement costs for a fortnight, month or any dates",
        "On an agreement's Check step, the new Cost by period section prices one stretch of the agreement at a time: a fortnight, month, quarter or year, or dates you pick. Use the arrows to move along the agreement. Public holidays and weekends are counted on the real calendar.",
        Staff, false));
}
