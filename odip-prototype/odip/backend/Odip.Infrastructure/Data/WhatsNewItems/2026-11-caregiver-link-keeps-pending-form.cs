using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_caregiver_link_keeps_pending_form = new(
    new Item("2026-11-caregiver-link-keeps-pending-form", "A caregiver's answers are never lost to a new link",
        "A new caregiver link can't replace a form that is waiting for review, so the caregiver's answers are never lost. Accept or decline the form first.",
        Staff, false));
}
