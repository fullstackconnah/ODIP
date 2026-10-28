using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_double_booking_block = new(33,
    new Item("2026-10-double-booking-block", "Coordinators can't double-book a worker",
        "When a worker already has a shift at that time, a coordinator can no longer put them on another shift from the roster board or the shift panel. An admin still can, after giving a reason. Shifts that already overlap can still be edited or cancelled.",
        Staff, false));
}
