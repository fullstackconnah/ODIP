using Odip.Domain.Entities;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Rostering;

/// <summary>
/// One outing or session several participants attend together (group activities D2). Each participant is their own <see cref="Shift"/>, linked by <see cref="Shift.GroupActivityId"/>; the
/// workers live on <see cref="GroupActivityStaff"/> rows, never on those shifts. Status reuses <see cref="ShiftStatus"/> (PR1 writes Draft, Published and Cancelled; later states lock the activity).
/// </summary>
public class GroupActivity : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }

    public DateOnly ServiceDate { get; set; }
    public TimeOnly StartTime { get; set; }
    public TimeOnly EndTime { get; set; }
    public bool EndsNextDay { get; set; }

    public string Title { get; set; } = string.Empty;
    public Guid? ActivityId { get; set; }
    public Activity? Activity { get; set; }
    public string? Location { get; set; }
    public Guid? ServiceLocationId { get; set; }
    public ServiceLocation? ServiceLocation { get; set; }
    public string? Notes { get; set; }

    /// <summary>The fewest workers the activity needs whatever its ratios say (0 to 20); null means none beyond the ratios.</summary>
    public int? MinStaffRequired { get; set; }

    public ShiftStatus Status { get; set; } = ShiftStatus.Draft;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CancelledAt { get; set; }

    public ICollection<GroupActivityStaff> Staff { get; set; } = new List<GroupActivityStaff>();
}

/// <summary>A worker on a <see cref="GroupActivity"/>, for their own part of its window. One row per worker; a busy period to every roster rule (<c>RosterAvailability.ActivityStaffBusyAsync</c>).</summary>
public class GroupActivityStaff : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }

    public Guid GroupActivityId { get; set; }
    public GroupActivity? GroupActivity { get; set; }

    public Guid UserId { get; set; }
    public User? User { get; set; }

    public TimeOnly StartTime { get; set; }
    public TimeOnly EndTime { get; set; }
    public bool EndsNextDay { get; set; }

    public string? Role { get; set; }

    /// <summary>Why the coordinator accepted the Warning findings below, if any were (as <see cref="Shift.OverrideReason"/>).</summary>
    public string? OverrideReason { get; set; }

    /// <summary>Comma-separated finding codes the coordinator acknowledged (as <see cref="Shift.AcknowledgedFindingCodes"/>).</summary>
    public string? AcknowledgedFindingCodes { get; set; }
}
