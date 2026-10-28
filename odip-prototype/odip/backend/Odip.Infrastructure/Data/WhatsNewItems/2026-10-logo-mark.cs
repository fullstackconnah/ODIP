using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_logo_mark = new(30,
    new Item("2026-10-logo-mark", "A new Bunya Support logo",
        "The small logo in the side menu is now the \"b\" from the Bunya Support name. When you fold the side menu away, the name folds into it.",
        WhatsNewAudience.All, false));
}
