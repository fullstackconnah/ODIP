using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_claims_manual = new(
    new Item("2026-11-claims-manual", "Make a one-off claim",
        "Make a one-off claim from the Claims screen. Choose New claim, then A one-off claim, and pick any price guide item and amount.",
        Staff, false));
}
