using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_managed_claims_paging = new(
    new Item("2026-11-managed-claims-paging", "Every plan- and self-managed claim is on the Claims page",
        "Plan- and self-managed claims on the Claims page now page through every claim, not just the newest 200.",
        Staff, false));
}
