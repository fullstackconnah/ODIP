using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_trip_times_on_roster = new(
    new Item("2026-11-trip-times-on-roster", "Trip times on the roster board",
        "Trip bars on the roster board now show each day's start and finish time. In the staff picker, people on a trip that day are grouped under On a trip that day. The staff bar shows the trip's times, not that worker's own hours.",
        Staff, false));
}
