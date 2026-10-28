using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_unsaved_prompt_clear_of_nav = new(21,
    new Item("2026-10-unsaved-prompt-clear-of-nav", "Unsaved changes prompt fits phones",
        "On a phone, the \"unsaved changes\" prompt no longer sits under the bottom menu.",
        WhatsNewAudience.All, false));
}
