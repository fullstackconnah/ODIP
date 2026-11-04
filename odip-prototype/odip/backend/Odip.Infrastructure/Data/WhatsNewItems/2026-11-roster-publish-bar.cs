using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_roster_publish_bar = new(
    new Item("2026-11-roster-publish-bar", "Publish week stays in reach on the roster board",
        "On the roster board, Publish week now sits in a bar at the bottom of the screen, so it is always there while you look through the week.\n\nOn a computer the board also scrolls on its own, with the days kept at the top and the participant names kept on the left.",
        Staff, false));
}
