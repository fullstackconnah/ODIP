using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_trip_form_labels = new(26,
    new Item("2026-10-trip-form-labels", "Trip forms read better with screen readers",
        "On a trip, the Edit trip, accommodation, bookings, staff, activity, vehicle and claim forms now label every field the same way as the rest of Bunya Support, and accommodation costs show dollars and cents.",
        Staff, false));
}
