using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_trips_switch = new(
    new Item("2026-11-trips-switch", "Switch trips and holidays off",
        "If your organisation does not run trips or holidays, you can hide them in Settings, under Workspace visibility. Trips and Bookings move to Other workspaces, and the dashboard no longer shows upcoming trips. Nothing is deleted.",
        WhatsNewAudience.Admin, false));
}
