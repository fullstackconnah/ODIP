using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_participant_quick_add = new(
    new Item("2026-11-participant-quick-add", "Quick add on the participant Overview",
        "A participant's Overview now starts with Quick add tiles for notes, routines, restrictive practices, medications, contacts, plan budget and agreements. Each tile takes you to the right page, and the add form is already open where you can add straight away. You only see the tiles your role can use.",
        WhatsNewAudience.Admin | WhatsNewAudience.Coordinator | WhatsNewAudience.SupportWorker, false));
}
