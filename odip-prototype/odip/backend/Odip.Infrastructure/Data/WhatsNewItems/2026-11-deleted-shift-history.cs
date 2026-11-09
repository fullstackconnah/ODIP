using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_deleted_shift_history = new(
    new Item("2026-11-deleted-shift-history", "See a deleted shift's full history",
        "In Settings › Deleted records, open a deleted shift or shift pattern and choose Show full history, to see every change made to it before it was deleted.",
        WhatsNewAudience.Admin, false));
}
