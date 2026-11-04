using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_incident_urgent_alert =
    new(new Item("2026-11-incident-urgent-alert", "Urgent alert for 24-hour incidents",
        "When an incident must be reported to the NDIS Commission within 24 hours, Bunya Support now puts an urgent item at the top of your bell, with the deadline and a link straight to the incident. It goes to the admins and coordinators of your organisation once per incident, and it also appears if you change an incident to 24-hour reporting.",
        Staff, false));
}
