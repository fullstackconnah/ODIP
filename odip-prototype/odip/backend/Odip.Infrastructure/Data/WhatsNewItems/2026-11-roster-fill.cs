using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_roster_fill = new(
    new Item("2026-11-roster-fill", "Rostering now shows how full the next weeks are",
        "The Rostering board has a chart under its title showing the next 8 weeks: how many shifts are filled and how many are still open, week by week. Select a week to show it on the board.\n\nYou can hide the chart, and the board remembers your choice on this device.",
        Staff, false));
}
