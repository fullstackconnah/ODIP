using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_two_step_admins = new(
    new Item("2026-11-two-step-admins", "Two-step verification for administrators",
        "Administrators can set up two-step verification now, with a code from an authenticator app, and will be asked to soon. Turn it on in Settings > My account. Microsoft sign-in is unchanged.",
        WhatsNewAudience.Admin, false));
}
