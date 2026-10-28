using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_forms_keep_typing = new(9,
    new Item("2026-10-forms-keep-typing", "Intake and task forms keep what you type",
        "If the participant or task you are editing refreshes in the background, for example when you come back to the browser tab, what you have typed now stays.\n\nWhen you open a task again after saving it, it shows its latest details.",
        Staff, false));
}
