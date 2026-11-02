using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_casual_fortnight_hours = new(
    new Item("2026-11-casual-fortnight-hours", "Set who is casual, and see a warning past 76 hours a fortnight",
        "On a staff member's edit form you can now set their employment type: full-time, part-time or casual. When a shift would take a casual worker past 76 hours in the fortnight, the roster warns you. It never stops the shift.",
        Staff, false));
}
