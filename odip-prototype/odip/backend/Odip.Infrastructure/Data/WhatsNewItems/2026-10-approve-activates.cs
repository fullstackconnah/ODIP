using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_approve_activates =
    new(new Item("2026-10-approve-activates", "Approving an agreement can move someone to Active",
        "An Admin can now choose, in Settings, Plan pricing, under Who may approve an agreement, to move a participant to Active when their service agreement is approved. It applies only to people still onboarding whose intake is finished, and Bunya Support never moves anyone back when an agreement ends. If someone can't be moved, the approval still stands and Bunya Support says why. It stays off until an Admin turns it on.",
        Staff, false));
}
