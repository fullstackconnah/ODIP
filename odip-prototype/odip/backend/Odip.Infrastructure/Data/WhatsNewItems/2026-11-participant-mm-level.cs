using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_participant_mm_level = new(
    new Item("2026-11-participant-mm-level", "Travel caps follow the participant's remoteness",
        "Set a participant's MM level on their Address & Living Arrangements card. Shifts not made from an agreement then use it for the travel time cap: 60 minutes in MM 4–⁠5, none in MM 6–⁠7.",
        Staff, false));
}
