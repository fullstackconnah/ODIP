using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_abn_setup_step = new(
    new Item("2026-11-abn-setup-step", "Organisation details step now needs an ABN",
        "The Organisation details setup step is done once you have added the legal name, address, state and a valid ABN. The NDIS registration number is optional. If your organisation has no ABN saved yet, the step shows as To do again; nothing is blocked and nothing else changes.",
        WhatsNewAudience.Admin, false));
}
