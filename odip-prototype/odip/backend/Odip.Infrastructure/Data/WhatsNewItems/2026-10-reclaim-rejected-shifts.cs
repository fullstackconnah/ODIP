using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_reclaim_rejected_shifts = new(
    new Item("2026-10-reclaim-rejected-shifts", "Shifts on a rejected claim can be claimed again",
        "When the NDIA rejects a shift claim, or a claim is cancelled, Generate claims now picks those shifts up again, and the participant's budget counts them as pending until they are claimed. The rejected claim stays in Claims as the record.",
        Staff, false));
}
