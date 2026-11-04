using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_service_locations = new(
    new Item("2026-11-service-locations", "Save the places your team works",
        "Service locations: save the places your team works and pick one on a shift. Each place can have its own time zone. Add them in Bunya Support under Settings, Service locations.",
        Staff, false));
}
