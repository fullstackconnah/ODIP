using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_claims_new_claim = new(
    new Item("2026-11-claims-new-claim", "Make any claim from the Claims screen",
        "New claim on the Claims screen opens shifts or a trip. A day already claimed on a shift claim or a trip claim is no longer claimed twice.",
        Staff, false));
}
