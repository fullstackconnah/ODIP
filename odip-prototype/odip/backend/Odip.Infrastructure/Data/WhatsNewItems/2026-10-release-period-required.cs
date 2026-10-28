using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_release_period_required = new(42,
    new Item("2026-10-release-period-required", "New plans ask how funding is released",
        "The funding plan editor now asks you to choose a release period for a new plan before it saves. \"Whole plan\" replaces \"No funding periods\" for a plan that is not split into periods. Plans already saved are unchanged.",
        Staff, false));
}
