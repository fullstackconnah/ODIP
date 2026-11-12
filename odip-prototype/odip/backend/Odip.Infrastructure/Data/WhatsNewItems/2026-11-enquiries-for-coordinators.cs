using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_enquiries_for_coordinators = new(
    new Item("2026-11-enquiries-for-coordinators", "Enquiries are for coordinators and admins",
        "Enquiries are now for coordinators and admins. Support workers no longer see the Enquiries tab.",
        Staff, false));
}
