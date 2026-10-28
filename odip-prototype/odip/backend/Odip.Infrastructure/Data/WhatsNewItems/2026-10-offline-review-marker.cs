using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_offline_review_marker = new(37,
    new Item("2026-10-offline-review-marker", "See which shifts were sent from offline",
        "On Completions, a shift a support worker finished without signal shows \"Sent from offline\" and when it reached Bunya Support. Its times are the ones the worker recorded on their phone.",
        Staff, false));
}
