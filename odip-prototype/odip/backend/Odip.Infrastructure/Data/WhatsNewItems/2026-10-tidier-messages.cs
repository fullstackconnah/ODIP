using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_tidier_messages = new(
    new Item("2026-10-tidier-messages", "Clearer messages and no double Start",
        "Start shift can no longer be tapped twice while your location is being checked, and it shows Starting\u2026 straight away.\n\nError messages now read the same way everywhere and say what to do next, and tables with nothing in them say what is missing instead of \"No data\". The Agreements switches are gone from Notifications until those emails exist.",
        WhatsNewAudience.All, false));
}
