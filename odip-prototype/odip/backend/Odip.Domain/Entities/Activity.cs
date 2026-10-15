using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// An organisation's library of reusable activity options.
/// </summary>
public class Activity : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }
    public Guid? EventTemplateId { get; set; }
    public EventTemplate? EventTemplate { get; set; }
    public string ActivityName { get; set; } = string.Empty;
    public ActivityCategory Category { get; set; }
    public string? Location { get; set; }
    public string? AccessibilityNotes { get; set; }
    public string? SuitabilityNotes { get; set; }
    public string? Notes { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public ICollection<ScheduledActivity> ScheduledActivities { get; set; } = new List<ScheduledActivity>();
}
