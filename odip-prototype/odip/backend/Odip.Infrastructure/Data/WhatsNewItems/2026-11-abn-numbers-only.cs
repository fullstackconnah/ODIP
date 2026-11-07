using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_abn_numbers_only = new(
    new Item("2026-11-abn-numbers-only", "ABN takes numbers only",
        "The ABN in Organisation profile now takes numbers and spaces only, so the claim file always carries a valid ABN.",
        WhatsNewAudience.Admin, false));
}
