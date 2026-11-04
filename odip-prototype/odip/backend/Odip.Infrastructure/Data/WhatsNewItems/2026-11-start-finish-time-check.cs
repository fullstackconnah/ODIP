using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_start_finish_time_check =
    new(new Item("2026-11-start-finish-time-check", "A quick check when you start or finish off roster",
        "If you start or finish more than 5 minutes before or after your rostered time, you'll be asked why. Your coordinator sees your answer when they review the shift.",
        WhatsNewAudience.SupportWorker, false));
}
