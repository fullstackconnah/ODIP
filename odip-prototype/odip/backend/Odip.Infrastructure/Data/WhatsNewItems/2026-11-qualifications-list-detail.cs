using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_qualifications_list_detail = new(
    new Item("2026-11-qualifications-list-detail", "Update qualifications person by person",
        "Qualifications now lists your staff on the left. Pick someone to see and update all of their dates on the right, then go to the next person.",
        Staff | WhatsNewAudience.ReadOnly, false));
}
