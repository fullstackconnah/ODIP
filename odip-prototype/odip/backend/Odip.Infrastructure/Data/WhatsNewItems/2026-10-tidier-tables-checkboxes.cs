using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_tidier_tables_checkboxes =
    new(new Item("2026-10-tidier-tables-checkboxes", "Tidier table pages and checkboxes",
        "On a phone, the page count under tables stays on one line, and ticked boxes now use the Bunya Support green.",
        Staff, false));
}
