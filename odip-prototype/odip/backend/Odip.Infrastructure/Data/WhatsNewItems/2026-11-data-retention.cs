using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_data_retention = new(
    new Item("2026-11-data-retention", "Data retention in Settings",
        "Settings, then Data retention, lists archived participants whose records have been kept for 7 years. For each one you can download their data, then purge their record for good. You get a task in Tasks when one is due.\n\nPurging can't be undone. A note of the purge, with no personal details, stays in Bunya Support.",
        WhatsNewAudience.Admin, false));
}
