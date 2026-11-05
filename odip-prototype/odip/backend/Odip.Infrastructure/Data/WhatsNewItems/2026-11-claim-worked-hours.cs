using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_claim_worked_hours = new(
    new Item("2026-11-claim-worked-hours", "Claims now follow the hours worked",
        "Shift claims bill the times a worker actually started and finished. Extra time (starting more than 5 minutes early or finishing more than 5 minutes late) is claimed once you approve it; until then, or if you decline it, the claim uses the rostered times. Under a budget hard limit, extra time that would go over is left out of the claim and listed with the reason.",
        Staff, false));
}
