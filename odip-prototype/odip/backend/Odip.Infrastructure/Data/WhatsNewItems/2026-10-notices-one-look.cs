using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_notices_one_look = new(22,
    new Item("2026-10-notices-one-look", "Warnings look the same everywhere",
        "Warning and error notices on participant pages, intake, the caregiver form and the roster panels now share one look, with an icon.",
        WhatsNewAudience.All, false));
}
