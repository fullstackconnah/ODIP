using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_trip_detail_tidy = new(
    new Item("2026-11-trip-detail-tidy", "A tidier trip page",
        "On a trip in Bunya Support, the top figures now show places booked and staff assigned against what the trip needs, and tapping one opens the tab where you fix it. Stay and transport share one tab, and Overview lists the trip facts beside the itinerary.",
        Staff, false));
}
