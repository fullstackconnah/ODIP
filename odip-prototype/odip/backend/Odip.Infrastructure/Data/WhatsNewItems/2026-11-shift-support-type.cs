using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_shift_support_type = new(
    new Item("2026-11-shift-support-type", "Set the support type on patterns and shifts",
        "Open a shift pattern or a shift on the roster and choose its support type. Shift claims use that type's rate for each shift's day. Shifts without one still claim community access.",
        Staff, false));
}
