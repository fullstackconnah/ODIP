using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_trip_staff_shortfall = new(
    new Item("2026-11-trip-staff-shortfall", "Spot trips that are short of staff",
        "When a trip has fewer staff assigned than its participants' support ratios need, its bar on the roster board and its column on the schedule now show how many it is short. It's a reminder only: it never stops you saving or publishing.",
        Staff, false));
}
