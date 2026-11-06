using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_compat_reason_optional = new(
    new Item("2026-11-compat-reason-optional", "A reason for No is now optional",
        "Marking a worker as No for a participant no longer needs a reason. You can still add one, and it is stored with the choice and visible in audit.",
        Staff, false));
}
