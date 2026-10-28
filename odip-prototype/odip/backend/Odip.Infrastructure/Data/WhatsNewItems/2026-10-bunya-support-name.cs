using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_bunya_support_name = new(16,
    new Item("2026-10-bunya-support-name", "Bunya Support, everywhere",
        "Messages from the app and its downloads now use the Bunya Support name. Data exports are called bunya-support-export, and the import templates are called bunya-support-…-template.",
        WhatsNewAudience.Admin, false));
}
