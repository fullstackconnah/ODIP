using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_participant_agreements = new(
    new Item("2026-11-participant-agreements", "Agreements on the participant page",
        "A participant's page now has an Agreements tab that lists every version of their service agreement. Open or edit a draft, delete one that was never approved, start a new revision of the current agreement, or end it early from a chosen last day. Ended agreements stay in the history, so their claims stay traceable.",
        Staff, false));
}
