using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_compatibility_board = new(
    new Item("2026-11-compatibility-board", "Set who works with whom, one participant at a time",
        "Compatibility in Bunya Support now opens on a participant. Pick a participant to see Preferred, Backup, Emergency and No side by side, tick several staff at once to add them to a tier, and move or remove anyone from the menu on their name. The list of every pairing is still there under All pairings.",
        Staff, false));
}
