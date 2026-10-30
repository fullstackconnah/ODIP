using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_invite_confirm =
    new(new Item("2026-10-invite-confirm", "Sign-in invites now skip people already invited",
        "Send sign-in invites in Import history now says how many staff are still to invite and asks before sending. Staff who were already invited are skipped unless you choose to send to them again, and each staff member's page shows when their invite was sent.",
        WhatsNewAudience.Admin, false));
}
