using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_participant_subtabs = new(28,
    new Item("2026-10-participant-subtabs", "Each section has its own tab",
        "On a participant's page, the sections of a tab are now listed as small tabs under the main ones. Choose one to see just that section. Risks, routines, contacts and notes show how many there are.\n\nLinks, flags and alerts still open the right section.",
        WhatsNewAudience.All, false));
}
