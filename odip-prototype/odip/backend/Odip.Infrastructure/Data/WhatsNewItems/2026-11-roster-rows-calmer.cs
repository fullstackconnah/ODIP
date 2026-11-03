using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_roster_rows_calmer = new(
    new Item("2026-11-roster-rows-calmer", "Roster rows show only what needs a look",
        "On the roster board, a participant's 1:1 ratio and the \"Fully covered\" tick are no longer repeated on every row. A ratio shows only when it isn't 1:1, and a row with unassigned shifts still shows its count. Rows are a little taller, and chip menus are easier to tap on a phone.",
        Staff, false));
}
