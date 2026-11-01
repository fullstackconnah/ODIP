using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_my_account_profile = new(
    new Item("2026-11-my-account-profile", "Update your own name and mobile",
        "Update your name and mobile in Settings, under Profile, and send yourself a password reset email.",
        Staff, false));
}
