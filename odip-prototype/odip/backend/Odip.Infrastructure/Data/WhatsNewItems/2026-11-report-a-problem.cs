using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_report_a_problem = new(
    new Item("2026-11-report-a-problem", "Report a problem",
        "Spotted something wrong in Bunya Support? Use Report a problem at the foot of the menu to tell us, and we'll look into it.",
        WhatsNewAudience.All, false));
}
