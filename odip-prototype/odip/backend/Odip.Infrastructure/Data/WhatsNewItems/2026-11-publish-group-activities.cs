using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_publish_group_activities = new(
    new Item("2026-11-publish-group-activities", "Publish week now includes group activities",
        "When group activities are on, Publish week sends out the week's draft group activities along with its shifts, and the people on them are notified. Each person gets one message, with their shifts and activities together.\n\nA week with only draft group activities can be published too. Publishing an activity from its own window tells the people on it as well.",
        Staff, false));
}
