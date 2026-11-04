using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_cpr_credential = new(
    new Item("2026-11-cpr-credential", "CPR is now its own credential",
        "CPR now has its own expiry date, next to first aid. Tick it on a staff member's profile to track it.",
        Staff, false));
}
