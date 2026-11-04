using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_roster_publish_action_bar = new(
    new Item("2026-11-roster-publish-action-bar", "The Publish bar now floats over the roster",
        "Publish week and Select shifts sit on a small floating bar over the board, so more of the week shows while you work.",
        Staff, false));
}
