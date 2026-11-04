using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_location_check_at_start = new(
    new Item("2026-11-location-check-at-start", "Starting a shift checks the place",
        "Bunya Support now checks that a shift starts at its service location, and shows the result when you approve the shift. We keep only the distance, never where the phone was.",
        Staff | WhatsNewAudience.SupportWorker, false));
}
