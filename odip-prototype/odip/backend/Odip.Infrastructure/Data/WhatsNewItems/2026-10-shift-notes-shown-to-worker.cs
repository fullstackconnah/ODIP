using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_shift_notes_shown_to_worker =
    new(new Item("2026-10-shift-notes-shown-to-worker", "Shift notes are shown to the support worker",
        "Notes typed on a shift appear to the assigned support worker in their portal, under \"From the office\". Don't write anything there the worker shouldn't read. To check one, open a shift on the Roster board and look under Notes.",
        Staff, false));
}
