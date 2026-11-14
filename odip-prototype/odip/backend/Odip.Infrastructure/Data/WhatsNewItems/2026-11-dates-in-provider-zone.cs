using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_dates_in_provider_zone = new(
    new Item("2026-11-dates-in-provider-zone", "Dates match your provider's time zone",
        "Dates and times now show in your provider's time zone on every screen, whatever your device is set to.",
        WhatsNewAudience.All, false));
}
