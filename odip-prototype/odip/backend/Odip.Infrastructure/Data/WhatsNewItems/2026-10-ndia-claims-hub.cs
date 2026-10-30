using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_ndia_claims_hub =
    new(new Item("2026-10-ndia-claims-hub", "Send NDIA claims from one place",
        "The new Claims page gathers every NDIA-managed line that's ready, checks it, and builds the bulk payment request file for the portal. Import the NDIA's results file and every line is marked for you. Rejected lines show what to do next, and lines get an age warning from 60 days. A claim's own page now builds its NDIA file the same way, and opens it in Claims.",
        Staff, true));
}
