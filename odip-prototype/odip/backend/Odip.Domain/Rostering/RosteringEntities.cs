using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Rostering;

/// <summary>Lifecycle of a <see cref="Shift"/>.</summary>
public enum ShiftStatus
{
    Draft = 0,
    Published = 1,
    Completed = 2,
    Cancelled = 3
}

/// <summary>
/// A staff-participant pairing preference. Three states, not a score — the absence of a
/// <see cref="StaffParticipantCompatibility"/> row for a pair means Allowed.
/// </summary>
public enum CompatibilityLevel
{
    Preferred = 0,
    Allowed = 1,
    Excluded = 2
}

/// <summary>
/// Severity of a <see cref="Odip.Domain.Rostering.Services.RosterFinding"/>. Blocking is
/// reserved for the one regulatory hard stop (expired worker screening) — everything else is
/// a Warning the coordinator may override with a reason.
/// </summary>
public enum RosterFindingSeverity
{
    Warning = 0,
    Blocking = 1
}

/// <summary>
/// A single rostered support shift for one participant on one day. <see cref="StaffId"/> is
/// null while the shift is unfilled. Trip staffing is tracked separately on
/// <see cref="StaffAssignment"/> — a <see cref="Shift"/> never represents trip work — but both
/// are read together by <see cref="Odip.Domain.Rostering.Services.RosterConflictService"/> so a
/// trip blocks a community shift and vice versa.
/// </summary>
public class Shift : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }

    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }

    /// <summary>Null means the shift is unfilled.</summary>
    public Guid? StaffId { get; set; }
    public Staff? Staff { get; set; }

    /// <summary>The day column this shift belongs to on the roster board.</summary>
    public DateOnly ServiceDate { get; set; }
    public TimeOnly StartTime { get; set; }
    public TimeOnly EndTime { get; set; }

    /// <summary>True for shifts crossing midnight, e.g. a 22:00-06:00 overnight shift.</summary>
    public bool EndsNextDay { get; set; }

    public SupportRatio Ratio { get; set; }
    public SleepoverType NightType { get; set; }
    public ShiftStatus Status { get; set; } = ShiftStatus.Draft;

    /// <summary>Provenance: the <see cref="ShiftPattern"/> this shift was generated from. Null for one-offs.</summary>
    public Guid? ShiftPatternId { get; set; }
    public string? Notes { get; set; }

    /// <summary>Why the coordinator accepted the Warning findings below, if any were.</summary>
    public string? OverrideReason { get; set; }

    /// <summary>Comma-separated <see cref="Services.RosterFinding.Code"/> values the coordinator acknowledged.</summary>
    public string? AcknowledgedFindingCodes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Length of the shift in hours, accounting for <see cref="EndsNextDay"/>.</summary>
    public decimal DurationHours
    {
        get
        {
            var start = StartTime.ToTimeSpan();
            var end = EndTime.ToTimeSpan();
            var span = EndsNextDay
                ? (TimeSpan.FromHours(24) - start) + end
                : end - start;
            return (decimal)span.TotalHours;
        }
    }
}

/// <summary>
/// A weekly-recurring template that <see cref="Services.ShiftPatternExpander"/> materialises
/// into <see cref="Shift"/> rows. Day-of-week + time + effective range only — no RRULE, no
/// monthly/nth-weekday recurrence.
/// </summary>
public class ShiftPattern : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }

    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }

    /// <summary>Staff pre-filled onto generated shifts. Null leaves generated shifts unfilled.</summary>
    public Guid? DefaultStaffId { get; set; }
    public Staff? DefaultStaff { get; set; }

    public DayOfWeek DayOfWeek { get; set; }
    public TimeOnly StartTime { get; set; }
    public TimeOnly EndTime { get; set; }
    public bool EndsNextDay { get; set; }
    public SupportRatio Ratio { get; set; }
    public SleepoverType NightType { get; set; }

    public DateOnly EffectiveFrom { get; set; }
    /// <summary>Inclusive. Null means the pattern has no end date.</summary>
    public DateOnly? EffectiveTo { get; set; }

    public bool IsActive { get; set; } = true;
    public string? Notes { get; set; }
}

/// <summary>
/// One cell of the staff-participant compatibility matrix. Absence of a row for a given
/// (StaffId, ParticipantId) pair means <see cref="CompatibilityLevel.Allowed"/>. Unique on
/// (TenantId, StaffId, ParticipantId) — enforced at the persistence layer.
/// </summary>
public class StaffParticipantCompatibility : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }

    public Guid StaffId { get; set; }
    public Staff? Staff { get; set; }

    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }

    public CompatibilityLevel Level { get; set; }
    public string? Reason { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
