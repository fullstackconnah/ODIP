using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_incident_rp_list = new(
    new Item("2026-11-incident-rp-list", "Every restrictive practice on the register, with its kind",
        "When you report a restrictive practice use, the form now lists every restrictive practice on the participant's register, each with its kind. Pick the one that was used, or pick \"None of these\" and describe it.",
        WhatsNewAudience.Admin | WhatsNewAudience.Coordinator | WhatsNewAudience.SupportWorker, false));
}
