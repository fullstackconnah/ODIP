using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_group_activity_overview = new(
    new Item("2026-11-group-activity-overview", "Group activities open on an overview",
        "Open a group activity on the roster board and you now start on an overview: when and where, who is coming, which staff are on and what is still short, and the details. Tap a row to open that part.\n\nCreating one walks you through the same parts, and you can skip people or staff for now and come back. Changes save one part at a time, and the date locks while people are attached.",
        WhatsNewAudience.Coordinator | WhatsNewAudience.Admin, false));
}
