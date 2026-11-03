using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_claims_work_first = new(
    new Item("2026-11-claims-work-first", "Claims now starts with the work to do",
        "The Claims page in Bunya Support now opens with what needs your attention first, including any rejected claims, with your totals tucked into a collapsed chart below.",
        Staff, false));
}
