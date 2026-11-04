using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_incident_full_view = new(
    new Item("2026-11-incident-full-view", "Everything about an incident on one page",
        "Open an incident to see all of it, including each witness and their statement. Edit one part at a time with its own Save. New incidents are still reported step by step.",
        Staff, false));
}
