using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_auto_roster_splits = new(
    new Item("2026-11-auto-roster-splits", "Split a shift when cover runs out part-way",
        "When nobody can work a whole shift, the draft can suggest two people, each taking one part, split where one person's availability ends.",
        Staff, false));
}
