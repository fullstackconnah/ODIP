using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_participant_tabs = new(5,
    new Item("2026-10-participant-tabs", "Participant pages are now split into tabs",
        "Open a participant to see their page in tabs, with Overview first.\n\nOverview starts with Before you start: the things to know before a shift, such as allergies and choking risk. Select one to go straight to its details in Health & safety.",
        WhatsNewAudience.All, true));
}
