using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_complaints_register = new(
    new Item("2026-11-complaints-register", "Complaints register",
        "A new Complaints page in the menu, under Incidents, keeps every complaint in one place: when it came in, who made it, what was done and the outcome. You can see how long each one has been open, find those open longer than 21 days, and record that you told the person they can go to the NDIS Commission. Bunya Support never contacts the NDIS Commission for you. Only Admins and Coordinators can see complaints.",
        Staff, false));
}
