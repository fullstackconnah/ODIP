using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_finish_later = new(
    new Item("2026-11-finish-later", "End a shift now, add the details later",
        "Tap End shift and the shift ends at that time. Add kilometres, travel, notes and the handover then or later; a shift with details missing shows Needs details, and it can't be approved until they're in.",
        Staff | WhatsNewAudience.SupportWorker, false));
}
