using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_10_leave_approvals_1024 = new(20,
    new Item("2026-10-leave-approvals-1024", "Leave fits smaller screens",
        "On a laptop-sized screen the leave table now shows each person with their leave type, and the dates with who asked, so nothing scrolls sideways.",
        Staff, false));
}
