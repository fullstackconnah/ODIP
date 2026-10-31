using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_organisation_time_zone = new(
    new Item("2026-11-organisation-time-zone", "Choose your organisation's time zone",
        "Settings, Organisation profile now has a Time zone next to your state. It starts from your state, and rosters, the portal and reminders use it to work out what counts as today. If you change it, times already saved stay the same.",
        WhatsNewAudience.Admin, false));
}
