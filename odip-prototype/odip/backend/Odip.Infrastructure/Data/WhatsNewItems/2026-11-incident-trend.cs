using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_incident_trend = new(
    new Item("2026-11-incident-trend", "Incidents now shows a month-by-month chart",
        "The Incidents page has a chart above the list showing the last 6 months: how many incidents happened each month, and how many of them were restrictive practice uses. Closed and archived reports count; drafts don't.\n\nYou can hide the chart, and the page remembers your choice on this device.",
        Staff, false));
}
