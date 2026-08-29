using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// A per-day routine or shift-critical specific a support worker must know/do for a
/// participant — e.g. a morning routine, a mealtime requirement, or a communication
/// preference. <see cref="DayOfWeek"/> null means "every day"; <see cref="StartTime"/>/
/// <see cref="EndTime"/> null means untimed (applies across the whole day rather than a
/// specific window). Retired via <see cref="IsActive"/> rather than archived — unlike
/// <see cref="ParticipantNote"/>/<see cref="ParticipantMedication"/> this isn't a
/// compliance record, so it's also hard-deletable via the controller.
/// </summary>
public class ParticipantRoutine : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }

    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }

    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;

    public RoutineCategory Category { get; set; }

    /// <summary>Null means the routine applies every day.</summary>
    public DayOfWeek? DayOfWeek { get; set; }

    /// <summary>Null (with <see cref="EndTime"/> also null) means untimed — applies across the whole day.</summary>
    public TimeOnly? StartTime { get; set; }
    public TimeOnly? EndTime { get; set; }

    /// <summary>Must-know for shifts — support workers need to see this regardless of the shift window.</summary>
    public bool IsCritical { get; set; }
    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
