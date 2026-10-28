using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_list_badges_tidy = new(43,
    new Item("2026-10-list-badges-tidy", "Tidier status labels and page controls in lists",
        "Status labels now look the same everywhere. On Staff and Participants, Active is green and Inactive is red. On Trips, waitlist counts use the same label style as the trip status.\n\nOn Completion review, the page controls now sit under the table in the same place as other lists, and the shifts you tick stay ticked when you move to another page.",
        WhatsNewAudience.All, false));
}
