using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_fewer_surprise_sign_outs = new(
    new Item("2026-11-fewer-surprise-sign-outs", "Fewer surprise sign-outs",
        "Coming back to Bunya Support after a break no longer signs you out while the page is still loading.",
        WhatsNewAudience.All, false));
}
