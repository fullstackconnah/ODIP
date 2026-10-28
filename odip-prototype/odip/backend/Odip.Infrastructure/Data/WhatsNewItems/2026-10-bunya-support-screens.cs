using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_bunya_support_screens = new(17,
    new Item("2026-10-bunya-support-screens", "Screens now say Bunya Support",
        "Settings, payslips and other screens now use the Bunya Support name too.",
        WhatsNewAudience.Admin, false));
}
