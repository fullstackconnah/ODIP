using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_several_agreements = new(
    new Item("2026-11-several-agreements", "Several agreements for one participant",
        "Add a trip, night support or another agreement beside the one a participant already has: choose Add agreement on the Agreements card. Each agreement keeps its own versions, dates and approval, and Bunya Support warns when together they plan more than the money available.",
        Staff, false));
}
