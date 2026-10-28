using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_returned_shift_coming_up = new(
    new Item("2026-10-returned-shift-coming-up", "Returned shifts show at the top of My shifts",
        "In the worker portal, a shift your coordinator sent back for changes now shows under Coming up until you resubmit it, instead of under Earlier.",
        WhatsNewAudience.SupportWorker, false));
}
