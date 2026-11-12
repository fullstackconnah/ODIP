using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_fewer_not_recorded = new(
    new Item("2026-11-fewer-not-recorded", "Fewer 'Not recorded' labels",
        "Optional details you have not filled in now show a quiet dash or a clearer label, such as No plan recorded, Not set or To do, instead of the words Not recorded.",
        WhatsNewAudience.All, false));
}
