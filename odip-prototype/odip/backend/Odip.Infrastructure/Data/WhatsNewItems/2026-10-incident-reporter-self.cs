using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_incident_reporter_self = new(
    new Item("2026-10-incident-reporter-self", "Incidents you report are filed under your name",
        "When a support worker reports an incident, the form now shows them as the reporter, and that's how it's saved.\n\nCoordinators and admins can still choose who reported it.",
        WhatsNewAudience.All, false));
}
