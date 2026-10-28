using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_tidier_tables_checkboxes =
    new(new Item("2026-10-tidier-tables-checkboxes", "Ticked boxes use the Bunya Support green",
        "Checkboxes and option buttons across the app now fill with the Bunya Support green when you select them, instead of the browser's blue.",
        Staff, false));
}
