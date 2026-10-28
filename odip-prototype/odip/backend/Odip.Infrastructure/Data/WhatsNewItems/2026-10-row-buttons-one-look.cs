using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_row_buttons_one_look = new(24,
    new Item("2026-10-row-buttons-one-look", "Add and remove buttons match",
        "The add and remove buttons on intake contacts and risks, incident witnesses and restrictive practices now look and work like the rest of the app, and the witness choice works with arrow keys.",
        WhatsNewAudience.All, false));
}
