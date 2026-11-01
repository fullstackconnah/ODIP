using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_shift_claim_run = new(
    new Item("2026-11-shift-claim-run", "Claim every participant's shifts at once",
        "Open Claims and choose Claim shifts. Bunya Support finds every completed shift that hasn't been claimed yet, from the last 14 days up to yesterday, and makes one claim for each participant. You can change the dates and check the preview before anything is made.\n\nShifts it can't price yet, such as sleepovers and group shifts, are listed with the reason and stay unclaimed.",
        Staff, false));
}
