using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_incident_clock = new(
    new Item("2026-11-incident-clock", "The NDIS Commission deadline starts when you became aware",
        "When you edit an incident, the Review & compliance step now asks when you became aware of it. The deadline to tell the NDIS Commission counts from that time, and the incident page shows when it's due.\n\nFor incidents due within 24 hours, the 5-day detailed report is tracked too, with its own task. The app now says NDIS Commission where it used to say QSC.",
        Staff, false));
}
