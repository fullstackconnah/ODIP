using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_history_latest_referral_duplicate = new(
    new Item("2026-11-history-latest-referral-duplicate", "Clearer History tab and referral sources",
        "The History tab now says when it shows only the latest events, and a duplicate referral source is marked on its field.",
        Staff, false));
}
