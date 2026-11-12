using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_group_activity_people_repeat = new(
    new Item("2026-11-group-activity-people-repeat", "Add people to a repeating group activity",
        "Open a repeating group activity and choose People. When you add or remove someone, pick This activity or This and all upcoming. A participant whose agreement has no group activity that day, or a different time, now shows a Not in agreement or Outside agreed time note. They can still come.",
        Staff, false));
}
