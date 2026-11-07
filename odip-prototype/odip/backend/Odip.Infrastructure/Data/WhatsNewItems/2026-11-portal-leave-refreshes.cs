using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_portal_leave_refreshes = new(
    new Item("2026-11-portal-leave-refreshes", "Your leave list updates when a request was already decided",
        "If your leave request was decided while you had it open, the Portal now shows the decision straight after you try to withdraw it.",
        WhatsNewAudience.SupportWorker, false));
}
