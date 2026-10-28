using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_adl_notes_in_full = new(19,
    new Item("2026-10-adl-notes-in-full", "ADL notes show in full",
        "Long ADL notes and \"how to help me\" text now wrap on a participant's page instead of being cut off.",
        WhatsNewAudience.All, false));
}
