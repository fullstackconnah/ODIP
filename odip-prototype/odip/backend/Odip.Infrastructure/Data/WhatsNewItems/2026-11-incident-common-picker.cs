using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_incident_common_picker = new(
    new Item("2026-11-incident-common-picker", "Pick a common incident to fill the form faster",
        "On the new incident form, a \"Common incident\" list at the top fills in the title, the type and a few prompts for what to write. Pick the one closest to what happened. You can still change everything, and you still choose the severity.",
        WhatsNewAudience.Admin | WhatsNewAudience.Coordinator | WhatsNewAudience.SupportWorker, false));
}
