using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_onboarding_complaints_rights = new(
    new Item("2026-11-onboarding-complaints-rights", "Onboarding now records complaints and rights",
        "A participant's onboarding checklist has two new items: \"Told how to make a complaint\" and \"Rights explained\". Open the participant from the Onboarding page, choose Record it on either item, and enter the date you explained it to them.\n\nThe two items count towards the steps shown for each participant, and they appear in the warning when you make a participant active. They don't stop you making someone active.",
        Staff, false));
}
