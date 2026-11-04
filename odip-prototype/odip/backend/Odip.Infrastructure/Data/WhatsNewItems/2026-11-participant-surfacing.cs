using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_participant_surfacing = new(
    new Item("2026-11-participant-surfacing", "Find things faster on a participant's page",
        "In Bunya Support, a participant's page now shows where everything is. Under the tabs, a line of links jumps straight to each section on that page, such as Cultural Background or Daily living. Sections with nothing recorded yet look quieter.\n\nOn the Overview tab, a new In this profile card lists every tab you can see, with links to each section inside it.",
        WhatsNewAudience.All, false));
}
