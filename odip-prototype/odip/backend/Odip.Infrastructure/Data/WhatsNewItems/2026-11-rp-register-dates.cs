using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_rp_register_dates =
    new(new Item("2026-11-rp-register-dates", "Plan dates and end dates on the restrictive practice register",
        "Each entry on a participant's Restrictive practices tab can now say whether it is used routinely or as needed, when its authorisation ends, and when it was first used. From the first use date the tab shows when the interim and comprehensive behaviour support plans are due, and alerts you when the interim plan is due soon and when either plan is overdue. When you report a use of an authorised practice, you are now asked whether it was used as set out in the plan or varied. An authorised use that follows the plan is no longer flagged as due within 24 hours.",
        Staff, false));
}
