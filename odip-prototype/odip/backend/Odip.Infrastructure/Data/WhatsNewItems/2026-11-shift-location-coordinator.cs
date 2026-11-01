using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_shift_location_coordinator = new(
    new Item("2026-11-shift-location-coordinator", "Add where a shift happens",
        "Shifts now have a Location field. Type where the shift happens, such as a library or a pool, and the support worker sees it on their shift. Leave it empty for shifts at home.",
        WhatsNewAudience.Coordinator, false));
}
