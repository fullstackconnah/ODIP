using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_signin_unsent_notice = new(
    new Item("2026-11-signin-unsent-notice", "A warning before unsent changes are deleted",
        "If unsent changes from another worker are on the phone, the sign-in page now says so before they are deleted.",
        WhatsNewAudience.SupportWorker, false));
}
