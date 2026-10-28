using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_caregiver_review_readable = new(10,
    new Item("2026-10-caregiver-review-readable", "Caregiver form reviews are easier to read",
        "When you review a caregiver's form, each section now has the same name the caregiver saw, and the Field, Current and Caregiver's value columns line up from one section to the next.",
        Staff, false));
}
