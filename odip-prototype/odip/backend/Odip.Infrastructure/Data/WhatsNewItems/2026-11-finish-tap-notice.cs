using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_finish_tap_notice = new(
    new Item("2026-11-finish-tap-notice", "A calmer note when your finish tap is renewed",
        "When your finish tap is renewed, Bunya Support now tells you in a calm note instead of red error text.",
        WhatsNewAudience.SupportWorker, false));
}
