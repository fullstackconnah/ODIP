using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_group_claim_headcount = new(
    new Item("2026-11-group-claim-headcount", "Group claims follow who came",
        "When more people come to a group activity than their service agreements quoted, each person's claim now shares the rate between everyone in the group, for each worker on the activity, rounded down to the cent. When fewer come, the quoted share stays. Someone who did not come still counts if their cancellation can be claimed, and a cancellation made a week or more ahead does not.",
        Staff, false));
}
