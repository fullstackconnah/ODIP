using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_shift_claim_rate_bands = new(
    new Item("2026-11-shift-claim-rate-bands", "Shift claims now use evening, night and weekend rates",
        "Bunya Support now splits each shift claim by rate: daytime, evening, night, Saturday, Sunday and public holiday hours each get their own line at the right price. Sleepovers and passive nights are claimed as one sleepover item per night. Claims made before this change stay as they are.",
        Staff, false));
}
