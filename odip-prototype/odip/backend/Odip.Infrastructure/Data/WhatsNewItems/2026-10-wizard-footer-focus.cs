using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_wizard_footer_focus = new(11,
    new Item("2026-10-wizard-footer-focus", "Save and Submit keep your place while they work",
        "When you use Save and continue later, Save as draft or Submit, the keyboard focus now stays on that button while it saves, so you do not lose your place.\n\nOn small phones the buttons also fit: Back and Next stay together, and the save button sits on its own line below.",
        Staff, false));
}
