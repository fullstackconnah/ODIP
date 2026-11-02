using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_meal_break_with_participant = new(
    new Item("2026-11-meal-break-with-participant", "Breaks with the person you support",
        "When you finish a shift, mark each break On my own or With the person you support. A break with them counts as time worked and is paid. Coordinators can change it when they review the shift.",
        WhatsNewAudience.SupportWorker | WhatsNewAudience.Coordinator | WhatsNewAudience.Admin, false));
}
