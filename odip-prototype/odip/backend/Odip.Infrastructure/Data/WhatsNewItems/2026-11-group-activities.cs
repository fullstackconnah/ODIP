using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_group_activities = new(
    new Item("2026-11-group-activities", "Group activities",
        "An admin turns on Group activities in Settings, under Workspace visibility. A group line on a service agreement then shows on the participant's board row, where you add them to an activity that day or create one. Click an activity to manage its participants, staff and each participant's ratio, and drop staff on it like a shift. Mark anyone who didn't attend. Group staff hours reach Payroll and the dashboard's approval tab, and attaching a participant's shift to the activity bills their share.",
        Staff, false));
}
