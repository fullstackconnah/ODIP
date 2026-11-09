using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_group_shared_support = new(
    new Item("2026-11-group-shared-support", "Shared support on group activities",
        "Shared support on a group activity (one worker with more than five people) is now claimed at the participant's share: the rate divided by the number of people their service agreement quoted, rounded down to the cent. A shared-support shift is only claimed when it is on a group activity and was made from its service agreement. Any other is still left out of the claim, with the reason.",
        Staff, false));
}
