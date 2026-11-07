using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_staff_reactivate_sign_in = new(
    new Item("2026-11-staff-reactivate-sign-in", "Reactivating staff restores their sign-in",
        "Reactivating a staff member now restores their sign-in straight away, and archiving one turns it off.",
        WhatsNewAudience.Admin, false));
}
