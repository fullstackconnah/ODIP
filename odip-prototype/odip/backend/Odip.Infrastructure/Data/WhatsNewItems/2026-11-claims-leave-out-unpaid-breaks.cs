using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_claims_leave_out_unpaid_breaks = new(
    new Item("2026-11-claims-leave-out-unpaid-breaks", "Shift claims leave out breaks taken alone",
        "A break a worker took on their own comes off the hours claimed for that shift. Breaks with the person you support are still claimed.",
        WhatsNewAudience.Coordinator | WhatsNewAudience.Admin, false));
}
