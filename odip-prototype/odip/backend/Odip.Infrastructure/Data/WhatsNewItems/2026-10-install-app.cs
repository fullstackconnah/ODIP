using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_install_app = new(29,
    new Item("2026-10-install-app", "Add Bunya Support to your phone",
        "On your phone, you can add Bunya Support to your home screen and open it like an app. After you sign in, look for the card above the menu bar.",
        WhatsNewAudience.All, false));
}
