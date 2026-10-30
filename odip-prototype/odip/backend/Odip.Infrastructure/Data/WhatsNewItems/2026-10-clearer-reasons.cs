using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_clearer_reasons =
    new(new Item("2026-10-clearer-reasons", "Clearer reasons on the Agreements bar",
        "When Approve or Renew is greyed out on the Agreements page, the reason now shows on the bar itself, including on a phone. The last step of editing an incident is now called Compliance, and an agreement that has ended shows its date like every other screen.",
        Staff, false));
}
