using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_compatibility_table = new(
    new Item("2026-11-compatibility-table", "Change every pairing from one table",
        "Compatibility in Bunya Support now has a Table view: participants down the side, staff across the top. Pick a cell and set Preferred, Backup, Emergency or clear it, or press P, B or E. Use the menu on a name to set a whole row or column at once. It replaces the All pairings list.",
        Staff, false));
}
