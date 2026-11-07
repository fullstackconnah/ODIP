using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_admin_account_guards = new(
    new Item("2026-11-admin-account-guards", "Admin accounts are protected",
        "Only an Admin can change or archive an Admin, and an organisation always keeps at least one active Admin.",
        Staff, false));
}
