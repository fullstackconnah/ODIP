using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_intake_review_labels = new(12,
    new Item("2026-10-intake-review-labels", "Intake review shows plan details in words",
        "On the last step of an intake, the review now shows funding source, plan type, service streams, support ratio and overnight support in plain words instead of internal names.",
        Staff, false));
}
