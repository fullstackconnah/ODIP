using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_unclaimed_shifts_cue = new(
    new Item("2026-11-unclaimed-shifts-cue", "See unclaimed shifts on the dashboard",
        "The Bunya Support dashboard now shows completed shifts that haven't been claimed yet, with a link straight to Claim shifts.",
        Staff, false));
}
