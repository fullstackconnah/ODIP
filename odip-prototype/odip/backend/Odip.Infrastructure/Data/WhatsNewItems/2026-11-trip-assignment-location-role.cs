using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_trip_assignment_location_role = new(
    new Item("2026-11-trip-assignment-location-role", "Trip assignments show where and your role",
        "Your trip assignments in My shifts now show where the trip is going and your role on it, such as Support Worker or Driver.",
        WhatsNewAudience.SupportWorker, false));
}
