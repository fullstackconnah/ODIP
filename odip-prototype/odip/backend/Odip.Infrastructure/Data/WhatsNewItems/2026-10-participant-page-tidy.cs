using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_participant_page_tidy = new(7,
    new Item("2026-10-participant-page-tidy", "Participant pages are easier to scan",
        "Each card now shows only what has been recorded. Anything missing is listed in one short Not recorded line at the bottom of the card.\n\nLong lists show the first five, with Show all to see the rest. Use Jump to at the top of a tab to go straight to a section.",
        WhatsNewAudience.All, false));
}
