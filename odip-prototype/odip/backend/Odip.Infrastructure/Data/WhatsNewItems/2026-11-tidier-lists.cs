using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_tidier_lists = new(
    new Item("2026-11-tidier-lists", "Tidier lists in Bunya Support",
        "Wide tables now fade at the edge with a button to show more columns. On Patterns and Leave, the row actions sit in a ⋯ menu. Status reads as a plain badge, and dates use the standard date fields.",
        Staff, false));
}
