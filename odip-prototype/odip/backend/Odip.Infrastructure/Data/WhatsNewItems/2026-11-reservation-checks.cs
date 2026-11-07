using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_reservation_checks = new(
    new Item("2026-11-reservation-checks", "Reservation checks",
        "Reservations now need a check-out after check-in, and archived properties can no longer be booked.",
        Staff, false));
}
