using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_roster_week_per_person =
    new(new Item("2026-10-roster-week-per-person", "See each person's week",
        "Open a staff member or participant from the roster to see their week of shifts on their profile, under Week. Click a shift to change it on the roster.",
        Staff, false));
}
