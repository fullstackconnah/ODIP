using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_roster_board_declutter = new(
    new Item("2026-11-roster-board-declutter", "A calmer roster board",
        "The roster now scrolls as one page, so the grid can fill the screen. Notices are down to one status line, the 8-week fill chart opens from Next 8 weeks, and New lets you add a shift or a trip.",
        Staff, false));
}
