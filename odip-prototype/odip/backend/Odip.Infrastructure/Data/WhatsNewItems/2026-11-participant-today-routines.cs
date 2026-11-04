using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_participant_today_routines = new(
    new Item("2026-11-participant-today-routines", "Today's routines on the participant page",
        "On a participant's Overview in Bunya Support, a new Today's routines card lists what is on today, critical routines first. Empty fields on the record now read the same way everywhere.",
        Staff, false));
}
