using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_roster_week_time_grid =
    new(new Item("2026-10-roster-week-time-grid", "See the week by the hour",
        "The Week tab on a staff member's or participant's page now shows shifts on an hourly grid, so you can see exactly when each one starts and ends. Overnight shifts carry on past midnight into the next day. Click a shift to see or change it right there, or click an empty time to add a shift at that time. On a phone, pick a day from the strip at the top.",
        Staff, false));
}
