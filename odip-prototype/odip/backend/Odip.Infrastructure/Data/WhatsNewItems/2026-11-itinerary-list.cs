using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_itinerary_list = new(
    new Item("2026-11-itinerary-list", "A list view for the itinerary",
        "On a trip's Overview in Bunya Support, the schedule now has a List view beside By day. It shows every stay and activity as one row with its date, time, place and status, and remembers your choice.",
        Staff, false));
}
