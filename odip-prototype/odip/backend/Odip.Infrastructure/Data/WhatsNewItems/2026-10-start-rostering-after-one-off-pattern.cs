using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_start_rostering_after_one_off_pattern = new(
    new Item("2026-10-start-rostering-after-one-off-pattern", "Start rostering after a one-off pattern",
        "Making shifts from a hand-made pattern no longer counts as starting the week. You can still press Start rostering on the Roster board to add everyone's agreement shifts for that week.",
        Staff, false));
}
