using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_settings_history = new(
    new Item("2026-11-settings-history", "See who changed your organisation's settings",
        "Open Settings, then Organisation, then Settings history. You can see who changed your organisation profile, billing details, safety checks and onboarding checklist, when, and from what to what.\n\nBank details only show that they were set, changed or cleared, never the numbers themselves.",
        WhatsNewAudience.Admin, false));
}
