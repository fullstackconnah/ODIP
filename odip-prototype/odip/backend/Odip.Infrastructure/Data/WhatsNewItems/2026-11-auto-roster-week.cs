using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_auto_roster_week = new(
    new Item("2026-11-auto-roster-week", "Draft a week's roster in one step",
        "On the roster board, Auto-roster week fills open shifts with each shift's regular first, then the participant's Preferred, Backup and Emergency staff, sharing hours towards each person's goal. Nothing changes until you review the draft and apply it, and it lists any shift it couldn't cover, with suggestions.",
        Staff, false));
}
