using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_shift_cancel_notice = new(
    new Item("2026-10-shift-cancel-notice", "Workers are told when a shift is cancelled",
        "When you cancel a published shift that has a worker on it, they now get a notification saying the shift was cancelled, and an email if your organisation sends notification emails. The notification opens the shift. Draft shifts, shifts with nobody on them and shifts before today stay quiet.",
        Staff, false));
}
