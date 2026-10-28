using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_theme_in_top_bar = new(27,
    new Item("2026-10-theme-in-top-bar", "Change the theme from the top bar",
        "Use the sun, moon or screen icon at the top of any page to switch between Light, Dark and System. Settings, Appearance still works too, and your choice is saved on this device.",
        WhatsNewAudience.All, false));
}
