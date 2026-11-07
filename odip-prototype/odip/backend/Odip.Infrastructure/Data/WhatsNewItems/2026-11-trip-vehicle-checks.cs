using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_trip_vehicle_checks = new(
    new Item("2026-11-trip-vehicle-checks", "Vehicle checks on trips",
        "You can no longer assign an archived vehicle to a trip. If a driver's licence expires before the trip, or they aren't marked as an eligible driver, you'll be asked for a reason first. Accommodation clashes now clear as soon as the other booking is cancelled or moved.",
        Staff, false));
}
