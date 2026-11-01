using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_two_step_optional = new(
    new Item("2026-11-two-step-optional", "Two-step verification",
        "You can now add a code from an authenticator app to your password sign-in. Turn it on in Settings > My account.",
        WhatsNewAudience.All, false));
}
