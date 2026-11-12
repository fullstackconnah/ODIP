using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_roster_by_activity = new(
    new Item("2026-11-roster-by-activity", "See the week by activity on the roster",
        "Rostering has a third way to look at the week. When group activities are turned on, use the view switch above the board and choose By activity. Each activity gets one row, with its sessions across the days, so you can see at a glance which days it runs, how many people are coming and whether a session still needs staff. Select a session to open it.",
        Staff, false));
}
