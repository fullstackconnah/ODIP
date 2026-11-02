using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_finish_km_prompt = new(
    new Item("2026-11-finish-km-prompt", "A reminder for kilometres and notes at the end of a shift",
        "If you finish a shift without entering kilometres or adding a note, you'll be asked once. Add them, or finish anyway. Enter 0 if you didn't drive.",
        WhatsNewAudience.SupportWorker, false));
}
