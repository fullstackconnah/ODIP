using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_provider_travel_claimed = new(
    new Item("2026-11-provider-travel-claimed", "Provider travel on claims",
        "Provider travel is now claimed from completed shifts when your organisation and the agreement allow it.",
        Staff, false));
}
