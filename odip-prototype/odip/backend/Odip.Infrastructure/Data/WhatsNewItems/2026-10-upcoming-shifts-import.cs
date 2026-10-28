using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_upcoming_shifts_import = new(15,
    new Item("2026-10-upcoming-shifts-import", "Import your upcoming shifts",
        "Go to Settings, then Import data, to bring in your next weeks of shifts: an export from your old platform, or a weekly pattern repeated for up to 12 weeks. Every shift is checked against the roster rules and added as a draft, and each week is ready to publish. Nobody is told until you publish.",
        WhatsNewAudience.Admin, false));
}
