using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_compliance_dates = new(
    new Item("2026-11-compliance-dates", "Keep track of your compliance dates",
        "Open Settings and choose Compliance dates to record when your registration, audits, insurance and key personnel checks are due.\n\nAdmins get a task on the Tasks page 90 days before each date. It updates at 30 days and if the date passes. Coordinators can see the list.",
        Staff, false));
}
