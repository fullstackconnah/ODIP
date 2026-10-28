using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_dark_mode = new(4,
    new Item("2026-10-dark-mode", "Dark mode is here",
        "Bunya Support now has a dark theme. Go to Settings, then Appearance, and choose Light, Dark or System under Theme.\n\nYour choice is saved on this device, so another computer or phone keeps its own.",
        WhatsNewAudience.All, true));
}
