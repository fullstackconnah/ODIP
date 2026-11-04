using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_extra_time_approval = new(
    new Item("2026-11-extra-time-approval", "Approve extra time before it goes to payroll",
        "When a worker starts more than 5 minutes early or finishes more than 5 minutes late, choose whether to pay the extra time, as you approve the shift or later. Until you approve it, Employment Hero gets the rostered hours.",
        Staff, false));
}
