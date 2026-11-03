using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_older_unclaimed_shifts = new(
    new Item("2026-11-older-unclaimed-shifts", "See older unclaimed shifts",
        "The Unclaimed shifts tile on the Bunya Support dashboard now counts completed shifts from before the last 14 days too, and says when any are more than 90 days old.",
        Staff, false));
}
