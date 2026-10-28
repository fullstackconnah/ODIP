using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_back_goes_back = new(40,
    new Item("2026-10-back-goes-back", "Back takes you where you came from",
        "Back now returns to the page you were on before. If you opened a page from a link or in a new tab, it goes to that page's main list instead.",
        Staff, false));
}
