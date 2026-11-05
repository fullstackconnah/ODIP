using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_rp_monthly_reports = new(
    new Item("2026-11-rp-monthly-reports", "Track restrictive practice monthly reports",
        "Incidents now has an RP monthly reports tab. Each authorised restrictive practice that needs reporting gets a line for every month once it ends, with its due date: 5 business days after the month, counting weekends and national public holidays. The NDIS Commission portal may differ.\n\nLodge each report in the portal, then record it here: pick the report type and the date you lodged it. As-needed practices list their recorded uses for the month. Download a month as CSV to help key it in.\n\nOverdue months show on the dashboard, on the participant's alerts and on each practice in the register.",
        Staff, false));
}
