using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_rp_authorised_checkbox = new(34,
    new Item("2026-10-rp-authorised-checkbox", "Mark a restrictive practice as authorised",
        "When you add or edit a restrictive practice, tick \"This restrictive practice is authorised\" to fill in who authorised it and when. Leave it unticked if it isn't authorised.",
        Staff, false));
}
