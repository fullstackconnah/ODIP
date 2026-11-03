using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_staff_goal_hours = new(
    new Item("2026-11-staff-goal-hours", "Set each person's goal hours a week",
        "On a staff member's edit form you can now set the hours a week they aim to work. Bunya Support uses it to share shifts fairly when it drafts a roster. Leave it empty and full-time staff aim for your weekly hours setting, part-time staff for half of it.",
        Staff, false));
}
