using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_rp_authorisation_badge = new(3,
    new Item("2026-10-rp-authorisation-badge", "Restrictive practices show whether they're authorised",
        "On a participant's Restrictive Practices tab, every active practice now shows Authorised or Not authorised, the same badge you see when reporting an incident.\n\nWhen a practice isn't authorised, the line under it says what's missing, such as the authorisation date or the authoriser.",
        Staff, false));
}
