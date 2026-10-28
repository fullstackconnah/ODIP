using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_caregiver_form_keeps_typing = new(8,
    new Item("2026-10-caregiver-form-keeps-typing", "Caregiver forms keep what you type while saving",
        "If a caregiver keeps typing while their form is saving, what they typed is now kept instead of being cleared when the save finishes.",
        Staff, false));
}
