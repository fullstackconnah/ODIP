using Odip.Domain.Enums;

namespace Odip.Domain.Entities;

/// <summary>
/// Day-by-day itinerary entry for a trip.
/// </summary>
public class TripDay
{
    public Guid Id { get; set; }
    public Guid TripInstanceId { get; set; }
    public TripInstance TripInstance { get; set; } = null!;
    public int DayNumber { get; set; }
    public DateOnly Date { get; set; }
    public string? DayTitle { get; set; }
    public string? DayNotes { get; set; }
    public bool IsPublicHoliday { get; set; }
    public OvernightSupportType OvernightType { get; set; } = OvernightSupportType.None;
    public decimal OvernightHours { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public ICollection<ScheduledActivity> ScheduledActivities { get; set; } = new List<ScheduledActivity>();
}
