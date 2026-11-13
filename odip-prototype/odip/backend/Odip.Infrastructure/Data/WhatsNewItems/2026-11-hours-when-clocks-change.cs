using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_hours_when_clocks_change = new(
    new Item("2026-11-hours-when-clocks-change", "Hours on the nights the clocks change",
        "On the two nights a year the clocks change, a shift's hours on the roster and in the worker's shift list now show its real length. For example, 10 pm to 6 am is 9 hours, not 8, when daylight saving ends. This now matches timesheets and invoices.",
        WhatsNewAudience.All, false));
}
