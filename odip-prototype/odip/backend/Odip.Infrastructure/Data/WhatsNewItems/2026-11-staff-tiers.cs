using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_staff_tiers = new(
    new Item("2026-11-staff-tiers", "Order your backup staff",
        "Each participant's Rostering tab now has a Staff preferences card: list preferred, backup and emergency staff in order, and the shift panel offers them in that order.",
        Staff, false));
}
