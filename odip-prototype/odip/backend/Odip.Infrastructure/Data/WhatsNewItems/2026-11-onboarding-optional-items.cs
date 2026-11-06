using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_onboarding_optional_items = new(
    new Item("2026-11-onboarding-optional-items", "Choose optional onboarding items",
        "In Settings, under Onboarding checklist, you can now add a plan budget item to every participant's checklist, or make complaints, rights and my provider optional. Optional items show in their own group, aren't counted, and never stop a participant being made active.",
        WhatsNewAudience.Admin, false));
}
