using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_completions_approve_times = new(
    new Item("2026-11-completions-approve-times", "See the times before you approve a shift",
        "On the Completions page, choose Approve on a shift and the dialog now shows the rostered and actual times first, with a line on what approving does. The variance on each row also reads start and finish separately.",
        Staff, false));
}
