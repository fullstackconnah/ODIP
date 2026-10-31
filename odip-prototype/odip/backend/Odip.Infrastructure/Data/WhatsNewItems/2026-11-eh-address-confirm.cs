using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_eh_address_confirm = new(
    new Item("2026-11-eh-address-confirm", "Check new Employment Hero email addresses",
        "When Employment Hero brings someone in with an email address that isn't at your organisation's domain or a common email provider, they can't sign in until you confirm it. Open the person's staff page, where a note explains it, and choose Confirm address.",
        Staff, false));
}
