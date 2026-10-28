using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_logo_icons = new(31,
    new Item("2026-10-logo-icons", "The new logo on your tab and home screen",
        "Your browser tab and the Bunya Support app on your phone now show the same \"b\" logo as the side menu. If you added Bunya Support to your home screen before today and it still shows the old logo, remove it and add it again.",
        WhatsNewAudience.All, false));
}
