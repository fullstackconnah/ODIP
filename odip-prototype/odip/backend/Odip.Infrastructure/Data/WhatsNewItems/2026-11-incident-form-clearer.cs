using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_incident_form_clearer = new(
    new Item("2026-11-incident-form-clearer", "A clearer incident report",
        "Severity is now numbered 1 to 4, with a short definition under each. Recording emergency services is easier: tick Police, Ambulance or Fire, then add the officer's name and reference for each. Sexual abuse is now an incident type on the 24-hour Commission clock, and the register entry for a restrictive practice has a place for the Commission reference.",
        Staff, false));
}
