using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_participant_tab_actions = new(
    new Item("2026-10-participant-tab-actions", "Easier-to-tap actions on participant tabs",
        "On a participant, the Edit, Archive, Restore and Delete actions on the Notes, Routines and Medications tabs (and the other record tabs) are now proper buttons that are easier to tap on a phone or tablet. The Archived, Inactive and Ceased lists open and close the same way on every tab.",
        WhatsNewAudience.All, false));
}
