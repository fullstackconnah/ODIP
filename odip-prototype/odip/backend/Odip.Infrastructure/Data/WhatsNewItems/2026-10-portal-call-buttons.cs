using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_portal_call_buttons = new(23,
    new Item("2026-10-portal-call-buttons", "Call buttons and shift notices look the same as the rest of the app",
        "In the support worker portal, the call buttons on a shift and the notices about flagged notes and shift problems now use the same style as the rest of Bunya Support.",
        WhatsNewAudience.All, false));
}
