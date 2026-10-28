using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_participant_adl_columns = new(18,
    new Item("2026-10-participant-adl-columns", "Tidier ADL tables",
        "The personal and community ADL tables on a participant's page now line up, and Medications says Add medication everywhere.",
        WhatsNewAudience.All, false));
}
