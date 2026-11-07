using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_leave_overlap_refused = new(
    new Item("2026-11-leave-overlap-refused", "Leave can no longer overlap",
        "Leave of the same type can no longer overlap: a request that covers days already booked is refused with a clear message.",
        Staff, false));
}
