using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_roster_who_is_free =
    new(new Item("2026-11-roster-who-is-free", "See who is available when you fill a shift",
        "When you pick someone for a shift on the roster, Bunya Support now lists first the staff marked as available that day, with \"Prefers this day\" on the days they prefer. Staff on leave or unavailable that day are not listed as available.",
        Staff, false));
}
