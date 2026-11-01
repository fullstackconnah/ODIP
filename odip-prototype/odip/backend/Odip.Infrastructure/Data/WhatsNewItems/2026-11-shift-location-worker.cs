using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_shift_location_worker = new(
    new Item("2026-11-shift-location-worker", "Your shifts show where they happen",
        "When your coordinator adds a location to a shift, you'll see it on the shift in My shifts.",
        WhatsNewAudience.SupportWorker, false));
}
