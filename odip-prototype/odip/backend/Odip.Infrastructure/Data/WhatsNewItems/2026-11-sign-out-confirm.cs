using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_sign_out_confirm = new(
    new Item("2026-11-sign-out-confirm", "Sign out asks you to confirm",
        "Signing out now asks you to confirm, so a stray tap doesn't sign you out.",
        WhatsNewAudience.All, false));
}
