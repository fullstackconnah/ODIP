using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_section_save_conflict = new(13,
    new Item("2026-10-section-save-conflict", "A section save now tells you when someone else saved it first",
        "If someone else saves the same section of a participant's profile while you are editing it, your save is stopped instead of quietly replacing theirs. What you typed stays in the form, and their version is shown beside it as Latest saved. Compare the two, then save again to replace their version, or cancel to keep it.",
        Staff, false));
}
