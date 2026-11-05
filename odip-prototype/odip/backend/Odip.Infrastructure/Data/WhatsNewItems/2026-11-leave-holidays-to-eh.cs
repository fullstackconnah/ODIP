using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_leave_holidays_to_eh = new(
    new Item("2026-11-leave-holidays-to-eh", "Leave sent to Employment Hero skips public holidays",
        "Leave sent to Employment Hero now skips your organisation's public holidays as well as weekends, so a leave over a holiday shows fewer hours on the leave approvals page. Leave sent before this change keeps its hours.",
        Staff, false));
}
