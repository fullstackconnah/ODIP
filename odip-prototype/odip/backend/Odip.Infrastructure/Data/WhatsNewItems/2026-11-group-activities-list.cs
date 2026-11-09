using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_group_activities_list = new(
    new Item("2026-11-group-activities-list", "See every group activity in one list",
        "Rostering now has a Group activities page. Pick a date range and a status to see what is on, who is running it, how many are coming and which are still Draft or short of staff. Select a row to open it on the roster board.",
        Staff, false));
}
