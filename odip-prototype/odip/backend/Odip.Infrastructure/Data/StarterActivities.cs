using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.Data;

/// <summary>
/// The generic activities every organisation starts with (no event template). The demo seed uses them with their fixed ids, because its itineraries point at them; setting an organisation up copies
/// them with fresh ids. The library is per organisation and nothing in the app creates activities, so without this a new organisation's picker would be empty.
/// </summary>
public static class StarterActivities
{
    public static List<Activity> For(Guid tenantId, bool keepSeedIds = false)
    {
        Guid IdOf(string seedId) => keepSeedIds ? Guid.Parse(seedId) : Guid.NewGuid();
        return
        [
            new() { Id = IdOf("06000000-0000-0000-0000-000000000014"), TenantId = tenantId, ActivityName = "Group Dinner Out", Category = ActivityCategory.Dining, Location = "Various", SuitabilityNotes = "Check dietary requirements and sensory environment" },
            new() { Id = IdOf("06000000-0000-0000-0000-000000000015"), TenantId = tenantId, ActivityName = "Movie Night In", Category = ActivityCategory.Leisure, Location = "Accommodation", SuitabilityNotes = "All abilities. Good wind-down activity." },
            new() { Id = IdOf("06000000-0000-0000-0000-000000000016"), TenantId = tenantId, ActivityName = "Arrival & Settling In", Category = ActivityCategory.Transport, SuitabilityNotes = "Allow extra time for transitions" },
            new() { Id = IdOf("06000000-0000-0000-0000-000000000017"), TenantId = tenantId, ActivityName = "Departure & Travel Home", Category = ActivityCategory.Transport },
            new() { Id = IdOf("06000000-0000-0000-0000-000000000018"), TenantId = tenantId, ActivityName = "Free Time / Rest", Category = ActivityCategory.Leisure, SuitabilityNotes = "All abilities. Build into every day." },
            new() { Id = IdOf("06000000-0000-0000-0000-000000000019"), TenantId = tenantId, ActivityName = "Bowling", Category = ActivityCategory.Sport, AccessibilityNotes = "Most bowling alleys have ramps and lightweight balls", SuitabilityNotes = "All abilities with support" },
            new() { Id = IdOf("06000000-0000-0000-0000-000000000020"), TenantId = tenantId, ActivityName = "Local Café Visit", Category = ActivityCategory.Dining, Location = "Various", AccessibilityNotes = "Check accessibility per venue" },
            new() { Id = IdOf("06000000-0000-0000-0000-000000000025"), TenantId = tenantId, ActivityName = "Sensory Art Session", Category = ActivityCategory.Cultural, Location = "Accommodation / Community Hall", AccessibilityNotes = "All abilities. Low sensory environment.", SuitabilityNotes = "Particularly good for participants with ABI or sensory sensitivities." },
        ];
    }
}
