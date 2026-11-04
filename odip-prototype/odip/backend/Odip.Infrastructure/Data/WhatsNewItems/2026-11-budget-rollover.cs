using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_budget_rollover =
    new(new Item("2026-11-budget-rollover", "Change the rolled-over amount",
        "In a funding plan, each period after the first now shows the amount rolled over from the period before. Bunya Support works it out from what was left unspent. If you know better, for example when money was spent outside Bunya Support, type the right amount. The agreement check shows the rolled-over amount too.",
        Staff, false));
}
