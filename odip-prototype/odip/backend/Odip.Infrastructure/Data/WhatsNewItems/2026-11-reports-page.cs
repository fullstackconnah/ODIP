using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_reports_page = new(
    new Item("2026-11-reports-page", "Reports: hours, shift fill rate and leave",
        "Staff & roster now has a Reports page. Pick a date range to see the hours each worker did on approved shifts, how many shifts were filled each week, and the leave your staff took.\n\nEach report downloads as a CSV file for a spreadsheet. Participant names are never included.",
        Staff, false));
}
