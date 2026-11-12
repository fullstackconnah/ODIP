using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_shift_cancellation_reason = new(
    new Item("2026-11-shift-cancellation-reason", "Say why a shift was cancelled",
        "When you cancel a shift, the shift panel now asks why. Choose a reason such as participant unwell, staff unavailable or weather. You can change it later by opening the cancelled shift.\n\nReports has a new Cancellations by reason table, so you can see why shifts were cancelled over any date range and download it as a CSV file. Shifts cancelled before today show Not recorded.",
        Staff, false));
}
