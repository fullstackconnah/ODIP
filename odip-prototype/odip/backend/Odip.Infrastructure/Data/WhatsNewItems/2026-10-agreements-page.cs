using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_agreements_page = new(35,
    new Item("2026-10-agreements-page", "Agreements page",
        "A new Agreements page in the menu lists every participant's service agreement with its dates, total and price list. Where your organisation lets your role approve agreements, you can tick the ones with a draft waiting and approve them together. The Agreements ending view from Participants now lives here too.",
        Staff, false));
}
