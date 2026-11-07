using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_settings_changes_recorded = new(
    new Item("2026-11-settings-changes-recorded", "Settings changes are recorded",
        "Changes to the alert windows and the session length now appear in the audit history.",
        WhatsNewAudience.Admin, false));
}
