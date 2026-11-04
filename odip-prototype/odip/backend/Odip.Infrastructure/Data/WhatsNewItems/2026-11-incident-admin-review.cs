using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_incident_admin_review = new(
    new Item("2026-11-incident-admin-review", "Review incidents",
        "An incident now has a Review section: an Admin records review notes, the actions taken and the new status, and Bunya Support stamps who reviewed it and when. Coordinators can read the review, and the status history shows each change. Support workers don't see the review.",
        Staff, false));
}
