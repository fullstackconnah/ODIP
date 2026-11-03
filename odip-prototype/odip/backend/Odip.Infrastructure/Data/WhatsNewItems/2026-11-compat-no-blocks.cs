using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_compat_no_blocks = new(
    new Item("2026-11-compat-no-blocks", "Workers marked No can't be rostered",
        "If a worker is marked No for a participant on the compatibility page, they can no longer be put on that participant's shifts. Shifts they already hold can still be reassigned, unassigned or cancelled.",
        Staff, false));
}
