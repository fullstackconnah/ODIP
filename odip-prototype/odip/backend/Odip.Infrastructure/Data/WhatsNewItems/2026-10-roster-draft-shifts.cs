using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_roster_draft_shifts = new(2,
    new Item("2026-10-roster-draft-shifts", "Draft shifts stand out on the roster, and you can publish one at a time",
        "Draft shifts on the roster board now have an amber background and the word Draft, so you can tell them from published shifts at a glance.\n\nTo publish a single shift, open its menu and choose Publish. Publishing the whole week works as before.",
        Staff, false));
}
