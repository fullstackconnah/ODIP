using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_roster_needs_staff = new(41,
    new Item("2026-10-roster-needs-staff", "Shifts with nobody on them are no longer drafts",
        "On the roster, a shift with nobody on it now shows as a dashed card that needs staff, not a yellow draft, and Publish week leaves it out. Once you put someone on it, it turns yellow and goes out with your next Publish week.",
        Staff, false));
}
