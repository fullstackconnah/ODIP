using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_meeting_small_answers =
    new(new Item("2026-10-meeting-small-answers", "Small changes from the October meeting",
        "New participants no longer offer \"Sleepover Support\" in Overnight Support, on intake and on the participant's Support profile. \"Overnight Sleepover\" is still there, and a participant who already has \"Sleepover Support\" keeps it.\n\nThe Privacy, Terms and Accessibility links at the bottom of every page now open in a new tab, so a form you are filling in is not lost.\n\nOn intake, the Cultural Considerations step now shows LGBTIQA+ and Family / Community in their own card, \"Support considerations\".",
        Staff, false));
}
