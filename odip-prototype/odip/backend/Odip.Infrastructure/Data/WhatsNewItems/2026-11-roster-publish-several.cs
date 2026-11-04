using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_roster_publish_several = new(
    new Item("2026-11-roster-publish-several", "Publish just the shifts you choose",
        "On the roster board, Select shifts lets you tick the draft shifts you want to send out, then publish only those. Each person on them is notified, and the rest stay in draft until you're ready.",
        Staff, false));
}
