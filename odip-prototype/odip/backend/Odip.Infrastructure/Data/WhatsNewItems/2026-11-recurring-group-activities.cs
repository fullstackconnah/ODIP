using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_recurring_group_activities = new(
    new Item("2026-11-recurring-group-activities", "Repeat a group activity",
        "When you create a group activity, choose Weekly, Fortnightly or Monthly under Repeats, below the start and end times, and pick an end date. Bunya Support makes a draft for each date. To change or cancel the ones still to come, open one and choose This and all upcoming.",
        Staff, false));
}
