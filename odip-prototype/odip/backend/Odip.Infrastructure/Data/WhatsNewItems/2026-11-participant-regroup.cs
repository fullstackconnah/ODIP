using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_participant_regroup = new(
    new Item("2026-11-participant-regroup", "Fewer tabs on a participant's page",
        "In Bunya Support, a participant's page now has fewer small tabs under each main tab. Related sections sit together on one tab, so you scroll instead of switching: Profile holds the address, key identifiers, cultural background and About me, and Medical holds health conditions.\n\nLinks, flags and alerts still land on the right section, and Roster and staff match are now one tab under People.",
        WhatsNewAudience.All, false));
}
