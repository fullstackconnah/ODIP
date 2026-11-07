using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_sign_out_always_sticks = new(
    new Item("2026-11-sign-out-always-sticks", "Sign out always sticks",
        "Signing out of Bunya Support now ends the session even if the app was renewing it at that moment.",
        WhatsNewAudience.All, false));
}
