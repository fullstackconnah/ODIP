using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// Reusable event/holiday concept (e.g. "Gold Coast Beach Break").
/// </summary>
public class EventTemplate : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }
    public string EventCode { get; set; } = string.Empty;
    public string EventName { get; set; } = string.Empty;
    public string? DefaultDestination { get; set; }
    public string? DefaultRegion { get; set; }
    public string? PreferredTimeOfYear { get; set; }
    public int? StandardDurationDays { get; set; }
    public string? AccessibilityNotes { get; set; }
    public string? FullyModifiedAccommodationNotes { get; set; }
    public string? SemiModifiedAccommodationNotes { get; set; }
    public string? WheelchairAccessNotes { get; set; }
    public string? TypicalActivities { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public ICollection<TripInstance> TripInstances { get; set; } = new List<TripInstance>();
    public ICollection<Activity> Activities { get; set; } = new List<Activity>();
}
