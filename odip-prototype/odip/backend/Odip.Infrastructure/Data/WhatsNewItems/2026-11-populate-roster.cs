using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_populate_roster =
    new(new Item("2026-11-populate-roster", "Populate roster is its own step",
        "Approving an agreement no longer adds shifts. Use Populate roster to fill one started week at a time.",
        Staff, false));
}
