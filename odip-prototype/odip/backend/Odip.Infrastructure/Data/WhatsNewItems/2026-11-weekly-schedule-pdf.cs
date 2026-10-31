using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_weekly_schedule_pdf = new(
    new Item("2026-11-weekly-schedule-pdf", "Print a participant's week for their family",
        "Open a participant and choose Documents, then Weekly Schedule PDF. You get the week you are viewing, day by day, with each worker's first name, ready to print or send to the family.\n\nDraft and cancelled shifts are left out, and notes are never shown. Pages also print cleanly now, without the menus.",
        Staff, false));
}
