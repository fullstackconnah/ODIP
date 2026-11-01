using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_roster_names_above_badges = new(
    new Item("2026-11-roster-names-above-badges", "Roster names sit above their badges",
        "The Rostering board now shows each participant's name on its own line, with the support ratio and warnings underneath. Long names are no longer cut short.",
        Staff, false));
}
