using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_settings_house_parts = new(
    new Item("2026-10-settings-house-parts", "Settings screens now work like the rest of Bunya Support",
        "In Settings, the Users and Tenants lists, the template form and the activity library now use the same search box, page buttons, tick boxes and confirm prompts as the rest of Bunya Support. If a tenant's users or provider settings cannot be loaded, the page now says so and lets you try again, instead of showing an empty list.",
        Staff, false));
}
