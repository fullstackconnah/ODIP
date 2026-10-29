using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_rp_future_authorisation =
    new(new Item("2026-10-rp-future-authorisation", "Future-dated authorisations show as not yet in force",
        "A restrictive practice authorised from a date that hasn't arrived yet now shows Not authorised, with \"Not yet in force\", until that date. Incidents and medication checks follow the same rule. Find it on a participant's Restrictive practices tab.",
        Staff, false));
}
