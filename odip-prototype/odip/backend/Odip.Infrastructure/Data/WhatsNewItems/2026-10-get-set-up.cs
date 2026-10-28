using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_get_set_up = new(14,
    new Item("2026-10-get-set-up", "Get set up from the dashboard",
        "A new organisation now sees Get set up at the top of the dashboard: six steps, from your organisation details to your first invoice, each with its status and what to do next.\n\nStaff imports now email each new staff member a sign-in invite straight after the import. Keep the tab open until the invites finish.\n\nHide the steps on a device, and show them again from Settings, Organisation setup.",
        WhatsNewAudience.Admin, false));
}
